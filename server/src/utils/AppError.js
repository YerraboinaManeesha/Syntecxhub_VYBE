export class AppError extends Error {
  constructor(status, message, { code, field } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.expose = true;
  }
}

export const badRequest = (message, opts) => new AppError(400, message, opts);
export const unauthorized = (message = 'Authentication required', opts) => new AppError(401, message, opts);
export const forbidden = (message = 'Forbidden', opts) => new AppError(403, message, opts);
export const notFound = (message = 'Not found', opts) => new AppError(404, message, opts);
export const conflict = (message, opts) => new AppError(409, message, opts);
