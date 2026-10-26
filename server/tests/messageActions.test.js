import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  connectSocket,
  del,
  fakePdf,
  get,
  makePng,
  newAgent,
  newClientMsgId,
  patch,
  post,
  put,
  registerUser,
  resetDb,
  sendMessage,
  startPrivateChat,
  startStack,
  stopStack,
  uploadToConversation,
  waitForEvent,
  emitAck,
} from './helpers.js';

beforeAll(startStack);
afterAll(stopStack);
beforeEach(resetDb);

async function pair() {
  const a = await registerUser();
  const b = await registerUser();
  const conversation = await startPrivateChat(a.agent, b.user);
  a.socket = await connectSocket(a.agent);
  b.socket = await connectSocket(b.agent);
  return { a, b, conversation, cid: conversation.id };
}

const send = async (who, cid, text) => (await sendMessage(who.socket, cid, text)).message;
const url = (cid, mid, tail = '') => `/api/conversations/${cid}/messages/${mid}${tail}`;
const history = async (who, cid) => (await get(who.agent, `/api/conversations/${cid}/messages`)).body.data.messages;
const age = (id, ms) =>
  mongoose.connection.db
    .collection('messages')
    .updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - ms) } });
const conv = async (who, cid) =>
  (await get(who.agent, '/api/conversations')).body.data.conversations.find((c) => c.id === cid);

describe('edit', () => {
  it('edits own message, marks it edited, updates the other member live and the history', async () => {
    const { a, b, cid } = await pair();
    const m = await send(a, cid, 'helo');
    const live = waitForEvent(b.socket, 'message:update');
    const res = await patch(a.agent, url(cid, m.id), { content: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.data.message.content).toBe('hello');
    expect(res.body.data.message.editedAt).toBeTruthy();
    expect((await live).message.content).toBe('hello');
    const stored = (await history(b, cid)).find((x) => x.id === m.id);
    expect(stored.content).toBe('hello');
    expect(stored.editedAt).toBeTruthy();
  });

  it("refuses to edit someone else's message", async () => {
    const { a, b, cid } = await pair();
    const m = await send(a, cid, 'mine');
    const res = await patch(b.agent, url(cid, m.id), { content: 'hijack' });
    expect(res.status).toBe(403);
    expect((await history(a, cid))[0].content).toBe('mine');
  });

  it('refuses after 15 minutes, empty text, and edits to a deleted message', async () => {
    const { a, cid } = await pair();
    const old = await send(a, cid, 'old one');
    await age(old.id, 16 * 60 * 1000);
    const late = await patch(a.agent, url(cid, old.id), { content: 'too late' });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('edit_window_closed');

    const fresh = await send(a, cid, 'fresh');
    expect((await patch(a.agent, url(cid, fresh.id), { content: '   ' })).status).toBe(400);

    await del(a.agent, url(cid, fresh.id) + '?scope=everyone');
    expect((await patch(a.agent, url(cid, fresh.id), { content: 'zombie' })).status).toBe(400);
  });

  it('unchanged text is a no-op and does not mark the message edited', async () => {
    const { a, cid } = await pair();
    const m = await send(a, cid, 'same');
    const res = await patch(a.agent, url(cid, m.id), { content: 'same' });
    expect(res.status).toBe(200);
    expect(res.body.data.message.editedAt).toBeNull();
  });

  it('non-members get 404 and the edit also refreshes the conversation preview', async () => {
    const { a, cid } = await pair();
    const outsider = await registerUser();
    const m = await send(a, cid, 'secret');
    expect((await patch(outsider.agent, url(cid, m.id), { content: 'x' })).status).toBe(404);
    await patch(a.agent, url(cid, m.id), { content: 'secret v2' });
    expect((await conv(a, cid)).lastMessage.content).toBe('secret v2');
  });

  it('can edit or clear the caption of an attachment message (the file keeps it valid)', async () => {
    const { a, cid } = await pair();
    const up = await uploadToConversation(a.agent, cid, await makePng(), 'p.png', 'image/png');
    const ack = await emitAck(a.socket, 'message:send', {
      conversationId: cid,
      content: 'cap',
      clientMsgId: newClientMsgId(),
      attachmentId: up.body.data.attachment.id,
    });
    expect((await patch(a.agent, url(cid, ack.message.id), { content: 'new cap' })).body.data.message.content).toBe('new cap');
    expect((await patch(a.agent, url(cid, ack.message.id), { content: '' })).status).toBe(200);
  });
});

describe('delete', () => {
  it('delete for me hides it only for me, forever, and tells my other sessions', async () => {
    const { a, b, cid } = await pair();
    const m = await send(a, cid, 'bye');
    const aSecond = await connectSocket(a.agent);
    const removed = waitForEvent(aSecond, 'message:removed');
    // the recipient may hide it too, without affecting the sender
    const res = await del(b.agent, url(cid, m.id) + '?scope=me');
    expect(res.status).toBe(200);
    expect((await history(b, cid)).length).toBe(0);
    expect((await history(a, cid)).length).toBe(1);

    const res2 = await del(a.agent, url(cid, m.id) + '?scope=me');
    expect(res2.status).toBe(200);
    expect((await removed).messageId).toBe(m.id);
    expect((await history(a, cid)).length).toBe(0);
  });

  it('delete for me does not count as unread afterwards', async () => {
    const { a, b, cid } = await pair();
    const m = await send(a, cid, 'one');
    expect((await conv(b, cid)).unreadCount).toBe(1);
    await del(b.agent, url(cid, m.id) + '?scope=me');
    expect((await conv(b, cid)).unreadCount).toBe(0);
  });

  it('delete for everyone leaves a tombstone for both people and removes text, file and reactions', async () => {
    const { a, b, cid } = await pair();
    const up = await uploadToConversation(a.agent, cid, fakePdf(), 'plan.pdf', 'application/pdf');
    const attId = up.body.data.attachment.id;
    const ack = await emitAck(a.socket, 'message:send', {
      conversationId: cid,
      content: 'top secret',
      clientMsgId: newClientMsgId(),
      attachmentId: attId,
    });
    const m = ack.message;
    await put(b.agent, url(cid, m.id, '/reaction'), { emoji: '👍' });
    expect((await get(b.agent, `/api/attachments/${attId}`)).status).toBe(200);

    const live = waitForEvent(b.socket, 'message:update');
    const res = await del(a.agent, url(cid, m.id) + '?scope=everyone');
    expect(res.status).toBe(200);
    const evt = (await live).message;
    expect(evt.deleted).toBe(true);
    expect(evt.content).toBe('');
    expect(evt.attachment).toBeNull();
    expect(evt.reactions).toEqual([]);

    for (const who of [a, b]) {
      const row = (await history(who, cid)).find((x) => x.id === m.id);
      expect(row.deleted).toBe(true);
      expect(row.content).toBe('');
      expect(row.attachment).toBeNull();
    }
    // the file itself is gone, not merely hidden
    expect((await get(b.agent, `/api/attachments/${attId}`)).status).toBe(404);
    expect((await get(a.agent, `/api/conversations/${cid}/shared?group=documents`)).body.data.items).toEqual([]);
    expect((await conv(b, cid)).lastMessage.content).toBe('This message was deleted');
  });

  it('only the sender, only within 1 hour; repeating it is harmless', async () => {
    const { a, b, cid } = await pair();
    const m = await send(a, cid, 'x1');
    expect((await del(b.agent, url(cid, m.id) + '?scope=everyone')).status).toBe(403);
    expect((await del(a.agent, url(cid, m.id) + '?scope=everyone')).status).toBe(200);
    expect((await del(a.agent, url(cid, m.id) + '?scope=everyone')).status).toBe(200);

    const old = await send(a, cid, 'x2');
    await age(old.id, 61 * 60 * 1000);
    const res = await del(a.agent, url(cid, old.id) + '?scope=everyone');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('delete_window_closed');
    // delete for me has no time limit
    expect((await del(a.agent, url(cid, old.id) + '?scope=me')).status).toBe(200);
  });

  it('requires a valid scope and membership', async () => {
    const { a, cid } = await pair();
    const outsider = await registerUser();
    const m = await send(a, cid, 'x');
    expect((await del(a.agent, url(cid, m.id))).status).toBe(400);
    expect((await del(a.agent, url(cid, m.id) + '?scope=nope')).status).toBe(400);
    expect((await del(outsider.agent, url(cid, m.id) + '?scope=me')).status).toBe(404);
    expect((await del(a.agent, url(cid, 'not-an-id') + '?scope=me')).status).toBe(404);
  });
});

describe('reply', () => {
  it('stores a reply with a quoted preview that survives refresh and reaches the other person', async () => {
    const { a, b, cid } = await pair();
    const original = await send(a, cid, 'what time is the call?');
    const live = waitForEvent(a.socket, 'message:new', { predicate: (p) => p.message.replyTo });
    const ack = await emitAck(b.socket, 'message:send', {
      conversationId: cid,
      content: '5pm',
      clientMsgId: newClientMsgId(),
      replyTo: original.id,
    });
    expect(ack.ok).toBe(true);
    expect(ack.message.replyTo).toMatchObject({ id: original.id, content: 'what time is the call?', deleted: false });
    expect(ack.message.replyTo.senderName).toBeTruthy();
    expect((await live).message.replyTo.id).toBe(original.id);
    const stored = (await history(a, cid)).find((x) => x.id === ack.message.id);
    expect(stored.replyTo.id).toBe(original.id);
  });

  it('rejects replies to missing, foreign-conversation or deleted messages', async () => {
    const { a, b, cid } = await pair();
    const c = await registerUser();
    const other = await startPrivateChat(a.agent, c.user);
    const foreign = await send(a, other.id, 'elsewhere');
    const target = await send(a, cid, 'target');
    const reply = (replyTo) =>
      emitAck(b.socket, 'message:send', { conversationId: cid, content: 'r', clientMsgId: newClientMsgId(), replyTo });

    expect((await reply(foreign.id)).ok).toBe(false);
    expect((await reply(new mongoose.Types.ObjectId().toString())).ok).toBe(false);
    await del(a.agent, url(cid, target.id) + '?scope=everyone');
    expect((await reply(target.id)).ok).toBe(false);
  });

  it("hides the quoted text once the original is deleted for everyone", async () => {
    const { a, b, cid } = await pair();
    const original = await send(a, cid, 'regrettable');
    const ack = await emitAck(b.socket, 'message:send', {
      conversationId: cid,
      content: 'ok',
      clientMsgId: newClientMsgId(),
      replyTo: original.id,
    });
    await del(a.agent, url(cid, original.id) + '?scope=everyone');
    const row = (await history(b, cid)).find((x) => x.id === ack.message.id);
    expect(row.replyTo.deleted).toBe(true);
    expect(row.replyTo.content).toBe('');
  });
});

describe('reactions', () => {
  it('adds, changes and removes one reaction per person, live', async () => {
    const { a, b, cid } = await pair();
    const m = await send(a, cid, 'react to me');
    const react = (who, emoji) => put(who.agent, url(cid, m.id, '/reaction'), { emoji });

    const live = waitForEvent(a.socket, 'message:update');
    const r1 = await react(b, '❤️');
    expect(r1.body.data.message.reactions).toEqual([{ emoji: '❤️', userIds: [b.user.id] }]);
    expect((await live).message.reactions[0].emoji).toBe('❤️');

    const r2 = await react(b, '🔥'); // changing replaces, never stacks
    expect(r2.body.data.message.reactions).toEqual([{ emoji: '🔥', userIds: [b.user.id] }]);

    const r3 = await react(a, '🔥');
    expect(r3.body.data.message.reactions[0].userIds.sort()).toEqual([a.user.id, b.user.id].sort());

    const r4 = await react(b, '🔥'); // same again removes
    expect(r4.body.data.message.reactions).toEqual([{ emoji: '🔥', userIds: [a.user.id] }]);
    expect((await history(b, cid))[0].reactions).toEqual([{ emoji: '🔥', userIds: [a.user.id] }]);
  });

  it('only the six allowed emojis, only members, never on deleted messages', async () => {
    const { a, cid } = await pair();
    const outsider = await registerUser();
    const m = await send(a, cid, 'x');
    expect((await put(a.agent, url(cid, m.id, '/reaction'), { emoji: '💩' })).status).toBe(400);
    expect((await put(a.agent, url(cid, m.id, '/reaction'), {})).status).toBe(400);
    expect((await put(outsider.agent, url(cid, m.id, '/reaction'), { emoji: '👍' })).status).toBe(404);
    await del(a.agent, url(cid, m.id) + '?scope=everyone');
    expect((await put(a.agent, url(cid, m.id, '/reaction'), { emoji: '👍' })).status).toBe(400);
  });

  it('concurrent taps from one person never create two reactions', async () => {
    const { a, b, cid } = await pair();
    const m = await send(a, cid, 'tap tap');
    await Promise.all(['👍', '👍', '😮', '😢'].map((emoji) => put(b.agent, url(cid, m.id, '/reaction'), { emoji })));
    const reactions = (await history(a, cid))[0].reactions;
    expect(reactions.flatMap((r) => r.userIds).filter((id) => id === b.user.id).length).toBeLessThanOrEqual(1);
  });
});

describe('pins', () => {
  it('pins for everyone in the conversation, max 3, and unpins', async () => {
    const { a, b, cid } = await pair();
    const ms = [];
    for (const t of ['one', 'two', 'three', 'four']) ms.push(await send(a, cid, t));
    const live = waitForEvent(b.socket, 'conversation:update', { predicate: (p) => p.conversation?.pins?.length === 1 });
    expect((await put(b.agent, `/api/conversations/${cid}/pins/${ms[0].id}`)).status).toBe(200);
    await live;
    expect((await put(a.agent, `/api/conversations/${cid}/pins/${ms[1].id}`)).status).toBe(200);
    expect((await put(a.agent, `/api/conversations/${cid}/pins/${ms[1].id}`)).status).toBe(200); // idempotent
    expect((await put(a.agent, `/api/conversations/${cid}/pins/${ms[2].id}`)).status).toBe(200);
    const over = await put(a.agent, `/api/conversations/${cid}/pins/${ms[3].id}`);
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('pin_limit');

    const pins = (await conv(a, cid)).pins;
    expect(pins.map((p) => p.content)).toEqual(['one', 'two', 'three']);
    expect((await conv(b, cid)).pins.length).toBe(3);

    await del(b.agent, `/api/conversations/${cid}/pins/${ms[0].id}`);
    expect((await conv(a, cid)).pins.map((p) => p.content)).toEqual(['two', 'three']);
    expect((await put(a.agent, `/api/conversations/${cid}/pins/${ms[3].id}`)).status).toBe(200);
  });

  it('concurrent pins can never exceed 3', async () => {
    const { a, cid } = await pair();
    const ms = [];
    for (const t of ['a1', 'a2', 'a3', 'a4', 'a5']) ms.push(await send(a, cid, t));
    await Promise.all(ms.map((m) => put(a.agent, `/api/conversations/${cid}/pins/${m.id}`)));
    expect((await conv(a, cid)).pins.length).toBe(3);
  });

  it('non-members cannot pin, and deleting a message for everyone removes its pin', async () => {
    const { a, b, cid } = await pair();
    const outsider = await registerUser();
    const m = await send(a, cid, 'pin me');
    expect((await put(outsider.agent, `/api/conversations/${cid}/pins/${m.id}`)).status).toBe(404);
    await put(b.agent, `/api/conversations/${cid}/pins/${m.id}`);
    expect((await conv(a, cid)).pins.length).toBe(1);
    await del(a.agent, url(cid, m.id) + '?scope=everyone');
    expect((await conv(b, cid)).pins).toEqual([]);
  });

  it('a message hidden "for me" disappears from my pin bar only', async () => {
    const { a, b, cid } = await pair();
    const m = await send(a, cid, 'shared pin');
    await put(a.agent, `/api/conversations/${cid}/pins/${m.id}`);
    await del(b.agent, url(cid, m.id) + '?scope=me');
    expect((await conv(b, cid)).pins).toEqual([]);
    expect((await conv(a, cid)).pins.length).toBe(1);
  });
});
