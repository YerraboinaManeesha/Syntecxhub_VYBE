import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { callsQuery } from '../validators/schemas.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound } from '../utils/AppError.js';
import { requireMembership } from '../services/conversationService.js';
import { iceServers } from '../config/env.js';
import { countUnseenMissed, hideCalls, listHistory, markMissedSeen } from '../services/callService.js';
import { userRoom } from '../sockets/emitters.js';

const router = Router();
router.use(requireAuth);

const syncBadge = async (req) =>
  req.app.get('io')?.to(userRoom(req.user._id)).emit('call:badge', { missed: await countUnseenMissed(req.user._id) });

// Finished calls of the signed-in user, newest first. Only their own calls, never anyone else's.
router.get(
  '/',
  validate(callsQuery, 'query'),
  asyncHandler(async (req, res) => {
    // Asking for one conversation's calls requires being a member of it (404 otherwise, like everywhere else).
    if (req.validatedQuery.conversationId) await requireMembership(req.validatedQuery.conversationId, req.user._id);
    const result = await listHistory(req.user._id, req.validatedQuery);
    res.json({ success: true, data: { ...result, missed: await countUnseenMissed(req.user._id) } });
  })
);

router.get(
  '/unseen',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { missed: await countUnseenMissed(req.user._id) } });
  })
);

// Called when the person opens the Calls page: the missed-call badge goes away on all their sessions.
router.post(
  '/seen',
  asyncHandler(async (req, res) => {
    await markMissedSeen(req.user._id);
    await syncBadge(req);
    res.json({ success: true, data: { missed: 0 } });
  })
);

// STUN, plus TURN when it is configured. Needs a signed-in user; TURN credentials are never public.
router.get('/config', (req, res) => res.json({ success: true, data: { iceServers: iceServers() } }));

// Remove one call, or all of them, from MY history. The other person's history is untouched.
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const removed = await hideCalls(req.user._id);
    await syncBadge(req);
    res.json({ success: true, data: { removed } });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Call not found');
    const removed = await hideCalls(req.user._id, req.params.id);
    if (!removed) throw notFound('Call not found');
    await syncBadge(req);
    res.json({ success: true, data: { removed } });
  })
);

export default router;