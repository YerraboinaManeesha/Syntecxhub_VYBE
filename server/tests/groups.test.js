import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import {
  collect,
  connectSocket,
  del,
  emitAck,
  get,
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

async function groupOfThree() {
  const a = await registerUser();
  const b = await registerUser();
  const c = await registerUser();
  const res = await post(a.agent, '/api/groups', { name: 'Project Crew', memberIds: [b.user.id, c.user.id] });
  return { a, b, c, group: res.body.data.conversation, res };
}

describe('group creation', () => {
  it('creates a group with the creator and selected members and returns member info', async () => {
    const { a, b, c, group, res } = await groupOfThree();
    expect(res.status).toBe(201);
    expect(group).toMatchObject({ type: 'group', groupName: 'Project Crew', createdBy: a.user.id });
    expect(group.participants.map((p) => p.id).sort()).toEqual([a.user.id, b.user.id, c.user.id].sort());
    for (const p of group.participants) expect(p.email).toBeUndefined();
  });

  it('tells every member about the new group live', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const sockB = await connectSocket(b.agent);
    const update = waitForEvent(sockB, 'conversation:update');
    await post(a.agent, '/api/groups', { name: 'Fresh', memberIds: [b.user.id] });
    expect((await update).conversation.groupName).toBe('Fresh');
  });

  it('validates input', async () => {
    const a = await registerUser();
    const b = await registerUser();
    expect((await post(a.agent, '/api/groups', { name: '', memberIds: [b.user.id] })).status).toBe(400);
    expect((await post(a.agent, '/api/groups', { name: 'X', memberIds: [] })).status).toBe(400);
    expect((await post(a.agent, '/api/groups', { name: 'X', memberIds: ['bad'] })).status).toBe(400);
    expect((await post(a.agent, '/api/groups', { name: 'X', memberIds: [a.user.id] })).status).toBe(400); // only yourself
    const ghost = new mongoose.Types.ObjectId().toString();
    expect((await post(a.agent, '/api/groups', { name: 'X', memberIds: [ghost] })).status).toBe(400);
  });

  it('deduplicates members', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const res = await post(a.agent, '/api/groups', { name: 'Dupes', memberIds: [b.user.id, b.user.id] });
    expect(res.body.data.conversation.participants).toHaveLength(2);
  });

  it('requires authentication', async () => {
    const { newAgent } = await import('./helpers.js');
    expect((await post(newAgent(), '/api/groups', { name: 'X', memberIds: [] })).status).toBe(401);
  });
});

describe('group messaging and authorization', () => {
  it('delivers to all members in real time, persists, and never reaches non-members', async () => {
    const { a, b, c, group } = await groupOfThree();
    const outsider = await registerUser();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    const sockC = await connectSocket(c.agent);
    const sockO = await connectSocket(outsider.agent);
    const gotB = waitForEvent(sockB, 'message:new');
    const gotC = waitForEvent(sockC, 'message:new');
    const leaked = collect(sockO, 'message:new');
    const leakedUpdates = collect(sockO, 'conversation:update');

    const ack = await sendMessage(sockA, group.id, 'hello team');
    expect(ack.ok).toBe(true);
    expect((await gotB).message.content).toBe('hello team');
    expect((await gotC).message.sender.name).toBe(a.user.name);
    await sleep(250);

    expect(leaked).toHaveLength(0);
    expect(leakedUpdates).toHaveLength(0);
    expect(await Message.countDocuments({ conversationId: group.id })).toBe(1);

    // History includes sender info for display.
    const history = await get(b.agent, `/api/conversations/${group.id}/messages`);
    expect(history.body.data.messages[0].sender.username).toBe(a.user.username);
  });

  it('blocks non-members from group history, details, joining and posting', async () => {
    const { group } = await groupOfThree();
    const outsider = await registerUser();
    const sock = await connectSocket(outsider.agent);

    expect((await get(outsider.agent, `/api/groups/${group.id}`)).status).toBe(404);
    expect((await get(outsider.agent, `/api/conversations/${group.id}`)).status).toBe(404);
    expect((await get(outsider.agent, `/api/conversations/${group.id}/messages`)).status).toBe(404);
    expect((await emitAck(sock, 'conversation:join', { conversationId: group.id })).ok).toBe(false);
    expect((await sendMessage(sock, group.id, 'sneaky')).ok).toBe(false);
    expect((await post(outsider.agent, `/api/groups/${group.id}/members`, { userIds: [outsider.user.id] })).status).toBe(404);
    expect((await del(outsider.agent, `/api/groups/${group.id}/members/me`)).status).toBe(404);
    expect(await Message.countDocuments({ conversationId: group.id })).toBe(0);
  });

  it('tracks unread per member rather than for the whole group', async () => {
    const { a, b, c, group } = await groupOfThree();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    await sendMessage(sockA, group.id, 'one');
    await sendMessage(sockA, group.id, 'two');

    const unread = async (who) => (await get(who.agent, '/api/conversations')).body.data.conversations[0].unreadCount;
    expect(await unread(a)).toBe(0);
    expect(await unread(b)).toBe(2);
    expect(await unread(c)).toBe(2);

    await emitAck(sockB, 'message:read', { conversationId: group.id });
    expect(await unread(b)).toBe(0);
    expect(await unread(c)).toBe(2); // C has not read; B reading changes nothing for C
  });

  it('scopes typing to the group room', async () => {
    const { a, b, c, group } = await groupOfThree();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    const sockC = await connectSocket(c.agent);
    for (const s of [sockA, sockB, sockC]) await emitAck(s, 'conversation:join', { conversationId: group.id });
    const seenC = waitForEvent(sockC, 'typing:update');
    const seenB = waitForEvent(sockB, 'typing:update');
    sockA.emit('typing:start', { conversationId: group.id });
    expect((await seenB).name).toBe(a.user.name);
    expect((await seenC).userId).toBe(a.user.id);
  });

  it('does not treat a private conversation as a group', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const priv = await startPrivateChat(a.agent, b.user);
    expect((await get(a.agent, `/api/groups/${priv.id}`)).status).toBe(404);
    expect((await del(a.agent, `/api/groups/${priv.id}/members/me`)).status).toBe(404);
    expect((await post(a.agent, `/api/groups/${priv.id}/members`, { userIds: [b.user.id] })).status).toBe(404);
  });
});

describe('group membership changes', () => {
  it('lets a member add people; new members start with nothing unread and receive new messages', async () => {
    const { a, group } = await groupOfThree();
    const d = await registerUser();
    const sockA = await connectSocket(a.agent);
    await sendMessage(sockA, group.id, 'before D joined');

    const sockD = await connectSocket(d.agent);
    const joined = waitForEvent(sockD, 'conversation:update');
    const add = await post(a.agent, `/api/groups/${group.id}/members`, { userIds: [d.user.id] });
    expect(add.status).toBe(200);
    expect(add.body.data.conversation.participants).toHaveLength(4);
    expect((await joined).conversation.id).toBe(group.id);

    const forD = (await get(d.agent, '/api/conversations')).body.data.conversations[0];
    expect(forD.unreadCount).toBe(0);

    const live = waitForEvent(sockD, 'message:new');
    await sendMessage(sockA, group.id, 'welcome D');
    expect((await live).message.content).toBe('welcome D');
    expect((await get(d.agent, '/api/conversations')).body.data.conversations[0].unreadCount).toBe(1);
  });

  it('rejects adding existing members, missing users and bad ids', async () => {
    const { a, b, group } = await groupOfThree();
    expect((await post(a.agent, `/api/groups/${group.id}/members`, { userIds: [b.user.id] })).status).toBe(400);
    const ghost = new mongoose.Types.ObjectId().toString();
    expect((await post(a.agent, `/api/groups/${group.id}/members`, { userIds: [ghost] })).status).toBe(400);
    expect((await post(a.agent, `/api/groups/${group.id}/members`, { userIds: ['x'] })).status).toBe(400);
  });

  it('enforces the maximum group size', async () => {
    const a = await registerUser();
    const others = [];
    for (let i = 0; i < 49; i += 1) others.push((await registerUser()).user.id);
    const full = await post(a.agent, '/api/groups', { name: 'Full', memberIds: others });
    expect(full.status).toBe(201); // 50 members
    const extra = await registerUser();
    const over = await post(a.agent, `/api/groups/${full.body.data.conversation.id}/members`, { userIds: [extra.user.id] });
    expect(over.status).toBe(400);
  }, 60000);

  it('lets a member leave and immediately cuts off their access', async () => {
    const { a, b, c, group } = await groupOfThree();
    const sockA = await connectSocket(a.agent);
    const sockB = await connectSocket(b.agent);
    const sockC = await connectSocket(c.agent);
    await emitAck(sockC, 'conversation:join', { conversationId: group.id });
    const missed = collect(sockC, 'message:new');
    const removedNotice = waitForEvent(sockC, 'conversation:update', { predicate: (p) => p.removed });
    const updateForB = waitForEvent(sockB, 'conversation:update', {
      predicate: (p) => p.conversation?.participants.length === 2,
    });

    const left = await del(c.agent, `/api/groups/${group.id}/members/me`);
    expect(left.status).toBe(200);
    expect((await removedNotice).conversationId).toBe(group.id);
    expect((await updateForB).conversation.participants.map((p) => p.id)).not.toContain(c.user.id);

    await sendMessage(sockA, group.id, 'after C left');
    await sleep(250);
    expect(missed).toHaveLength(0);

    expect((await get(c.agent, `/api/conversations/${group.id}`)).status).toBe(404);
    expect((await get(c.agent, `/api/conversations/${group.id}/messages`)).status).toBe(404);
    expect((await sendMessage(sockC, group.id, 'still here?')).ok).toBe(false);
    expect((await emitAck(sockC, 'conversation:join', { conversationId: group.id })).ok).toBe(false);
    expect((await get(c.agent, '/api/conversations')).body.data.conversations).toHaveLength(0);

    // Remaining members still chat normally.
    expect((await sendMessage(sockB, group.id, 'we carry on')).ok).toBe(true);
  });

  it('keeps a former member history readable to the rest of the group', async () => {
    const { a, c, group } = await groupOfThree();
    const sockC = await connectSocket(c.agent);
    await sendMessage(sockC, group.id, 'C was here');
    await del(c.agent, `/api/groups/${group.id}/members/me`);
    const history = await get(a.agent, `/api/conversations/${group.id}/messages`);
    expect(history.body.data.messages[0].sender.name).toBe(c.user.name);
  });

  it('deletes the group when the last member leaves', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const made = await post(a.agent, '/api/groups', { name: 'Tiny', memberIds: [b.user.id] });
    const id = made.body.data.conversation.id;
    const sockA = await connectSocket(a.agent);
    await sendMessage(sockA, id, 'bye');
    await del(a.agent, `/api/groups/${id}/members/me`);
    await del(b.agent, `/api/groups/${id}/members/me`);
    expect(await Conversation.countDocuments({ _id: id })).toBe(0);
    expect(await Message.countDocuments({ conversationId: id })).toBe(0);
  });
});
