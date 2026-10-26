import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();

export const env = {
  nodeEnv,
  isProd,
  isTest,
  port: Number(process.env.PORT) || 5000,
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || '',
  cookieName: 'vybe_token',
  cookieSameSite: ['lax', 'strict', 'none'].includes(sameSite) ? sameSite : 'lax',
  // Browsers require Secure for SameSite=None; always use Secure in production.
  cookieSecure: isProd || sameSite === 'none',
  sessionDays: 7,
  bcryptRounds: isTest ? 4 : 12,
  presenceGraceMs: process.env.PRESENCE_GRACE_MS !== undefined ? Number(process.env.PRESENCE_GRACE_MS) : 2000,
};

export function assertEnv() {
  const problems = [];
  if (!env.jwtSecret || env.jwtSecret.length < 32) problems.push('JWT_SECRET must be set and at least 32 characters');
  if (!env.mongoUri) problems.push('MONGODB_URI must be set');
  if (env.isProd && !env.clientOrigin.startsWith('https://')) {
    problems.push('CLIENT_ORIGIN must be an https:// URL in production');
  }
  if (problems.length) {
    throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
  }
}

// Calls: STUN is free and enough on most networks. Add a TURN server for strict NATs / mobile data
// by setting TURN_URLS (comma separated), TURN_USERNAME and TURN_CREDENTIAL.
const list = (value) => (value || '').split(',').map((v) => v.trim()).filter(Boolean);
export const callConfig = {
  ringTimeoutMs: process.env.CALL_RING_TIMEOUT_MS !== undefined ? Number(process.env.CALL_RING_TIMEOUT_MS) : 45_000,
  stunUrls: list(process.env.STUN_URLS).length ? list(process.env.STUN_URLS) : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
  turnUrls: list(process.env.TURN_URLS),
  turnUsername: process.env.TURN_USERNAME || '',
  turnCredential: process.env.TURN_CREDENTIAL || '',
};

export function iceServers() {
  const servers = [{ urls: callConfig.stunUrls }];
  if (callConfig.turnUrls.length && callConfig.turnUsername && callConfig.turnCredential) {
    servers.push({ urls: callConfig.turnUrls, username: callConfig.turnUsername, credential: callConfig.turnCredential });
  }
  return servers;
}
