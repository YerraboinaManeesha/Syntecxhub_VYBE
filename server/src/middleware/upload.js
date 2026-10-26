import multer from 'multer';
import { AppError, badRequest } from '../utils/AppError.js';
import { MAX_UPLOAD_BYTES } from '../services/fileValidation.js';

// Files are held in memory just long enough to validate and re-encode them, then go to GridFS.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 2 },
});

/** Accepts exactly one file in `field`; turns multer failures into clean API errors. */
export function singleFile(field = 'file') {
  const handler = upload.single(field);
  return (req, res, next) => {
    handler(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'File is too large', { code: 'file_too_large' }));
      }
      if (error instanceof multer.MulterError) {
        return next(badRequest('Invalid upload', { code: 'bad_upload' }));
      }
      return next(error);
    });
  };
}
