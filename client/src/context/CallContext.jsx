import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './SocketContext.jsx';
import { useToast } from './ToastContext.jsx';
import { callsApi } from '../services/api.js';
import CallOverlay from '../components/calls/CallUI.jsx';

const CallContext = createContext(null);

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside CallProvider');
  return ctx;
}

// What the person reads when a call ends (null = just close, e.g. it was answered on another device).
const END_NOTICE = {
  declined: 'Call declined',
  no_answer: 'No answer',
  cancelled: 'Call ended',
  ended: 'Call ended',
  connection_lost: 'Connection lost',
};
const NOTICE_MS = 2200;

function mediaProblem(error) {
  if (!navigator.mediaDevices?.getUserMedia) return 'Calls need a secure (https) connection and a browser that supports them.';
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'VYBE needs permission to use your microphone (and camera for video). Allow it in your browser and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone or camera was found on this device.';
    case 'NotReadableError':
      return 'Your microphone or camera is being used by another app.';
    default:
      return 'Could not start the microphone or camera.';
  }
}

/** A soft repeating beep while a call is ringing. Silent (and harmless) if the browser blocks audio. */
function startRingtone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    gain.connect(ctx.destination);
    const burst = () => {
      [0, 0.5].forEach((delay) => {
        const osc = ctx.createOscillator();
        osc.frequency.value = 520;
        osc.connect(gain);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.3);
      });
    };
    burst();
    const timer = setInterval(burst, 2200);
    return () => {
      clearInterval(timer);
      ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

/**
 * One call at a time. Owns the WebRTC connection and the call screens.
 *   call.status: 'calling' (ringing them) | 'incoming' | 'connecting' | 'active' | 'ended' (shows the result briefly)
 * Signalling goes through the socket; audio and video go straight between the two browsers.
 */
export function CallProvider({ children }) {
  const { socket } = useSocket();
  const toast = useToast();
  const [call, setCall] = useState(null);
  const [streams, setStreams] = useState({ local: null, remote: null });
  const [missed, setMissed] = useState(0);
  const callRef = useRef(null);
  callRef.current = call;
  // Everything WebRTC lives outside React state: it must survive renders and never trigger them.
  const rtc = useRef({ pc: null, local: null, callId: null, queue: [], candidates: [], remoteSet: false, cancelled: false, noticeTimer: null });

  // Waits briefly for the connection (just after the page opens it may still be connecting).
  const emit = useCallback(async (event, payload) => {
    const offline = { ok: false, error: { message: 'You are offline. Check your connection and try again.' } };
    if (!socket) return offline;
    if (!socket.connected) {
      const connected = await new Promise((resolve) => {
        const timer = setTimeout(() => { socket.off('connect', onConnect); resolve(false); }, 3000);
        function onConnect() { clearTimeout(timer); resolve(true); }
        socket.once('connect', onConnect);
      });
      if (!connected) return offline;
    }
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: { message: 'The server did not answer. Please try again.' } } : res));
    });
  }, [socket]);

  const sendSignal = useCallback((data) => {
    if (rtc.current.callId) socket?.emit('call:signal', { callId: rtc.current.callId, data });
  }, [socket]);

  const teardown = useCallback(() => {
    const r = rtc.current;
    if (r.pc) {
      r.pc.onicecandidate = null; r.pc.ontrack = null; r.pc.onconnectionstatechange = null;
      r.pc.close();
    }
    r.local?.getTracks().forEach((t) => t.stop());
    Object.assign(r, { pc: null, local: null, callId: null, queue: [], candidates: [], remoteSet: false });
    setStreams({ local: null, remote: null });
  }, []);

  /** Show how the call ended for a moment, then close the screen. */
  const finish = useCallback((notice) => {
    teardown();
    clearTimeout(rtc.current.noticeTimer);
    if (!notice) { setCall(null); return; }
    setCall((c) => (c ? { ...c, status: 'ended', notice, reconnecting: false } : c));
    rtc.current.noticeTimer = setTimeout(() => setCall(null), NOTICE_MS);
  }, [teardown]);

  const getMedia = useCallback(async (type) => {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'Unsupported' });
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: type === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  }, []);

  const flushSignals = useCallback(async () => {
    const r = rtc.current;
    while (r.queue.length && r.pc) await handleSignalRef.current(r.queue.shift());
  }, []);

  const makePeer = useCallback((iceServers, stream) => {
    const r = rtc.current;
    const pc = new RTCPeerConnection({ iceServers });
    r.pc = pc;
    r.local = stream;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    setStreams((s) => ({ ...s, local: stream }));
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => setStreams((s) => ({ ...s, remote: e.streams[0] || new MediaStream([e.track]) }));
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') setCall((c) => (c && c.status !== 'ended' ? { ...c, status: 'active', startedAt: c.startedAt || Date.now(), reconnecting: false } : c));
      else if (state === 'disconnected') setCall((c) => (c && c.status === 'active' ? { ...c, reconnecting: true } : c));
      else if (state === 'failed') {
        const id = r.callId;
        if (id) socket?.emit('call:end', { callId: id });
        toast.error('The call could not connect. Check your network and try again.');
        finish('Call failed');
      }
    };
    return pc;
  }, [sendSignal, socket, toast, finish]);

  const handleSignalRef = useRef(null);
  handleSignalRef.current = async (data) => {
    const r = rtc.current;
    if (!r.pc) { r.queue.push(data); return; } // arrived before our side was ready
    try {
      if (data.type === 'offer') {
        await r.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        r.remoteSet = true;
        for (const c of r.candidates.splice(0)) await r.pc.addIceCandidate(c).catch(() => {});
        const answer = await r.pc.createAnswer();
        await r.pc.setLocalDescription(answer);
        sendSignal({ type: 'answer', sdp: answer.sdp });
      } else if (data.type === 'answer') {
        await r.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        r.remoteSet = true;
        for (const c of r.candidates.splice(0)) await r.pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        if (r.remoteSet) await r.pc.addIceCandidate(data.candidate).catch(() => {});
        else r.candidates.push(data.candidate);
      } else if (typeof data.camera === 'boolean') {
        setCall((c) => (c ? { ...c, remoteCamOff: !data.camera } : c));
      }
    } catch (e) {
      console.error('[call] signalling', e);
    }
  };

  // ----- actions -----
  const startCall = useCallback(async (conversationId, type, peer) => {
    if (callRef.current) return;
    const r = rtc.current;
    r.cancelled = false;
    clearTimeout(r.noticeTimer);
    setCall({ status: 'calling', type, peer, direction: 'outgoing', conversationId, muted: false, camOff: false, remoteCamOff: false });
    let stream;
    try {
      stream = await getMedia(type);
    } catch (e) {
      setCall(null);
      toast.error(mediaProblem(e));
      return;
    }
    if (r.cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
    r.local = stream;
    setStreams((s) => ({ ...s, local: stream }));
    const res = await emit('call:start', { conversationId, type });
    if (r.cancelled) {
      if (res.ok && res.call?.id) socket?.emit('call:end', { callId: res.call.id });
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if (!res.ok) {
      stream.getTracks().forEach((t) => t.stop());
      setStreams({ local: null, remote: null });
      setCall(null);
      toast.error(res.error?.message || 'Could not start the call.');
      return;
    }
    if (res.call.status === 'busy') {
      finish('Busy');
      return;
    }
    r.callId = res.call.id;
    makePeer(res.iceServers, stream);
    setCall((c) => (c ? { ...c, id: res.call.id } : c));
  }, [emit, finish, getMedia, makePeer, socket, toast]);

  const accept = useCallback(async () => {
    const current = callRef.current;
    if (!current || current.status !== 'incoming') return;
    let stream;
    try {
      stream = await getMedia(current.type);
    } catch (e) {
      socket?.emit('call:decline', { callId: current.id });
      setCall(null);
      toast.error(mediaProblem(e));
      return;
    }
    setCall((c) => (c ? { ...c, status: 'connecting', muted: false, camOff: false, remoteCamOff: false } : c));
    const res = await emit('call:answer', { callId: current.id });
    if (!res.ok) {
      stream.getTracks().forEach((t) => t.stop());
      finish(res.error?.code === 'call_gone' ? null : 'Call failed');
      if (res.error?.code !== 'call_gone') toast.error(res.error?.message || 'Could not answer the call.');
      return;
    }
    rtc.current.callId = current.id;
    makePeer(res.iceServers, stream);
    await flushSignals();
  }, [emit, finish, flushSignals, getMedia, makePeer, socket, toast]);

  const decline = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    socket?.emit('call:decline', { callId: current.id });
    finish(null);
  }, [finish, socket]);

  const hangup = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    if (current.status === 'incoming') return decline();
    rtc.current.cancelled = true; // also cancels a call that has not finished starting
    const id = rtc.current.callId || current.id;
    if (id) socket?.emit('call:end', { callId: id });
    return finish(current.status === 'active' ? 'Call ended' : 'Call cancelled');
  }, [decline, finish, socket]);

  const toggleMute = useCallback(() => {
    const track = rtc.current.local?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCall((c) => (c ? { ...c, muted: !track.enabled } : c));
  }, []);

  const toggleCamera = useCallback(() => {
    const track = rtc.current.local?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    sendSignal({ camera: track.enabled });
    setCall((c) => (c ? { ...c, camOff: !track.enabled } : c));
  }, [sendSignal]);

  // ----- server events -----
  useEffect(() => {
    if (!socket) return undefined;

    const onIncoming = ({ call: incoming }) => {
      if (callRef.current) return; // the server already treats us as busy; never stack screens
      clearTimeout(rtc.current.noticeTimer);
      setCall({ id: incoming.id, status: 'incoming', type: incoming.type, peer: incoming.peer, direction: 'incoming', conversationId: incoming.conversationId });
    };
    const onAccepted = async ({ call: accepted }) => {
      const r = rtc.current;
      if (!r.pc || callRef.current?.id !== accepted.id) return;
      setCall((c) => (c ? { ...c, status: 'connecting' } : c));
      try {
        const offer = await r.pc.createOffer();
        await r.pc.setLocalDescription(offer);
        sendSignal({ type: 'offer', sdp: offer.sdp });
      } catch (e) {
        console.error('[call] offer', e);
      }
    };
    const onSignal = ({ callId, data }) => {
      if (callRef.current?.id !== callId) return;
      handleSignalRef.current(data);
    };
    const onEnded = ({ call: ended, reason }) => {
      const current = callRef.current;
      if (!current || current.id !== ended.id) return;
      if (reason === 'answered_elsewhere') { finish(null); return; }
      if (current.status === 'incoming') { finish(reason === 'no_answer' || reason === 'cancelled' ? 'Missed call' : null); return; }
      finish(END_NOTICE[reason] || 'Call ended');
    };
    const onBadge = ({ missed: n }) => setMissed(n);
    const onDisconnect = () => {
      if (callRef.current && callRef.current.status !== 'ended') finish('Connection lost');
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:signal', onSignal);
    socket.on('call:ended', onEnded);
    socket.on('call:badge', onBadge);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:signal', onSignal);
      socket.off('call:ended', onEnded);
      socket.off('call:badge', onBadge);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket, finish, sendSignal]);

  // Missed-call badge after sign-in / reconnect.
  useEffect(() => {
    if (!socket) return undefined;
    const load = () => callsApi.unseen().then((d) => setMissed(d.missed)).catch(() => {});
    if (socket.connected) load();
    socket.on('connect', load);
    return () => socket.off('connect', load);
  }, [socket]);

  // Ringtone and tab title while an incoming call rings.
  const ringing = call?.status === 'incoming';
  useEffect(() => {
    if (!ringing) return undefined;
    const stop = startRingtone();
    const title = document.title;
    document.title = '📞 Incoming call · VYBE';
    return () => { stop(); document.title = title; };
  }, [ringing]);

  // Leaving the page must free the microphone and camera.
  useEffect(() => () => { clearTimeout(rtc.current.noticeTimer); teardown(); }, [teardown]);

  const value = useMemo(
    () => ({ call, streams, missed, setMissed, busy: Boolean(call), startCall, accept, decline, hangup, toggleMute, toggleCamera }),
    [call, streams, missed, startCall, accept, decline, hangup, toggleMute, toggleCamera]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallOverlay />
    </CallContext.Provider>
  );
}