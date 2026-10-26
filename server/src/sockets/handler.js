import { formatZodError } from '../middleware/validate.js';
import { AppError } from '../utils/AppError.js';

/**
 * Wraps an event handler with payload validation, error translation and acknowledgements.
 * Failures reach the client as { ok: false, error } in the ack, or as `error:notification`
 * when the event has no ack callback. Internal errors are logged, never leaked.
 */
export function handler(socket, schema, fn, { quiet = false } = {}) {
  return async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : null;
    const fail = (error) => {
      if (reply) reply({ ok: false, error });
      else if (!quiet) socket.emit('error:notification', error);
    };

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return fail({ code: 'invalid_payload', message: formatZodError(parsed.error).message });
    }

    try {
      const result = (await fn(parsed.data)) || {};
      if (reply) reply({ ok: true, ...result });
    } catch (error) {
      if (error instanceof AppError) {
        fail({ code: error.code || 'error', message: error.message });
      } else {
        console.error('[socket] unexpected error', error);
        fail({ code: 'server_error', message: 'Something went wrong. Please try again.' });
      }
    }
  };
}
