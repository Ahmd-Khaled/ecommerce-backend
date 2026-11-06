const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { CartModel } = require('../dist/DB/models/cart/cart.model');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { OrderModel } = require('../dist/DB/models/order/order.model');
const { cartService } = require('../dist/Modules/cart/cart.service');
const { orderService } = require('../dist/Modules/order/order.service');

// Explicit test URI only; never use the application's MONGO_URI.
test('real MongoDB concurrency and transaction guarantees', { skip: !process.env.MONGO_TEST_URI }, async t => {
  t.after(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await mongoose.connect(process.env.MONGO_TEST_URI, {
    dbName: `cart_test_${new mongoose.Types.ObjectId()}`, serverSelectionTimeoutMS: 5000,
  });

  await Promise.all([CartModel.init(), ProductModel.init(), OrderModel.init()]);
  const user = () => new mongoose.Types.ObjectId();
  const product = async (stock = 10) => {
    const id = new mongoose.Types.ObjectId();
    // Minimal database fixture bypasses unrelated catalog validation.
    await ProductModel.collection.insertOne({ _id: id, slug: id.toString(), sku: id.toString(), price: 5, stock, isActive: true });
    return id;
  };
  const checkout = async owner => {
    const cart = await CartModel.findOne({ user: owner });
    return { version: cart.__v, items: cart.items.map(item => ({ productId: item.product.toString(), unitPrice: 5 })) };
  };

  await t.test('concurrent creation produces one cart and retains both additions', async () => {
    const owner = user(), id = await product();
    await Promise.all([1, 2].map(() => cartService.addCartItem(owner, { productId: id.toString(), quantity: 1 })));
    assert.equal(await CartModel.countDocuments({ user: owner }), 1);
    assert.equal((await CartModel.findOne({ user: owner })).items[0].quantity, 2);
    assert.equal((await ProductModel.findById(id)).stock, 10);
  });

  await t.test('parallel relative mutations do not lose increments', async () => {
    const owner = user(), id = await product();
    await cartService.addCartItem(owner, { productId: id.toString(), quantity: 1 });
    await Promise.all([1, 2].map(() => cartService.increaseCartItem(owner, id.toString())));
    assert.equal((await CartModel.findOne({ user: owner })).items[0].quantity, 3);
  });

  await t.test('two checkouts cannot oversell the last unit', async () => {
    const owners = [user(), user()], id = await product(1);
    for (const owner of owners) await cartService.addCartItem(owner, { productId: id.toString(), quantity: 1 });
    const inputs = await Promise.all(owners.map(checkout));
    const results = await Promise.allSettled(owners.map((owner, i) => orderService.checkout(owner, inputs[i])));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await ProductModel.findById(id)).stock, 0);
    assert.equal(await OrderModel.countDocuments({ user: { $in: owners } }), 1);
    assert.equal(await CartModel.countDocuments({ user: { $in: owners }, 'items.0': { $exists: true } }), 1);
  });

  await t.test('late price failure rolls back earlier deductions and leaves cart intact', async () => {
    const owner = user(), first = await product(), second = await product();
    for (const id of [first, second]) await cartService.addCartItem(owner, { productId: id.toString(), quantity: 2 });
    const input = await checkout(owner);
    await ProductModel.collection.updateOne({ _id: second }, { $set: { price: 6 } });
    await assert.rejects(orderService.checkout(owner, input), { statusCode: 409 });
    assert.equal((await ProductModel.findById(first)).stock, 10);
    assert.equal((await CartModel.findOne({ user: owner })).items.length, 2);
    assert.equal(await OrderModel.countDocuments({ user: owner }), 0);
  });

  await t.test('duplicate checkout and stale versions cannot deduct twice', async () => {
    const owner = user(), id = await product();
    await cartService.addCartItem(owner, { productId: id.toString(), quantity: 1 });
    const input = await checkout(owner);
    const results = await Promise.allSettled([1, 2].map(() => orderService.checkout(owner, input)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await ProductModel.findById(id)).stock, 9);
    assert.equal(await OrderModel.countDocuments({ user: owner }), 1);
  });

  await t.test('concurrent distinct additions respect the configured line limit', async t => {
    t.mock.property(process, 'env', { ...process.env, CART_MAX_ITEMS: '1' });
    const owner = user(), ids = [await product(), await product()];
    const results = await Promise.allSettled(ids.map(id => cartService.addCartItem(owner, { productId: id.toString(), quantity: 1 })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await CartModel.findOne({ user: owner })).items.length, 1);
  });

  await t.test('cart mutations invalidate a previously reviewed checkout', async () => {
    const owner = user(), id = await product();
    await cartService.addCartItem(owner, { productId: id.toString(), quantity: 1 });
    const input = await checkout(owner);
    await cartService.increaseCartItem(owner, id.toString());
    await assert.rejects(orderService.checkout(owner, input), { statusCode: 409 });
    assert.equal((await ProductModel.findById(id)).stock, 10);
    assert.equal((await CartModel.findOne({ user: owner })).items[0].quantity, 2);
  });
});
