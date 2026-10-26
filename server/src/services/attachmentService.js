import mongoose from 'mongoose';
import { Message } from '../models/Message.js';
import { Attachment } from '../models/Attachment.js';
import { badRequest, notFound } from '../utils/AppError.js';
import { serializeAttachment } from '../utils/serialize.js';
import { assertWithinLimit, cleanFilename, processImage, sniffFile } from './fileValidation.js';
import { deleteFile, putBuffer } from './storage.js';

const PENDING_TTL_MS = 60 * 60 * 1000; // an upload that is never sent is removed after an hour

/** Validates and stores an uploaded file as a pending attachment of a conversation. */
export async function createUpload({ file, uploader, conversation }) {
  if (!file) throw badRequest('Choose a file to upload', { code: 'no_file' });

  const filename = cleanFilename(file.originalname);
  const detected = sniffFile(file.buffer, filename);
  if (!detected) {
    throw badRequest('This file type is not supported. Send photos (JPG, PNG, WebP), videos (MP4, MOV, WebM) or documents (PDF, Word, Excel, PowerPoint, TXT, CSV).', {
      code: 'unsupported_type',
    });
  }
  assertWithinLimit(detected.kind, file.buffer.length);

  let { buffer } = file;
  let { mimeType } = detected;
  let width;
  let height;
  if (detected.kind === 'image') {
    const processed = await processImage(buffer);
    ({ buffer, mimeType, width, height } = processed);
  }

  const fileId = await putBuffer(buffer, filename, {
    conversationId: String(conversation._id),
    uploaderId: String(uploader._id),
  });

  try {
    const attachment = await Attachment.create({
      uploaderId: uploader._id,
      conversationId: conversation._id,
      kind: detected.kind,
      filename,
      mimeType,
      size: buffer.length,
      width,
      height,
      fileId,
    });
    return attachment;
  } catch (error) {
    await deleteFile(fileId); // never leave bytes behind without metadata
    throw error;
  }
}

export async function removeAttachment(attachment) {
  await Attachment.deleteOne({ _id: attachment._id });
  await deleteFile(attachment.fileId);
}

/** Loads an attachment only if the viewer may see it, otherwise throws 404 (so ids cannot be probed). */
export async function loadAccessible(id, user, { Conversation }) {
  if (!mongoose.isValidObjectId(id)) throw notFound('File not found');
  const attachment = await Attachment.findById(id);
  if (!attachment) throw notFound('File not found');

  if (!attachment.messageId) {
    // Not sent yet: visible only to the person who uploaded it.
    if (String(attachment.uploaderId) !== String(user._id)) throw notFound('File not found');
  } else {
    const isMember = await Conversation.exists({ _id: attachment.conversationId, participants: user._id });
    if (!isMember) throw notFound('File not found');
  }
  return attachment;
}

/** Shared items of one conversation, newest first. group: 'media' (photos+videos) or 'documents'. */
export async function listShared(conversationId, { group, before, limit }, userId = null) {
  const kinds = group === 'documents' ? ['document'] : ['image', 'video'];
  const base = { conversationId, messageId: { $ne: null }, kind: { $in: kinds } };
  const collected = [];
  let cursor = before || null;
  let exhausted = false;

  // Skip files whose message this member cleared or deleted for themselves; keep paging until the page is full.
  while (collected.length < limit + 1 && !exhausted) {
    const filter = cursor ? { ...base, _id: { $lt: cursor } } : base;
    const batch = await Attachment.find(filter).sort({ _id: -1 }).limit(limit + 1);
    if (batch.length < limit + 1) exhausted = true;
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]._id;
    let visible = batch;
    if (userId) {
      const hidden = await Message.find({ _id: { $in: batch.map((a) => a.messageId) }, deletedFor: userId }).select('_id').lean();
      const hiddenIds = new Set(hidden.map((m) => String(m._id)));
      visible = batch.filter((a) => !hiddenIds.has(String(a.messageId)));
    }
    collected.push(...visible);
  }

  const hasMore = collected.length > limit;
  return {
    items: collected.slice(0, limit).map((a) => ({ ...serializeAttachment(a), senderId: String(a.uploaderId) })),
    hasMore,
  };
}

export async function deleteForConversation(conversationId) {
  const attachments = await Attachment.find({ conversationId }).select('fileId');
  await Promise.all(attachments.map((a) => deleteFile(a.fileId)));
  await Attachment.deleteMany({ conversationId });
}

export async function cleanupOrphans(now = Date.now(), ttl = PENDING_TTL_MS) {
  const stale = await Attachment.find({ messageId: null, createdAt: { $lt: new Date(now - ttl) } }).select('fileId');
  await Promise.all(stale.map((a) => deleteFile(a.fileId)));
  if (stale.length) await Attachment.deleteMany({ _id: { $in: stale.map((a) => a._id) } });
  return stale.length;
}
