import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

function limiter({ windowMs, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    skip: () => env.isTest,
    handler: (req, res) => {
      res.status(429).json({ success: false, error: { message, code: 'rate_limited' } });
    },
  });
}

// Counts only failed logins, so normal use never hits it.
export const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});

export const registerLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: 'Too many sign-up attempts. Please try again later.',
});

export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 300,
  message: 'Too many requests. Please slow down.',
});

export const uploadLimiter = limiter({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  message: 'You are uploading too many files. Please wait a few minutes.',
});
