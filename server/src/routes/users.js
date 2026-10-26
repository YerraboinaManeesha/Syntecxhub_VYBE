import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listUsersQuery, updateProfileSchema } from '../validators/schemas.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, conflict, notFound } from '../utils/AppError.js';
import { publicUser, selfUser } from '../utils/serialize.js';
import { singleFile } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { assertWithinLimit, processImage, sniffFile } from '../services/fileValidation.js';
import { deleteFile, getFileSize, putBuffer } from '../services/storage.js';
import { sendStoredFile } from './attachments.js';
import { Conversation } from '../models/Conversation.js';
import { emitConversationUpdate, userRoom } from '../sockets/emitters.js';
import { blockBetween, blockUser, unblockUser, listBlockedIds } from '../services/blockService.js';
import { isOnline } from '../services/presence.js';

const router = Router();
router.use(requireAuth);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get(
  '/',
  validate(listUsersQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { q, page, limit } = req.validatedQuery;

    const filter = { _id: { $ne: req.user._id } }; // never include yourself
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i'); // escaped: user input is never a raw regex
      filter.$or = [{ name: pattern }, { username: pattern }];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name username avatarVersion') // only public fields are even read from the database
        .sort({ username: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { users: users.map(publicUser), page, limit, total, hasMore: page * limit < total },
    });
  })
);


// ----- blocking: silent, like WhatsApp. The other person is never told. -----
async function refreshPair(req, otherId) {
  const io = req.app.get('io');
  if (!io) return;
  const convs = await Conversation.find({ type: 'private', participants: { $all: [req.user._id, otherId] } }).select('_id');
  await Promise.all(convs.map((c) => emitConversationUpdate(io, c._id).catch(() => {})));
}

router.get(
  '/blocked',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { userIds: await listBlockedIds(req.user._id) } });
  })
);

router.post(
  '/:id/block',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('User not found');
    await blockUser(req.user._id, req.params.id);
    const io = req.app.get('io');
    // Both sides now see each other as offline.
    io?.to(userRoom(req.user._id)).emit('presence:update', { userId: String(req.params.id), online: false });
    io?.to(userRoom(req.params.id)).emit('presence:update', { userId: String(req.user._id), online: false });
    await refreshPair(req, req.params.id);
    res.json({ success: true, data: { blocked: true } });
  })
);

router.delete(
  '/:id/block',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('User not found');
    await unblockUser(req.user._id, req.params.id);
    const io = req.app.get('io');
    // Status comes back only if nobody still blocks the other.
    const { mine, theirs } = await blockBetween(req.user._id, req.params.id);
    if (!mine && !theirs) {
      io?.to(userRoom(req.user._id)).emit('presence:update', { userId: String(req.params.id), online: isOnline(req.params.id) });
      io?.to(userRoom(req.params.id)).emit('presence:update', { userId: String(req.user._id), online: isOnline(req.user._id) });
    }
    await refreshPair(req, req.params.id);
    res.json({ success: true, data: { blocked: false } });
  })
);

// Tells everyone who shares a conversation with this user that the profile photo changed.
async function broadcastProfileChange(req) {
  const io = req.app.get('io');
  if (!io) return;
  const ids = await Conversation.find({ participants: req.user._id }).select('_id').limit(200);
  await Promise.all(ids.map((c) => emitConversationUpdate(io, c._id).catch(() => {})));
}

// Only ever changes the authenticated user's own photo. There is no :id, so another account cannot be targeted.
router.post(
  '/me/avatar',
  uploadLimiter,
  singleFile('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Choose a photo to upload', { code: 'no_file' });
    const detected = sniffFile(req.file.buffer, req.file.originalname);
    if (!detected || detected.kind !== 'image') {
      throw badRequest('Profile photos must be JPG, PNG or WebP images.', { code: 'unsupported_type' });
    }
    assertWithinLimit('image', req.file.buffer.length);
    const processed = await processImage(req.file.buffer, { avatar: true });

    const user = await User.findById(req.user._id).select('+avatarFileId');
    const previousFileId = user.avatarFileId;
    user.avatarFileId = await putBuffer(processed.buffer, `avatar-${user._id}.webp`, { userId: String(user._id) });
    user.avatarVersion = new Date();
    await user.save();
    await deleteFile(previousFileId);

    await broadcastProfileChange(req);
    res.json({ success: true, data: { user: selfUser(user) } });
  })
);

router.delete(
  '/me/avatar',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+avatarFileId');
    const previousFileId = user.avatarFileId;
    user.avatarFileId = undefined;
    user.avatarVersion = undefined;
    await user.save();
    await deleteFile(previousFileId);

    await broadcastProfileChange(req);
    res.json({ success: true, data: { user: selfUser(user) } });
  })
);

// Any signed-in user may view another user's profile photo (it is public profile information).
router.get(
  '/:id/avatar',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('No photo');
    const user = await User.findById(req.params.id).select('avatarVersion +avatarFileId');
    if (!user?.avatarFileId) throw notFound('No photo');
    // The URL carries ?v=<version>, so a changed photo is always fetched fresh.
    sendStoredFile(req, res, {
      fileId: user.avatarFileId,
      size: await getFileSize(user.avatarFileId),
      mimeType: 'image/webp',
      filename: `${user._id}.webp`,
      inline: true,
      cache: 'private, max-age=86400',
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('User not found');
    const user = await User.findById(req.params.id).select('name username avatarVersion');
    if (!user) throw notFound('User not found');
    res.json({ success: true, data: { user: publicUser(user) } });
  })
);

// Only ever edits the authenticated user. There is no :id, so another account cannot be targeted.
router.patch(
  '/me',
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const { name, username } = req.body;
    const user = req.user;

    if (username !== undefined && username !== user.username) {
      const taken = await User.exists({ username, _id: { $ne: user._id } });
      if (taken) throw conflict('That username is already taken', { field: 'username' });
      user.username = username;
    }
    if (name !== undefined) user.name = name;

    try {
      await user.save();
    } catch (error) {
      if (error?.code === 11000) throw conflict('That username is already taken', { field: 'username' });
      throw error;
    }
    res.json({ success: true, data: { user: selfUser(user) } });
  })
);

export default router;
