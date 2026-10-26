import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { message: 'Route not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Malformed JSON bodies
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { message: 'Invalid JSON body' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { message: 'Request body too large' } });
  }

  const status = err.expose ? err.status : err.status && err.status < 500 ? err.status : 500;

  if (status >= 500) {
    // Log details server-side only. Never send stack traces or internals to the client.
    console.error(`[error] ${req.method} ${req.originalUrl}`, env.isProd ? err.message : err);
  }

  const body = {
    success: false,
    error: {
      message: status >= 500 ? 'Something went wrong. Please try again.' : err.message,
    },
  };
  if (err.code && typeof err.code === 'string') body.error.code = err.code;
  if (err.field) body.error.field = err.field;
  if (err.fields) body.error.fields = err.fields;

  res.status(status).json(body);
}
