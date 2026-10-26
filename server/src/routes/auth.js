import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { registerSchema, loginSchema } from '../validators/schemas.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { conflict, unauthorized } from '../utils/AppError.js';
import { setSessionCookie, clearSessionCookie, signSocketToken, verifyToken } from '../utils/tokens.js';
import { selfUser } from '../utils/serialize.js';
import { userRoom } from '../sockets/emitters.js';

const router = Router();

// Compared against when the account does not exist, so response time does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.bcryptRounds);

function duplicateField(error) {
  const key = Object.keys(error.keyPattern || error.keyValue || {})[0];
  return key === 'email' ? 'email' : 'username';
}

router.post(
  '/register',
  registerLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, username, email, password } = req.body;

    const [emailTaken, usernameTaken] = await Promise.all([User.exists({ email }), User.exists({ username })]);
    if (emailTaken) throw conflict('An account with this email already exists', { field: 'email' });
    if (usernameTaken) throw conflict('That username is already taken', { field: 'username' });

    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);

    let user;
    try {
      user = await User.create({ name, username, email, passwordHash });
    } catch (error) {
      // Two simultaneous sign-ups can both pass the checks above; the unique indexes are the real guard.
      if (error?.code === 11000) {
        const field = duplicateField(error);
        throw conflict(
          field === 'email' ? 'An account with this email already exists' : 'That username is already taken',
          { field }
        );
      }
      throw error;
    }

    setSessionCookie(res, user._id);
    res.status(201).json({ success: true, data: { user: selfUser(user) } });
  })
);

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body;
    const normalized = identifier.toLowerCase();
    const query = normalized.includes('@') ? { email: normalized } : { username: normalized };

    const user = await User.findOne(query).select('+passwordHash');
    const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

    // One generic message for every failure: unknown account and wrong password look identical.
    if (!user || !valid) throw unauthorized('Invalid credentials', { code: 'invalid_credentials' });

    setSessionCookie(res, user._id);
    res.json({ success: true, data: { user: selfUser(user) } });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    // Works even if the session has already expired, and always clears the cookie.
    const payload = verifyToken(req.cookies?.[env.cookieName] || '', 'session');
    if (payload) disconnectUserSockets(req.app.get('io'), payload.sub);
    clearSessionCookie(res);
    res.json({ success: true, data: { loggedOut: true } });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, data: { user: selfUser(req.user) } });
});

// Short-lived token for the Socket.io handshake. The session cookie itself is HttpOnly and
// never exposed to JavaScript, so the browser asks for this and passes it as socket auth.
router.get('/socket-token', requireAuth, (req, res) => {
  res.json({ success: true, data: { token: signSocketToken(req.user._id) } });
});

// Used by the logout flow to close any open sockets for the user.
export function disconnectUserSockets(io, userId) {
  if (io) io.in(userRoom(userId)).disconnectSockets(true);
}

export default router;
