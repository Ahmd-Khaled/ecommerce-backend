const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Types } = require('mongoose');
const userToken = require('../dist/Utils/security/token');
const adminToken = require('../dist/Modules/admin/admin.token');
const { adminAuthService } = require('../dist/Modules/admin/admin.auth.service');
const { adminService } = require('../dist/Modules/admin/admin.service');
const { userService } = require('../dist/Modules/user/user.service');
const { adminRepository } = require('../dist/DB/repository/admin.repository');
const { userRepository } = require('../dist/DB/repository/user.repository');
const { TokenRepository } = require('../dist/DB/repository/token.repository');
const { AdminModel } = require('../dist/DB/models/admin/admin.model');
const { UserModel } = require('../dist/DB/models/user/user.model');
const { adminRouter } = require('../dist/Modules/admin/admin.routes');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');
const { generateHash } = require('../dist/Utils/security/hash');

function fixture(t, role = 'admin') {
  // Deliberately identical secrets: claims must still prevent identity/type confusion.
  t.mock.property(process, 'env', { ...process.env, ACCESS_EXPIRES_IN: '900', REFRESH_EXPIRES_IN: '3600',
    ACCESS_USER_TOKEN_SECRET: 'same-test-secret', REFRESH_USER_TOKEN_SECRET: 'same-test-secret',
    ACCESS_ADMIN_TOKEN_SECRET: 'same-test-secret', REFRESH_ADMIN_TOKEN_SECRET: 'same-test-secret' });
  const id = new Types.ObjectId();
  const admin = { _id: id, role, tokenVersion: 0, email: 'admin@example.com', firstName: 'Test', lastName: 'Admin' };
  const user = { _id: id, role: 'user', tokenVersion: 0 };
  const revoked = new Set();
  t.mock.method(adminRepository, 'findOne', async () => admin);
  t.mock.method(userRepository, 'findOne', async () => user);
  t.mock.method(adminRepository, 'incrementTokenVersion', async () => { admin.tokenVersion++; return admin; });
  t.mock.method(TokenRepository.prototype, 'findOne', async ({ filter }) => revoked.has(filter.jti) ? {} : null);
  t.mock.method(TokenRepository.prototype, 'create', async ({ data }) => {
    if (data.some(row => revoked.has(row.jti))) throw { code: 11000 };
    data.forEach(row => revoked.add(row.jti)); return data;
  });
  return { admin, user, revoked };
}

test('tokens cannot cross identities or token types even with identical IDs and secrets', async t => {
  const { admin, user } = fixture(t);
  const a = await adminToken.createAdminCredentials(admin), u = await userToken.createLoginCredentials(user);
  await assert.rejects(userToken.decodedToken({ authorization: `admin ${a.accessToken}` }), { statusCode: 401 });
  await assert.rejects(userToken.decodedToken({ authorization: `user ${a.accessToken}` }), { statusCode: 401 });
  await assert.rejects(adminToken.decodedAdminToken(`user ${u.accessToken}`), { statusCode: 401 });
  await assert.rejects(adminToken.decodedAdminToken(`admin ${u.accessToken}`), { statusCode: 401 });
  await assert.rejects(adminToken.decodedAdminToken(`admin ${a.refreshToken}`), { statusCode: 401 });
  await assert.rejects(userToken.decodedToken({ authorization: `user ${u.refreshToken}` }), { statusCode: 401 });
  assert.equal((await adminToken.decodedAdminToken(`admin ${a.accessToken}`)).admin, admin);
  assert.equal((await userToken.decodedToken({ authorization: `user ${u.accessToken}` })).user, user);
  user.role = 'admin';
  await assert.rejects(userToken.createLoginCredentials(user), { statusCode: 403 });
  await assert.rejects(userToken.decodedToken({ authorization: `user ${u.accessToken}` }), { statusCode: 401 });
});

test('frozen, deleted, changed roles and stale versions reject existing sessions', async t => {
  const { admin, user } = fixture(t);
  const a = await adminToken.createAdminCredentials(admin), u = await userToken.createLoginCredentials(user);
  for (const field of ['freezedAt', 'deletedAt']) {
    admin[field] = new Date(); user[field] = new Date();
    await assert.rejects(adminToken.decodedAdminToken(`admin ${a.accessToken}`));
    await assert.rejects(userToken.decodedToken({ authorization: `user ${u.accessToken}` }));
    delete admin[field]; delete user[field];
  }
  admin.tokenVersion++; user.tokenVersion++;
  await assert.rejects(adminToken.decodedAdminToken(`admin ${a.accessToken}`), { statusCode: 401 });
  await assert.rejects(userToken.decodedToken({ authorization: `user ${u.accessToken}` }), { statusCode: 401 });
});

test('admin refresh rotation detects replay and concurrent use', async t => {
  const { admin } = fixture(t);
  const tokens = await adminToken.createAdminCredentials(admin);
  const results = await Promise.allSettled([1, 2].map(() => adminAuthService.refresh(`admin ${tokens.refreshToken}`)));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(admin.tokenVersion, 1);
  const fresh = await adminToken.createAdminCredentials(admin);
  const rotated = await adminAuthService.refresh(`admin ${fresh.refreshToken}`);
  await assert.rejects(adminAuthService.refresh(`admin ${fresh.refreshToken}`), { statusCode: 401 });
  await assert.rejects(adminToken.decodedAdminToken(`admin ${rotated.tokens.accessToken}`), { statusCode: 401 });
});

test('management rejects escalation, mass assignment, self removal and protected super-admin changes', async t => {
  const { admin } = fixture(t);
  const id = String(new Types.ObjectId());
  await assert.rejects(adminService.create(admin, {}), { statusCode: 403 });
  await assert.rejects(userService.update(admin, id, { role: 'super-admin' }), { statusCode: 400 });
  await assert.rejects(userService.update(admin, id, { tokenVersion: 0 }), { statusCode: 400 });
  await assert.rejects(userService.create(admin, { role: 'admin' }), { statusCode: 400 });
  await assert.rejects(userService.list(admin, { limit: 101 }), { statusCode: 400 });
  await assert.rejects(userService.list(admin, { search: { $ne: null } }), { statusCode: 400 });
  admin.role = 'super-admin';
  await assert.rejects(adminService.update(admin, String(admin._id), {}, true), { statusCode: 403 });
  t.mock.method(AdminModel, 'findById', () => ({ exec: async () => ({ role: 'super-admin' }) }));
  await assert.rejects(adminService.update(admin, id, { role: 'admin' }), { statusCode: 403 });
  await assert.rejects(adminService.update(admin, id, {}, true), { statusCode: 403 });
});

test('admin login cookie is isolated and customer credentials cannot reach admin routes', async t => {
  const { admin, user } = fixture(t);
  admin.password = await generateHash('Password123');
  t.mock.method(adminRepository, 'findByEmailWithPassword', async () => admin);
  const app = express(); app.use(express.json(), cookieParser()); app.use('/api/v1/admin', adminRouter); app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'Password123' }) });
  assert.equal(login.status, 200);
  const body = await login.json(); assert.equal(body.tokens.refreshToken, undefined); assert.equal(body.admin.password, undefined);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^adminRefreshToken=/); assert.match(cookie, /Path=\/api\/v1\/admin\/auth/); assert.match(cookie, /HttpOnly/);
  const access = 'admin ' + body.tokens.accessToken;
  assert.equal((await fetch(base + '/auth/profile', { headers: { authorization: access } })).status, 200);
  assert.equal((await fetch(base, { headers: { authorization: access } })).status, 403);
  const u = await userToken.createLoginCredentials(user);
  assert.equal((await fetch(base + '/users', { headers: { authorization: 'user ' + u.accessToken } })).status, 401);
  assert.equal((await fetch(base + '/auth/refresh-token', { method: 'POST', headers: { cookie: cookie.split(';')[0] } })).status, 200);
  assert.equal((await fetch(base + '/auth/refresh-token', { method: 'POST', headers: { cookie: 'refreshToken=' + encodeURIComponent('user ' + u.refreshToken) } })).status, 400);
});

test('model roles and serialized admin secrets are isolated', () => {
  assert.deepEqual(UserModel.schema.path('role').enumValues.sort(), ['guest', 'user']);
  assert.deepEqual(AdminModel.schema.path('role').enumValues.sort(), ['admin', 'super-admin']);
  const admin = new AdminModel({ firstName: 'Test', lastName: 'Admin', email: 'a@example.com', password: 'secret' });
  assert.equal(admin.toJSON().password, undefined); assert.equal(admin.toObject().password, undefined);
  assert.equal(AdminModel.collection.name, 'admins');
});

test('legacy and malformed admin claims fail closed', async t => {
  fixture(t);
  for (const payload of [{}, { identity: 'admin', tokenType: 'access', _id: 'invalid', tokenVersion: 0 }]) {
    const token = jwt.sign(payload, 'same-test-secret', { expiresIn: 60, jwtid: 'test' });
    await assert.rejects(adminToken.decodedAdminToken('admin ' + token), { statusCode: 401 });
  }
});
