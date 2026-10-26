import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Two token purposes so one cannot be used in place of the other:
//  - session: long-lived, lives only in an HttpOnly cookie
//  - socket:  60 seconds, handed to the browser so it can open the Socket.io connection

export function signSessionToken(userId) {
  return jwt.sign({ sub: String(userId), purpose: 'session' }, env.jwtSecret, {
    expiresIn: `${env.sessionDays}d`,
  });
}

export function signSocketToken(userId) {
  return jwt.sign({ sub: String(userId), purpose: 'socket' }, env.jwtSecret, { expiresIn: '60s' });
}

export function verifyToken(token, purpose) {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    if (payload.purpose !== purpose || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: '/',
  };
}

export function setSessionCookie(res, userId) {
  res.cookie(env.cookieName, signSessionToken(userId), {
    ...cookieOptions(),
    maxAge: env.sessionDays * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(env.cookieName, cookieOptions());
}
