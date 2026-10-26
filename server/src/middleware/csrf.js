import { env } from '../config/env.js';
import { forbidden } from '../utils/AppError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-based auth, in two layers:
 *  1. State-changing requests must carry a custom header. A cross-site HTML form cannot set one,
 *     and a cross-site fetch/XHR carrying it triggers a CORS preflight that our CORS policy rejects.
 *  2. If the browser sends an Origin header, it must be our frontend origin.
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  if (req.get('x-requested-with') !== 'vybe') {
    return next(forbidden('Missing required request header', { code: 'csrf' }));
  }
  const origin = req.get('origin');
  if (origin && origin !== env.clientOrigin) {
    return next(forbidden('Request origin not allowed', { code: 'csrf' }));
  }
  return next();
}
