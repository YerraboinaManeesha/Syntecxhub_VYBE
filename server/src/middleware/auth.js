import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { unauthorized } from '../utils/AppError.js';
import { verifyToken } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[env.cookieName];
  const payload = token ? verifyToken(token, 'session') : null;
  if (!payload) throw unauthorized('Please sign in to continue');

  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized('Please sign in to continue');

  req.user = user;
  next();
});
