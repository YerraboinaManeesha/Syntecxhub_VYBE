import { isOnline } from '../services/presence.js';

export function avatarUrlFor(user) {
  if (!user?.avatarVersion) return null;
  const id = user._id ?? user.id;
  // The version in the query string changes with every new photo, so caches never go stale.
  return `/api/users/${id}/avatar?v=${new Date(user.avatarVersion).getTime()}`;
}

// Only these fields ever leave the server about a user. No email, no hash.
export function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id ?? user.id),
    name: user.name,
    username: user.username,
    avatarUrl: avatarUrlFor(user),
    online: isOnline(user._id ?? user.id),
  };
}

// The signed-in user sees their own email too.
export function selfUser(user) {
  return { ...publicUser(user), email: user.email, createdAt: user.createdAt };
}

export function serializeAttachment(attachment) {
  if (!attachment) return null;
  const id = String(attachment._id ?? attachment.id);
  return {
    id,
    kind: attachment.kind,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    url: `/api/attachments/${id}`,
    sentAt: attachment.sentAt ?? null,
    pending: !attachment.messageId,
  };
}

/** Groups a message's reactions by emoji: [{ emoji, userIds }], in the order each emoji first appeared. */
export function serializeReactions(reactions = []) {
  const byEmoji = new Map();
  for (const r of reactions) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji).push(String(r.userId));
  }
  return [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
}

const PREVIEW_LENGTH = 140;

/** Short, safe description of a message for reply quotes and the pin bar. Never exposes deleted content. */
export function serializePreview(message, senderName) {
  if (!message) return null;
  const deleted = Boolean(message.deletedAt);
  const text = deleted ? '' : message.content || '';
  return {
    id: String(message._id),
    senderId: String(message.senderId?._id ?? message.senderId),
    senderName: senderName || message.senderId?.name || null,
    content: text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text,
    attachmentKind: deleted ? null : message.attachment?.kind || null,
    deleted,
  };
}

export function serializeMessage(message, sender, attachment, replyTo = null) {
  const senderDoc = sender || (message.senderId && message.senderId._id ? message.senderId : null);
  const senderId = String(senderDoc?._id ?? message.senderId?._id ?? message.senderId);
  const deleted = Boolean(message.deletedAt);
  const attachmentDoc = attachment || (message.attachment && message.attachment.filename ? message.attachment : null);
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    senderId,
    sender: senderDoc ? { id: senderId, name: senderDoc.name, username: senderDoc.username } : { id: senderId },
    content: deleted ? '' : message.content || '',
    attachment: deleted ? null : serializeAttachment(attachmentDoc),
    call: message.call?.callId
      ? {
          id: String(message.call.callId),
          type: message.call.type,
          status: message.call.status,
          endedBy: message.call.endedBy || null,
          durationSec: message.call.durationSec || 0,
          callerId: String(message.call.callerId),
        }
      : null,
    clientMsgId: message.clientMsgId,
    createdAt: message.createdAt,
    editedAt: deleted ? null : message.editedAt || null,
    deleted,
    reactions: deleted ? [] : serializeReactions(message.reactions),
    replyTo: deleted ? null : replyTo,
  };
}

export function serializeConversation(conversation, { unreadCount = 0, receipts = {}, pins = [] } = {}) {
  return {
    id: String(conversation._id),
    type: conversation.type,
    groupName: conversation.groupName || null,
    createdBy: conversation.createdBy ? String(conversation.createdBy) : null,
    participants: conversation.participants.map(publicUser),
    lastMessage: conversation.lastMessage?.content
      ? {
          content: conversation.lastMessage.content,
          isCall: Boolean(conversation.lastMessage.isCall),
          senderId: String(conversation.lastMessage.senderId),
          createdAt: conversation.lastMessage.createdAt,
        }
      : null,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount,
    // Per member: how far their app has received (deliveredAt) and read (readAt). Members only.
    receipts,
    pins,
    createdAt: conversation.createdAt,
  };
}