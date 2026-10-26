import mongoose from 'mongoose';

// Files live in MongoDB GridFS, so they persist with the database (Atlas) and survive Render
// redeploys, whose local disk is wiped. No extra service or credentials are needed.
let bucket;
let bucketDb;

function getBucket() {
  const db = mongoose.connection.db;
  if (!bucket || bucketDb !== db) {
    bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
    bucketDb = db;
  }
  return bucket;
}

export function putBuffer(buffer, filename, metadata = {}) {
  return new Promise((resolve, reject) => {
    const stream = getBucket().openUploadStream(filename, { metadata });
    stream.on('error', reject);
    stream.on('finish', () => resolve(stream.id));
    stream.end(buffer);
  });
}

export async function deleteFile(fileId) {
  if (!fileId) return;
  try {
    await getBucket().delete(fileId);
  } catch (error) {
    // Already gone is fine; anything else is worth knowing about but must not break the request.
    if (!/FileNotFound/i.test(error.message)) console.error('[storage] delete failed', error.message);
  }
}

// `end` is inclusive here (HTTP semantics); GridFS wants an exclusive end.
export function openStream(fileId, { start, end } = {}) {
  const options = {};
  if (start !== undefined) options.start = start;
  if (end !== undefined) options.end = end + 1;
  return getBucket().openDownloadStream(fileId, options);
}

export async function getFileSize(fileId) {
  const file = await getBucket().find({ _id: fileId }).next();
  if (!file) throw new Error('File not found');
  return file.length;
}
