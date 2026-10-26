import { useEffect, useRef, useState } from 'react';
import { Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { Avatar } from '../common/Common.jsx';
import { useCall } from '../../context/CallContext.jsx';

const CALL_CSS = `
.call-incoming { position: fixed; z-index: 120; top: var(--space-4); right: var(--space-4); width: min(360px, calc(100vw - 2 * var(--space-4))); padding: var(--space-4); display: flex; align-items: center; gap: var(--space-4); background: var(--color-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg, 16px); box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55); animation: call-pop 0.2s ease-out; }
.call-incoming-text { flex: 1; min-width: 0; }
.call-incoming-text strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.call-incoming-text span { color: var(--color-text-muted); font-size: var(--text-sm); }
.call-incoming-actions { display: flex; gap: var(--space-3); }
.call-round { width: 48px; height: 48px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; border: 0; cursor: pointer; color: #fff; background: rgba(255, 255, 255, 0.14); transition: filter 0.15s, background 0.15s; }
.call-round:hover:not(:disabled) { filter: brightness(1.15); }
.call-round:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.call-round.accept { background: #1fa971; }
.call-round.end { background: #e5484d; }
.call-round.off { background: #fff; color: #1a0b1f; }
.call-screen { position: fixed; inset: 0; z-index: 110; display: flex; flex-direction: column; background: radial-gradient(circle at 50% 30%, #3a1647 0%, #170a1d 70%); color: #fff; }
.call-top { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: calc(var(--space-5) + env(safe-area-inset-top, 0px)) var(--space-4) var(--space-3); text-align: center; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6); }
.call-top strong { font-size: var(--text-lg, 20px); }
.call-status { font-size: var(--text-sm); opacity: 0.85; font-variant-numeric: tabular-nums; }
.call-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.call-avatar-wrap { position: relative; display: flex; align-items: center; justify-content: center; }
.call-avatar-wrap::before, .call-avatar-wrap::after { content: ''; position: absolute; inset: -14px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); opacity: 0; }
.call-avatar-wrap.ringing::before { animation: call-ring 2s infinite; }
.call-avatar-wrap.ringing::after { animation: call-ring 2s 1s infinite; }
.call-video-main { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
.call-video-main.mirror, .call-pip video.mirror { transform: scaleX(-1); }
.call-pip { position: absolute; z-index: 3; right: var(--space-4); bottom: var(--space-3); width: 132px; aspect-ratio: 3 / 4; padding: 0; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: var(--radius-md); overflow: hidden; background: #000; cursor: pointer; }
.call-pip video { width: 100%; height: 100%; object-fit: cover; display: block; }
.call-pip-off { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #241029; }
.call-banner { position: absolute; z-index: 3; top: 8px; left: 50%; transform: translateX(-50%); padding: 6px 14px; border-radius: 999px; background: rgba(0, 0, 0, 0.6); font-size: var(--text-sm); }
.call-controls { position: relative; z-index: 2; display: flex; justify-content: center; gap: var(--space-4); padding: var(--space-4) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom, 0px)); }
.call-controls .call-round { width: 56px; height: 56px; }
@media (max-width: 600px) {
  .call-incoming { top: 0; left: 0; right: 0; width: auto; border-radius: 0 0 16px 16px; padding-top: calc(var(--space-4) + env(safe-area-inset-top, 0px)); }
  .call-pip { width: 96px; right: var(--space-3); }
  .call-controls { gap: var(--space-3); }
}
@keyframes call-ring { 0% { transform: scale(0.9); opacity: 0.7; } 100% { transform: scale(1.5); opacity: 0; } }
@keyframes call-pop { from { transform: translateY(-12px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .call-avatar-wrap.ringing::before, .call-avatar-wrap.ringing::after, .call-incoming { animation: none; } }
`;

const pad = (n) => String(n).padStart(2, '0');
function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function Timer({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{formatDuration(Math.max(0, Math.floor((now - since) / 1000)))}</span>;
}

/** <video>/<audio> that plays a MediaStream. */
function StreamEl({ stream, muted = false, tag: Tag = 'video', className, 'data-testid': testId }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream || null;
    if (stream) el.play?.().catch(() => {});
  }, [stream]);
  const extra = Tag === 'video' ? { playsInline: true } : {};
  return <Tag ref={ref} autoPlay muted={muted} className={className} data-testid={testId} {...extra} />;
}

function statusText(call) {
  if (call.status === 'ended') return call.notice;
  if (call.reconnecting) return 'Reconnecting…';
  if (call.status === 'calling') return 'Calling…';
  if (call.status === 'connecting') return 'Connecting…';
  return null; // active: the timer
}

export default function CallOverlay() {
  const { call, streams, accept, decline, hangup, toggleMute, toggleCamera } = useCall();
  const screenRef = useRef(null);
  const [swap, setSwap] = useState(false); // big picture shows me instead of them
  const [full, setFull] = useState(false);

  useEffect(() => { if (!call) { setSwap(false); } }, [call]);
  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (!call) return null;
  const name = call.peer?.name || 'Unknown';
  const isVideo = call.type === 'video';

  if (call.status === 'incoming') {
    return (
      <>
        <style>{CALL_CSS}</style>
        <div className="call-incoming" role="alertdialog" aria-label={`Incoming ${call.type} call from ${name}`} data-testid="call-incoming">
          <Avatar name={name} id={call.peer?.id} src={call.peer?.avatarUrl} size={52} />
          <div className="call-incoming-text">
            <strong>{name}</strong>
            <span>Incoming {isVideo ? 'video' : 'voice'} call…</span>
          </div>
          <div className="call-incoming-actions">
            <button type="button" className="call-round end" onClick={decline} aria-label="Decline call"><PhoneOff size={22} aria-hidden="true" /></button>
            <button type="button" className="call-round accept" onClick={accept} aria-label="Accept call">
              {isVideo ? <Video size={22} aria-hidden="true" /> : <Phone size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </>
    );
  }

  const text = statusText(call);
  const live = call.status === 'active';
  const showRemoteVideo = isVideo && streams.remote && live && !call.remoteCamOff;
  const localVideoOn = isVideo && streams.local && !call.camOff;
  const bigIsMe = isVideo && swap && live;
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else screenRef.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <>
      <style>{CALL_CSS}</style>
      <div className="call-screen" role="dialog" aria-label={`${isVideo ? 'Video' : 'Voice'} call with ${name}`} ref={screenRef} data-testid="call-screen">
        {/* Remote audio always plays through here, with or without video. */}
        <StreamEl tag="audio" stream={streams.remote} />
        <div className="call-top">
          <strong>{name}</strong>
          <span className="call-status" role="status" aria-live="polite" data-testid="call-status">
            {text || (call.startedAt ? <Timer since={call.startedAt} /> : '')}
          </span>
        </div>

        <div className="call-stage">
          {isVideo && live ? (
            <>
              {bigIsMe ? (
                localVideoOn ? <StreamEl stream={streams.local} muted className="call-video-main mirror" data-testid="call-video-local" /> : null
              ) : showRemoteVideo ? (
                <StreamEl stream={streams.remote} className="call-video-main" data-testid="call-video-remote" />
              ) : null}
              {((bigIsMe && !localVideoOn) || (!bigIsMe && !showRemoteVideo)) && (
                <div className="call-avatar-wrap"><Avatar name={name} id={call.peer?.id} src={call.peer?.avatarUrl} size={120} /></div>
              )}
              {call.remoteCamOff && !bigIsMe && <span className="call-banner">{name} turned their camera off</span>}
              <button type="button" className="call-pip" onClick={() => setSwap((v) => !v)} aria-label="Swap the big and small picture" data-testid="call-pip">
                {bigIsMe ? (
                  showRemoteVideo ? <StreamEl stream={streams.remote} /> : <span className="call-pip-off"><Avatar name={name} id={call.peer?.id} src={call.peer?.avatarUrl} size={48} /></span>
                ) : localVideoOn ? (
                  <StreamEl stream={streams.local} muted className="mirror" />
                ) : (
                  <span className="call-pip-off"><VideoOff size={22} aria-hidden="true" /></span>
                )}
              </button>
            </>
          ) : (
            <div className={`call-avatar-wrap ${call.status === 'calling' ? 'ringing' : ''}`}>
              <Avatar name={name} id={call.peer?.id} src={call.peer?.avatarUrl} size={isVideo ? 96 : 140} />
            </div>
          )}
        </div>

        {call.status !== 'ended' && (
          <div className="call-controls">
            <button type="button" className={`call-round ${call.muted ? 'off' : ''}`} onClick={toggleMute} aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={call.muted} disabled={!streams.local}>
              {call.muted ? <MicOff size={24} aria-hidden="true" /> : <Mic size={24} aria-hidden="true" />}
            </button>
            {isVideo && (
              <button type="button" className={`call-round ${call.camOff ? 'off' : ''}`} onClick={toggleCamera} aria-label={call.camOff ? 'Turn camera on' : 'Turn camera off'} aria-pressed={call.camOff} disabled={!streams.local}>
                {call.camOff ? <VideoOff size={24} aria-hidden="true" /> : <Video size={24} aria-hidden="true" />}
              </button>
            )}
            {isVideo && document.fullscreenEnabled && (
              <button type="button" className="call-round" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>
                {full ? <Minimize2 size={22} aria-hidden="true" /> : <Maximize2 size={22} aria-hidden="true" />}
              </button>
            )}
            <button type="button" className="call-round end" onClick={hangup} aria-label="End call" data-testid="call-end"><PhoneOff size={24} aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </>
  );
}