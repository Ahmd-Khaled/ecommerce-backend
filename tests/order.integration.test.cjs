const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { OrderModel } = require('../dist/DB/models/order/order.model');
const { UserModel } = require('../dist/DB/models/user/user.model');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { CartModel } = require('../dist/DB/models/cart/cart.model');
const { orderService: service } = require('../dist/Modules/order/order.service');
const { productService } = require('../dist/Modules/product/product.service');

test('order lifecycle and checkout on a real replica set', { skip: !process.env.MONGO_TEST_URI }, async t => {
  const dbName = 'order_test_' + new mongoose.Types.ObjectId();
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  t.after(async () => {
    if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await Promise.all([OrderModel.init(), CartModel.init(), ProductModel.init()]);
  const admin = new mongoose.Types.ObjectId();
  async function fixture(count = 1) {
    const user = new mongoose.Types.ObjectId(), addressId = new mongoose.Types.ObjectId();
    await UserModel.collection.insertOne({ _id: user, email: user.toString() + '@example.test', address: [{ _id: addressId, fullName: 'Buyer Name', phone: '123',
      country: 'EG', city: 'Cairo', street: 'Original Street' }] });
    const ids = [];
    for (let i = 0; i < count; i++) {
      const id = new mongoose.Types.ObjectId();
      await ProductModel.collection.insertOne({ _id: id, name: 'Original product', sku: id.toString(), slug: id.toString(),
        stock: 10, price: 0.29, isActive: true });
      ids.push(id);
    }
    const cart = await CartModel.create({ user, items: ids.map(product => ({ product, quantity: 2 })) });
    const input = { version: cart.__v, addressId: addressId.toString(), items: ids.map(product => ({ productId: product.toString(), unitPriceMinor: 29 })) };
    return { user, addressId, ids, input, key: randomUUID() };
  }
  const buy = f => service.checkout(f.user, f.input, f.key);
  const stock = async id => (await ProductModel.findById(id)).stock;

  await t.test('concurrent same-key checkout creates one order and both callers receive its identity', async () => {
    const f = await fixture();
    const results = await Promise.all([buy(f), buy(f)]);
    assert.equal(String(results[0].order._id), String(results[1].order._id));
    assert.equal(results.filter(r => r.replayed).length, 1);
    assert.equal(await OrderModel.countDocuments({ user: f.user }), 1);
    assert.equal(await stock(f.ids[0]), 8);
    assert.equal((await CartModel.findOne({ user: f.user })).items.length, 0);
    await assert.rejects(service.checkout(f.user, { ...f.input, version: 99 }, f.key), { statusCode: 409 });
  });

  await t.test('different keys on the same cart cannot create two orders', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([buy(f), service.checkout(f.user, f.input, randomUUID())]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await stock(f.ids[0]), 8);
    assert.equal(await OrderModel.countDocuments({ user: f.user }), 1);
  });

  await t.test('keys are scoped by user; snapshots survive edits and removal; replay ignores current cart', async () => {
    const f = await fixture(), other = await fixture();
    other.key = f.key;
    const result = await buy(f);
    await buy(other);
    await ProductModel.collection.updateOne({ _id: f.ids[0] }, { $set: { name: 'Changed', sku: 'CHANGED', price: 10 } });
    await UserModel.collection.updateOne({ _id: f.user }, { $set: { address: [] } });
    const details = await service.details(String(result.order._id), f.user);
    assert.equal(details.items[0].name, 'Original product');
    assert.equal(details.shippingAddress.street, 'Original Street');
    assert.equal(details.grandTotalMinor, 58);
    assert.equal((await buy(f)).replayed, true);
    assert.equal((await service.list(f.user, {})).orders.length, 1);
    assert.equal((await service.list(f.user, {})).orders[0].shippingAddress, undefined);
    assert.equal((await service.adminList({ user: f.user.toString(), status: 'placed' })).pagination.total, 1);
    await assert.rejects(service.details(String(result.order._id), other.user), { statusCode: 404 });
    await assert.rejects(service.cancel(other.user, String(result.order._id), {}), { statusCode: 404 });
  });

  await t.test('foreign address cannot be purchased and no writes survive', async () => {
    const f = await fixture(), other = await fixture();
    await assert.rejects(service.checkout(f.user, { ...f.input, addressId: other.addressId.toString() }, f.key), { statusCode: 404 });
    assert.equal(await stock(f.ids[0]), 10);
    assert.equal(await OrderModel.countDocuments({ user: f.user }), 0);
    assert.equal((await CartModel.findOne({ user: f.user })).items.length, 1);
  });

  await t.test('concurrent cancellation restores once, even for archived products; replay remains safe', async () => {
    const f = await fixture();
    const { order } = await buy(f);
    await productService.deleteProduct(f.ids[0].toString());
    assert.equal((await ProductModel.findById(f.ids[0])).isActive, false);
    const results = await Promise.all([service.cancel(f.user, String(order._id), { reason: 'Changed mind' }),
      service.cancel(f.user, String(order._id), {})]);
    assert.ok(results.every(r => r.status === 'cancelled'));
    assert.equal(await stock(f.ids[0]), 10);
    const stored = await OrderModel.findById(order._id);
    assert.equal(stored.statusHistory.length, 2);
    assert.ok(stored.stockRestoredAt);
    assert.equal((await buy(f)).order.status, 'cancelled');
    assert.equal(await stock(f.ids[0]), 10);
  });

  await t.test('admin transitions enforce expected status, ordering and terminal states', async () => {
    const f = await fixture(), { order } = await buy(f), id = String(order._id);
    await assert.rejects(service.transition(admin, id, { expectedStatus: 'placed', status: 'delivered' }), { statusCode: 409 });
    await service.transition(admin, id, { expectedStatus: 'placed', status: 'processing' });
    await assert.rejects(service.transition(admin, id, { expectedStatus: 'placed', status: 'processing' }), { statusCode: 409 });
    await assert.rejects(service.cancel(f.user, id, {}), { statusCode: 409 });
    await service.transition(admin, id, { expectedStatus: 'processing', status: 'shipped' });
    await assert.rejects(service.transition(admin, id, { expectedStatus: 'shipped', status: 'cancelled' }), { statusCode: 409 });
    await service.transition(admin, id, { expectedStatus: 'shipped', status: 'delivered' });
    await assert.rejects(service.transition(admin, id, { expectedStatus: 'delivered', status: 'processing' }), { statusCode: 409 });
    assert.equal((await OrderModel.findById(id)).statusHistory.length, 4);
    assert.equal(await stock(f.ids[0]), 8);
  });

  await t.test('cancellation racing processing or shipping has one legal committed result', async () => {
    for (const processing of [false, true]) {
      const f = await fixture(), { order } = await buy(f), id = String(order._id);
      if (processing) await service.transition(admin, id, { expectedStatus: 'placed', status: 'processing' });
      const results = await Promise.allSettled([
        processing ? service.transition(admin, id, { expectedStatus: 'processing', status: 'cancelled' }) : service.cancel(f.user, id, {}),
        service.transition(admin, id, { expectedStatus: processing ? 'processing' : 'placed', status: processing ? 'shipped' : 'processing' }),
      ]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const stored = await OrderModel.findById(id);
      assert.equal(await stock(f.ids[0]), stored.status === 'cancelled' ? 10 : 8);
    }
  });

  await t.test('missing inventory midway rolls back cancellation and earlier stock increments', async () => {
    const f = await fixture(2), { order } = await buy(f);
    await ProductModel.collection.deleteOne({ _id: f.ids[1] }); // Simulate historical corruption, not the archive API.
    await assert.rejects(service.cancel(f.user, String(order._id), {}), { statusCode: 409 });
    assert.equal(await stock(f.ids[0]), 8);
    const stored = await OrderModel.findById(order._id);
    assert.equal(stored.status, 'placed');
    assert.equal(stored.stockRestoredAt, undefined);
    assert.equal(stored.statusHistory.length, 1);
  });

  await t.test('unsafe inventory restoration aborts without changing order', async () => {
    const f = await fixture(), { order } = await buy(f);
    await ProductModel.collection.updateOne({ _id: f.ids[0] }, { $set: { stock: Number.MAX_SAFE_INTEGER } });
    await assert.rejects(service.cancel(f.user, String(order._id), {}), { statusCode: 409 });
    assert.equal((await OrderModel.findById(order._id)).status, 'placed');
  });

  await t.test('archive racing checkout never loses an inventory record', async () => {
    const f = await fixture();
    const [purchase, archive] = await Promise.allSettled([buy(f), productService.deleteProduct(f.ids[0].toString())]);
    assert.equal(archive.status, 'fulfilled');
    assert.ok(await ProductModel.findById(f.ids[0]));
    if (purchase.status === 'fulfilled') {
      await service.cancel(f.user, String(purchase.value.order._id), {});
      assert.equal(await stock(f.ids[0]), 10);
    } else {
      assert.equal(await stock(f.ids[0]), 10);
      assert.equal(await OrderModel.countDocuments({ user: f.user }), 0);
    }
  });

  await t.test('legacy orders coexist with the unique index, retain amounts and require manual lifecycle review', async () => {
    const user = new mongoose.Types.ObjectId();
    await OrderModel.collection.insertMany([1, 2].map(() => ({ user, items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, unitPrice: 5 }], total: 5, status: 'placed' })));
    await OrderModel.createIndexes();
    const result = await service.list(user, {});
    assert.equal(result.orders.length, 2);
    assert.equal(result.orders[0].currency, null);
    assert.equal(result.orders[0].total, 5);
    await assert.rejects(service.cancel(user, String(result.orders[0]._id), {}), { statusCode: 409 });
  });

  await t.test('read-only audit reports incompatible catalog data and legacy inventory', async () => {
    const { spawnSync } = require('node:child_process');
    const uri = new URL(process.env.MONGO_TEST_URI);
    uri.pathname = '/' + dbName;
    const id = new mongoose.Types.ObjectId();
    await ProductModel.collection.insertOne({ _id: id, name: 'Bad precision', sku: id.toString(), slug: id.toString(), price: 1.005, stock: 1 });
    const before = await ProductModel.countDocuments();
    const result = spawnSync(process.execPath, ['scripts/order-audit.cjs'], {
      cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, MONGO_AUDIT_URI: uri.toString() },
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.invalidProducts >= 1);
    assert.equal(report.legacyOrders, 2);
    assert.equal(report.duplicateKeyGroups, 0);
    assert.equal(await ProductModel.countDocuments(), before);
    assert.equal((await ProductModel.findById(id)).price, 1.005);
  });
  await t.test('pagination is stable for equal timestamps and filters remain owner-scoped', async () => {
    const f = await fixture(), { order } = await buy(f);
    const secondId = new mongoose.Types.ObjectId(), thirdId = new mongoose.Types.ObjectId();
    const row = await OrderModel.findById(order._id).lean();
    const date = new Date('2026-01-01T00:00:00Z');
    await OrderModel.collection.updateOne({ _id: order._id }, { $set: { createdAt: date } });
    await OrderModel.collection.insertMany([secondId, thirdId].map(_id => ({ ...row, _id, createdAt: date, idempotencyKey: randomUUID() })));
    const first = await service.list(f.user, { page: 1, limit: 2 });
    const second = await service.list(f.user, { page: 2, limit: 2 });
    assert.equal(first.pagination.total, 3);
    const ids = [...first.orders, ...second.orders].map(o => String(o._id));
    assert.deepEqual(ids, [order._id, secondId, thirdId].map(String).sort().reverse());
    assert.equal((await service.adminList({ user: String(f.user), from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00.100Z' })).pagination.total, 3);
  });

  await t.test('admin can cancel processing orders and snapshots resist query updates', async () => {
    const f = await fixture(), { order } = await buy(f), id = String(order._id);
    await OrderModel.updateOne({ _id: order._id }, { $set: { grandTotalMinor: 1, currency: 'USD', shippingAddress: { city: 'Changed' }, items: [] } });
    await OrderModel.updateOne({ _id: order._id }, { $set: { "items.0.name": "Changed", "shippingAddress.city": "Changed" } });
    const original = await service.details(id, f.user);
    assert.equal(original.grandTotalMinor, 58);
    assert.equal(original.currency, 'EGP');
    assert.equal(original.shippingAddress.city, 'Cairo');
    assert.equal(original.items.length, 1);
    assert.equal(original.items[0].name, "Original product");
    await service.transition(admin, id, { expectedStatus: 'placed', status: 'processing' });
    await service.transition(admin, id, { expectedStatus: 'processing', status: 'cancelled', reason: 'Cannot fulfill' });
    assert.equal(await stock(f.ids[0]), 10);
  });});
