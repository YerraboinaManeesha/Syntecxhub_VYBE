import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Attachment } from '../models/Attachment.js';
import { removeAttachment } from './attachmentService.js';
import { PARTICIPANT_FIELDS, previewFor } from './conversationService.js';
import { replyPreviewMap } from './previews.js';
import { serializeMessage } from '../utils/serialize.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';

export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_EVERYONE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_PINS = 3;
export const DELETED_PREVIEW = 'This message was deleted';

/** Loads a message the viewer may act on: it must be in this conversation and not hidden for them. */
async function loadMessage(conversationId, messageId, userId) {
  if (!mongoose.isValidObjectId(messageId)) throw notFound('Message not found');
  const message = await Message.findOne({ _id: messageId, conversationId, deletedFor: { $ne: userId } });
  if (!message) throw notFound('Message not found');
  return message;
}

/** Call records are facts: they can be hidden for yourself, but never edited, reacted to, pinned or deleted for everyone. */
function rejectCallRecord(message) {
  if (message.call?.callId) throw badRequest('Call records cannot be changed', { code: 'call_record' });
}

/** The message exactly as clients should see it now (same for every member). */
export async function hydrate(messageId) {
  const message = await Message.findById(messageId).populate('senderId', PARTICIPANT_FIELDS).populate('attachment');
  const previews = await replyPreviewMap([message.replyTo]);
  return serializeMessage(message, null, null, previews.get(String(message.replyTo)) || null);
}

// Keeps the conversation-list preview right when the newest message changes.
async function refreshLastMessage(conversationId, message, content) {
  await Conversation.updateOne(
    {
      _id: conversationId,
      'lastMessage.createdAt': message.createdAt,
      'lastMessage.senderId': message.senderId,
    },
    { $set: { 'lastMessage.content': content } }
  );
}

export async function editMessage(conversation, user, messageId, content) {
  const message = await loadMessage(conversation._id, messageId, user._id);
  rejectCallRecord(message);
  if (String(message.senderId) !== String(user._id)) throw forbidden('You can only edit your own messages');
  if (message.deletedAt) throw badRequest('This message was deleted', { code: 'message_deleted' });
  if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw badRequest('Messages can only be edited within 15 minutes of sending', { code: 'edit_window_closed' });
  }
  if (!content && !message.attachment) throw badRequest('Message cannot be empty', { code: 'empty_message' });
  if (content === message.content) return { message: await hydrate(message._id), changed: false };

  message.content = content;
  message.editedAt = new Date();
  await message.save();
  const populated = await Message.findById(message._id).populate('attachment', 'kind filename');
  await refreshLastMessage(conversation._id, message, previewFor(content, populated.attachment));
  return { message: await hydrate(message._id), changed: true };
}

export async function deleteForMe(conversation, user, messageId) {
  const message = await loadMessage(conversation._id, messageId, user._id);
  await Message.updateOne({ _id: message._id }, { $addToSet: { deletedFor: user._id } });
  // A message you hid no longer belongs in your pin bar.
  return { messageId: String(message._id) };
}

export async function deleteForEveryone(conversation, user, messageId) {
  const message = await loadMessage(conversation._id, messageId, user._id);
  rejectCallRecord(message);
  if (String(message.senderId) !== String(user._id)) {
    throw forbidden('Only the sender can delete a message for everyone');
  }
  if (message.deletedAt) return { message: await hydrate(message._id), changed: false };
  if (Date.now() - message.createdAt.getTime() > DELETE_EVERYONE_WINDOW_MS) {
    throw badRequest('Messages can only be deleted for everyone within 1 hour of sending', {
      code: 'delete_window_closed',
    });
  }

  const attachment = message.attachment ? await Attachment.findById(message.attachment) : null;
  await Message.updateOne(
    { _id: message._id },
    {
      $set: { content: '', deletedAt: new Date(), reactions: [] },
      $unset: { attachment: '', replyTo: '', editedAt: '' },
    }
  );
  if (attachment) await removeAttachment(attachment); // file bytes and metadata are gone, not just hidden
  await Conversation.updateOne({ _id: conversation._id }, { $pull: { pins: { messageId: message._id } } });
  await refreshLastMessage(conversation._id, message, DELETED_PREVIEW);
  return { message: await hydrate(message._id), changed: true };
}

/** Set, change or remove the caller's reaction. Same emoji again removes it; another emoji replaces it. */
export async function toggleReaction(conversation, user, messageId, emoji) {
  const message = await loadMessage(conversation._id, messageId, user._id);
  rejectCallRecord(message);
  if (message.deletedAt) throw badRequest('This message was deleted', { code: 'message_deleted' });

  const existing = message.reactions.find((r) => String(r.userId) === String(user._id));
  if (existing && existing.emoji === emoji) {
    await Message.updateOne({ _id: message._id }, { $pull: { reactions: { userId: user._id } } });
  } else if (existing) {
    await Message.updateOne(
      { _id: message._id, 'reactions.userId': user._id },
      { $set: { 'reactions.$.emoji': emoji } }
    );
  } else {
    // The condition makes a double tap or two tabs unable to add a second reaction for one person.
    await Message.updateOne(
      { _id: message._id, 'reactions.userId': { $ne: user._id } },
      { $push: { reactions: { userId: user._id, emoji } } }
    );
  }
  return { message: await hydrate(message._id) };
}

export async function pinMessage(conversation, user, messageId) {
  const message = await loadMessage(conversation._id, messageId, user._id);
  rejectCallRecord(message);
  if (message.deletedAt) throw badRequest('This message was deleted', { code: 'message_deleted' });

  const result = await Conversation.updateOne(
    {
      _id: conversation._id,
      'pins.messageId': { $ne: message._id },
      $expr: { $lt: [{ $size: { $ifNull: ['$pins', []] } }, MAX_PINS] },
    },
    { $push: { pins: { messageId: message._id, pinnedBy: user._id, pinnedAt: new Date() } } }
  );
  if (result.modifiedCount === 0) {
    const already = await Conversation.exists({ _id: conversation._id, 'pins.messageId': message._id });
    if (!already) throw badRequest(`You can pin up to ${MAX_PINS} messages. Unpin one first.`, { code: 'pin_limit' });
  }
  return { messageId: String(message._id) };
}

export async function unpinMessage(conversation, messageId) {
  if (!mongoose.isValidObjectId(messageId)) throw notFound('Message not found');
  await Conversation.updateOne({ _id: conversation._id }, { $pull: { pins: { messageId } } });
  return { messageId: String(messageId) };
}