const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { Types } = require('mongoose');
const { authService } = require('../dist/Modules/auth/auth.service');
const { authRouter } = require('../dist/Modules/auth/auth.routes');
const { userRepository: repo } = require('../dist/DB/repository/user.repository');
const { UserModel, UserSchema } = require('../dist/DB/models/user/user.model');
const token = require('../dist/Utils/security/token');
const hash = require('../dist/Utils/security/hash');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');

function fixture(t, claims = {}) {
  t.mock.property(process, 'env', { ...process.env, GOOGLE_CLIENT_ID: 'test-client', REFRESH_EXPIRES_IN: '3600' });
  const payload = { sub: 'google-123', email: 'Test@example.com', email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600, ...claims };
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async options => {
    assert.deepEqual(options, { idToken: 'header.payload.signature', audience: 'test-client' });
    return { getPayload: () => payload };
  });
  const user = { _id: new Types.ObjectId(), email: 'test@example.com', googleSub: payload.sub,
    firstName: 'Test', lastName: 'User', username: 'Test User', role: 'user', confirmedAt: new Date(), tokenVersion: 0 };
  t.mock.method(repo, 'findByGoogleSub', async () => user);
  t.mock.method(repo, 'findByEmail', async () => null);
  const credentials = t.mock.method(token, 'createLoginCredentials', async () => ({
    accessToken: 'app-access', refreshToken: require('jsonwebtoken').sign({}, 'test-secret', { expiresIn: 3600 }), signatureLevel: 'user',
  }));
  return { user, payload, credentials };
}
const login = () => authService.googleLogin({ idToken: 'header.payload.signature' });

test('existing Google identity uses sub even when Google email changes', async t => {
  const { user } = fixture(t, { email: 'changed@example.com' });
  t.mock.method(repo, 'findByEmail', () => assert.fail('must not look up email'));
  const result = await login();
  assert.equal(result.user.id, String(user._id));
  assert.equal(result.user.email, user.email);
  assert.equal(result.tokens.accessToken, 'app-access');
});

for (const reason of ['invalid signature', 'expired', 'wrong audience', 'wrong issuer']) {
  test(`rejects verifier failure: ${reason}`, async t => {
    const { credentials } = fixture(t);
    t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => { throw new Error(reason); });
    await assert.rejects(login(), { statusCode: 401 });
    assert.equal(credentials.mock.callCount(), 0);
  });
}
for (const claims of [{ email_verified: false }, { exp: 1 }, { sub: '' }, { email: '' }]) {
  test(`rejects missing/unverified/expired claims ${JSON.stringify(claims)}`, async t => {
    const { credentials } = fixture(t, claims);
    await assert.rejects(login(), { statusCode: claims.email_verified === false ? 403 : 401 });
    assert.equal(credentials.mock.callCount(), 0);
  });
}
test('disabled Google configuration fails closed', async t => {
  fixture(t); delete process.env.GOOGLE_CLIENT_ID;
  await assert.rejects(login(), { statusCode: 503 });
});
test('registers verified passwordless user with normalized email and safe defaults', async t => {
  fixture(t);
  t.mock.method(repo, 'findByGoogleSub', async () => null);
  t.mock.method(repo, 'createUser', async data => {
    assert.equal(data.email, 'test@example.com');
    assert.equal(data.googleSub, 'google-123');
    assert.ok(data.confirmedAt instanceof Date);
    assert.equal(data.password, undefined);
    const user = new UserModel(data); await user.validate(); return user;
  });
  assert.equal((await login()).user.role, 'user');
});
test('email conflict never links or creates an account', async t => {
  const { user } = fixture(t);
  delete user.googleSub;
  t.mock.method(repo, 'findByGoogleSub', async () => null);
  t.mock.method(repo, 'findByEmail', async () => user);
  t.mock.method(repo, 'createUser', () => assert.fail('must not create'));
  t.mock.method(repo, 'linkGoogle', () => assert.fail('must not link'));
  await assert.rejects(login(), { statusCode: 409 });
});
test('registration completed between identity and email reads still logs in the same identity', async t => {
  const { user } = fixture(t); let reads = 0;
  t.mock.method(repo, 'findByGoogleSub', async () => ++reads > 1 ? user : null);
  t.mock.method(repo, 'findByEmail', async () => user);
  t.mock.method(repo, 'createUser', async () => { throw { code: 11000 }; });
  assert.equal((await login()).user.id, String(user._id));
});
for (const sameIdentity of [true, false]) {
  test(`duplicate registration recovers only same identity: ${sameIdentity}`, async t => {
    const { user } = fixture(t); let reads = 0;
    t.mock.method(repo, 'findByGoogleSub', async () => ++reads > 1 && sameIdentity ? user : null);
    t.mock.method(repo, 'createUser', async () => { throw { code: 11000 }; });
    if (sameIdentity) assert.equal((await login()).user.id, String(user._id));
    else await assert.rejects(login(), { statusCode: 409 });
  });
}
for (const status of ['frozen', 'unconfirmed']) {
  test(`blocks ${status} users before issuing credentials`, async t => {
    const { user, credentials } = fixture(t);
    if (status === 'frozen') user.freezedAt = new Date(); else delete user.confirmedAt;
    await assert.rejects(login(), { statusCode: 403 });
    assert.equal(credentials.mock.callCount(), 0);
  });
}
test('linking requires password proof and uses atomic repository update', async t => {
  const { user } = fixture(t); delete user.googleSub; user.password = 'hash';
  t.mock.method(repo, 'findUserByIdWithPassword', async () => user);
  t.mock.method(hash, 'compareHash', async (plain, stored) => plain === 'correct' && stored === 'hash');
  const link = t.mock.method(repo, 'linkGoogle', async (account, sub) => {
    assert.equal(account, user); assert.equal(sub, 'google-123'); return user;
  });
  await assert.rejects(authService.linkGoogle(user._id, { idToken: 'header.payload.signature', currentPassword: 'wrong' }), { statusCode: 401 });
  assert.equal(link.mock.callCount(), 0);
  await authService.linkGoogle(user._id, { idToken: 'header.payload.signature', currentPassword: 'correct' });
  assert.equal(link.mock.callCount(), 1);
});
for (const outcome of ['duplicate', 'changed', 'frozen', 'already-linked']) {
  test(`linking rejects ${outcome}`, async t => {
    const { user } = fixture(t); delete user.googleSub; user.password = 'hash';
    if (outcome === 'frozen') user.freezedAt = new Date();
    if (outcome === 'already-linked') user.googleSub = 'another-sub';
    t.mock.method(repo, 'findUserByIdWithPassword', async () => user);
    t.mock.method(hash, 'compareHash', async () => true);
    t.mock.method(repo, 'linkGoogle', async () => {
      if (outcome === 'duplicate') throw { code: 11000 };
      return null;
    });
    await assert.rejects(authService.linkGoogle(user._id, { idToken: 'header.payload.signature', currentPassword: 'correct' }),
      { statusCode: outcome === 'frozen' ? 403 : 409 });
  });
}
test('schema retains email uniqueness and adds partial unique Google identity index', async () => {
  assert.ok(UserSchema.indexes().some(([keys, options]) => keys.email === 1 && options.unique));
  assert.ok(UserSchema.indexes().some(([keys, options]) => keys.googleSub === 1 && options.unique && options.partialFilterExpression.googleSub.$type === 'string'));
  await assert.rejects(new UserModel({ firstName: 'Local', lastName: 'User', email: 'local@example.com' }).validate());
});
test('HTTP Google login validates input, sets HttpOnly cookie, and protects linking', async t => {
  fixture(t);
  const app = express(); app.use(express.json()); app.use('/api/v1/auth', authRouter); app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (path, body) => fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const bad = await post('google', {}); assert.equal(bad.status, 400);
  const response = await post('google', { idToken: 'header.payload.signature' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json(); assert.equal(result.tokens.refreshToken, undefined);
  assert.equal(result.tokens.accessToken, 'app-access');
  assert.equal((await post('google/link', { idToken: 'header.payload.signature', currentPassword: 'Password123!' })).status, 401);
});
