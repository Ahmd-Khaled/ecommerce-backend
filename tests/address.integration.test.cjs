const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { UserModel } = require('../dist/DB/models/user/user.model');
const { addressService } = require('../dist/Modules/address/address.service');
const input = { label: 'Home', fullName: 'Ahmed Ali', phone: '+201012345678', country: 'Egypt', city: 'Cairo', street: 'Main Street' };

test('MongoDB address persistence, legacy migration, ownership and concurrency', { skip: !process.env.MONGO_TEST_URI }, async t => {
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName: `address_test_${new mongoose.Types.ObjectId()}`, serverSelectionTimeoutMS: 5000 });
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  const owner = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
  await UserModel.collection.insertMany([
    { _id: owner, email: 'owner@example.com', address: [{ ...input, isDefault: true }] },
    { _id: other, email: 'other@example.com' },
  ]);
  const legacy = await addressService.listAddresses(owner);
  assert.ok(legacy[0]._id);
  assert.equal(String((await addressService.listAddresses(owner))[0]._id), String(legacy[0]._id));
  const created = await Promise.all([1, 2, 3].map(n => addressService.createAddress(owner, { ...input, label: String(n), isDefault: true })));
  await Promise.all(created.map(a => addressService.setDefaultAddress(owner, String(a._id))));
  const saved = await UserModel.collection.findOne({ _id: owner });
  assert.equal(saved.address.length, 4);
  assert.equal(saved.address.filter(a => a.isDefault).length, 1);
  await assert.rejects(addressService.deleteAddress(other, String(created[0]._id)), { statusCode: 404 });
  const first = await addressService.createAddress(other, input);
  assert.equal(first.isDefault, true);
  assert.ok((await UserModel.collection.findOne({ _id: other })).address[0]._id);
});
