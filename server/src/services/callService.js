import mongoose from 'mongoose';
import { Call, OPEN_STATUSES } from '../models/Call.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { PARTICIPANT_FIELDS } from './conversationService.js';
import { publicUser, serializeMessage } from '../utils/serialize.js';
import { AppError } from '../utils/AppError.js';

const populateBoth = (query) => query.populate('callerId', PARTICIPANT_FIELDS).populate('calleeId', PARTICIPANT_FIELDS);
const idOf = (value) => String(value?._id ?? value);

/** What one person sees about a call: the other person, the direction and how it ended. */
export function serializeCall(call, viewerId) {
  const outgoing = idOf(call.callerId) === String(viewerId);
  const peer = outgoing ? call.calleeId : call.callerId;
  const peerUser = peer && peer.name ? publicUser(peer) : { id: idOf(peer) };
  return {
    id: String(call._id),
    conversationId: String(call.conversationId),
    type: call.type,
    status: call.status,
    direction: outgoing ? 'outgoing' : 'incoming',
    // Missed from the viewer's side: they were called and never spoke to anyone.
    missed: !outgoing && (call.status === 'missed' || call.status === 'busy'),
    peer: peerUser,
    createdAt: call.createdAt,
    answeredAt: call.answeredAt ?? null,
    endedAt: call.endedAt ?? null,
    durationSec: call.durationSec || 0,
    endedBy: call.endedBy ?? null,
  };
}

const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
};

/** One short line for the conversation list. Neutral wording: both people see the same text. */
export function callPreview(call) {
  const kind = call.type === 'video' ? 'Video call' : 'Voice call';
  if (call.status === 'completed') return `${kind} · ${fmtDuration(call.durationSec || 0)}`;
  if (call.status === 'missed' || call.status === 'busy') return `Missed ${kind.toLowerCase()}`;
  if (call.status === 'declined') return `${kind} declined`;
  return kind;
}

/**
 * Puts the finished call into the chat as a message, exactly once (a unique index on the call id makes a repeated
 * report harmless). If the callee blocked the caller, the record is hidden from the callee and never moves their list.
 * Returns { message, created, hiddenFrom }; message is null when nothing new was written.
 */
export async function recordCallMessage(call, { hiddenFor = [] } = {}) {
  const callId = call._id;
  const callerId = call.callerId._id ?? call.callerId;
  let doc;
  try {
    doc = await Message.create({
      conversationId: call.conversationId,
      senderId: callerId,
      content: '',
      clientMsgId: `call-${callId}`,
      deletedFor: hiddenFor,
      call: { callId, type: call.type, status: call.status, endedBy: call.endedBy, durationSec: call.durationSec || 0, callerId },
    });
  } catch (error) {
    if (error?.code === 11000) return { message: null, created: false, hiddenFrom: [] };
    throw error;
  }
  if (hiddenFor.length === 0) {
    await Conversation.updateOne(
      { _id: call.conversationId },
      { $set: { lastMessageAt: doc.createdAt, lastMessage: { content: callPreview(call), senderId: callerId, createdAt: doc.createdAt, isCall: true } } }
    );
  }
  const populated = await Message.findById(doc._id).populate('senderId', PARTICIPANT_FIELDS);
  return { message: serializeMessage(populated), created: true, hiddenFrom: hiddenFor.map(String) };
}

export async function loadCall(callId) {
  if (!mongoose.isValidObjectId(callId)) return null;
  return populateBoth(Call.findById(callId));
}

const openCallFor = (userIds) =>
  Call.exists({ status: { $in: OPEN_STATUSES }, $or: [{ callerId: { $in: userIds } }, { calleeId: { $in: userIds } }] });

/**
 * Creates the call record. A caller who is already in a call cannot start another (error).
 * A callee who is busy gets a final "busy" record instead, which the caller sees as "busy".
 */
export async function createCall({ conversationId, callerId, calleeId, type, hiddenFor = [] }) {
  if (await openCallFor([callerId])) {
    throw new AppError(409, 'You are already in a call', { code: 'already_in_call' });
  }
  const calleeBusy = Boolean(await openCallFor([calleeId]));
  const now = new Date();
  const call = await Call.create({
    conversationId,
    callerId,
    calleeId,
    type,
    status: calleeBusy ? 'busy' : 'ringing',
    endedAt: calleeBusy ? now : undefined,
    endedBy: calleeBusy ? 'server' : undefined,
    // Someone who blocked the caller neither hears the call nor gets a missed-call entry.
    calleeSeen: !calleeBusy || hiddenFor.length > 0,
    hiddenFor,
  });

  if (!calleeBusy) {
    // Both people calling each other at the same moment: the newer call yields.
    const clash = await Call.exists({
      _id: { $lt: call._id },
      status: { $in: OPEN_STATUSES },
      $or: [{ callerId: { $in: [callerId, calleeId] } }, { calleeId: { $in: [callerId, calleeId] } }],
    });
    if (clash) {
      await Call.updateOne({ _id: call._id }, { status: 'busy', endedAt: now, endedBy: 'server', calleeSeen: false });
      return { call: await loadCall(call._id), busy: true };
    }
  }
  return { call: await loadCall(call._id), busy: calleeBusy };
}

/** ringing -> ongoing, only for the callee, only once. Returns null if the call is no longer ringing. */
export async function answerCall(callId, calleeId) {
  const updated = await Call.findOneAndUpdate(
    { _id: callId, calleeId, status: 'ringing' },
    { status: 'ongoing', answeredAt: new Date() },
    { new: true }
  );
  return updated && loadCall(updated._id);
}

/** ringing -> declined. */
export async function declineCall(callId, calleeId) {
  const updated = await Call.findOneAndUpdate(
    { _id: callId, calleeId, status: 'ringing' },
    { status: 'declined', endedAt: new Date(), endedBy: 'callee' },
    { new: true }
  );
  return updated && loadCall(updated._id);
}

/**
 * Ends a call from whatever open state it is in: ongoing -> completed (with duration),
 * ringing -> missed (caller hung up / no answer). Returns null if it was already finished.
 */
export async function finishCall(callId, endedBy) {
  const now = new Date();
  const completed = await Call.findOneAndUpdate(
    { _id: callId, status: 'ongoing' },
    [
      {
        $set: {
          status: 'completed',
          endedAt: now,
          endedBy,
          durationSec: { $max: [0, { $round: [{ $divide: [{ $subtract: [now, '$answeredAt'] }, 1000] }, 0] }] },
        },
      },
    ],
    { new: true }
  );
  if (completed) return loadCall(completed._id);

  const missed = await Call.findOneAndUpdate(
    { _id: callId, status: 'ringing' },
    { status: 'missed', endedAt: now, endedBy, calleeSeen: false },
    { new: true }
  );
  return missed && loadCall(missed._id);
}

/** After a restart nobody is on a call any more: close whatever was left open. */
export async function closeStaleCalls() {
  const now = new Date();
  const stale = await Call.find({ status: { $in: OPEN_STATUSES } });
  await Call.updateMany({ status: 'ringing' }, { status: 'missed', endedAt: now, endedBy: 'server', calleeSeen: false });
  await Call.updateMany({ status: 'ongoing' }, { status: 'failed', endedAt: now, endedBy: 'server' });
  // The chat should still show that these calls happened.
  for (const call of stale) {
    const final = await Call.findById(call._id);
    await recordCallMessage(final).catch((e) => console.error('[call] stale record', e.message));
  }
}

export const HISTORY_FILTERS = ['all', 'missed', 'incoming', 'outgoing'];

export async function listHistory(userId, { before, limit, filter = 'all', conversationId } = {}) {
  const me = new mongoose.Types.ObjectId(String(userId));
  const query = { status: { $nin: OPEN_STATUSES }, hiddenFor: { $ne: me } };
  if (filter === 'incoming') query.calleeId = me;
  else if (filter === 'outgoing') query.callerId = me;
  else if (filter === 'missed') Object.assign(query, { calleeId: me, status: { $in: ['missed', 'busy'] } });
  else query.$or = [{ callerId: me }, { calleeId: me }];
  if (conversationId) query.conversationId = conversationId;
  if (before) query._id = { $lt: before };
  const rows = await populateBoth(Call.find(query).sort({ _id: -1 }).limit(limit + 1));
  const hasMore = rows.length > limit;
  return { calls: rows.slice(0, limit).map((c) => serializeCall(c, userId)), hasMore };
}

export const countUnseenMissed = (userId) =>
  Call.countDocuments({ calleeId: userId, status: { $in: ['missed', 'busy'] }, calleeSeen: false, hiddenFor: { $ne: userId } });

export async function markMissedSeen(userId) {
  await Call.updateMany({ calleeId: userId, calleeSeen: false, status: { $nin: OPEN_STATUSES } }, { calleeSeen: true });
}

/** Hide one finished call (or all of them) from this person's history. */
export async function hideCalls(userId, callId) {
  const filter = { status: { $nin: OPEN_STATUSES }, $or: [{ callerId: userId }, { calleeId: userId }] };
  if (callId) filter._id = callId;
  const result = await Call.updateMany(filter, { $addToSet: { hiddenFor: userId } });
  // A hidden missed call must not keep the badge lit.
  await markMissedSeen(userId);
  return result.matchedCount;
}