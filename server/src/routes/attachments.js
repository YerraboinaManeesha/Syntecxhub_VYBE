import { Router } from 'express';
import { Conversation } from '../models/Conversation.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError, forbidden } from '../utils/AppError.js';
import { loadAccessible, removeAttachment } from '../services/attachmentService.js';
import { openStream } from '../services/storage.js';

const router = Router();
router.use(requireAuth);

// "bytes=0-99", "bytes=100-", "bytes=-500" -> { start, end } (inclusive) or null if unsatisfiable
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return null;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

export function sendStoredFile(req, res, { fileId, size, mimeType, filename, inline, cache }) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.set({
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    // Even if something odd were served, it can run no script and load nothing.
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });

  let range = null;
  if (req.headers.range) {
    range = parseRange(req.headers.range, size);
    if (!range) {
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }
  }

  const stream = range ? openStream(fileId, range) : openStream(fileId);
  if (range) {
    res.status(206);
    res.set({ 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
  } else {
    res.set('Content-Length', size);
  }
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const attachment = await loadAccessible(req.params.id, req.user, { Conversation });
    // Photos and videos may display inline. Documents are always downloaded, never rendered by the browser.
    const inline = attachment.kind !== 'document' && req.query.download !== '1';
    sendStoredFile(req, res, {
      fileId: attachment.fileId,
      size: attachment.size,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      inline,
      cache: 'private, max-age=300',
    });
  })
);

// Removes an upload that has not been sent yet (the user cancelled the preview).
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const attachment = await loadAccessible(req.params.id, req.user, { Conversation });
    if (attachment.messageId) throw forbidden('Sent attachments cannot be deleted');
    if (String(attachment.uploaderId) !== String(req.user._id)) throw new AppError(404, 'File not found');
    await removeAttachment(attachment);
    res.json({ success: true, data: { removed: true } });
  })
);

export default router;
