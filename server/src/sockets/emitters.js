import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Block } from '../models/Block.js';
import { maskQuoteFor } from '../services/previews.js';
import { getMembership, markDelivered, summarize, PARTICIPANT_FIELDS } from '../services/conversationService.js';

export const userRoom = (userId) => `user:${userId}`;
export const conversationRoom = (conversationId) => `conversation:${conversationId}`;

/**
 * Sends each member their own view of the conversation (unread counts differ per member).
 * Goes to the member's private `user:` room, which every one of their sessions has joined.
 */
export async function emitConversationUpdate(io, conversationId, { onlyUserIds } = {}) {
  if (!io) return;
  const conversation = await Conversation.findById(conversationId).populate('participants', PARTICIPANT_FIELDS);
  if (!conversation) return;

  const targets = conversation.participants
    .map((p) => String(p._id))
    .filter((id) => !onlyUserIds || onlyUserIds.includes(id));

  await Promise.all(
    targets.map(async (userId) => {
      const payload = await summarize(conversation, userId);
      io.to(userRoom(userId)).emit('conversation:update', { conversation: payload });
    })
  );
}

/** Tell a user (all their sessions) that a conversation is gone from their list. */
export function emitConversationRemoved(io, userId, conversationId) {
  if (!io) return;
  io.to(userRoom(userId)).emit('conversation:update', { conversationId: String(conversationId), removed: true });
  io.in(userRoom(userId)).socketsLeave(conversationRoom(conversationId));
}

/** Tells every member how far one member has received/read. Members only; carries no message content. */
export async function emitReceipt(io, conversationId, userId, receipt) {
  if (!io) return;
  const conversation = await Conversation.findById(conversationId).select('participants');
  if (!conversation) return;
  // Someone you blocked is never told how far you have received/read.
  const blockedByOwner = new Set((await Block.find({ blockerId: userId }).select('blockedId').lean()).map((b) => String(b.blockedId)));
  const rooms = conversation.participants.filter((id) => !blockedByOwner.has(String(id))).map((id) => userRoom(id));
  if (rooms.length === 0) return;
  io.to(rooms).emit('receipt:update', {
    conversationId: String(conversationId),
    userId: String(userId),
    deliveredAt: receipt.deliveredAt,
    readAt: receipt.readAt,
  });
}

/** An edited / deleted / reacted-to message, sent to every member (the view is the same for all of them). */
export async function emitMessageUpdate(io, conversationId, message) {
  if (!io) return;
  const conversation = await Conversation.findById(conversationId).select('participants');
  if (!conversation) return;
  // Per member, so a quote of something they cleared stays hidden from them. Nobody the message is hidden from hears of it.
  const hidden = new Set(((await Message.findById(message.id).select('deletedFor').lean())?.deletedFor || []).map(String));
  await Promise.all(
    conversation.participants.filter((id) => !hidden.has(String(id))).map(async (id) => {
      io.to(userRoom(id)).emit('message:update', { message: await maskQuoteFor(message, String(id)) });
    })
  );
}

/** "Delete for me": only the person's own sessions are told to drop it. */
export function emitMessageRemoved(io, userId, conversationId, messageId) {
  if (!io) return;
  io.to(userRoom(userId)).emit('message:removed', { conversationId: String(conversationId), messageId: String(messageId) });
}

const DELIVERY_ACK_TIMEOUT_MS = 8000;

/**
 * Sends a stored message to every member. Other members' sessions must acknowledge it:
 * "delivered" means a signed-in session actually received the event, not merely that the user is online.
 */
export async function emitMessageNew(io, conversationId, message, { skipUserIds = [] } = {}) {
  if (!io) return;
  const conversation = await Conversation.findById(conversationId).select('participants');
  if (!conversation) return;

  for (const memberId of conversation.participants) {
    const id = String(memberId);
    if (skipUserIds.includes(id)) continue; // blocked: stored for the sender, never delivered
    // A reply that quotes a message this member cleared must not carry the cleared text to them.
    const view = await maskQuoteFor(message, id);
    if (id === String(message.senderId)) {
      io.to(userRoom(id)).emit('message:new', { message: view });
      continue;
    }
    io.in(userRoom(id))
      .timeout(DELIVERY_ACK_TIMEOUT_MS)
      .emit('message:new', { message: view }, (error, responses) => {
        // Some sessions may not answer (error is set), but any answer proves delivery to a live session.
        if (!responses || responses.length === 0) return;
        markDelivered(conversationId, id, new Date(message.createdAt))
          .then((receipt) => receipt && emitReceipt(io, conversationId, id, receipt))
          .catch((e) => console.error('[receipt]', e));
      });
  }
}

export { getMembership };
