const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { UserModel } = require('../dist/DB/models/user/user.model');
const { AdminModel } = require('../dist/DB/models/admin/admin.model');
const { userService } = require('../dist/Modules/user/user.service');
const { adminService } = require('../dist/Modules/admin/admin.service');
const { adminAuthService } = require('../dist/Modules/admin/admin.auth.service');
const actor = { _id: new Types.ObjectId(), role: 'super-admin', tokenVersion: 0 };
const record = () => ({ _id: new Types.ObjectId(), firstName: 'Test', lastName: 'Account', email: 'test@example.com',
  role: 'user', password: 'never-return', tokenVersion: 3, confirmedAt: new Date() });
const query = result => ({ select() { return this; }, sort() { return this; }, skip() { return this; },
  limit() { return this; }, exec: async () => result });

test('listing escapes search, bounds pagination, uses identical filters, and projects safe fields', async t => {
  for (const [model, service, role, key] of [[UserModel, userService, 'guest', 'users'], [AdminModel, adminService, 'admin', 'admins']]) {
    let predicate;
    const row = { ...record(), role };
    t.mock.method(model, 'find', filter => {
      predicate = filter;
      assert.equal(filter.role, role); assert.deepEqual(filter.freezedAt, { $ne: null }); assert.equal(filter.deletedAt, null);
      assert.equal(filter.$or[0].firstName.$regex, '\\.\\*');
      const chain = query([row]);
      chain.select = fields => { assert.ok(!fields.includes('password')); return chain; };
      chain.skip = n => { assert.equal(n, 10); return chain; };
      chain.limit = n => { assert.equal(n, 10); return chain; };
      return chain;
    });
    t.mock.method(model, 'countDocuments', filter => { assert.deepEqual(filter, predicate); return query(12); });
    const result = await service.list(actor, { page: '2', limit: '10', search: '.*', role, status: 'frozen' });
    assert.equal(result[key][0].password, undefined); assert.equal(result[key][0].tokenVersion, undefined);
    assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 12, totalPages: 2 });
  }
});

test('customer status and role writes invalidate sessions atomically and regenerate name slugs', async t => {
  const row = record();
  t.mock.method(UserModel, 'findOne', () => query(row));
  t.mock.method(UserModel, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.tokenVersion, 3); assert.equal(filter.deletedAt, null);
    assert.deepEqual(filter.role, { $in: ['user', 'guest'] });
    assert.equal(update.$inc.tokenVersion, 1); assert.equal(options.runValidators, true);
    assert.equal(update.$set.role, 'guest'); assert.ok(update.$set.freezedAt instanceof Date);
    assert.equal(update.$set.slug, 'new-account');
    return query({ ...row, ...update.$set });
  });
  const result = await userService.update(actor, String(row._id), { firstName: 'New', role: 'guest', status: 'frozen' });
  assert.equal(result.status, 'frozen'); assert.equal(result.role, 'guest'); assert.equal(result.password, undefined);
});

test('admin promotion and soft deletion are guarded against concurrent promotion or deletion', async t => {
  const row = { ...record(), role: 'admin' };
  t.mock.method(AdminModel, 'findById', () => query(row));
  let writes = [];
  t.mock.method(AdminModel, 'findOneAndUpdate', (filter, update) => {
    assert.equal(filter.role, 'admin'); assert.equal(filter.deletedAt, null);
    assert.equal(update.$inc.tokenVersion, 1); writes.push(update);
    return query({ ...row, ...update.$set });
  });
  const promoted = await adminService.update(actor, String(row._id), { role: 'super-admin' });
  assert.equal(promoted.role, 'super-admin');
  const deleted = await adminService.update(actor, String(row._id), {}, true);
  assert.equal(deleted.status, 'deleted'); assert.ok(writes[1].$set.deletedAt instanceof Date);
  t.mock.method(AdminModel, 'findOneAndUpdate', () => query(null));
  await assert.rejects(adminService.update(actor, String(row._id), { status: 'active' }), { statusCode: 404 });
});

test('admin creation maps duplicate email conflicts and self profile cannot change privileges', async t => {
  const input = { firstName: 'Test', lastName: 'Admin', email: 'TEST@EXAMPLE.COM', password: 'Password123', role: 'admin' };
  t.mock.method(AdminModel, 'create', async data => {
    assert.equal(data.email, 'test@example.com'); assert.equal(data.role, 'admin'); return { ...record(), ...data };
  });
  const result = await adminService.create(actor, input);
  assert.equal(result.password, undefined); assert.equal(result.email, 'test@example.com');
  t.mock.method(AdminModel, 'create', async () => { throw { code: 11000 }; });
  await assert.rejects(adminService.create(actor, input), { statusCode: 409 });
  await assert.rejects(adminAuthService.updateProfile(actor, { role: 'super-admin' }), { statusCode: 400 });
  await assert.rejects(adminAuthService.updateProfile(actor, { password: 'Password123' }), { statusCode: 400 });
});
