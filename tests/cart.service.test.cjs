const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { cartService: service } = require('../dist/Modules/cart/cart.service');
const { cartRepository } = require('../dist/DB/repository/cart.repository');
const { productRepository } = require('../dist/DB/repository/product.repository');
const { adjustCartItemSchema } = require('../dist/Modules/cart/cart.validation');
const { validations } = require('../dist/Middlewares/validation.middlewares');

function fixture(t, quantity = 3, stock = 10) {
  const id = new Types.ObjectId();
  const user = new Types.ObjectId();
  const product = { _id: id, isActive: true, stock, price: 5 };
  const save = t.mock.fn(async () => {});
  const cart = { __v: 0, items: [{ product: id, quantity }], save };
  t.mock.method(cartRepository, 'findCartByUser', async actualUser => {
    assert.equal(actualUser, user);
    return cart;
  });
  t.mock.method(productRepository, 'findProductById', async () => product);
  return { id: id.toString(), user, product, cart, save };
}

test('adjustment validation defaults missing quantity and rejects invalid bodies', () => {
  for (const body of [undefined, {}]) {
    const req = { body };
    validations({ body: adjustCartItemSchema })(req, {}, () => {});
    assert.deepEqual(req.body, { quantity: 1 });
  }
  for (const quantity of [0, -1, 1.5, 101, '2', null]) {
    assert.equal(adjustCartItemSchema.safeParse({ quantity }).success, false);
  }
  assert.equal(adjustCartItemSchema.safeParse({ extra: 1 }).success, false);
});

for (const [method, direction] of [['increaseCartItem', 1], ['decreaseCartItem', -1]]) {
  test(`${method} adjusts existing quantity and recalculates totals`, async t => {
    const f = fixture(t, 5);
    const result = await service[method](f.user, f.id, { quantity: 2 });
    assert.equal(result.items[0].quantity, 5 + direction * 2);
    assert.equal(result.totalItems, 5 + direction * 2);
    assert.equal(result.subtotal, (5 + direction * 2) * 5);
    assert.equal(f.save.mock.callCount(), 1);
  });

  test(`${method} defaults to one`, async t => {
    const f = fixture(t);
    const result = await service[method](f.user, f.id);
    assert.equal(result.totalItems, 3 + direction);
  });

  test(`${method} enforces availability and resulting stock before saving`, async t => {
    const f = fixture(t, 5, 2);
    if (direction < 0) {
      f.product.isActive = false;
      assert.equal((await service[method](f.user, f.id)).totalItems, 4);
      return;
    }
    await assert.rejects(service[method](f.user, f.id), { statusCode: 400 });
    f.product.stock = 0;
    await assert.rejects(service[method](f.user, f.id), { message: 'Product is out of stock' });
    f.product.isActive = false;
    await assert.rejects(service[method](f.user, f.id), { statusCode: 404 });
    assert.equal(f.cart.items[0].quantity, 5);
    assert.equal(f.save.mock.callCount(), 0);
  });

  test(`${method} requires an existing cart item`, async t => {
    const f = fixture(t);
    f.cart.items = [];
    await assert.rejects(service[method](f.user, f.id), { message: 'Product not found in cart' });
    cartRepository.findCartByUser = async () => null;
    await assert.rejects(service[method](f.user, f.id), { message: 'Cart not found' });
    assert.equal(f.save.mock.callCount(), 0);
  });
}

for (const quantity of [undefined, 1, 2]) {
  test(`decrease removes an item at quantity one with adjustment ${quantity}`, async t => {
    const f = fixture(t, 1);
    const otherId = new Types.ObjectId();
    f.cart.items.push({ product: otherId, quantity: 3 });
    const result = await service.decreaseCartItem(
      f.user, f.id, quantity === undefined ? undefined : { quantity },
    );
    assert.equal(f.cart.items.length, 1);
    assert.equal(f.cart.items[0].product, otherId);
    assert.equal(result.totalItems, 3);
    assert.equal(result.subtotal, 15);
    assert.equal(f.save.mock.callCount(), 1);
  });
}

test('decrease removes the last item even when stock is zero', async t => {
  const f = fixture(t, 1, 0);
  const result = await service.decreaseCartItem(f.user, f.id);
  assert.deepEqual(result, { items: [], totalItems: 0, subtotal: 0, version: 0 });
  assert.equal(f.save.mock.callCount(), 1);
});

test('decrease still rejects zero and negative results when current quantity exceeds one', async t => {
  const f = fixture(t, 2);
  for (const quantity of [2, 3]) {
    await assert.rejects(service.decreaseCartItem(f.user, f.id, { quantity }), {
      statusCode: 400, message: 'Quantity must be at least 1',
    });
  }
  assert.equal(f.cart.items[0].quantity, 2);
  assert.equal(f.save.mock.callCount(), 0);
});

test('increase permits exactly available stock', async t => {
  const f = fixture(t, 9, 10);
  assert.equal((await service.increaseCartItem(f.user, f.id)).totalItems, 10);
});

test('existing update still replaces the quantity', async t => {
  const f = fixture(t, 5);
  assert.equal((await service.updateCartItem(f.user, f.id, { quantity: 2 })).totalItems, 2);
});


test('unavailable items stay visible without exposing inactive product details', async t => {
  const f = fixture(t);
  f.product.isActive = false;
  const result = await service.getCart(f.user);
  assert.equal(result.items[0].available, false);
  assert.deepEqual(Object.keys(result.items[0].product), ['_id']);
  assert.equal(result.subtotal, 0);
  productRepository.findProductById = async () => null;
  assert.equal((await service.removeCartItem(f.user, f.id)).totalItems, 0);
});

test('configured limits apply to cumulative quantities and distinct items', async t => {
  const f = fixture(t, 3, 100);
  t.mock.property(process, 'env', { ...process.env, CART_MAX_QUANTITY: '3', CART_MAX_ITEMS: '1' });
  await assert.rejects(service.addCartItem(f.user, { productId: f.id, quantity: 1 }), { statusCode: 400 });
  f.product._id = new Types.ObjectId();
  await assert.rejects(service.addCartItem(f.user, { productId: f.product._id.toString(), quantity: 1 }), { message: 'Cart item limit reached' });
  assert.equal(f.save.mock.callCount(), 0);
});

test('version conflicts re-read state before applying relative changes', async t => {
  const { Error: MongooseError } = require('mongoose');
  const f = fixture(t, 3);
  const fresh = { __v: 1, items: [{ product: new Types.ObjectId(f.id), quantity: 5 }], save: async () => {} };
  let reads = 0;
  cartRepository.findCartByUser = async () => reads++ === 0 ? f.cart : fresh;
  f.cart.save = async () => { throw new MongooseError.VersionError({ _doc: { _id: f.id } }, 0, ['items']); };
  assert.equal((await service.increaseCartItem(f.user, f.id)).totalItems, 6);
  assert.equal(reads, 2);
});

test('persistent version conflicts return 409 after bounded retries', async t => {
  const { Error: MongooseError } = require('mongoose');
  const f = fixture(t);
  let reads = 0;
  cartRepository.findCartByUser = async () => {
    reads++;
    return { __v: 0, items: [], save: async () => { throw new MongooseError.VersionError({ _doc: { _id: f.id } }, 0, ['items']); } };
  };
  await assert.rejects(service.clearCart(f.user), { statusCode: 409 });
  assert.equal(reads, 3);
});

test('ambiguous write errors are not retried', async t => {
  const f = fixture(t);
  const error = new Error('connection lost');
  f.cart.save = t.mock.fn(async () => { throw error; });
  await assert.rejects(service.increaseCartItem(f.user, f.id), error);
  assert.equal(f.cart.save.mock.callCount(), 1);
});

test('cart creation recovers the winner of a unique-index race', async t => {
  const { CartModel } = require('../dist/DB/models/cart/cart.model');
  const f = fixture(t);
  t.mock.method(CartModel, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.user, f.user);
    assert.equal(options.upsert, true);
    assert.deepEqual(update.$setOnInsert.items, []);
    return { exec: async () => { throw { code: 11000 }; } };
  });
  assert.equal(await cartRepository.createCart(f.user), f.cart);
});

test('cart model enables atomic version checks and cart adds never change stock', async t => {
  const { CartModel } = require('../dist/DB/models/cart/cart.model');
  assert.equal(CartModel.schema.options.optimisticConcurrency, true);
  const f = fixture(t);
  await service.addCartItem(f.user, { productId: f.id, quantity: 1 });
  assert.equal(f.product.stock, 10);
});
