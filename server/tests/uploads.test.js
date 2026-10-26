import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { Attachment } from '../src/models/Attachment.js';
import { Message } from '../src/models/Message.js';
import { User } from '../src/models/User.js';
import { cleanupOrphans } from '../src/services/attachmentService.js';
import {
  collect,
  connectSocket,
  del,
  emitAck,
  fakeDocx,
  fakeMp4,
  fakePdf,
  get,
  makeJpegWithGps,
  makePng,
  makeWebp,
  newAgent,
  newClientMsgId,
  post,
  registerUser,
  resetDb,
  sendMessage,
  sleep,
  startPrivateChat,
  startStack,
  stopStack,
  uploadFile,
  uploadToConversation,
  waitForEvent,
} from './helpers.js';

beforeAll(startStack);
afterAll(stopStack);
beforeEach(resetDb);

const gridfsCount = async () => mongoose.connection.db.collection('uploads.files').countDocuments();

async function pair() {
  const a = await registerUser();
  const b = await registerUser();
  const conversation = await startPrivateChat(a.agent, b.user);
  return { a, b, conversation };
}

const sendAttachment = (socket, conversationId, attachmentId, content = '', clientMsgId = newClientMsgId()) =>
  emitAck(socket, 'message:send', { conversationId, attachmentId, content, clientMsgId });

describe('profile photos', () => {
  it('uploads a photo, serves it, and exposes the URL to other users', async () => {
    const { a, b } = await pair();
    const res = await uploadFile(a.agent, '/api/users/me/avatar', await makePng(400, 300), 'me.png', 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.data.user.avatarUrl).toMatch(new RegExp(`^/api/users/${a.user.id}/avatar\\?v=\\d+$`));

    // Another signed-in user sees it in search and can fetch the image.
    const search = await get(b.agent, `/api/users?q=${a.user.username}`);
    const url = search.body.data.users[0].avatarUrl;
    expect(url).toBe(res.body.data.user.avatarUrl);
    const img = await get(b.agent, url).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    const meta = await sharp(img.body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256]);
  });

  it('requires sign-in to view or change photos', async () => {
    const { a } = await pair();
    expect((await get(newAgent(), `/api/users/${a.user.id}/avatar`)).status).toBe(401);
    expect((await uploadFile(newAgent(), '/api/users/me/avatar', await makePng(), 'x.png')).status).toBe(401);
  });

  it('replaces the old photo (new version, old bytes deleted) and can remove it', async () => {
    const { a } = await pair();
    const first = await uploadFile(a.agent, '/api/users/me/avatar', await makePng(), 'a.png');
    expect(await gridfsCount()).toBe(1);
    await sleep(5);
    const second = await uploadFile(a.agent, '/api/users/me/avatar', await makeWebp(), 'b.webp');
    expect(second.body.data.user.avatarUrl).not.toBe(first.body.data.user.avatarUrl);
    expect(await gridfsCount()).toBe(1); // old file removed, not leaked

    const removed = await del(a.agent, '/api/users/me/avatar');
    expect(removed.status).toBe(200);
    expect(removed.body.data.user.avatarUrl).toBeNull();
    expect(await gridfsCount()).toBe(0);
    expect((await get(a.agent, `/api/users/${a.user.id}/avatar`)).status).toBe(404);
  });

  it('accepts JPG, PNG and WebP and nothing else', async () => {
    const { a } = await pair();
    expect((await uploadFile(a.agent, '/api/users/me/avatar', await makeJpegWithGps(), 'p.jpg')).status).toBe(200);
    expect((await uploadFile(a.agent, '/api/users/me/avatar', await makePng(), 'p.png')).status).toBe(200);
    expect((await uploadFile(a.agent, '/api/users/me/avatar', await makeWebp(), 'p.webp')).status).toBe(200);

    const bad = [
      ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg'],
      ['html', Buffer.from('<html><script>alert(1)</script></html>'), 'x.png'],
      ['gif', Buffer.from('GIF89a' + 'x'.repeat(40)), 'x.gif'],
      ['pdf', fakePdf(), 'x.pdf'],
      ['video', fakeMp4(), 'x.mp4'],
      ['text renamed to png', Buffer.from('just some text pretending to be a picture'), 'x.png'],
    ];
    for (const [label, buffer, name] of bad) {
      const res = await uploadFile(a.agent, '/api/users/me/avatar', buffer, name, 'image/png');
      expect(res.status, label).toBe(400);
    }
    // Corrupt image: right signature, undecodable body.
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9)]);
    const res = await uploadFile(a.agent, '/api/users/me/avatar', corrupt, 'broken.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_image');
  });

  it('rejects photos over 5 MB and a missing file', async () => {
    const { a } = await pair();
    const big = Buffer.concat([await makePng(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    expect((await uploadFile(a.agent, '/api/users/me/avatar', big, 'big.png')).status).toBe(413);
    const none = await a.agent.post('/api/users/me/avatar').set('X-Requested-With', 'vybe');
    expect(none.status).toBe(400);
  });

  it('strips location/camera metadata from uploaded photos', async () => {
    const { a, b, conversation } = await pair();
    const jpeg = await makeJpegWithGps();
    expect((await sharp(jpeg).metadata()).exif).toBeTruthy(); // the source really has EXIF
    const up = await uploadToConversation(a.agent, conversation.id, jpeg, 'photo.jpg');
    const file = await get(a.agent, up.body.data.attachment.url).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((await sharp(file.body).metadata()).exif).toBeUndefined();
    expect(file.body.includes(Buffer.from('secret-exif-marker'))).toBe(false);
  });

  it('only changes your own photo, whatever the request says', async () => {
    const { a, b } = await pair();
    await uploadFile(a.agent, '/api/users/me/avatar', await makePng(), 'a.png');
    const before = (await User.findById(a.user.id)).avatarVersion;
    await uploadFile(b.agent, `/api/users/me/avatar?userId=${a.user.id}`, await makePng(), 'b.png');
    expect((await User.findById(a.user.id)).avatarVersion.getTime()).toBe(before.getTime());
    expect((await User.findById(b.user.id)).avatarVersion).toBeTruthy();
    expect((await post(b.agent, `/api/users/${a.user.id}/avatar`, {})).status).toBe(404);
    expect((await del(b.agent, `/api/users/${a.user.id}/avatar`)).status).toBe(404);
  });

  it('pushes the new photo to contacts live', async () => {
    const { a, b } = await pair();
    const sockB = await connectSocket(b.agent);
    const update = waitForEvent(sockB, 'conversation:update', {
      predicate: (p) => p.conversation?.participants.find((x) => x.id === a.user.id)?.avatarUrl,
    });
    await uploadFile(a.agent, '/api/users/me/avatar', await makePng(), 'a.png');
    const payload = await update;
    expect(payload.conversation.participants.find((x) => x.id === a.user.id).avatarUrl).toMatch(/avatar\?v=/);
  });
});

describe('attachment upload validation', () => {
  it('accepts photos, videos and documents and classifies them by content', async () => {
    const { a, conversation } = await pair();
    const cases = [
      [await makePng(), 'pic.png', 'image', 'image/png'],
      [await makeJpegWithGps(), 'pic.jpg', 'image', 'image/jpeg'],
      [await makeWebp(), 'pic.webp', 'image', 'image/webp'],
      [fakeMp4(), 'clip.mp4', 'video', 'video/mp4'],
      [fakePdf(), 'report.pdf', 'document', 'application/pdf'],
      [fakeDocx(), 'notes.docx', 'document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      [Buffer.from('name,score\nasha,10\n'), 'data.csv', 'document', 'text/csv'],
      [Buffer.from('plain notes here, long enough'), 'todo.txt', 'document', 'text/plain'],
    ];
    for (const [buffer, name, kind, mimeType] of cases) {
      const res = await uploadToConversation(a.agent, conversation.id, buffer, name);
      expect(res.status, name).toBe(201);
      expect(res.body.data.attachment).toMatchObject({ kind, mimeType, filename: name, pending: true });
    }
  });

  it('records dimensions for images', async () => {
    const { a, conversation } = await pair();
    const res = await uploadToConversation(a.agent, conversation.id, await makePng(120, 90), 'p.png');
    expect(res.body.data.attachment).toMatchObject({ width: 120, height: 90 });
  });

  it('does not trust the filename or declared type', async () => {
    const { a, conversation } = await pair();
    const cases = [
      ['html as image', Buffer.from('<html><script>alert(1)</script></html>'), 'evil.png', 'image/png'],
      ['html', Buffer.from('<html><body>hi there friend</body></html>'), 'page.html', 'text/html'],
      ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'img.svg', 'image/svg+xml'],
      ['executable', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 2)]), 'setup.exe', 'application/x-msdownload'],
      ['script', Buffer.from('#!/bin/sh\nrm -rf /\n'), 'run.sh', 'text/x-shellscript'],
      ['zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]), 'archive.zip', 'application/zip'],
      ['pdf without pdf bytes', Buffer.from('this is not really a pdf file at all'), 'fake.pdf', 'application/pdf'],
      ['binary named txt', Buffer.concat([Buffer.from('abc'), Buffer.from([0, 1, 2]), Buffer.alloc(40, 3)]), 'bin.txt', 'text/plain'],
      ['heic photo', Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(100)]), 'iphone.heic', 'image/heic'],
      ['gif', Buffer.from('GIF89a' + 'x'.repeat(40)), 'a.gif', 'image/gif'],
    ];
    for (const [label, buffer, name, type] of cases) {
      const res = await uploadToConversation(a.agent, conversation.id, buffer, name, type);
      expect(res.status, label).toBe(400);
      expect(res.body.error.code, label).toBe('unsupported_type');
    }
    expect(await Attachment.countDocuments()).toBe(0);
    expect(await gridfsCount()).toBe(0);
  });

  it('enforces per-type size limits (photo 5 MB, video 25 MB, document 10 MB)', async () => {
    const { a, conversation } = await pair();
    const bigPhoto = Buffer.concat([await makePng(), Buffer.alloc(5 * 1024 * 1024)]);
    const bigDoc = Buffer.concat([fakePdf(), Buffer.alloc(10 * 1024 * 1024)]);
    const hugeVideo = fakeMp4(25 * 1024 * 1024 + 1024);
    expect((await uploadToConversation(a.agent, conversation.id, bigPhoto, 'p.png')).status).toBe(413);
    expect((await uploadToConversation(a.agent, conversation.id, bigDoc, 'd.pdf')).status).toBe(413);
    expect((await uploadToConversation(a.agent, conversation.id, hugeVideo, 'v.mp4')).status).toBe(413);
    // A 12 MB video is fine even though it would be too big for a document.
    expect((await uploadToConversation(a.agent, conversation.id, fakeMp4(12 * 1024 * 1024), 'ok.mp4')).status).toBe(201);
    expect(await Attachment.countDocuments()).toBe(1);
  });

  it('sanitises file names', async () => {
    const { a, conversation } = await pair();
    const res = await uploadToConversation(a.agent, conversation.id, fakePdf(), '../../etc/pass"wd<>.pdf');
    expect(res.status).toBe(201);
    expect(res.body.data.attachment.filename).not.toMatch(/[\\/"<>]/);
    expect(res.body.data.attachment.filename.endsWith('.pdf')).toBe(true);
  });

  it('requires membership and sign-in, and checks before reading the body', async () => {
    const { conversation } = await pair();
    const outsider = await registerUser();
    expect((await uploadToConversation(newAgent(), conversation.id, fakePdf(), 'x.pdf')).status).toBe(401);
    expect((await uploadToConversation(outsider.agent, conversation.id, fakePdf(), 'x.pdf')).status).toBe(404);
    expect((await uploadToConversation(outsider.agent, 'not-an-id', fakePdf(), 'x.pdf')).status).toBe(404);
    expect(await Attachment.countDocuments()).toBe(0);
  });

  it('requires the CSRF header on uploads', async () => {
    const { a, conversation } = await pair();
    const res = await a.agent.post(`/api/conversations/${conversation.id}/attachments`).attach('file', fakePdf(), 'x.pdf');
    expect(res.status).toBe(403);
  });

  it('rejects a request without a file', async () => {
    const { a, conversation } = await pair();
    const res = await a.agent.post(`/api/conversations/${conversation.id}/attachments`).set('X-Requested-With', 'vybe');
    expect(res.status).toBe(400);
  });
});

describe('sending attachments in real time', () => {
  it('sends an attachment with no text; both people get it live and it persists', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    const up = await uploadToConversation(a.agent, conversation.id, await makePng(), 'photo.png');
    const attachmentId = up.body.data.attachment.id;

    const incoming = waitForEvent(sockB, 'message:new');
    const ack = await sendAttachment(sockA, conversation.id, attachmentId);
    const received = await incoming;

    expect(ack.ok).toBe(true);
    expect(ack.message.content).toBe('');
    expect(ack.message.attachment).toMatchObject({ id: attachmentId, kind: 'image', filename: 'photo.png', pending: false });
    expect(received.message.attachment.id).toBe(attachmentId);

    // Persisted: history returns it, for either person, after "refresh".
    for (const who of [a, b]) {
      const history = await get(who.agent, `/api/conversations/${conversation.id}/messages`);
      expect(history.body.data.messages[0].attachment).toMatchObject({ id: attachmentId, kind: 'image' });
    }
    const stored = await Attachment.findById(attachmentId);
    expect(String(stored.messageId)).toBe(ack.message.id);
  });

  it('sends text together with a document, and updates the conversation preview', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const up = await uploadToConversation(a.agent, conversation.id, fakePdf(), 'report.pdf');
    const ack = await sendAttachment(sockA, conversation.id, up.body.data.attachment.id, 'here is the report');
    expect(ack.message).toMatchObject({ content: 'here is the report' });
    expect(ack.message.attachment.kind).toBe('document');

    const forB = (await get(b.agent, '/api/conversations')).body.data.conversations[0];
    expect(forB.lastMessage.content).toBe('here is the report');
    expect(forB.unreadCount).toBe(1);
  });

  it('shows a readable preview for attachment-only messages', async () => {
    const { a, conversation } = await pair();
    const sock = await connectSocket(a.agent);
    const cases = [
      [await makePng(), 'a.png', 'Photo'],
      [fakeMp4(), 'a.mp4', 'Video'],
      [fakePdf(), 'Plan.pdf', 'Document: Plan.pdf'],
    ];
    for (const [buffer, name, preview] of cases) {
      const up = await uploadToConversation(a.agent, conversation.id, buffer, name);
      await sendAttachment(sock, conversation.id, up.body.data.attachment.id);
      const list = await get(a.agent, '/api/conversations');
      expect(list.body.data.conversations[0].lastMessage.content).toBe(preview);
    }
  });

  it('still rejects a message with neither text nor attachment', async () => {
    const { a, conversation } = await pair();
    const sock = await connectSocket(a.agent);
    const res = await sendMessage(sock, conversation.id, '   ');
    expect(res.ok).toBe(false);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('is idempotent: retrying a send with an attachment delivers it once', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    const seen = collect(sockB, 'message:new');
    const up = await uploadToConversation(a.agent, conversation.id, await makePng(), 'p.png');
    const id = newClientMsgId();
    const first = await sendAttachment(sockA, conversation.id, up.body.data.attachment.id, '', id);
    const retry = await sendAttachment(sockA, conversation.id, up.body.data.attachment.id, '', id);
    await sleep(200);
    expect(first.ok && retry.ok).toBe(true);
    expect(retry.duplicate).toBe(true);
    expect(retry.message.attachment.id).toBe(first.message.attachment.id);
    expect(seen).toHaveLength(1);
    expect(await Message.countDocuments()).toBe(1);
  });

  it('cannot send the same upload twice, nor someone else upload, nor one from another conversation', async () => {
    const { a, b, conversation } = await pair();
    const c = await registerUser();
    const otherConv = await startPrivateChat(a.agent, c.user);
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);

    const up = await uploadToConversation(a.agent, conversation.id, fakePdf(), 'x.pdf');
    const attachmentId = up.body.data.attachment.id;

    // B tries to send A's pending upload
    expect((await sendAttachment(sockB, conversation.id, attachmentId)).ok).toBe(false);
    // A sends it to a different conversation
    expect((await sendAttachment(sockA, otherConv.id, attachmentId)).ok).toBe(false);
    // First legitimate use works, second does not
    expect((await sendAttachment(sockA, conversation.id, attachmentId)).ok).toBe(true);
    const again = await sendAttachment(sockA, conversation.id, attachmentId);
    expect(again.ok).toBe(false);
    expect(await Message.countDocuments()).toBe(1);

    // Unknown ids
    expect((await sendAttachment(sockA, conversation.id, new mongoose.Types.ObjectId().toString())).ok).toBe(false);
    expect((await sendAttachment(sockA, conversation.id, 'nope')).ok).toBe(false);
  });

  it('works in groups, reaching every member and no one else', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const c = await registerUser();
    const outsider = await registerUser();
    const group = (await post(a.agent, '/api/groups', { name: 'Crew', memberIds: [b.user.id, c.user.id] })).body.data.conversation;
    const sockA = await connectSocket(a.agent);
    const sockC = await connectSocket(c.agent);
    const sockO = await connectSocket(outsider.agent);
    const leaked = collect(sockO, 'message:new');
    const gotC = waitForEvent(sockC, 'message:new');

    const up = await uploadToConversation(a.agent, group.id, await makePng(), 'team.png');
    await sendAttachment(sockA, group.id, up.body.data.attachment.id, 'team photo');
    expect((await gotC).message.attachment.filename).toBe('team.png');
    await sleep(200);
    expect(leaked).toHaveLength(0);
  });
});

describe('downloading attachments', () => {
  async function sentFile(buffer, name) {
    const { a, b, conversation } = await pair();
    const sock = await connectSocket(a.agent);
    const up = await uploadToConversation(a.agent, conversation.id, buffer, name);
    await sendAttachment(sock, conversation.id, up.body.data.attachment.id);
    return { a, b, conversation, attachment: up.body.data.attachment };
  }

  it('serves photos inline and documents as downloads, with safe headers', async () => {
    const { a, b, attachment } = await sentFile(fakePdf(), 'Plan v2.pdf');
    const res = await get(b.agent, attachment.url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Plan v2.pdf"/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.headers['cache-control']).toMatch(/private/);
    expect((await get(a.agent, attachment.url)).status).toBe(200);
  });

  it('serves images inline unless a download is requested', async () => {
    const { a, attachment } = await sentFile(await makePng(), 'pic.png');
    expect((await get(a.agent, attachment.url)).headers['content-disposition']).toMatch(/^inline/);
    expect((await get(a.agent, `${attachment.url}?download=1`)).headers['content-disposition']).toMatch(/^attachment/);
  });

  it('returns exact bytes and supports range requests for video seeking', async () => {
    const video = fakeMp4(10_000);
    const { a, attachment } = await sentFile(video, 'clip.mp4');
    const parse = (r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const full = await get(a.agent, attachment.url).buffer(true).parse(parse);
    expect(full.status).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.compare(full.body, video)).toBe(0);

    const part = await get(a.agent, attachment.url).set('Range', 'bytes=100-199').buffer(true).parse(parse);
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 100-199/10000');
    expect(Buffer.compare(part.body, video.subarray(100, 200))).toBe(0);

    const tail = await get(a.agent, attachment.url).set('Range', 'bytes=-50').buffer(true).parse(parse);
    expect(tail.status).toBe(206);
    expect(Buffer.compare(tail.body, video.subarray(9950))).toBe(0);

    const open = await get(a.agent, attachment.url).set('Range', 'bytes=9990-').buffer(true).parse(parse);
    expect(open.headers['content-range']).toBe('bytes 9990-9999/10000');

    const bad = await get(a.agent, attachment.url).set('Range', 'bytes=20000-30000');
    expect(bad.status).toBe(416);
  });

  it('blocks everyone who is not in the conversation', async () => {
    const { attachment, conversation } = await sentFile(fakePdf(), 'secret.pdf');
    const outsider = await registerUser();
    expect((await get(outsider.agent, attachment.url)).status).toBe(404);
    expect((await get(outsider.agent, `/api/conversations/${conversation.id}/shared`)).status).toBe(404);
    expect((await get(newAgent(), attachment.url)).status).toBe(401);
    expect((await get(outsider.agent, '/api/attachments/not-an-id')).status).toBe(404);
  });

  it('keeps unsent uploads private to the uploader, who can cancel them', async () => {
    const { a, b, conversation } = await pair();
    const up = await uploadToConversation(a.agent, conversation.id, await makePng(), 'draft.png');
    const att = up.body.data.attachment;
    expect((await get(a.agent, att.url)).status).toBe(200);
    expect((await get(b.agent, att.url)).status).toBe(404); // even the other participant cannot see a draft
    expect((await del(b.agent, att.url)).status).toBe(404);

    const removed = await del(a.agent, att.url);
    expect(removed.status).toBe(200);
    expect((await get(a.agent, att.url)).status).toBe(404);
    expect(await Attachment.countDocuments()).toBe(0);
    expect(await gridfsCount()).toBe(0);
  });

  it('does not allow deleting a sent attachment', async () => {
    const { a, attachment } = await sentFile(fakePdf(), 'keep.pdf');
    expect((await del(a.agent, attachment.url)).status).toBe(403);
    expect((await get(a.agent, attachment.url)).status).toBe(200);
  });

  it('removes access when a member leaves a group', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const c = await registerUser();
    const group = (await post(a.agent, '/api/groups', { name: 'G', memberIds: [b.user.id, c.user.id] })).body.data.conversation;
    const sock = await connectSocket(a.agent);
    const up = await uploadToConversation(a.agent, group.id, fakePdf(), 'g.pdf');
    await sendAttachment(sock, group.id, up.body.data.attachment.id);
    expect((await get(c.agent, up.body.data.attachment.url)).status).toBe(200);
    await del(c.agent, `/api/groups/${group.id}/members/me`);
    expect((await get(c.agent, up.body.data.attachment.url)).status).toBe(404);
    expect((await get(b.agent, up.body.data.attachment.url)).status).toBe(200);
  });

  it('deletes stored files when the last member leaves a group', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const group = (await post(a.agent, '/api/groups', { name: 'Tiny', memberIds: [b.user.id] })).body.data.conversation;
    const sock = await connectSocket(a.agent);
    const up = await uploadToConversation(a.agent, group.id, fakePdf(), 'g.pdf');
    await sendAttachment(sock, group.id, up.body.data.attachment.id);
    expect(await gridfsCount()).toBe(1);
    await del(a.agent, `/api/groups/${group.id}/members/me`);
    await del(b.agent, `/api/groups/${group.id}/members/me`);
    expect(await Attachment.countDocuments()).toBe(0);
    expect(await gridfsCount()).toBe(0);
  });
});

describe('shared media and files', () => {
  async function conversationWithFiles() {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    const send = async (who, sock, buffer, name) => {
      const up = await uploadToConversation(who.agent, conversation.id, buffer, name);
      await sendAttachment(sock, conversation.id, up.body.data.attachment.id);
      await sleep(5);
      return up.body.data.attachment;
    };
    const items = {
      photo: await send(a, sockA, await makePng(), 'one.png'),
      video: await send(b, sockB, fakeMp4(), 'two.mp4'),
      pdf: await send(a, sockA, fakePdf(), 'three.pdf'),
      doc: await send(b, sockB, fakeDocx(), 'four.docx'),
    };
    return { a, b, conversation, items };
  }

  it('lists media and documents separately, newest first, with dates and senders', async () => {
    const { a, conversation, items } = await conversationWithFiles();
    const media = await get(a.agent, `/api/conversations/${conversation.id}/shared?group=media`);
    expect(media.body.data.items.map((i) => i.filename)).toEqual(['two.mp4', 'one.png']);
    expect(media.body.data.items[0].sentAt).toBeTruthy();
    expect(media.body.data.items[0].senderId).toBeTruthy();
    expect(media.body.data.items[0].url).toBe(items.video.url);

    const docs = await get(a.agent, `/api/conversations/${conversation.id}/shared?group=documents`);
    expect(docs.body.data.items.map((i) => i.filename)).toEqual(['four.docx', 'three.pdf']);
    const defaults = await get(a.agent, `/api/conversations/${conversation.id}/shared`);
    expect(defaults.body.data.items).toHaveLength(2); // media by default
  });

  it('paginates', async () => {
    const { a, conversation } = await conversationWithFiles();
    const first = await get(a.agent, `/api/conversations/${conversation.id}/shared?group=media&limit=1`);
    expect(first.body.data).toMatchObject({ hasMore: true });
    const next = await get(
      a.agent,
      `/api/conversations/${conversation.id}/shared?group=media&limit=1&before=${first.body.data.items[0].id}`
    );
    expect(next.body.data.items[0].filename).toBe('one.png');
    expect(next.body.data.hasMore).toBe(false);
  });

  it('never includes unsent uploads or files from other conversations', async () => {
    const { a, b, conversation } = await conversationWithFiles();
    const c = await registerUser();
    const other = await startPrivateChat(a.agent, c.user);
    const sock = await connectSocket(a.agent);
    const upOther = await uploadToConversation(a.agent, other.id, await makePng(), 'other-chat.png');
    await sendAttachment(sock, other.id, upOther.body.data.attachment.id);
    await uploadToConversation(a.agent, conversation.id, await makePng(), 'draft-only.png'); // never sent

    const media = await get(b.agent, `/api/conversations/${conversation.id}/shared?group=media`);
    const names = media.body.data.items.map((i) => i.filename);
    expect(names).not.toContain('other-chat.png');
    expect(names).not.toContain('draft-only.png');
    const otherMedia = await get(c.agent, `/api/conversations/${other.id}/shared?group=media`);
    expect(otherMedia.body.data.items.map((i) => i.filename)).toEqual(['other-chat.png']);
  });

  it('validates query parameters and requires sign-in', async () => {
    const { a, conversation } = await conversationWithFiles();
    expect((await get(a.agent, `/api/conversations/${conversation.id}/shared?group=everything`)).status).toBe(400);
    expect((await get(a.agent, `/api/conversations/${conversation.id}/shared?before=bad`)).status).toBe(400);
    expect((await get(newAgent(), `/api/conversations/${conversation.id}/shared`)).status).toBe(401);
  });
});

describe('cleanup of abandoned uploads', () => {
  it('removes uploads that were never sent once they are old, and keeps recent and sent ones', async () => {
    const { a, conversation } = await pair();
    const sock = await connectSocket(a.agent);
    const abandoned = (await uploadToConversation(a.agent, conversation.id, await makePng(), 'old.png')).body.data.attachment;
    const recent = (await uploadToConversation(a.agent, conversation.id, await makePng(), 'new.png')).body.data.attachment;
    const sent = (await uploadToConversation(a.agent, conversation.id, fakePdf(), 'sent.pdf')).body.data.attachment;
    await sendAttachment(sock, conversation.id, sent.id);
    const oid = (id) => new mongoose.Types.ObjectId(id);
    // createdAt is immutable in Mongoose, so backdate through the raw collection.
    await Attachment.collection.updateOne({ _id: oid(abandoned.id) }, { $set: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    await Attachment.collection.updateOne({ _id: oid(sent.id) }, { $set: { createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000) } });

    expect(await cleanupOrphans()).toBe(1);
    expect(await Attachment.findById(abandoned.id)).toBeNull();
    expect(await Attachment.findById(recent.id)).not.toBeNull();
    expect(await Attachment.findById(sent.id)).not.toBeNull();
    expect(await gridfsCount()).toBe(2);
  });
});
