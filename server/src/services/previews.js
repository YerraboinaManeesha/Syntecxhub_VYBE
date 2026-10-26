import { Message } from '../models/Message.js';
import { serializePreview } from '../utils/serialize.js';

const SENDER_FIELDS = 'name username';

/** Loads the quoted messages for a batch of replies: Map(messageId -> preview). One query, not one per message. */
export async function replyPreviewMap(replyToIds, viewerId = null) {
  const ids = [...new Set(replyToIds.filter(Boolean).map(String))];
  if (ids.length === 0) return new Map();
  const found = await Message.find({ _id: { $in: ids } })
    .select('senderId content attachment deletedAt deletedFor')
    .populate('senderId', SENDER_FIELDS)
    .populate('attachment', 'kind');
  // A quote of something this viewer cleared or deleted for themselves shows as unavailable, never its text.
  const hiddenFor = (m) => viewerId && (m.deletedFor || []).some((id) => String(id) === String(viewerId));
  return new Map(found.map((m) => [String(m._id), hiddenFor(m) ? serializePreview({ _id: m._id, senderId: m.senderId, deletedAt: new Date() }) : serializePreview(m)]));
}

/** A copy of a serialized message whose reply quote is hidden when `viewerId` removed the quoted message for themselves. */
export async function maskQuoteFor(message, viewerId) {
  if (!message?.replyTo?.id) return message;
  const previews = await replyPreviewMap([message.replyTo.id], viewerId);
  return { ...message, replyTo: previews.get(String(message.replyTo.id)) || message.replyTo };
}

/** Pinned messages of a conversation as the viewer should see them (nothing deleted, nothing hidden for them). */
export async function pinPreviews(conversation, viewerId) {
  const pins = conversation.pins || [];
  if (pins.length === 0) return [];
  const found = await Message.find({
    _id: { $in: pins.map((p) => p.messageId) },
    deletedAt: { $exists: false },
    deletedFor: { $ne: viewerId },
  })
    .select('senderId content attachment deletedAt')
    .populate('senderId', SENDER_FIELDS)
    .populate('attachment', 'kind');
  const byId = new Map(found.map((m) => [String(m._id), m]));
  return pins
    .filter((p) => byId.has(String(p.messageId)))
    .map((p) => ({
      ...serializePreview(byId.get(String(p.messageId))),
      messageId: String(p.messageId),
      pinnedBy: p.pinnedBy ? String(p.pinnedBy) : null,
      pinnedAt: p.pinnedAt,
    }));
}
