import request from 'supertest';
import mongoose from 'mongoose';
import { io as createClient } from 'socket.io-client';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { buildServer } from '../src/app.js';
import { env } from '../src/config/env.js';
import { resetPresence } from '../src/services/presence.js';

let stack;
let port;
const openSockets = new Set();
let counter = 0;

export async function startStack() {
  await connectDb(env.mongoUri);
  stack = buildServer();
  await new Promise((resolve) => stack.httpServer.listen(0, resolve));
  port = stack.httpServer.address().port;
  return stack;
}

export async function stopStack() {
  closeAllSockets();
  stack.io.close();
  await new Promise((resolve) => stack.httpServer.close(resolve));
  await mongoose.connection.dropDatabase();
  await disconnectDb();
}

export async function resetDb() {
  closeAllSockets();
  resetPresence();
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  // GridFS collections are not Mongoose models, so clear them explicitly.
  const db = mongoose.connection.db;
  await Promise.all(['uploads.files', 'uploads.chunks'].map((name) => db.collection(name).deleteMany({})));
}

export const app = () => stack.app;

// ---- HTTP helpers: every state-changing call carries the CSRF header, like the real client ----
const withHeader = (req) => req.set('X-Requested-With', 'vybe');
export const get = (agent, url) => agent.get(url);
export const post = (agent, url, body) => withHeader(agent.post(url)).send(body);
export const patch = (agent, url, body) => withHeader(agent.patch(url)).send(body);
export const put = (agent, url, body) => withHeader(agent.put(url)).send(body);
export const del = (agent, url) => withHeader(agent.delete(url));

export function newAgent() {
  return request.agent(stack.app);
}

export async function registerUser(overrides = {}) {
  counter += 1;
  const agent = newAgent();
  const data = {
    name: `User ${counter}`,
    username: `user_${counter}`,
    email: `user${counter}@example.com`,
    password: 'Passw0rdOK',
    ...overrides,
  };
  const res = await post(agent, '/api/auth/register', { ...data, confirmPassword: data.password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.data.user, data };
}

// ---- Socket helpers ----
export async function connectSocket(agent, { token } = {}) {
  let authToken = token;
  if (authToken === undefined) {
    const res = await get(agent, '/api/auth/socket-token');
    authToken = res.body.data.token;
  }
  const socket = createClient(`http://localhost:${port}`, {
    auth: { token: authToken },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  openSockets.add(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

export function tryConnect(authToken) {
  const socket = createClient(`http://localhost:${port}`, {
    auth: { token: authToken },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  openSockets.add(socket);
  return new Promise((resolve) => {
    socket.once('connect', () => resolve({ connected: true, socket }));
    socket.once('connect_error', (error) => resolve({ connected: false, error: error.message }));
  });
}

function closeAllSockets() {
  for (const socket of openSockets) socket.close();
  openSockets.clear();
}

export function waitForEvent(socket, event, { predicate = () => true, timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeout);
    function onEvent(payload) {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off(event, onEvent);
        resolve(payload);
      }
    }
    socket.on(event, onEvent);
  });
}

export function collect(socket, event) {
  const events = [];
  socket.on(event, (payload) => events.push(payload));
  return events;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.timeout(5000).emit(event, payload, (error, response) => {
      resolve(error ? { ok: false, error: { code: 'timeout' } } : response);
    });
  });
}

let msgCounter = 0;
export const newClientMsgId = () => `cmid-${Date.now()}-${++msgCounter}-xxxx`;

export const sendMessage = (socket, conversationId, content, clientMsgId = newClientMsgId()) =>
  emitAck(socket, 'message:send', { conversationId, content, clientMsgId });

export async function startPrivateChat(agentA, userB) {
  const res = await post(agentA, '/api/conversations', { userId: userB.id });
  return res.body.data.conversation;
}

// ---- Upload helpers ----
import sharp from 'sharp';

export async function makePng(width = 64, height = 48, color = '#8B5CF6') {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}
export async function makeJpegWithGps() {
  // A JPEG that carries EXIF metadata, to prove it is stripped.
  return sharp({ create: { width: 80, height: 60, channels: 3, background: '#ff0000' } })
    .withExif({ IFD0: { Copyright: 'secret-exif-marker' } })
    .jpeg()
    .toBuffer();
}
export async function makeWebp() {
  return sharp({ create: { width: 50, height: 50, channels: 3, background: '#00ff00' } }).webp().toBuffer();
}
// Minimal files whose bytes look like the real thing (enough for type detection).
export const fakeMp4 = (size = 4096) => {
  const buf = Buffer.alloc(size, 7);
  buf.writeUInt32BE(24, 0);
  buf.write('ftypisom', 4, 'latin1');
  return buf;
};
export const fakePdf = () => Buffer.from('%PDF-1.4\n% fake pdf body\n1 0 obj\n<<>>\nendobj\n%%EOF');
export const fakeDocx = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]);

export const uploadFile = (agent, url, buffer, filename, contentType) =>
  agent
    .post(url)
    .set('X-Requested-With', 'vybe')
    .attach('file', buffer, { filename, contentType: contentType || 'application/octet-stream' });

export const uploadToConversation = (agent, conversationId, buffer, filename, contentType) =>
  uploadFile(agent, `/api/conversations/${conversationId}/attachments`, buffer, filename, contentType);
