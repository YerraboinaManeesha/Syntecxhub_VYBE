import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createConversationSchema,
  deleteMessageQuery,
  editMessageSchema,
  messagesQuery,
  reactionSchema,
  sharedQuery,
} from '../validators/schemas.js';
import { singleFile } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { createUpload, listShared } from '../services/attachmentService.js';
import { serializeAttachment } from '../utils/serialize.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  clearChat,
  findOrCreatePrivate,
  getMessages,
  listForUser,
  markRead,
  requireMembership,
  summarize,
} from '../services/conversationService.js';
import {
  deleteForEveryone,
  deleteForMe,
  editMessage,
  pinMessage,
  toggleReaction,
  unpinMessage,
} from '../services/messageService.js';
import {
  emitConversationUpdate,
  emitMessageRemoved,
  emitMessageUpdate,
  emitReceipt,
  userRoom,
} from '../sockets/emitters.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const conversations = await listForUser(req.user._id);
    res.json({ success: true, data: { conversations } });
  })
);

// Creates a private conversation, or returns the existing one. Never creates a duplicate.
router.post(
  '/',
  validate(createConversationSchema),
  asyncHandler(async (req, res) => {
    const { conversation, created } = await findOrCreatePrivate(req.user._id, req.body.userId);
    const summary = await summarize(conversation, req.user._id);

    if (created) {
      // Let the other person's open sessions learn about it immediately.
      await emitConversationUpdate(req.app.get('io'), conversation._id);
    }
    res.status(created ? 201 : 200).json({ success: true, data: { conversation: summary, created } });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    res.json({ success: true, data: { conversation: await summarize(conversation, req.user._id) } });
  })
);

router.get(
  '/:id/messages',
  validate(messagesQuery, 'query'),
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const { before, limit } = req.validatedQuery;
    const result = await getMessages(conversation._id, { before, limit, userId: req.user._id });
    res.json({ success: true, data: result });
  })
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const result = await markRead(conversation._id, req.user._id);

    // Keep the reader's other tabs/devices in sync.
    req.app.get('io')?.to(userRoom(req.user._id)).emit('message:read:update', {
      conversationId: String(conversation._id),
      unreadCount: 0,
      lastReadAt: result.lastReadAt,
    });
    emitReceipt(req.app.get('io'), conversation._id, req.user._id, {
      deliveredAt: result.deliveredAt,
      readAt: result.lastReadAt,
    }).catch(() => {});
    res.json({ success: true, data: { conversationId: String(conversation._id), unreadCount: 0 } });
  })
);

// Upload a file to a conversation. It stays "pending" (visible only to the uploader) until a
// message that references it is sent. Membership is checked before the file body is read.
router.post(
  '/:id/attachments',
  uploadLimiter,
  asyncHandler(async (req, res, next) => {
    req.conversation = await requireMembership(req.params.id, req.user._id);
    next();
  }),
  singleFile('file'),
  asyncHandler(async (req, res) => {
    const attachment = await createUpload({ file: req.file, uploader: req.user, conversation: req.conversation });
    res.status(201).json({ success: true, data: { attachment: serializeAttachment(attachment) } });
  })
);

// Photos/videos ("media") or documents exchanged in this conversation, for the profile view.
router.get(
  '/:id/shared',
  validate(sharedQuery, 'query'),
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const result = await listShared(conversation._id, req.validatedQuery, req.user._id);
    res.json({ success: true, data: result });
  })
);

// ----- message actions: edit, delete, react, pin. Membership is checked first on every one. -----
const refreshConversation = (req, conversation) =>
  emitConversationUpdate(req.app.get('io'), conversation._id).catch((e) => console.error('[emit]', e));

// "Clear chat": hides the whole conversation history for the signed-in member only.
router.delete(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const io = req.app.get('io');
    const { clearedAt } = await clearChat(conversation, req.user._id);
    // Every session of this member empties the thread; nobody else is told anything.
    io?.to(userRoom(req.user._id)).emit('conversation:cleared', { conversationId: String(conversation._id), clearedAt });
    emitConversationUpdate(io, conversation._id, { onlyUserIds: [String(req.user._id)] }).catch((e) => console.error('[emit]', e));
    res.json({ success: true, data: { conversationId: String(conversation._id), clearedAt } });
  })
);

router.patch(
  '/:id/messages/:messageId',
  validate(editMessageSchema),
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const { message, changed } = await editMessage(conversation, req.user, req.params.messageId, req.body.content);
    if (changed) {
      await emitMessageUpdate(req.app.get('io'), conversation._id, message);
      refreshConversation(req, conversation);
    }
    res.json({ success: true, data: { message } });
  })
);

router.delete(
  '/:id/messages/:messageId',
  validate(deleteMessageQuery, 'query'),
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const io = req.app.get('io');
    if (req.validatedQuery.scope === 'me') {
      const { messageId } = await deleteForMe(conversation, req.user, req.params.messageId);
      emitMessageRemoved(io, req.user._id, conversation._id, messageId);
      refreshConversation(req, conversation);
      return res.json({ success: true, data: { messageId } });
    }
    const { message, changed } = await deleteForEveryone(conversation, req.user, req.params.messageId);
    if (changed) {
      await emitMessageUpdate(io, conversation._id, message);
      refreshConversation(req, conversation);
    }
    return res.json({ success: true, data: { message } });
  })
);

router.put(
  '/:id/messages/:messageId/reaction',
  validate(reactionSchema),
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const { message } = await toggleReaction(conversation, req.user, req.params.messageId, req.body.emoji);
    await emitMessageUpdate(req.app.get('io'), conversation._id, message);
    res.json({ success: true, data: { message } });
  })
);

router.put(
  '/:id/pins/:messageId',
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const result = await pinMessage(conversation, req.user, req.params.messageId);
    refreshConversation(req, conversation);
    res.json({ success: true, data: result });
  })
);

router.delete(
  '/:id/pins/:messageId',
  asyncHandler(async (req, res) => {
    const conversation = await requireMembership(req.params.id, req.user._id);
    const result = await unpinMessage(conversation, req.params.messageId);
    refreshConversation(req, conversation);
    res.json({ success: true, data: result });
  })
);

export default router;
