const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Types } = require('mongoose');
const { authRouter } = require('../dist/Modules/auth/auth.routes');
const { authService } = require('../dist/Modules/auth/auth.service');
const { corsOptions } = require('../dist/Utils/middleware/cors');
const { refreshTokenCookieOptions } = require('../dist/Modules/auth/auth.cookie');
const { userRepository } = require('../dist/DB/repository/user.repository');
const { TokenRepository } = require('../dist/DB/repository/token.repository');
const token = require('../dist/Utils/security/token');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');

function fixture(t, role = 'user') {
  t.mock.property(process, 'env', { ...process.env, NODE_ENV: 'production', CORS_ORIGINS: 'https://shop.example.com', ACCESS_EXPIRES_IN: '900', REFRESH_EXPIRES_IN: '3600', ACCESS_USER_TOKEN_SECRET: 'test-access-user', REFRESH_USER_TOKEN_SECRET: 'test-refresh-user', ACCESS_ADMIN_TOKEN_SECRET: 'test-access-admin', REFRESH_ADMIN_TOKEN_SECRET: 'test-refresh-admin' });
  const user = { _id: new Types.ObjectId(), role, tokenVersion: 0 };
  const revoked = new Set();
  t.mock.method(userRepository, 'findOne', async () => user);
  t.mock.method(userRepository, 'incrementTokenVersion', async () => { user.tokenVersion++; return user; });
  t.mock.method(TokenRepository.prototype, 'findOne', async ({ filter }) => revoked.has(filter.jti) ? { jti: filter.jti } : null);
  t.mock.method(TokenRepository.prototype, 'create', async ({ data }) => {
    if (data.some(row => revoked.has(row.jti))) throw { code: 11000 };
    data.forEach(row => revoked.add(row.jti)); return data;
  });
  return { user, revoked };
}

for (const role of ['user', 'admin']) test(`${role}: cookie login, rotation, reuse detection and version invalidation`, async t => {
  const { user } = fixture(t, role);
  t.mock.method(authService, 'login', async () => {
    const credentials = await token.createLoginCredentials(user);
    return { message: 'Login successful', user: { id: String(user._id) }, tokens: { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken, tokenType: credentials.signatureLevel } };
  });
  const app = express(); app.use(cors(corsOptions()), express.json(), cookieParser()); app.use('/api/v1/auth', authRouter); app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (path, { body, cookie, authorization, origin = 'https://shop.example.com', method = 'POST' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(authorization ? { Authorization: authorization } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  };
  const login = await call('login', { body: { email: 'test@example.com', password: 'Password123' } });
  assert.equal(login.status, 200); assert.equal(login.body.tokens.refreshToken, undefined);
  assert.equal(login.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(login.headers.get('access-control-allow-origin'), 'https://shop.example.com');
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const setCookie = login.headers.get('set-cookie');
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/v1/auth', 'Expires=']) assert.ok(setCookie.includes(attribute));
  const cookie = setCookie.split(';')[0];
  const credential = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  const decoded = jwt.decode(credential.split(' ')[1]);
  assert.equal(new Date(/Expires=([^;]+)/.exec(setCookie)[1]).getTime(), decoded.exp * 1000);
  assert.equal((await call('refresh-token', { authorization: credential })).status, 400);
  assert.equal((await call('refresh-token', { body: { refreshToken: credential } })).status, 400);
  assert.equal((await call('refresh-token', { cookie: 'refreshToken=invalid' })).status, 400);
  assert.equal((await call('refresh-token', { cookie, origin: 'https://evil.example.com' })).status, 403);
  const refreshed = await call('refresh-token', { cookie });
  assert.equal(refreshed.status, 200); assert.equal(refreshed.body.tokens.refreshToken, undefined);
  const rotatedCookie = refreshed.headers.get('set-cookie').split(';')[0]; assert.notEqual(rotatedCookie, cookie);
  assert.equal((await call('refresh-token', { cookie })).status, 401); assert.equal(user.tokenVersion, 1);
  assert.equal((await call('refresh-token', { cookie: rotatedCookie })).status, 401);

  const fresh = await call('login', { body: { email: 'test@example.com', password: 'Password123' } });
  const logoutCookie = fresh.headers.get('set-cookie').split(';')[0];
  const authorization = `${role} ${fresh.body.tokens.accessToken}`;
  const logout = await call('logout', { cookie: logoutCookie, authorization });
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  await assert.rejects(token.decodedToken({ authorization }), { statusCode: 401 });
  const allCredentials = await token.createLoginCredentials(user);
  const all = await call('logout-all', { authorization: `${role} ${allCredentials.accessToken}` });
  assert.equal(all.status, 200); assert.match(all.headers.get('set-cookie'), /Path=\/api\/v1\/auth/); assert.equal(user.tokenVersion, 2);
});

test('concurrent refresh reuse invalidates sessions and frozen accounts cannot rotate', async t => {
  const { user } = fixture(t);
  const credentials = await token.createLoginCredentials(user);
  const authorization = `user ${credentials.refreshToken}`;
  const results = await Promise.allSettled([authService.refreshToken(authorization), authService.refreshToken(authorization)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(user.tokenVersion, 1);
  user.freezedAt = new Date();
  const frozen = await token.createLoginCredentials(user);
  await assert.rejects(authService.refreshToken(`user ${frozen.refreshToken}`), { statusCode: 403 });
});

test('logout enforces ownership and development cookie options are evaluated at runtime', async t => {
  const { user, revoked } = fixture(t);
  const credentials = await token.createLoginCredentials(user);
  await assert.rejects(authService.logoutCurrentDevice({ accessDecoded: { _id: String(new Types.ObjectId()) }, refreshToken: `user ${credentials.refreshToken}` }), { statusCode: 401 });
  assert.equal(revoked.size, 0);
  process.env.NODE_ENV = 'development'; assert.equal(refreshTokenCookieOptions().secure, false);
  assert.equal(refreshTokenCookieOptions().maxAge, undefined);
});

test('successful password changes and resets clear the refresh cookie', async t => {
  const { authController } = require('../dist/Modules/auth/auth.controller');
  fixture(t);
  for (const method of ['changePassword', 'resetPassword']) {
    t.mock.method(authService, method, async () => ({ message: 'Login again' }));
    const cleared = [];
    const res = { clearCookie: (...args) => cleared.push(args), status() { return this; }, json() {} };
    await authController[method]({ user: { _id: new Types.ObjectId() }, body: {}, ip: '127.0.0.1' }, res);
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0][0], 'refreshToken');
    assert.deepEqual(cleared[0][1], { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/auth' });
  }
});
