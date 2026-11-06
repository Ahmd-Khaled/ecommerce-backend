const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { CartModel } = require('../dist/DB/models/cart/cart.model');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { OrderModel } = require('../dist/DB/models/order/order.model');
const { orderService } = require('../dist/Modules/order/order.service');

function fixture(t) {
  const user = new mongoose.Types.ObjectId();
  const product = new mongoose.Types.ObjectId();
  const session = {};
  const cart = { _id: new mongoose.Types.ObjectId(), __v: 2, items: [{ product, quantity: 3 }] };
  const input = { version: 2, items: [{ productId: product.toString(), unitPrice: 5 }] };
  t.mock.method(mongoose.connection, 'transaction', async fn => fn(session));
  t.mock.method(CartModel, 'findOne', filter => {
    assert.equal(filter.user, user);
    return { session: actual => { assert.equal(actual, session); return { exec: async () => cart }; } };
  });
  const deduct = t.mock.method(ProductModel, 'findOneAndUpdate', (filter, update, options) => {
    assert.deepEqual(filter, { _id: product, isActive: true, price: 5, stock: { $gte: 3 } });
    assert.deepEqual(update, { $inc: { stock: -3 } });
    assert.equal(options.session, session);
    return { exec: async () => ({ price: 5 }) };
  });
  const create = t.mock.method(OrderModel, 'create', async (orders, options) => {
    assert.equal(options.session, session);
    return orders;
  });
  const clear = t.mock.method(CartModel, 'updateOne', (filter, update, options) => {
    assert.deepEqual(filter, { _id: cart._id, __v: 2 });
    assert.deepEqual(update, { $set: { items: [] }, $inc: { __v: 1 } });
    assert.equal(options.session, session);
    return { exec: async () => ({ modifiedCount: 1 }) };
  });
  return { user, cart, input, deduct, create, clear };
}

test('checkout guards inventory, snapshots current prices and clears the versioned cart in one transaction', async t => {
  const f = fixture(t);
  const order = await orderService.checkout(f.user, f.input);
  assert.equal(order.total, 15);
  assert.equal(order.items[0].unitPrice, 5);
  assert.equal(f.deduct.mock.callCount(), 1);
  assert.equal(f.clear.mock.callCount(), 1);
});

test('stale cart version is rejected before stock writes', async t => {
  const f = fixture(t);
  f.input.version = 1;
  await assert.rejects(orderService.checkout(f.user, f.input), { statusCode: 409 });
  assert.equal(f.deduct.mock.callCount(), 0);
});

test('price, availability or stock mismatch aborts checkout', async t => {
  const f = fixture(t);
  ProductModel.findOneAndUpdate = () => ({ exec: async () => null });
  await assert.rejects(orderService.checkout(f.user, f.input), { statusCode: 409 });
  assert.equal(f.create.mock.callCount(), 0);
  assert.equal(f.clear.mock.callCount(), 0);
});

test('cart write conflict aborts transaction after order creation', async t => {
  const f = fixture(t);
  CartModel.updateOne = () => ({ exec: async () => ({ modifiedCount: 0 }) });
  await assert.rejects(orderService.checkout(f.user, f.input), { statusCode: 409 });
});

test('duplicate or missing price confirmations cannot purchase a different cart', async t => {
  const f = fixture(t);
  f.input.items.push(f.input.items[0]);
  await assert.rejects(orderService.checkout(f.user, f.input), { statusCode: 409 });
  assert.equal(f.deduct.mock.callCount(), 0);
});
