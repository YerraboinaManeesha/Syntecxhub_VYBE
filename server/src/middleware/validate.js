import { AppError } from '../utils/AppError.js';

export function formatZodError(error) {
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = error.issues[0];
  return { message: first?.message || 'Invalid input', fields };
}

// validate(schema, 'body' | 'query') replaces req[source] with the parsed (cleaned) value.
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const { message, fields } = formatZodError(result.error);
      const err = new AppError(400, message, { code: 'validation_error' });
      err.fields = fields;
      return next(err);
    }
    if (source === 'query') {
      // Express 4 allows reassigning req.query; keep parsed values under req.validatedQuery as well.
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }
    return next();
  };
}
