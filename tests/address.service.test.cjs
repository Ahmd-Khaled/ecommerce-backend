const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Types } = require('mongoose');
const { addressRepository } = require('../dist/DB/repository/address.repository');
const { addressService } = require('../dist/Modules/address/address.service');
const token = require('../dist/Utils/security/token');
const { addressRouter } = require('../dist/Modules/address/address.routes');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');
const { createAddressSchema, updateAddressSchema } = require('../dist/Modules/address/address.validation');
const input = { label: 'Home', fullName: 'Ahmed Ali', phone: '+201012345678', country: 'Egypt', city: 'Cairo', street: 'Main Street' };

function storage(t) {
  const rows = new Map();
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  t.mock.method(addressRepository, 'findByUser', async id => rows.has(String(id)) ? { address: copy(rows.get(String(id))) } : null);
  t.mock.method(addressRepository, 'replace', async (id, previous, addresses) => {
    if (JSON.stringify(rows.get(String(id))) !== JSON.stringify(previous)) return false;
    rows.set(String(id), copy(addresses));
    return true;
  });
  return rows;
}

test('validation trims fields and rejects invalid, empty and untrusted inputs', () => {
  assert.equal(createAddressSchema.parse({ ...input, label: ' Home ' }).label, 'Home');
  for (const patch of [{ label: ' ' }, { phone: 'abc' }, { isDefault: 'true' }, { userId: 'x' }, { _id: 'x' }, { street: 'x'.repeat(301) }]) {
    assert.equal(createAddressSchema.safeParse({ ...input, ...patch }).success, false);
  }
  assert.equal(updateAddressSchema.safeParse({}).success, false);
  assert.equal(updateAddressSchema.safeParse({ isDefault: false }).success, true);
});

test('address lifecycle, ownership, missing users and default behavior', async t => {
  const rows = storage(t), owner = new Types.ObjectId(), other = new Types.ObjectId();
  rows.set(String(owner), undefined); rows.set(String(other), []);
  assert.deepEqual(await addressService.listAddresses(owner), []);
  const first = await addressService.createAddress(owner, input);
  assert.equal(first.isDefault, true);
  const second = await addressService.createAddress(owner, { ...input, label: 'Work' });
  assert.equal(second.isDefault, false);
  await assert.rejects(addressService.updateAddress(other, String(first._id), { city: 'Alex' }), { statusCode: 404 });
  await assert.rejects(addressService.deleteAddress(other, String(first._id)), { statusCode: 404 });
  await assert.rejects(addressService.setDefaultAddress(other, String(first._id)), { statusCode: 404 });
  await assert.rejects(addressService.listAddresses(new Types.ObjectId()), { statusCode: 404 });
  await addressService.setDefaultAddress(owner, String(second._id));
  await addressService.updateAddress(owner, String(second._id), { city: 'Alex' });
  let addresses = await addressService.listAddresses(owner);
  assert.equal(addresses.filter(a => a.isDefault).length, 1);
  assert.equal(addresses[1].city, 'Alex');
  addresses = await addressService.deleteAddress(owner, String(second._id));
  assert.equal(addresses[0].isDefault, true);
  assert.deepEqual(await addressService.deleteAddress(owner, String(first._id)), []);
  const explicit = await addressService.createAddress(owner, { ...input, isDefault: false });
  assert.equal(explicit.isDefault, false);
});

test('legacy IDs are persisted and duplicate defaults repaired', async t => {
  const rows = storage(t), owner = new Types.ObjectId();
  rows.set(String(owner), [{ ...input, isDefault: true }, { ...input, isDefault: true }]);
  const first = await addressService.listAddresses(owner);
  const second = await addressService.listAddresses(owner);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), second);
  assert.ok(first.every(a => a._id));
  assert.equal(first.filter(a => a.isDefault).length, 1);
});

test('concurrent creates and default switches preserve addresses and one default', async t => {
  const rows = storage(t), owner = new Types.ObjectId(); rows.set(String(owner), []);
  const created = await Promise.all([1, 2, 3].map(n => addressService.createAddress(owner, { ...input, label: String(n), isDefault: true })));
  await Promise.all(created.map(a => addressService.setDefaultAddress(owner, String(a._id))));
  const addresses = await addressService.listAddresses(owner);
  assert.equal(addresses.length, 3);
  assert.equal(addresses.filter(a => a.isDefault).length, 1);
});

test('retry exhaustion reports conflict', async t => {
  storage(t); const owner = new Types.ObjectId();
  t.mock.method(addressRepository, 'findByUser', async () => ({ address: [] }));
  t.mock.method(addressRepository, 'replace', async () => false);
  await assert.rejects(addressService.createAddress(owner, input), { statusCode: 409 });
});

test('HTTP routes authenticate, validate, and scope every operation to the current user', async t => {
  const rows = storage(t), owner = new Types.ObjectId(), other = new Types.ObjectId();
  rows.set(String(owner), []); rows.set(String(other), []);
  t.mock.method(token, 'decodedToken', async ({ authorization }) => ({ user: { _id: authorization === 'other' ? other : owner }, decoded: {} }));
  const app = express(); app.use(express.json()); app.use('/api/v1/addresses', addressRouter); app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (method, path = '', body, authorization = 'owner') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/addresses${path}`, { method, headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request('GET', '', undefined, '')).status, 401);
  assert.equal((await request('POST', '', {})).status, 400);
  const created = await request('POST', '', input); assert.equal(created.status, 201);
  const id = created.body.data._id;
  assert.equal((await request('GET')).body.data.length, 1);
  assert.equal((await request('PATCH', `/${id}`, {})).status, 400);
  assert.equal((await request('PATCH', '/invalid', { city: 'Alex' })).status, 400);
  assert.equal((await request('PATCH', `/${id}`, { city: 'Alex' }, 'other')).status, 404);
  assert.equal((await request('PATCH', `/${id}`, { city: 'Alex' })).body.data.city, 'Alex');
  assert.equal((await request('PATCH', `/${id}/default`)).status, 200);
  assert.equal((await request('DELETE', `/${id}`)).status, 200);
});
