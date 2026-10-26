import sharp from 'sharp';
import { badRequest, AppError } from '../utils/AppError.js';

const MB = 1024 * 1024;

export const LIMITS = {
  image: 5 * MB,
  video: 25 * MB,
  document: 10 * MB,
};
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(LIMITS));

export const LIMIT_LABELS = { image: '5 MB', video: '25 MB', document: '10 MB' };

const DOCUMENT_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
};
const OOXML = new Set(['docx', 'xlsx', 'pptx']);
const OLE = new Set(['doc', 'xls', 'ppt']);

// ftyp brands that are genuinely video. HEIC/AVIF photos share the ftyp container and must not match.
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'mmp4', 'dash', 'M4V ', 'MSNV', '3gp4', '3gp5', '3gp6']);

const startsWith = (buffer, bytes, offset = 0) => bytes.every((byte, i) => buffer[offset + i] === byte);
const ascii = (buffer, start, end) => buffer.subarray(start, end).toString('latin1');

export function extensionOf(filename) {
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(filename || '');
  return match ? match[1].toLowerCase() : '';
}

/**
 * Decides what a file really is from its bytes. The filename and the browser-declared type are
 * never trusted. Returns { kind, mimeType } or null if the type is not allowed.
 */
export function sniffFile(buffer, filename) {
  if (!buffer || buffer.length < 12) return null;

  // Images
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { kind: 'image', mimeType: 'image/jpeg' };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mimeType: 'image/png' };
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return { kind: 'image', mimeType: 'image/webp' };

  // Video
  if (ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12);
    if (brand === 'qt  ') return { kind: 'video', mimeType: 'video/quicktime' };
    if (MP4_BRANDS.has(brand)) return { kind: 'video', mimeType: 'video/mp4' };
    return null;
  }
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mimeType: 'video/webm' };

  // Documents: the content signature and the extension must agree.
  const ext = extensionOf(filename);
  const documentType = DOCUMENT_TYPES[ext];
  if (!documentType) return null;

  if (ext === 'pdf') return ascii(buffer, 0, 5) === '%PDF-' ? { kind: 'document', mimeType: documentType } : null;
  if (OOXML.has(ext)) return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ? { kind: 'document', mimeType: documentType } : null;
  if (OLE.has(ext)) {
    return startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) ? { kind: 'document', mimeType: documentType } : null;
  }
  // txt / csv: plain text only. A NUL byte means it is binary.
  if (buffer.subarray(0, 8192).includes(0)) return null;
  return { kind: 'document', mimeType: documentType };
}

/** Browsers send file names as UTF-8 bytes that arrive decoded as latin1; undo that, then make the name safe. */
export function cleanFilename(raw) {
  let name = String(raw || 'file');
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  if (!decoded.includes('�')) name = decoded;

  name = name
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (name.length > 120) {
    const ext = extensionOf(name);
    name = ext ? `${name.slice(0, 115 - ext.length)}.${ext}` : name.slice(0, 120);
  }
  return name || 'file';
}

export function assertWithinLimit(kind, size) {
  if (size > LIMITS[kind]) {
    const label = { image: 'Photos', video: 'Videos', document: 'Documents' }[kind];
    throw new AppError(413, `${label} can be at most ${LIMIT_LABELS[kind]}`, { code: 'file_too_large' });
  }
}

const unreadable = () => badRequest('That image could not be read. Try a different photo.', { code: 'bad_image' });

/**
 * Re-encodes an image. This proves the file really decodes, removes metadata (GPS location, camera
 * info), applies EXIF rotation and caps the dimensions.
 * avatar: square 256px WebP. chat: original format, longest side at most 2560px.
 */
export async function processImage(buffer, { avatar = false } = {}) {
  try {
    const pipeline = sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
    const { format } = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(format)) throw unreadable();

    if (avatar) {
      const { data, info } = await pipeline
        .resize(256, 256, { fit: 'cover', position: 'attention' })
        .webp({ quality: 86 })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, mimeType: 'image/webp', width: info.width, height: info.height };
    }

    const resized = pipeline.resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true });
    const encoded =
      format === 'png' ? resized.png() : format === 'webp' ? resized.webp({ quality: 88 }) : resized.jpeg({ quality: 86 });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    return { buffer: data, mimeType, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unreadable();
  }
}
