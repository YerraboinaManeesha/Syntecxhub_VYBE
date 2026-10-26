import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { callConfig, iceServers } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { blockBetween } from '../services/blockService.js';
import {
  answerCall, countUnseenMissed, createCall, declineCall, finishCall, loadCall, recordCallMessage, serializeCall,
} from '../services/callService.js';
import { handler } from './handler.js';
import { emitConversationUpdate, emitMessageNew, userRoom } from './emitters.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const startPayload = z.object({ conversationId: objectId, type: z.enum(['voice', 'video']) });
const callPayload = z.object({ callId: objectId });
// Offers, answers and ICE candidates are opaque to the server: relayed, never stored or interpreted.
const signalPayload = z.object({ callId: objectId, data: z.record(z.any()) });

/**
 * Live state of calls that are ringing or ongoing: callId -> { callerId, calleeId, callerSocket, calleeSocket, timer, quiet }.
 * Only the sockets that started / answered a call may relay media signalling for it.
 */
const live = new Map();

export function resetCallState() {
  for (const entry of live.values()) clearTimeout(entry.timer);
  live.clear();
}

const START_LIMIT = 6;
const START_WINDOW_MS = 60_000;

export function registerCallHandlers(io, socket, me) {
  const startTimes = [];

  /** Puts the finished call into the chat for both people, once. Nobody is told about a call they never heard. */
  const publishRecord = async (callDoc, quiet) => {
    const calleeId = String(callDoc.calleeId._id ?? callDoc.calleeId);
    const callerId = String(callDoc.callerId._id ?? callDoc.callerId);
    const { message, created, hiddenFrom } = await recordCallMessage(callDoc, { hiddenFor: quiet ? [calleeId] : [] });
    if (!created) return;
    await emitMessageNew(io, callDoc.conversationId, message, { skipUserIds: hiddenFrom });
    emitConversationUpdate(io, callDoc.conversationId, hiddenFrom.length ? { onlyUserIds: [callerId] } : {}).catch((e) => console.error('[emit]', e));
  };

  const sendEnded = async (callDoc, reason) => {
    if (!callDoc) return;
    const entry = live.get(String(callDoc._id));
    if (entry) {
      clearTimeout(entry.timer);
      live.delete(String(callDoc._id));
    }
    const callerId = String(callDoc.callerId._id ?? callDoc.callerId);
    const calleeId = String(callDoc.calleeId._id ?? callDoc.calleeId);
    for (const viewerId of [callerId, calleeId]) {
      // A call the callee never heard (they blocked the caller) is invisible to them.
      if (entry?.quiet && viewerId === calleeId) continue;
      io.to(userRoom(viewerId)).emit('call:ended', { call: serializeCall(callDoc, viewerId), reason });
    }
    if (!entry?.quiet) await emitBadge(calleeId);
    await publishRecord(callDoc, Boolean(entry?.quiet)).catch((e) => console.error('[call] record', e));
  };

  const emitBadge = async (userId) => {
    io.to(userRoom(userId)).emit('call:badge', { missed: await countUnseenMissed(userId) });
  };

  const ringTimeout = (callId) =>
    setTimeout(async () => {
      try {
        const ended = await finishCall(callId, 'timeout');
        await sendEnded(ended, 'no_answer');
      } catch (e) {
        console.error('[call] timeout', e);
      }
    }, callConfig.ringTimeoutMs).unref();

  /** The caller/callee of an open call, and which side `me` is. Anything else is "not found". */
  const requireOpenCall = async (callId) => {
    const call = await loadCall(callId);
    const involved = call && [String(call.callerId._id), String(call.calleeId._id)].includes(me.id);
    if (!call || !involved || !['ringing', 'ongoing'].includes(call.status)) {
      throw new AppError(404, 'This call is no longer active', { code: 'call_gone' });
    }
    return call;
  };

  // A call already ringing when this session connects (page opened mid-ring) rings here too.
  for (const [callId, entry] of live) {
    if (entry.calleeId === me.id && !entry.calleeSocket && !entry.quiet) {
      loadCall(callId).then((call) => call?.status === 'ringing' && socket.emit('call:incoming', { call: serializeCall(call, me.id) })).catch(() => {});
    }
  }

  socket.on(
    'call:start',
    handler(socket, startPayload, async ({ conversationId, type }) => {
      const now = Date.now();
      while (startTimes.length && now - startTimes[0] > START_WINDOW_MS) startTimes.shift();
      if (startTimes.length >= START_LIMIT) throw new AppError(429, 'You are calling too often. Try again in a minute.', { code: 'rate_limited' });
      startTimes.push(now);

      const conversation = await Conversation.findOne({ _id: conversationId, participants: me.id });
      if (!conversation) throw new AppError(404, 'Conversation not found');
      if (conversation.type !== 'private') throw new AppError(400, 'Calls are only available in private chats', { code: 'not_private' });
      const calleeId = String(conversation.participants.find((p) => String(p) !== me.id));

      const { mine, theirs } = await blockBetween(me.id, calleeId);
      if (mine) throw new AppError(403, 'You blocked this contact. Unblock to call.', { code: 'blocked' });

      const { call, busy } = await createCall({ conversationId, callerId: me.id, calleeId, type, hiddenFor: theirs ? [calleeId] : [] });

      if (busy) {
        // The caller learns it right away; the callee gets a missed call.
        emitBadge(calleeId).catch(() => {});
        io.to(userRoom(calleeId)).emit('call:missed', { call: serializeCall(call, calleeId) });
        await publishRecord(call, false).catch((e) => console.error('[call] record', e));
        return { call: serializeCall(call, me.id), iceServers: [] };
      }

      live.set(String(call._id), {
        callerId: me.id, calleeId, callerSocket: socket.id, calleeSocket: null, timer: ringTimeout(call._id), quiet: Boolean(theirs),
      });
      // If they blocked the caller, nothing rings: the caller just sees "Calling…" until it times out, like WhatsApp.
      if (!theirs) io.to(userRoom(calleeId)).emit('call:incoming', { call: serializeCall(call, calleeId) });
      return { call: serializeCall(call, me.id), iceServers: iceServers() };
    })
  );

  socket.on(
    'call:answer',
    handler(socket, callPayload, async ({ callId }) => {
      const entry = live.get(callId);
      const call = await answerCall(callId, me.id);
      if (!call || !entry) throw new AppError(409, 'This call was already answered or has ended', { code: 'call_gone' });
      clearTimeout(entry.timer);
      entry.calleeSocket = socket.id;
      // The caller's app can now create the WebRTC offer; the callee's other devices stop ringing.
      io.to(entry.callerSocket).emit('call:accepted', { call: serializeCall(call, entry.callerId) });
      socket.to(userRoom(me.id)).emit('call:ended', { call: serializeCall(call, me.id), reason: 'answered_elsewhere' });
      return { call: serializeCall(call, me.id), iceServers: iceServers() };
    })
  );

  socket.on(
    'call:decline',
    handler(socket, callPayload, async ({ callId }) => {
      const call = await declineCall(callId, me.id);
      if (!call) throw new AppError(409, 'This call was already answered or has ended', { code: 'call_gone' });
      await sendEnded(call, 'declined');
    })
  );

  socket.on(
    'call:end',
    handler(socket, callPayload, async ({ callId }) => {
      const open = await requireOpenCall(callId);
      const side = String(open.callerId._id) === me.id ? 'caller' : 'callee';
      const ended = await finishCall(callId, side);
      await sendEnded(ended, ended?.status === 'completed' ? 'ended' : 'cancelled');
    })
  );

  // WebRTC offer / answer / ICE candidates, relayed to the other side's active session only.
  socket.on(
    'call:signal',
    handler(
      socket,
      signalPayload,
      async ({ callId, data }) => {
        const entry = live.get(callId);
        if (!entry || ![entry.callerId, entry.calleeId].includes(me.id)) return;
        const mineIsCaller = entry.callerId === me.id;
        if ((mineIsCaller ? entry.callerSocket : entry.calleeSocket) !== socket.id) return; // not the session on this call
        const target = mineIsCaller ? entry.calleeSocket : entry.callerSocket;
        if (!target) return;
        io.to(target).emit('call:signal', { callId, data });
      },
      { quiet: true }
    )
  );

  return {
    // The session that carried a call went away: the call cannot continue.
    async onDisconnect() {
      for (const [callId, entry] of [...live]) {
        const carried = entry.callerSocket === socket.id || entry.calleeSocket === socket.id;
        if (!carried) continue;
        try {
          const ended = await finishCall(callId, 'server');
          await sendEnded(ended, 'connection_lost');
        } catch (e) {
          console.error('[call] disconnect', e);
        }
      }
    },
  };
}