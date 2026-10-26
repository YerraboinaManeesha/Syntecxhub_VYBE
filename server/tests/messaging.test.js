import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { signSessionToken } from '../src/utils/tokens.js';
import {
  collect,
  connectSocket,
  emitAck,
  get,
  newClientMsgId,
  post,
  registerUser,
  resetDb,
  sendMessage,
  sleep,
  startPrivateChat,
  startStack,
  stopStack,
  tryConnect,
  waitForEvent,
} from './helpers.js';

beforeAll(startStack);
afterAll(stopStack);
beforeEach(resetDb);

async function twoUsersWithChat() {
  const a = await registerUser();
  const b = await registerUser();
  const conversation = await startPrivateChat(a.agent, b.user);
  return { a, b, conversation };
}

describe('private conversations', () => {
  it('creates one conversation and reuses it from either side', async () => {
    const a = await registerUser();
    const b = await registerUser();

    const first = await post(a.agent, '/api/conversations', { userId: b.user.id });
    const again = await post(a.agent, '/api/conversations', { userId: b.user.id });
    const fromB = await post(b.agent, '/api/conversations', { userId: a.user.id });

    expect(first.status).toBe(201);
    expect(first.body.data.created).toBe(true);
    expect(again.status).toBe(200);
    expect(again.body.data.created).toBe(false);
    expect(fromB.body.data.conversation.id).toBe(first.body.data.conversation.id);
    expect(await Conversation.countDocuments({ type: 'private' })).toBe(1);
  });

  it('never creates duplicates under concurrent requests', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const results = await Promise.all([
      post(a.agent, '/api/conversations', { userId: b.user.id }),
      post(b.agent, '/api/conversations', { userId: a.user.id }),
      post(a.agent, '/api/conversations', { userId: b.user.id }),
      post(b.agent, '/api/conversations', { userId: a.user.id }),
      post(a.agent, '/api/conversations', { userId: b.user.id }),
    ]);
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.conversation.id)).size).toBe(1);
    expect(await Conversation.countDocuments({ type: 'private' })).toBe(1);
  });

  it('rejects a conversation with yourself or with a user that does not exist', async () => {
    const a = await registerUser();
    expect((await post(a.agent, '/api/conversations', { userId: a.user.id })).status).toBe(400);
    expect((await post(a.agent, '/api/conversations', { userId: new mongoose.Types.ObjectId().toString() })).status).toBe(404);
    expect((await post(a.agent, '/api/conversations', { userId: 'nope' })).status).toBe(400);
  });

  it('lists conversations sorted by latest activity with participants and previews', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const c = await registerUser();
    const withB = await startPrivateChat(a.agent, b.user);
    const withC = await startPrivateChat(a.agent, c.user);

    const socket = await connectSocket(a.agent);
    await sendMessage(socket, withB.id, 'first to B');
    await sleep(10);
    await sendMessage(socket, withC.id, 'then to C');

    const list = await get(a.agent, '/api/conversations');
    const ids = list.body.data.conversations.map((x) => x.id);
    expect(ids).toEqual([withC.id, withB.id]);
    expect(list.body.data.conversations[0].lastMessage.content).toBe('then to C');
    for (const participant of list.body.data.conversations[0].participants) {
      expect(participant.email).toBeUndefined();
    }
  });
});

describe('socket authentication', () => {
  it('rejects connections with no token, a garbage token, or a session token', async () => {
    const { a } = await twoUsersWithChat();
    expect((await tryConnect(undefined)).connected).toBe(false);
    expect((await tryConnect('garbage')).connected).toBe(false);
    // The long-lived session token must not work as a socket token.
    expect((await tryConnect(signSessionToken(a.user.id))).connected).toBe(false);
  });

  it('accepts a proper short-lived socket token', async () => {
    const { a } = await twoUsersWithChat();
    const socket = await connectSocket(a.agent);
    expect(socket.connected).toBe(true);
  });

  it('only issues socket tokens to signed-in users', async () => {
    const { newAgent } = await import('./helpers.js');
    expect((await get(newAgent(), '/api/auth/socket-token')).status).toBe(401);
  });
});

describe('real-time delivery and persistence', () => {
  it('persists, acknowledges and delivers a message to the recipient instantly', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);

    const incoming = waitForEvent(sockB, 'message:new');
    const ack = await sendMessage(sockA, conversation.id, '  Hello B!  ');
    const received = await incoming;

    expect(ack.ok).toBe(true);
    expect(ack.message.content).toBe('Hello B!');
    expect(ack.message.senderId).toBe(a.user.id);
    expect(received.message.id).toBe(ack.message.id);
    expect(received.message.sender.username).toBe(a.user.username);

    // Stored in MongoDB before it was acknowledged.
    const stored = await Message.findById(ack.message.id);
    expect(stored.content).toBe('Hello B!');
  });

  it('keeps history after a refresh and lets an offline recipient read it later', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    await sendMessage(sockA, conversation.id, 'while you were away');

    // B was never connected. They log in later and fetch.
    const msgs = await get(b.agent, `/api/conversations/${conversation.id}/messages`);
    expect(msgs.body.data.messages.map((m) => m.content)).toEqual(['while you were away']);
    const list = await get(b.agent, '/api/conversations');
    expect(list.body.data.conversations[0].unreadCount).toBe(1);
  });

  it('is idempotent: a retried send with the same clientMsgId is stored and delivered once', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    const received = collect(sockB, 'message:new');

    const id = newClientMsgId();
    const first = await sendMessage(sockA, conversation.id, 'only once', id);
    const retry = await sendMessage(sockA, conversation.id, 'only once', id);
    await sleep(200);

    expect(first.ok && retry.ok).toBe(true);
    expect(retry.duplicate).toBe(true);
    expect(retry.message.id).toBe(first.message.id);
    expect(await Message.countDocuments({ conversationId: conversation.id })).toBe(1);
    expect(received).toHaveLength(1);
  });

  it('does not let a clientMsgId be reused to write into a different conversation', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const c = await registerUser();
    const withB = await startPrivateChat(a.agent, b.user);
    const withC = await startPrivateChat(a.agent, c.user);
    const sockA = await connectSocket(a.agent);

    const id = newClientMsgId();
    await sendMessage(sockA, withB.id, 'to B', id);
    const reuse = await sendMessage(sockA, withC.id, 'to C', id);
    expect(reuse.ok).toBe(false);
    expect(await Message.countDocuments({ conversationId: withC.id })).toBe(0);
  });

  it('delivers to every session of the recipient, and syncs the sender other tabs', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA1 = await connectSocket(a.agent);
    const sockA2 = await connectSocket(a.agent);
    const sockB1 = await connectSocket(b.agent);
    const sockB2 = await connectSocket(b.agent);
    const got = [collect(sockA2, 'message:new'), collect(sockB1, 'message:new'), collect(sockB2, 'message:new')];

    await sendMessage(sockA1, conversation.id, 'to everyone');
    await sleep(200);
    for (const events of got) expect(events).toHaveLength(1);
  });

  it('rejects empty, whitespace-only and oversized messages without storing them', async () => {
    const { a, conversation } = await twoUsersWithChat();
    const sock = await connectSocket(a.agent);

    for (const content of ['', '    ', 'x'.repeat(4001)]) {
      const res = await sendMessage(sock, conversation.id, content);
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe('invalid_payload');
    }
    const badId = await emitAck(sock, 'message:send', { conversationId: conversation.id, content: 'hi', clientMsgId: 'x' });
    expect(badId.ok).toBe(false);
    const missing = await emitAck(sock, 'message:send', {});
    expect(missing.ok).toBe(false);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('stores HTML as plain text, unmodified (the UI renders it as text)', async () => {
    const { a, conversation } = await twoUsersWithChat();
    const sock = await connectSocket(a.agent);
    const html = '<img src=x onerror=alert(1)> & <b>bold</b>';
    const ack = await sendMessage(sock, conversation.id, html);
    expect(ack.message.content).toBe(html);
  });

  it('keeps multi-line messages', async () => {
    const { a, conversation } = await twoUsersWithChat();
    const sock = await connectSocket(a.agent);
    const ack = await sendMessage(sock, conversation.id, 'line one\nline two');
    expect(ack.message.content).toBe('line one\nline two');
  });

  it('rate-limits a flooding socket', async () => {
    const { a, conversation } = await twoUsersWithChat();
    const sock = await connectSocket(a.agent);
    const results = [];
    for (let i = 0; i < 25; i += 1) results.push(await sendMessage(sock, conversation.id, `spam ${i}`));
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(results.filter((r) => !r.ok && r.error.code === 'rate_limited').length).toBe(5);
  });
});

describe('authorization', () => {
  it('blocks a non-member from reading, joining, writing or marking read on a private conversation', async () => {
    const { a, conversation } = await twoUsersWithChat();
    const intruder = await registerUser();
    const sockIntruder = await connectSocket(intruder.agent);
    const sockA = await connectSocket(a.agent);
    const leaked = collect(sockIntruder, 'message:new');
    const leakedUpdates = collect(sockIntruder, 'conversation:update');

    expect((await get(intruder.agent, `/api/conversations/${conversation.id}`)).status).toBe(404);
    expect((await get(intruder.agent, `/api/conversations/${conversation.id}/messages`)).status).toBe(404);
    expect((await post(intruder.agent, `/api/conversations/${conversation.id}/read`, {})).status).toBe(404);

    expect((await emitAck(sockIntruder, 'conversation:join', { conversationId: conversation.id })).ok).toBe(false);
    expect((await sendMessage(sockIntruder, conversation.id, 'let me in')).ok).toBe(false);
    expect((await emitAck(sockIntruder, 'message:read', { conversationId: conversation.id })).ok).toBe(false);

    await sendMessage(sockA, conversation.id, 'private stuff');
    await sleep(250);
    expect(leaked).toHaveLength(0);
    expect(leakedUpdates).toHaveLength(0);
    expect(await Message.countDocuments({ conversationId: conversation.id })).toBe(1);
  });

  it('does not trust a sender id from the client', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const ack = await emitAck(sockA, 'message:send', {
      conversationId: conversation.id,
      content: 'spoof',
      clientMsgId: newClientMsgId(),
      senderId: b.user.id,
    });
    expect(ack.message.senderId).toBe(a.user.id);
  });

  it('refuses requests with malformed ids', async () => {
    const a = await registerUser();
    expect((await get(a.agent, '/api/conversations/not-an-id')).status).toBe(404);
    const sock = await connectSocket(a.agent);
    expect((await emitAck(sock, 'conversation:join', { conversationId: 'not-an-id' })).ok).toBe(false);
  });

  it('requires authentication on every conversation endpoint', async () => {
    const { conversation } = await twoUsersWithChat();
    const { newAgent } = await import('./helpers.js');
    const anon = newAgent();
    expect((await get(anon, '/api/conversations')).status).toBe(401);
    expect((await get(anon, `/api/conversations/${conversation.id}`)).status).toBe(401);
    expect((await get(anon, `/api/conversations/${conversation.id}/messages`)).status).toBe(401);
    expect((await post(anon, `/api/conversations/${conversation.id}/read`, {})).status).toBe(401);
    expect((await post(anon, '/api/conversations', { userId: conversation.id })).status).toBe(401);
  });
});

describe('unread counts', () => {
  it('counts per recipient, never for the sender, and clears when read', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);

    await sendMessage(sockA, conversation.id, 'one');
    await sendMessage(sockA, conversation.id, 'two');
    await sleep(100);

    const forB = (await get(b.agent, '/api/conversations')).body.data.conversations[0];
    const forA = (await get(a.agent, '/api/conversations')).body.data.conversations[0];
    expect(forB.unreadCount).toBe(2);
    expect(forA.unreadCount).toBe(0);

    const read = await emitAck(sockB, 'message:read', { conversationId: conversation.id });
    expect(read.ok).toBe(true);
    expect((await get(b.agent, '/api/conversations')).body.data.conversations[0].unreadCount).toBe(0);

    await sendMessage(sockA, conversation.id, 'three');
    expect((await get(b.agent, '/api/conversations')).body.data.conversations[0].unreadCount).toBe(1);
  });

  it('pushes personalised unread counts live through conversation:update', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);

    const updateB = waitForEvent(sockB, 'conversation:update', { predicate: (p) => p.conversation?.unreadCount === 1 });
    const updateA = waitForEvent(sockA, 'conversation:update', { predicate: (p) => p.conversation?.lastMessage });
    await sendMessage(sockA, conversation.id, 'ping');

    expect((await updateB).conversation.unreadCount).toBe(1);
    expect((await updateA).conversation.unreadCount).toBe(0);
  });

  it('syncs read state to the reader other sessions (socket and REST)', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB1 = await connectSocket(b.agent);
    const sockB2 = await connectSocket(b.agent);
    await sendMessage(sockA, conversation.id, 'hello');

    const sync1 = waitForEvent(sockB2, 'message:read:update');
    await emitAck(sockB1, 'message:read', { conversationId: conversation.id });
    expect((await sync1).conversationId).toBe(conversation.id);

    await sendMessage(sockA, conversation.id, 'again');
    const sync2 = waitForEvent(sockB1, 'message:read:update');
    const rest = await post(b.agent, `/api/conversations/${conversation.id}/read`, {});
    expect(rest.status).toBe(200);
    expect((await sync2).unreadCount).toBe(0);
  });

  it('treats sending a message as having caught up', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    await sendMessage(sockA, conversation.id, 'question?');
    expect((await get(b.agent, '/api/conversations')).body.data.conversations[0].unreadCount).toBe(1);
    await sendMessage(sockB, conversation.id, 'answer');
    expect((await get(b.agent, '/api/conversations')).body.data.conversations[0].unreadCount).toBe(0);
    expect((await get(a.agent, '/api/conversations')).body.data.conversations[0].unreadCount).toBe(1);
  });
});

describe('history pagination', () => {
  it('pages older messages with a cursor and no duplicates or gaps', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    // Insert directly: this test is about pagination, not the send path.
    const docs = Array.from({ length: 35 }, (_, i) => ({
      conversationId: conversation.id,
      senderId: i % 2 ? a.user.id : b.user.id,
      content: `msg ${i}`,
      clientMsgId: `seed-${i}-xxxxxxxx`,
    }));
    for (const doc of docs) await Message.create(doc); // sequential so _id order matches

    const newest = await get(a.agent, `/api/conversations/${conversation.id}/messages?limit=30`);
    expect(newest.body.data.messages).toHaveLength(30);
    expect(newest.body.data.hasMore).toBe(true);
    expect(newest.body.data.messages[0].content).toBe('msg 5');
    expect(newest.body.data.messages[29].content).toBe('msg 34');

    const older = await get(
      a.agent,
      `/api/conversations/${conversation.id}/messages?limit=30&before=${newest.body.data.messages[0].id}`
    );
    expect(older.body.data.messages.map((m) => m.content)).toEqual(['msg 0', 'msg 1', 'msg 2', 'msg 3', 'msg 4']);
    expect(older.body.data.hasMore).toBe(false);
  });

  it('validates pagination parameters', async () => {
    const { a, conversation } = await twoUsersWithChat();
    expect((await get(a.agent, `/api/conversations/${conversation.id}/messages?before=bad`)).status).toBe(400);
    expect((await get(a.agent, `/api/conversations/${conversation.id}/messages?limit=5000`)).status).toBe(400);
  });
});

describe('typing indicators', () => {
  it('relays typing only to members who joined the conversation, and never stores it', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const outsider = await registerUser();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    const sockO = await connectSocket(outsider.agent);
    const seenByOutsider = collect(sockO, 'typing:update');

    await emitAck(sockA, 'conversation:join', { conversationId: conversation.id });
    await emitAck(sockB, 'conversation:join', { conversationId: conversation.id });
    await emitAck(sockO, 'conversation:join', { conversationId: conversation.id }); // rejected

    const start = waitForEvent(sockB, 'typing:update');
    sockA.emit('typing:start', { conversationId: conversation.id });
    expect(await start).toMatchObject({ conversationId: conversation.id, userId: a.user.id, isTyping: true });

    const stop = waitForEvent(sockB, 'typing:update', { predicate: (p) => p.isTyping === false });
    sockA.emit('typing:stop', { conversationId: conversation.id });
    expect((await stop).isTyping).toBe(false);

    sockO.emit('typing:start', { conversationId: conversation.id }); // not in room: ignored
    await sleep(200);
    expect(seenByOutsider).toHaveLength(0);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('does not echo typing back to the typist', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    await emitAck(sockA, 'conversation:join', { conversationId: conversation.id });
    await emitAck(sockB, 'conversation:join', { conversationId: conversation.id });
    const echoed = collect(sockA, 'typing:update');
    sockA.emit('typing:start', { conversationId: conversation.id });
    await sleep(200);
    expect(echoed).toHaveLength(0);
  });

  it('clears the indicator when the typist disconnects', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    await emitAck(sockA, 'conversation:join', { conversationId: conversation.id });
    await emitAck(sockB, 'conversation:join', { conversationId: conversation.id });

    sockA.emit('typing:start', { conversationId: conversation.id });
    await waitForEvent(sockB, 'typing:update', { predicate: (p) => p.isTyping });

    const cleared = waitForEvent(sockB, 'typing:update', { predicate: (p) => p.isTyping === false });
    sockA.close();
    expect((await cleared).userId).toBe(a.user.id);
  });

  it('stops relaying after conversation:leave', async () => {
    const { a, b, conversation } = await twoUsersWithChat();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    await emitAck(sockA, 'conversation:join', { conversationId: conversation.id });
    await emitAck(sockB, 'conversation:join', { conversationId: conversation.id });
    await emitAck(sockB, 'conversation:leave', { conversationId: conversation.id });
    const seen = collect(sockB, 'typing:update');
    sockA.emit('typing:start', { conversationId: conversation.id });
    await sleep(200);
    expect(seen).toHaveLength(0);
  });
});

describe('presence', () => {
  it('tells contacts when a user comes online and, after the grace period, offline', async () => {
    const { a, b } = await twoUsersWithChat();
    const sockB = await connectSocket(b.agent);

    const online = waitForEvent(sockB, 'presence:update', { predicate: (p) => p.userId === a.user.id && p.online });
    const sockA = await connectSocket(a.agent);
    await online;

    const users = await get(b.agent, `/api/users?q=${a.user.username}`);
    expect(users.body.data.users[0].online).toBe(true);

    const offline = waitForEvent(sockB, 'presence:update', { predicate: (p) => p.userId === a.user.id && !p.online });
    sockA.close();
    await offline;
    const after = await get(b.agent, `/api/users?q=${a.user.username}`);
    expect(after.body.data.users[0].online).toBe(false);
  });

  it('keeps a user online while any tab or device is still connected', async () => {
    const { a, b } = await twoUsersWithChat();
    const sockB = await connectSocket(b.agent);
    const events = collect(sockB, 'presence:update');

    const tab1 = await connectSocket(a.agent);
    const tab2 = await connectSocket(a.agent);
    await sleep(100);
    tab1.close();
    await sleep(600); // longer than the grace period
    expect(events.filter((e) => !e.online)).toHaveLength(0);
    expect((await get(b.agent, `/api/users?q=${a.user.username}`)).body.data.users[0].online).toBe(true);

    tab2.close();
    await waitForEvent(sockB, 'presence:update', { predicate: (p) => !p.online });
  });

  it('does not announce offline if the user reconnects within the grace period (page refresh)', async () => {
    const { a, b } = await twoUsersWithChat();
    const sockB = await connectSocket(b.agent);
    const first = await connectSocket(a.agent);
    await sleep(100);
    const events = collect(sockB, 'presence:update');

    first.close();
    await sleep(50);
    await connectSocket(a.agent);
    await sleep(500);
    expect(events).toHaveLength(0);
  });

  it('only tells users who share a conversation', async () => {
    const { a } = await twoUsersWithChat();
    const stranger = await registerUser();
    const sockStranger = await connectSocket(stranger.agent);
    const events = collect(sockStranger, 'presence:update');
    await connectSocket(a.agent);
    await sleep(200);
    expect(events).toHaveLength(0);
  });
});

describe('new conversations appear live for the other person', () => {
  it('pushes conversation:update to the recipient when a chat is first created', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const sockB = await connectSocket(b.agent);
    const update = waitForEvent(sockB, 'conversation:update');
    await startPrivateChat(a.agent, b.user);
    const payload = await update;
    expect(payload.conversation.type).toBe('private');
    expect(payload.conversation.participants.map((p) => p.id)).toContain(a.user.id);
  });
});
