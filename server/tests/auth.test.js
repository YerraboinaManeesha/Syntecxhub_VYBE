import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { User } from '../src/models/User.js';
import {
  del,
  get,
  newAgent,
  patch,
  post,
  registerUser,
  resetDb,
  startStack,
  stopStack,
} from './helpers.js';

beforeAll(startStack);
afterAll(stopStack);
beforeEach(resetDb);

const validBody = {
  name: 'Maya Rao',
  username: 'Maya_Rao',
  email: 'Maya@Example.com',
  password: 'Passw0rdOK',
  confirmPassword: 'Passw0rdOK',
};

describe('registration', () => {
  it('creates an account, hashes the password and sets an HttpOnly session cookie', async () => {
    const agent = newAgent();
    const res = await post(agent, '/api/auth/register', validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ name: 'Maya Rao', username: 'maya_rao', email: 'maya@example.com' });
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/vybe_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const stored = await User.findOne({ username: 'maya_rao' }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe(validBody.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('logs the user in after registering (session works on /me)', async () => {
    const agent = newAgent();
    await post(agent, '/api/auth/register', validBody);
    const me = await get(agent, '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.username).toBe('maya_rao');
  });

  it('rejects a duplicate email (case-insensitive)', async () => {
    await post(newAgent(), '/api/auth/register', validBody);
    const res = await post(newAgent(), '/api/auth/register', {
      ...validBody,
      username: 'someone_else',
      email: 'MAYA@example.COM',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.field).toBe('email');
  });

  it('rejects a duplicate username (case-insensitive)', async () => {
    await post(newAgent(), '/api/auth/register', validBody);
    const res = await post(newAgent(), '/api/auth/register', {
      ...validBody,
      username: 'MAYA_RAO',
      email: 'other@example.com',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.field).toBe('username');
  });

  it('lets only one of two simultaneous identical sign-ups through', async () => {
    const results = await Promise.all([
      post(newAgent(), '/api/auth/register', validBody),
      post(newAgent(), '/api/auth/register', validBody),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments()).toBe(1);
  });

  it.each([
    ['short password', { password: 'abc1', confirmPassword: 'abc1' }, 'password'],
    ['password without a number', { password: 'abcdefghij', confirmPassword: 'abcdefghij' }, 'password'],
    ['mismatched confirmation', { confirmPassword: 'Different1' }, 'confirmPassword'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['bad username characters', { username: 'bad name!' }, 'username'],
    ['too-short name', { name: 'A' }, 'name'],
  ])('rejects %s', async (_label, patchBody, field) => {
    const res = await post(newAgent(), '/api/auth/register', { ...validBody, ...patchBody });
    expect(res.status).toBe(400);
    expect(res.body.error.fields[field]).toBeTruthy();
  });

  it('ignores attempts to set privileged or extra fields', async () => {
    const res = await post(newAgent(), '/api/auth/register', { ...validBody, isAdmin: true, role: 'admin' });
    expect(res.status).toBe(201);
    const stored = await User.findOne({ username: 'maya_rao' }).lean();
    expect(stored.isAdmin).toBeUndefined();
    expect(stored.role).toBeUndefined();
  });
});

describe('login and sessions', () => {
  it('logs in with email or with username', async () => {
    const { data } = await registerUser();
    const byEmail = await post(newAgent(), '/api/auth/login', { identifier: data.email, password: data.password });
    const byName = await post(newAgent(), '/api/auth/login', {
      identifier: data.username.toUpperCase(),
      password: data.password,
    });
    expect(byEmail.status).toBe(200);
    expect(byName.status).toBe(200);
  });

  it('gives the same generic error for a wrong password and an unknown account', async () => {
    const { data } = await registerUser();
    const wrongPassword = await post(newAgent(), '/api/auth/login', { identifier: data.email, password: 'Wrong1234' });
    const unknown = await post(newAgent(), '/api/auth/login', { identifier: 'nobody@example.com', password: 'Wrong1234' });

    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe('Invalid credentials');
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('protects /me and logs out by clearing the cookie', async () => {
    expect((await get(newAgent(), '/api/auth/me')).status).toBe(401);

    const { agent } = await registerUser();
    expect((await get(agent, '/api/auth/me')).status).toBe(200);

    const out = await post(agent, '/api/auth/logout', {});
    expect(out.status).toBe(200);
    expect((await get(agent, '/api/auth/me')).status).toBe(401);
  });

  it('rejects tampered, expired and wrong-purpose tokens', async () => {
    const { user } = await registerUser();
    const secret = process.env.JWT_SECRET;

    const forged = jwt.sign({ sub: user.id, purpose: 'session' }, 'a-different-secret-entirely-xxxxxxxxxxxx');
    const expired = jwt.sign({ sub: user.id, purpose: 'session' }, secret, { expiresIn: -10 });
    const wrongPurpose = jwt.sign({ sub: user.id, purpose: 'socket' }, secret, { expiresIn: '1m' });

    for (const token of [forged, expired, wrongPurpose]) {
      const res = await get(newAgent(), '/api/auth/me').set('Cookie', `vybe_token=${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('rejects a valid session for a user that no longer exists', async () => {
    const { agent, user } = await registerUser();
    await User.deleteOne({ _id: user.id });
    expect((await get(agent, '/api/auth/me')).status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const { agent } = await registerUser();
    const res = await agent.patch('/api/users/me').send({ name: 'Hacked' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });

  it('rejects requests from a foreign Origin even with the header', async () => {
    const { agent } = await registerUser();
    const res = await patch(agent, '/api/users/me', { name: 'Hacked' }).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('accepts the configured frontend origin', async () => {
    const { agent } = await registerUser();
    const res = await patch(agent, '/api/users/me', { name: 'Valid Name' }).set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
  });

  it('does not allow credentialed CORS for other origins', async () => {
    const res = await get(newAgent(), '/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

describe('users', () => {
  it('requires authentication', async () => {
    expect((await get(newAgent(), '/api/users')).status).toBe(401);
  });

  it('searches by name and username, excludes the caller, and exposes only public fields', async () => {
    const me = await registerUser({ name: 'Searcher One', username: 'searcher' });
    await registerUser({ name: 'Priya Nair', username: 'priya_n', email: 'priya@example.com' });
    await registerUser({ name: 'Rahul Verma', username: 'rv_dev', email: 'rahul@example.com' });

    const byName = await get(me.agent, '/api/users?q=priya');
    expect(byName.body.data.users.map((u) => u.username)).toEqual(['priya_n']);

    const byUsername = await get(me.agent, '/api/users?q=rv_');
    expect(byUsername.body.data.users.map((u) => u.username)).toEqual(['rv_dev']);

    const all = await get(me.agent, '/api/users');
    expect(all.body.data.users.map((u) => u.username)).not.toContain('searcher');

    for (const u of all.body.data.users) {
      expect(Object.keys(u).sort()).toEqual(['avatarUrl', 'id', 'name', 'online', 'username']);
    }
    expect(JSON.stringify(all.body)).not.toMatch(/example\.com|passwordHash|\$2[aby]\$/);
  });

  it('treats the search text literally, not as a regular expression', async () => {
    const me = await registerUser();
    await registerUser({ name: 'Dot Man', username: 'dotman', email: 'dot@example.com' });
    const res = await get(me.agent, '/api/users?q=.*');
    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(0);
  });

  it('paginates', async () => {
    const me = await registerUser();
    for (let i = 0; i < 5; i += 1) await registerUser();
    const page1 = await get(me.agent, '/api/users?limit=2&page=1');
    const page3 = await get(me.agent, '/api/users?limit=2&page=3');
    expect(page1.body.data.users).toHaveLength(2);
    expect(page1.body.data.hasMore).toBe(true);
    expect(page1.body.data.total).toBe(5);
    expect(page3.body.data.users).toHaveLength(1);
    expect(page3.body.data.hasMore).toBe(false);
  });

  it('returns a public profile by id and 404s for unknown or malformed ids', async () => {
    const me = await registerUser();
    const other = await registerUser();
    const ok = await get(me.agent, `/api/users/${other.user.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.email).toBeUndefined();
    expect((await get(me.agent, `/api/users/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    expect((await get(me.agent, '/api/users/not-an-id')).status).toBe(404);
  });

  it('updates only the caller profile, with username uniqueness', async () => {
    const me = await registerUser({ username: 'first_user' });
    const other = await registerUser({ username: 'second_user' });

    const ok = await patch(me.agent, '/api/users/me', { name: 'New Name', username: 'Renamed_User' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user).toMatchObject({ name: 'New Name', username: 'renamed_user' });

    const taken = await patch(me.agent, '/api/users/me', { username: 'second_user' });
    expect(taken.status).toBe(409);

    // Passing someone else's id/email/password in the body must not change anything.
    await patch(me.agent, '/api/users/me', { name: 'Still Me', _id: other.user.id, email: 'x@y.com' });
    const untouched = await User.findById(other.user.id);
    expect(untouched.username).toBe('second_user');
    const mine = await User.findById(me.user.id);
    expect(mine.email).not.toBe('x@y.com');

    expect((await patch(me.agent, '/api/users/me', {})).status).toBe(400);
  });
});

describe('misc API behaviour', () => {
  it('returns JSON 404s and never leaks stack traces', async () => {
    const res = await get(newAgent(), '/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await newAgent()
      .post('/api/auth/login')
      .set('X-Requested-With', 'vybe')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });

  it('exposes a health endpoint', async () => {
    const res = await get(newAgent(), '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('delete is not exposed on users', async () => {
    const me = await registerUser();
    expect((await del(me.agent, `/api/users/${me.user.id}`)).status).toBe(404);
  });
});
