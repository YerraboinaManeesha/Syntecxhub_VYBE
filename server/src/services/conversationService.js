import mongoose from 'mongoose';
import { Conversation, makeParticipantKey } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { ReadState } from '../models/ReadState.js';
import { User } from '../models/User.js';
import { Attachment } from '../models/Attachment.js';
import { deleteForConversation } from './attachmentService.js';
import { serializeConversation, serializeMessage } from '../utils/serialize.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { pinPreviews, replyPreviewMap } from './previews.js';
import { Block } from '../models/Block.js';
import { blockBetween } from './blockService.js';

export const PARTICIPANT_FIELDS = 'name username avatarVersion';
export const MAX_GROUP_SIZE = 50;

/**
 * Authorization primitive. Returns the conversation (participants populated) only if
 * `userId` is a member; otherwise null. Never trust a client-supplied conversation id
 * without going through this.
 */
export async function getMembership(conversationId, userId) {
  if (!mongoose.isValidObjectId(conversationId)) return null;
  return Conversation.findOne({ _id: conversationId, participants: userId }).populate(
    'participants',
    PARTICIPANT_FIELDS
  );
}

export async function requireMembership(conversationId, userId) {
  const conversation = await getMembership(conversationId, userId);
  // 404 for both "does not exist" and "not yours" so ids cannot be probed.
  if (!conversation) throw notFound('Conversation not found');
  return conversation;
}

async function unreadCountsFor(userId, conversations) {
  if (conversations.length === 0) return new Map();
  const ids = conversations.map((c) => c._id);
  const states = await ReadState.find({ userId, conversationId: { $in: ids } }).lean();
  const lastReadByConv = new Map(states.map((s) => [String(s.conversationId), s.lastReadAt]));

  const counts = await Promise.all(
    conversations.map((conversation) => {
      const lastReadAt = lastReadByConv.get(String(conversation._id)) || conversation.createdAt;
      return Message.countDocuments({
        conversationId: conversation._id,
        senderId: { $ne: userId },
        deletedFor: { $ne: userId },
        // Calls have their own missed-call badge; they never count as unread messages.
        'call.callId': { $exists: false },
        createdAt: { $gt: lastReadAt },
      });
    })
  );
  return new Map(conversations.map((c, i) => [String(c._id), counts[i]]));
}

/** Delivery/read watermarks of every member, per conversation: { convId: { userId: { deliveredAt, readAt } } } */
async function receiptsFor(conversations) {
  const result = new Map(conversations.map((c) => [String(c._id), {}]));
  if (conversations.length === 0) return result;
  const states = await ReadState.find({ conversationId: { $in: conversations.map((c) => c._id) } }).lean();
  for (const s of states) {
    const read = s.lastReadAt || null;
    // Reading a message implies it was delivered.
    const delivered = [s.deliveredAt, s.lastReadAt].filter(Boolean).sort((a, b) => b - a)[0] || null;
    const bucket = result.get(String(s.conversationId));
    if (bucket) bucket[String(s.userId)] = { deliveredAt: delivered, readAt: read };
  }
  return result;
}

/** The list preview must not show text this member cleared. */
async function clearedAtMap(userId, conversations) {
  const states = await ReadState.find({ userId, conversationId: { $in: conversations.map((c) => c._id) }, clearedAt: { $ne: null } })
    .select('conversationId clearedAt')
    .lean();
  return new Map(states.map((s) => [String(s.conversationId), s.clearedAt]));
}

function hideClearedPreview(payload, conversation, clearedAt) {
  const last = conversation.lastMessage?.createdAt;
  if (clearedAt && last && new Date(last) <= new Date(clearedAt)) return { ...payload, lastMessage: null };
  return payload;
}

/**
 * What a block changes in one person's view of a private conversation:
 *  - blockedByMe tells the blocker to show "Unblock" (nobody is ever told they were blocked)
 *  - the other person always looks offline, in both directions
 *  - a blocked person's ticks stop advancing at the moment of the block, so they cannot tell
 */
function applyBlockView(payload, conversation, viewerId, blocks) {
  if (conversation.type !== 'private') return payload;
  const other = conversation.participants.find((p) => String(p._id ?? p) !== String(viewerId));
  if (!other) return payload;
  const otherId = String(other._id ?? other);
  const mine = blocks.find((b) => String(b.blockerId) === String(viewerId) && String(b.blockedId) === otherId);
  const theirs = blocks.find((b) => String(b.blockerId) === otherId && String(b.blockedId) === String(viewerId));
  if (!mine && !theirs) return { ...payload, blockedByMe: false };

  const receipts = { ...payload.receipts };
  if (theirs && receipts[otherId]) {
    const cap = (d) => (d && new Date(d) > new Date(theirs.createdAt) ? theirs.createdAt : d);
    receipts[otherId] = { deliveredAt: cap(receipts[otherId].deliveredAt), readAt: cap(receipts[otherId].readAt) };
  }
  return {
    ...payload,
    blockedByMe: Boolean(mine),
    participants: payload.participants.map((p) => (p.id === otherId ? { ...p, online: false } : p)),
    receipts,
  };
}

const blocksFor = (userId) => Block.find({ $or: [{ blockerId: userId }, { blockedId: userId }] }).lean();

export async function summarize(conversation, viewerId) {
  const [counts, receipts, pins, cleared, blocks] = await Promise.all([
    unreadCountsFor(viewerId, [conversation]),
    receiptsFor([conversation]),
    pinPreviews(conversation, viewerId),
    clearedAtMap(viewerId, [conversation]),
    blocksFor(viewerId),
  ]);
  const payload = serializeConversation(conversation, {
    unreadCount: counts.get(String(conversation._id)) || 0,
    receipts: receipts.get(String(conversation._id)),
    pins,
  });
  return applyBlockView(hideClearedPreview(payload, conversation, cleared.get(String(conversation._id))), conversation, viewerId, blocks);
}

/**
 * "Clear chat": hides every message currently in the conversation from this member only.
 * Nothing is deleted for anyone else, the conversation and its members stay, and new messages arrive normally.
 */
export async function clearChat(conversation, userId) {
  const now = new Date();
  await Message.updateMany(
    { conversationId: conversation._id, deletedFor: { $ne: userId }, createdAt: { $lte: now } },
    { $addToSet: { deletedFor: userId } }
  );
  await ReadState.updateOne(
    { conversationId: conversation._id, userId },
    { $set: { clearedAt: now, lastReadAt: now } },
    { upsert: true }
  );
  return { clearedAt: now };
}

export async function listForUser(userId) {
  const conversations = await Conversation.find({ participants: userId })
    .sort({ lastMessageAt: -1 })
    .limit(200)
    .populate('participants', PARTICIPANT_FIELDS);
  const [counts, receipts, cleared, blocks] = await Promise.all([
    unreadCountsFor(userId, conversations),
    receiptsFor(conversations),
    clearedAtMap(userId, conversations),
    blocksFor(userId),
  ]);
  return Promise.all(
    conversations.map(async (c) =>
      applyBlockView(
        hideClearedPreview(
          serializeConversation(c, {
            unreadCount: counts.get(String(c._id)) || 0,
            receipts: receipts.get(String(c._id)),
            pins: await pinPreviews(c, userId),
          }),
          c,
          cleared.get(String(c._id))
        ),
        c,
        userId,
        blocks
      )
    )
  );
}

async function createReadStates(conversationId, userIds, at = new Date()) {
  if (userIds.length === 0) return;
  await ReadState.bulkWrite(
    userIds.map((userId) => ({
      updateOne: {
        filter: { conversationId, userId },
        update: { $setOnInsert: { lastReadAt: at } },
        upsert: true,
      },
    }))
  );
}

/** Finds the one private conversation between two users, creating it if this is the first time. */
export async function findOrCreatePrivate(userId, otherUserId) {
  if (String(userId) === String(otherUserId)) throw badRequest('You cannot start a conversation with yourself');

  const other = await User.findById(otherUserId).select('_id');
  if (!other) throw notFound('User not found');

  const participantKey = makeParticipantKey(userId, otherUserId);
  let conversation = await Conversation.findOne({ participantKey });
  let created = false;

  if (!conversation) {
    try {
      conversation = await Conversation.create({
        type: 'private',
        participants: [userId, otherUserId],
        participantKey,
        createdBy: userId,
      });
      created = true;
      await createReadStates(conversation._id, [userId, otherUserId]);
    } catch (error) {
      // Lost a race with a concurrent request: the unique index rejected the duplicate. Reuse the winner.
      if (error?.code === 11000) {
        conversation = await Conversation.findOne({ participantKey });
      } else {
        throw error;
      }
    }
  }

  const populated = await Conversation.findById(conversation._id).populate('participants', PARTICIPANT_FIELDS);
  return { conversation: populated, created };
}

export async function createGroup(creatorId, name, memberIds) {
  const unique = [...new Set(memberIds.map(String))].filter((id) => id !== String(creatorId));
  if (unique.length === 0) throw badRequest('Select at least one other member');
  if (unique.length + 1 > MAX_GROUP_SIZE) throw badRequest(`Groups can have at most ${MAX_GROUP_SIZE} members`);

  const found = await User.countDocuments({ _id: { $in: unique } });
  if (found !== unique.length) throw badRequest('One or more selected users do not exist');

  const conversation = await Conversation.create({
    type: 'group',
    participants: [creatorId, ...unique],
    groupName: name,
    createdBy: creatorId,
  });
  await createReadStates(conversation._id, conversation.participants);
  return Conversation.findById(conversation._id).populate('participants', PARTICIPANT_FIELDS);
}

export async function addGroupMembers(conversation, userIds) {
  const existing = new Set(conversation.participants.map((p) => String(p._id)));
  const toAdd = [...new Set(userIds.map(String))].filter((id) => !existing.has(id));
  if (toAdd.length === 0) throw badRequest('Those users are already in the group');
  if (existing.size + toAdd.length > MAX_GROUP_SIZE) {
    throw badRequest(`Groups can have at most ${MAX_GROUP_SIZE} members`);
  }
  const found = await User.countDocuments({ _id: { $in: toAdd } });
  if (found !== toAdd.length) throw badRequest('One or more selected users do not exist');

  await Conversation.updateOne({ _id: conversation._id }, { $addToSet: { participants: { $each: toAdd } } });
  // New members start with nothing unread: they were not part of earlier messages.
  await createReadStates(conversation._id, toAdd);
  return { addedIds: toAdd };
}

export async function leaveGroup(conversation, userId) {
  await Conversation.updateOne({ _id: conversation._id }, { $pull: { participants: userId } });
  await ReadState.deleteOne({ conversationId: conversation._id, userId });

  const remaining = await Conversation.findById(conversation._id).select('participants');
  if (remaining && remaining.participants.length === 0) {
    await deleteForConversation(conversation._id);
    await Promise.all([
      Message.deleteMany({ conversationId: conversation._id }),
      ReadState.deleteMany({ conversationId: conversation._id }),
      Conversation.deleteOne({ _id: conversation._id }),
    ]);
    return { deleted: true };
  }
  return { deleted: false };
}

export async function markRead(conversationId, userId) {
  const lastReadAt = new Date();
  await ReadState.updateOne({ conversationId, userId }, { $set: { lastReadAt }, $max: { deliveredAt: lastReadAt } }, { upsert: true });
  return { lastReadAt, deliveredAt: lastReadAt, unreadCount: 0 };
}

/**
 * Advances a member's "received" watermark (never backwards).
 * Returns the new receipt only if it moved, so callers broadcast real changes only.
 */
export async function markDelivered(conversationId, userId, upTo) {
  const before = await ReadState.findOneAndUpdate(
    { conversationId, userId },
    { $max: { deliveredAt: upTo } },
    { upsert: false, new: false }
  ).lean();
  if (!before) return null; // not a member (no read state)
  const previous = [before.deliveredAt, before.lastReadAt].filter(Boolean).sort((a, b) => b - a)[0];
  if (previous && previous >= upTo) return null;
  return { deliveredAt: upTo, readAt: before.lastReadAt || null };
}

/** Marks everything currently in the user's conversations as received (used when their app (re)connects). */
export async function markAllDelivered(userId, at = new Date()) {
  const states = await ReadState.find({ userId }).select('conversationId deliveredAt lastReadAt').lean();
  const moved = [];
  await Promise.all(
    states.map(async (s) => {
      const receipt = await markDelivered(s.conversationId, userId, at);
      if (receipt) moved.push({ conversationId: String(s.conversationId), ...receipt });
    })
  );
  return moved;
}

export async function getMessages(conversationId, { before, limit, userId }) {
  const filter = { conversationId };
  if (userId) filter.deletedFor = { $ne: userId }; // "deleted for me" messages never come back
  if (before) filter._id = { $lt: before };

  const page = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('senderId', PARTICIPANT_FIELDS)
    .populate('attachment');

  const hasMore = page.length > limit;
  const items = page.slice(0, limit).reverse(); // oldest -> newest for display
  const previews = await replyPreviewMap(items.map((m) => m.replyTo), userId);
  return { messages: items.map((m) => serializeMessage(m, null, null, previews.get(String(m.replyTo)) || null)), hasMore };
}

const ATTACHMENT_LABEL = { image: 'Photo', video: 'Video' };

export function previewFor(content, attachment) {
  const text = content.length > 200 ? `${content.slice(0, 200)}…` : content;
  if (text) return text;
  if (!attachment) return '';
  return attachment.kind === 'document' ? `Document: ${attachment.filename}` : ATTACHMENT_LABEL[attachment.kind];
}

/**
 * Persists a message, optionally carrying a previously uploaded attachment.
 * Idempotent on (senderId, clientMsgId): a retry returns the stored message with created=false
 * instead of inserting a duplicate or trying to claim the attachment twice.
 */
export async function createMessage({ conversation, sender, content, clientMsgId, attachmentId, replyToId }) {
  // Private chats: you cannot message someone you blocked. If THEY blocked you, the message is stored for you
  // (it looks sent) but is hidden from them and never delivered; nothing tells you.
  let hiddenFrom = [];
  if (conversation.type === 'private') {
    const other = conversation.participants.find((p) => String(p._id) !== String(sender._id));
    if (other) {
      const { mine, theirs } = await blockBetween(sender._id, other._id);
      if (mine) throw forbidden('You blocked this contact. Unblock to send a message.', { code: 'blocked' });
      if (theirs) hiddenFrom = [other._id];
    }
  }
  const findExisting = async () => {
    const found = await Message.findOne({ senderId: sender._id, clientMsgId }).populate('attachment');
    // The same clientMsgId must not be reused for a different conversation.
    if (!found || String(found.conversationId) !== String(conversation._id)) {
      throw badRequest('Invalid message id', { code: 'bad_client_msg_id' });
    }
    const previews = await replyPreviewMap([found.replyTo]);
    return { message: serializeMessage(found, sender, null, previews.get(String(found.replyTo)) || null), created: false, hiddenFrom: [] };
  };

  if (await Message.exists({ senderId: sender._id, clientMsgId })) return findExisting();

  // The attachment must be the sender's own upload, for this conversation, and not yet sent.
  let attachment = null;
  if (attachmentId) {
    attachment = await Attachment.findOne({
      _id: attachmentId,
      uploaderId: sender._id,
      conversationId: conversation._id,
      messageId: null,
    });
    if (!attachment) throw badRequest('That attachment is not available. Upload it again.', { code: 'bad_attachment' });
  }

  // A reply must quote a live message from this same conversation.
  if (replyToId) {
    const target = await Message.findOne({
      _id: replyToId,
      conversationId: conversation._id,
      deletedAt: { $exists: false },
      deletedFor: { $ne: sender._id },
      'call.callId': { $exists: false }, // a call record cannot be quoted
    }).select('_id');
    if (!target) throw badRequest('The message you are replying to is not available', { code: 'bad_reply' });
  }

  let message;
  try {
    message = await Message.create({
      replyTo: replyToId || undefined,
      conversationId: conversation._id,
      senderId: sender._id,
      content,
      clientMsgId,
      attachment: attachment?._id,
      deletedFor: hiddenFrom,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return findExisting(); // lost a race with a concurrent identical send
  }

  if (attachment) {
    // Claim atomically so one upload can never be attached to two messages.
    const claimed = await Attachment.updateOne(
      { _id: attachment._id, messageId: null },
      { $set: { messageId: message._id, sentAt: message.createdAt } }
    );
    if (claimed.modifiedCount === 0) {
      await Message.deleteOne({ _id: message._id });
      throw badRequest('That attachment is not available. Upload it again.', { code: 'bad_attachment' });
    }
    attachment.messageId = message._id;
    attachment.sentAt = message.createdAt;
  }

  // A message the other person never sees must not move their conversation list either.
  if (hiddenFrom.length === 0) {
    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessageAt: message.createdAt,
          lastMessage: { content: previewFor(content, attachment), senderId: sender._id, createdAt: message.createdAt },
        },
      }
    );
  }
  // Sending implies the sender has caught up with the conversation.
  await markRead(conversation._id, sender._id);

  const previews = await replyPreviewMap([message.replyTo]);
  return { message: serializeMessage(message, sender, attachment, previews.get(String(message.replyTo)) || null), created: true, hiddenFrom: hiddenFrom.map(String) };
}