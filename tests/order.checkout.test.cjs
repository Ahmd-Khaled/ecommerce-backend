const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { CartModel } = require('../dist/DB/models/cart/cart.model');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { UserModel } = require('../dist/DB/models/user/user.model');
const { OrderModel } = require('../dist/DB/models/order/order.model');
const { orderService } = require('../dist/Modules/order/order.service');
const { checkoutFingerprint, orderResponse } = require('../dist/DB/repository/order.repository');
const { toMinor, safeMoney, storeMoney } = require('../dist/Utils/money');
const key = 'checkout-test-key-123';
const query = value => ({ session() { return this; }, select() { return this; }, exec: async () => value });

function fixture(t) {
  const user = new mongoose.Types.ObjectId(), product = new mongoose.Types.ObjectId(), addressId = new mongoose.Types.ObjectId();
  const session = {};
  const cart = { _id: new mongoose.Types.ObjectId(), __v: 2, items: [{ product, quantity: 3 }] };
  const input = { version: 2, addressId: addressId.toString(), items: [{ productId: product.toString(), unitPriceMinor: 500 }] };
  const address = { _id: addressId, fullName: 'Buyer Name', phone: '123', country: 'EG', city: 'Cairo', street: 'Street' };
  t.mock.method(mongoose.connection, 'transaction', async fn => fn(session));
  const replay = t.mock.method(OrderModel, 'findOne', () => query(null));
  t.mock.method(UserModel, 'findOne', filter => {
    assert.equal(filter._id, user);
    assert.equal(filter['address._id'].toString(), addressId.toString());
    return query({ address: [address] });
  });
  t.mock.method(CartModel, 'findOne', filter => {
    assert.equal(filter.user, user);
    const q = query(cart);
    q.session = actual => { assert.equal(actual, session); return q; };
    return q;
  });
  t.mock.method(ProductModel, 'findOne', () => query({ price: 5 }));
  const deduct = t.mock.method(ProductModel, 'findOneAndUpdate', (filter, update, options) => {
    assert.deepEqual(filter, { _id: product, isActive: true, price: 5, stock: { $gte: 3 } });
    assert.deepEqual(update, { $inc: { stock: -3 } });
    assert.equal(options.session, session);
    return query({ price: 5, name: 'Book', sku: 'BOOK-1' });
  });
  const create = t.mock.method(OrderModel, 'create', async (orders, options) => {
    assert.equal(options.session, session);
    return orders.map(order => new OrderModel(order));
  });
  const clear = t.mock.method(CartModel, 'updateOne', (filter, update, options) => {
    assert.deepEqual(filter, { _id: cart._id, __v: 2 });
    assert.deepEqual(update, { $set: { items: [] }, $inc: { __v: 1 } });
    assert.equal(options.session, session);
    return query({ modifiedCount: 1 });
  });
  return { user, cart, input, address, deduct, create, clear, replay };
}

test('money conversion is exact, bounded and respects configured precision', t => {
  assert.equal(toMinor(0.29, 2), 29);
  assert.equal(toMinor(1.005, 3), 1005);
  assert.equal(toMinor(1e-6, 6), 1);
  assert.equal(toMinor(1e3, 2), 100000);
  for (const value of [1.005, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => toMinor(value, 2), { statusCode: 400 });
  assert.throws(() => safeMoney(Number.MAX_SAFE_INTEGER + 1), { statusCode: 400 });
  t.mock.property(process, 'env', { ...process.env, STORE_CURRENCY_EXPONENT: '1.5' });
  assert.throws(storeMoney, /Invalid store currency/);
});

test('checkout snapshots prices, product and owned address and clears cart in one transaction', async t => {
  const f = fixture(t);
  const result = await orderService.checkout(f.user, f.input, key);
  assert.equal(result.replayed, false);
  assert.equal(result.order.grandTotalMinor, 1500);
  assert.equal(result.order.items[0].unitPriceMinor, 500);
  assert.equal(result.order.items[0].name, 'Book');
  assert.equal(result.order.items[0].sku, 'BOOK-1');
  assert.equal(result.order.shippingAddress.city, 'Cairo');
  assert.equal(result.order.currency, 'EGP');
  assert.equal(result.order.shippingMinor, 0);
  assert.equal(result.order.discountMinor, 0);
  assert.equal(result.order.taxMinor, 0);
  assert.equal(result.order.idempotencyKey, undefined);
  assert.equal(result.order.requestFingerprint, undefined);
  f.address.city = 'Changed';
  assert.equal(result.order.shippingAddress.city, 'Cairo');
  assert.equal(f.deduct.mock.callCount(), 1);
  assert.equal(f.clear.mock.callCount(), 1);
});

test('stale cart version rejects before stock writes', async t => {
  const f = fixture(t);
  await assert.rejects(orderService.checkout(f.user, { ...f.input, version: 1 }, key), { statusCode: 409 });
  assert.equal(f.deduct.mock.callCount(), 0);
});

test('missing or foreign address produces the same not found response', async t => {
  const f = fixture(t);
  UserModel.findOne = () => query(null);
  await assert.rejects(orderService.checkout(f.user, f.input, key), { statusCode: 404, message: 'Address not found' });
  assert.equal(f.deduct.mock.callCount(), 0);
});

test('price or stock mismatch aborts checkout', async t => {
  const f = fixture(t);
  ProductModel.findOneAndUpdate = () => query(null);
  await assert.rejects(orderService.checkout(f.user, f.input, key), { statusCode: 409 });
  assert.equal(f.create.mock.callCount(), 0);
  assert.equal(f.clear.mock.callCount(), 0);
});

test('cart write conflict aborts after order creation', async t => {
  const f = fixture(t);
  CartModel.updateOne = () => query({ modifiedCount: 0 });
  await assert.rejects(orderService.checkout(f.user, f.input, key), { statusCode: 409 });
});

test('invalid confirmation, key, address and extra fields are rejected', async t => {
  const f = fixture(t);
  for (const input of [
    { ...f.input, items: [...f.input.items, ...f.input.items] },
    { ...f.input, addressId: undefined }, { ...f.input, total: 1 },
    { ...f.input, items: [{ productId: f.input.items[0].productId, unitPrice: 5 }] },
  ]) await assert.rejects(orderService.checkout(f.user, input, key), { statusCode: 400 });
  await assert.rejects(orderService.checkout(f.user, f.input, 'short'), { statusCode: 400 });
  assert.equal(f.deduct.mock.callCount(), 0);
});

test('same key replays before touching cart/address and changed payload conflicts', async t => {
  const f = fixture(t);
  const result = await orderService.checkout(f.user, f.input, key);
  const persisted = new OrderModel({ ...result.order, idempotencyKey: key, requestFingerprint: checkoutFingerprint(f.input) });
  f.replay.mock.mockImplementation(() => query(persisted));
  CartModel.findOne = () => { throw new Error('Replay must not read cart'); };
  UserModel.findOne = () => { throw new Error('Replay must not read address'); };
  assert.equal((await orderService.checkout(f.user, f.input, key)).replayed, true);
  await assert.rejects(orderService.checkout(f.user, { ...f.input, version: 99 }, key), { statusCode: 409 });
});

test('fingerprint is independent of item order and ID case', () => {
  const first = { productId: 'AAAAAAAAAAAAAAAAAAAAAAAA', unitPriceMinor: 10 };
  const second = { productId: 'bbbbbbbbbbbbbbbbbbbbbbbb', unitPriceMinor: 20 };
  const base = { version: 1, addressId: 'CCCCCCCCCCCCCCCCCCCCCCCC', items: [first, second] };
  assert.equal(checkoutFingerprint(base), checkoutFingerprint({ ...base, items: [second, { ...first, productId: first.productId.toLowerCase() }] }));
});

test('unknown commits reconcile a winner or return an explicit uncertain outcome', async t => {
  const f = fixture(t);
  t.mock.method(mongoose.connection, 'transaction', async () => { throw { hasErrorLabel: label => label === 'UnknownTransactionCommitResult' }; });
  await assert.rejects(orderService.checkout(f.user, f.input, key), { statusCode: 503, message: 'Checkout outcome is uncertain; retry with the same Idempotency-Key' });
});

test('legacy DTO retains original amounts without inventing snapshots or currency', () => {
  const value = orderResponse(new OrderModel({ user: new mongoose.Types.ObjectId(), total: 15, items: [{ product: new mongoose.Types.ObjectId(), quantity: 3, unitPrice: 5 }] }));
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.total, 15);
  assert.equal(value.currency, null);
  assert.equal(value.shippingAddress, null);
  assert.equal(value.items[0].name, null);
});


test('concurrent duplicate-key and uncertain commit outcomes return the committed winner', async t => {
  const f = fixture(t);
  const first = await orderService.checkout(f.user, f.input, key);
  const persisted = new OrderModel({ ...first.order, idempotencyKey: key, requestFingerprint: checkoutFingerprint(f.input) });
  for (const failure of [{ code: 11000 }, { hasErrorLabel: label => label === 'UnknownTransactionCommitResult' }]) {
    let reads = 0;
    f.replay.mock.mockImplementation(() => query(++reads === 1 ? null : persisted));
    t.mock.method(mongoose.connection, 'transaction', async () => { throw failure; });
    const result = await orderService.checkout(f.user, f.input, key);
    assert.equal(result.replayed, true);
    assert.equal(String(result.order._id), String(first.order._id));
  }
});

test('empty carts, missing products, mismatched confirmations and unsafe totals fail without clearing', async t => {
  const f = fixture(t);
  const original = [...f.cart.items];
  f.cart.items = [];
  await assert.rejects(orderService.checkout(f.user, f.input, key), { statusCode: 400 });
  f.cart.items = original;
  const lookup = t.mock.method(ProductModel, 'findOne', () => query(null));
  await assert.rejects(orderService.checkout(f.user, f.input, key), { statusCode: 409 });
  lookup.mock.mockImplementation(() => query({ price: 6 }));
  await assert.rejects(orderService.checkout(f.user, f.input, key), { statusCode: 409 });
  lookup.mock.mockImplementation(() => query({ price: 50000000000000 }));
  t.mock.method(ProductModel, 'findOneAndUpdate', () => query({ name: 'Book', sku: 'BOOK-1' }));
  await assert.rejects(orderService.checkout(f.user, { ...f.input, items: [{ ...f.input.items[0], unitPriceMinor: 5000000000000000 }] }, key), { statusCode: 400 });
  assert.equal(f.clear.mock.callCount(), 0);
});

test('model rejects inconsistent monetary totals', async t => {
  const f = fixture(t);
  const { order } = await orderService.checkout(f.user, f.input, key);
  const valid = new OrderModel({ ...order, idempotencyKey: key, requestFingerprint: checkoutFingerprint(f.input) });
  await valid.validate();
  valid.grandTotalMinor++;
  await assert.rejects(valid.validate(), /totals are inconsistent/);
});
