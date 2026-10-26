import { Block } from '../models/Block.js';
import { badRequest, notFound } from '../utils/AppError.js';
import { User } from '../models/User.js';

/** Who blocked whom between two people. `mine` = I blocked them; `theirs` = they blocked me. */
export async function blockBetween(userId, otherId) {
  const rows = await Block.find({
    $or: [
      { blockerId: userId, blockedId: otherId },
      { blockerId: otherId, blockedId: userId },
    ],
  }).lean();
  return {
    mine: rows.find((r) => String(r.blockerId) === String(userId)) || null,
    theirs: rows.find((r) => String(r.blockerId) === String(otherId)) || null,
  };
}

/** Everyone with a block in either direction with this user (their status and typing stay hidden both ways). */
export async function blockedPeerIds(userId) {
  const rows = await Block.find({ $or: [{ blockerId: userId }, { blockedId: userId }] }).select('blockerId blockedId').lean();
  const ids = new Set();
  for (const r of rows) ids.add(String(String(r.blockerId) === String(userId) ? r.blockedId : r.blockerId));
  return ids;
}

export async function blockUser(blockerId, blockedId) {
  if (String(blockerId) === String(blockedId)) throw badRequest('You cannot block yourself');
  if (!(await User.exists({ _id: blockedId }))) throw notFound('User not found');
  await Block.updateOne({ blockerId, blockedId }, { $setOnInsert: { blockerId, blockedId } }, { upsert: true });
}

export async function unblockUser(blockerId, blockedId) {
  await Block.deleteOne({ blockerId, blockedId });
}

export const listBlockedIds = async (userId) => (await Block.find({ blockerId: userId }).select('blockedId').lean()).map((r) => String(r.blockedId));
