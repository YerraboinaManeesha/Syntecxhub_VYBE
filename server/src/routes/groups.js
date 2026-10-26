import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { addMembersSchema, createGroupSchema } from '../validators/schemas.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound } from '../utils/AppError.js';
import {
  addGroupMembers,
  createGroup,
  leaveGroup,
  requireMembership,
  summarize,
} from '../services/conversationService.js';
import { emitConversationRemoved, emitConversationUpdate } from '../sockets/emitters.js';

const router = Router();
router.use(requireAuth);

async function requireGroupMember(id, userId) {
  const conversation = await requireMembership(id, userId);
  if (conversation.type !== 'group') throw notFound('Group not found');
  return conversation;
}

router.post(
  '/',
  validate(createGroupSchema),
  asyncHandler(async (req, res) => {
    const conversation = await createGroup(req.user._id, req.body.name, req.body.memberIds);
    await emitConversationUpdate(req.app.get('io'), conversation._id);
    res.status(201).json({
      success: true,
      data: { conversation: await summarize(conversation, req.user._id) },
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const conversation = await requireGroupMember(req.params.id, req.user._id);
    res.json({ success: true, data: { conversation: await summarize(conversation, req.user._id) } });
  })
);

// Any current member can add people (basic membership model; roles can come later).
router.post(
  '/:id/members',
  validate(addMembersSchema),
  asyncHandler(async (req, res) => {
    const conversation = await requireGroupMember(req.params.id, req.user._id);
    await addGroupMembers(conversation, req.body.userIds);
    await emitConversationUpdate(req.app.get('io'), conversation._id);
    const fresh = await requireGroupMember(req.params.id, req.user._id);
    res.json({ success: true, data: { conversation: await summarize(fresh, req.user._id) } });
  })
);

router.delete(
  '/:id/members/me',
  asyncHandler(async (req, res) => {
    const conversation = await requireGroupMember(req.params.id, req.user._id);
    const io = req.app.get('io');
    const { deleted } = await leaveGroup(conversation, req.user._id);

    // The leaver loses access immediately: their sockets leave the room and their list drops it.
    emitConversationRemoved(io, req.user._id, conversation._id);
    if (!deleted) await emitConversationUpdate(io, conversation._id);

    res.json({ success: true, data: { left: true } });
  })
);

export default router;
