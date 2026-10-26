import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReadState } from '../src/models/ReadState.js';
import {
  collect,
  connectSocket,
  emitAck,
  get,
  newAgent,
  post,
  registerUser,
  resetDb,
  sendMessage,
  sleep,
  startPrivateChat,
  startStack,
  stopStack,
  waitForEvent,
} from './helpers.js';

beforeAll(startStack);
afterAll(stopStack);
beforeEach(resetDb);

// A recipient app that acknowledges each message:new, like the real client does.
const ackingClient = async (agent) => {
  const socket = await connectSocket(agent);
  socket.on('message:new', (_payload, ack) => typeof ack === 'function' && ack());
  return socket;
};

async function pair() {
  const a = await registerUser();
  const b = await registerUser();
  const conversation = await startPrivateChat(a.agent, b.user);
  return { a, b, conversation };
}

const receiptsFor = async (who, conversationId) =>
  (await get(who.agent, '/api/conversations')).body.data.conversations.find((c) => c.id === conversationId).receipts;

describe('message status: sent, delivered, read', () => {
  it('SENT: a stored message has no delivery or read mark for the recipient yet', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent); // sender only; recipient has no live session
    const ack = await sendMessage(sockA, conversation.id, 'hello');
    expect(ack.ok).toBe(true);

    const r = (await receiptsFor(a, conversation.id))[b.user.id];
    const sentAt = new Date(ack.message.createdAt).getTime();
    expect(!r.deliveredAt || new Date(r.deliveredAt).getTime() < sentAt).toBe(true);
    expect(new Date(r.readAt).getTime()).toBeLessThan(sentAt);
  });

  it('DELIVERED: not when the recipient is merely online and silent; only when their session acknowledges', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const silentB = await connectSocket(b.agent); // online, but never acknowledges
    const seen = collect(sockA, 'receipt:update');

    const ack = await sendMessage(sockA, conversation.id, 'are you there');
    await sleep(400);
    expect(seen.filter((r) => r.userId === b.user.id && new Date(r.deliveredAt) >= new Date(ack.message.createdAt))).toHaveLength(0);
    const before = (await receiptsFor(a, conversation.id))[b.user.id];
    expect(!before.deliveredAt || new Date(before.deliveredAt) < new Date(ack.message.createdAt)).toBe(true);
    silentB.close();

    // Now a recipient session that does acknowledge.
    const ackingB = await ackingClient(b.agent);
    const delivered = waitForEvent(sockA, 'receipt:update', {
      predicate: (r) => r.userId === b.user.id && new Date(r.deliveredAt) >= new Date('2000-01-01'),
    });
    const second = await sendMessage(sockA, conversation.id, 'second');
    const receipt = await delivered;
    expect(new Date(receipt.deliveredAt).getTime()).toBeGreaterThanOrEqual(new Date(second.message.createdAt).getTime());
    expect(receipt.conversationId).toBe(conversation.id);
    ackingB.close();
  });

  it('DELIVERED: the receipt is persisted and shows in the conversation list', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    await ackingClient(b.agent);
    const delivered = waitForEvent(sockA, 'receipt:update', { predicate: (r) => r.userId === b.user.id });
    const ack = await sendMessage(sockA, conversation.id, 'hi');
    await delivered;
    const r = (await receiptsFor(a, conversation.id))[b.user.id];
    expect(new Date(r.deliveredAt).getTime()).toBeGreaterThanOrEqual(new Date(ack.message.createdAt).getTime());
    expect(new Date(r.readAt).getTime()).toBeLessThan(new Date(ack.message.createdAt).getTime());
  });

  it('DELIVERED after reconnect: a message sent while offline is delivered when the app syncs', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const ack = await sendMessage(sockA, conversation.id, 'while you were away'); // B has no session at all
    await sleep(150);
    const early = (await receiptsFor(a, conversation.id))[b.user.id];
    expect(!early.deliveredAt || new Date(early.deliveredAt) < new Date(ack.message.createdAt)).toBe(true);

    const sockB = await connectSocket(b.agent); // connecting alone is not delivery
    await sleep(300);
    const afterConnect = (await receiptsFor(a, conversation.id))[b.user.id];
    expect(!afterConnect.deliveredAt || new Date(afterConnect.deliveredAt) < new Date(ack.message.createdAt)).toBe(true);

    const delivered = waitForEvent(sockA, 'receipt:update', { predicate: (r) => r.userId === b.user.id });
    sockB.emit('delivery:sync'); // the app confirms it has loaded its conversations
    const receipt = await delivered;
    expect(new Date(receipt.deliveredAt).getTime()).toBeGreaterThanOrEqual(new Date(ack.message.createdAt).getTime());
  });

  it('READ: only when the recipient marks the conversation read; implies delivered; reaches the sender live', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent); // silent: never delivered via ack
    const ack = await sendMessage(sockA, conversation.id, 'please read');
    await sleep(300);
    expect(new Date((await receiptsFor(a, conversation.id))[b.user.id].readAt).getTime()).toBeLessThan(new Date(ack.message.createdAt).getTime());

    const read = waitForEvent(sockA, 'receipt:update', {
      predicate: (r) => r.userId === b.user.id && new Date(r.readAt) >= new Date(ack.message.createdAt),
    });
    await emitAck(sockB, 'message:read', { conversationId: conversation.id });
    const receipt = await read;
    expect(new Date(receipt.deliveredAt).getTime()).toBeGreaterThanOrEqual(new Date(ack.message.createdAt).getTime());
    const r = (await receiptsFor(a, conversation.id))[b.user.id];
    expect(new Date(r.readAt).getTime()).toBeGreaterThanOrEqual(new Date(ack.message.createdAt).getTime());
  });

  it('READ via the REST fallback also updates the sender', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const ack = await sendMessage(sockA, conversation.id, 'x');
    const read = waitForEvent(sockA, 'receipt:update', { predicate: (r) => new Date(r.readAt) >= new Date(ack.message.createdAt) });
    expect((await post(b.agent, `/api/conversations/${conversation.id}/read`, {})).status).toBe(200);
    expect((await read).userId).toBe(b.user.id);
  });

  it('the marker never moves backwards', async () => {
    const { a, b, conversation } = await pair();
    const sockA = await connectSocket(a.agent);
    const sockB = await ackingClient(b.agent);
    await sendMessage(sockA, conversation.id, 'one');
    await sleep(300);
    const first = (await receiptsFor(a, conversation.id))[b.user.id].deliveredAt;
    sockB.emit('delivery:sync');
    await sleep(300);
    const later = (await receiptsFor(a, conversation.id))[b.user.id].deliveredAt;
    expect(new Date(later).getTime()).toBeGreaterThanOrEqual(new Date(first).getTime());
    const state = await ReadState.findOne({ conversationId: conversation.id, userId: b.user.id });
    expect(new Date(state.deliveredAt).getTime()).toBeGreaterThanOrEqual(new Date(first).getTime());
  });

  it('groups: one member receiving or reading is visible, per member', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const c = await registerUser();
    const group = (await post(a.agent, '/api/groups', { name: 'G', memberIds: [b.user.id, c.user.id] })).body.data.conversation;
    const sockA = await connectSocket(a.agent);
    await ackingClient(b.agent); // B acknowledges, C has no session
    const delivered = waitForEvent(sockA, 'receipt:update', { predicate: (r) => r.userId === b.user.id });
    const ack = await sendMessage(sockA, group.id, 'team');
    await delivered;
    const receipts = await receiptsFor(a, group.id);
    expect(new Date(receipts[b.user.id].deliveredAt).getTime()).toBeGreaterThanOrEqual(new Date(ack.message.createdAt).getTime());
    expect(!receipts[c.user.id].deliveredAt || new Date(receipts[c.user.id].deliveredAt) < new Date(ack.message.createdAt)).toBe(true);
  });

  it('receipts only reach conversation members and delivery:sync only affects the caller', async () => {
    const { a, b, conversation } = await pair();
    const outsider = await registerUser();
    const sockO = await connectSocket(outsider.agent);
    const leaked = collect(sockO, 'receipt:update');
    const sockA = await connectSocket(a.agent);
    await ackingClient(b.agent);
    const delivered = waitForEvent(sockA, 'receipt:update', { predicate: (r) => r.userId === b.user.id });
    await sendMessage(sockA, conversation.id, 'private');
    await delivered;
    sockO.emit('delivery:sync');
    await sleep(300);
    expect(leaked).toHaveLength(0);
    // The outsider's sync must not have moved anyone else's marker.
    const states = await ReadState.find({ conversationId: conversation.id }).lean();
    expect(states.every((s) => String(s.userId) !== outsider.user.id)).toBe(true);
    // Outsider cannot see the receipts via REST either.
    const list = await get(outsider.agent, '/api/conversations');
    expect(list.body.data.conversations).toHaveLength(0);
    expect((await get(newAgent(), '/api/conversations')).status).toBe(401);
  });
});
