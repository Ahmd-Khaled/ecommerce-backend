const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { wishlistService } = require('../dist/Modules/wishlist/wishlist.service');
const { wishlistRepository } = require('../dist/DB/repository/wishlist.repository');
const { productRepository } = require('../dist/DB/repository/product.repository');

const user = new Types.ObjectId();
const product = new Types.ObjectId();

test('add is idempotent and capacity rejection does not mutate items', async t => {
  t.mock.method(productRepository, 'existsProduct', async () => ({ _id: product }));
  t.mock.method(wishlistRepository, 'has', async () => true);
  const reserve = t.mock.method(wishlistRepository, 'reserve', async () => null);
  assert.deepEqual(await wishlistService.add(user, product.toString()), { isFavorited: true, added: false });
  assert.equal(reserve.mock.callCount(), 0);
});

test('add reserves, inserts once, and releases capacity after duplicate race', async t => {
  t.mock.method(productRepository, 'existsProduct', async () => ({ _id: product }));
  t.mock.method(wishlistRepository, 'has', async () => false);
  t.mock.method(wishlistRepository, 'reserve', async () => ({ itemCount: 1 }));
  t.mock.method(wishlistRepository, 'insert', async () => false);
  const release = t.mock.method(wishlistRepository, 'release', async () => {});
  assert.deepEqual(await wishlistService.add(user, product.toString()), { isFavorited: true, added: false });
  assert.equal(release.mock.callCount(), 1);
});

test('list skips archived references, advances cursor, and returns whitelisted current products', async t => {
  const first = { _id: new Types.ObjectId(), user, product: new Types.ObjectId(), addedAt: new Date('2026-01-02T00:00:00.000Z') };
  const second = { _id: new Types.ObjectId(), user, product: new Types.ObjectId(), addedAt: new Date('2026-01-01T00:00:00.000Z') };
  const page = t.mock.method(wishlistRepository, 'pageRows', async () => [first, second]);
  t.mock.method(productRepository, 'findProducts', async () => [{ _id: second.product, name: 'Active', slug: 'active', description: 'Current details', price: 3, stock: 2, images: [], category: product, isActive: true, ratingsCount: 0, secret: 'omit' }]);
  const result = await wishlistService.list(user, { limit: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Active');
  assert.equal('secret' in result.items[0], false);
  assert.equal(result.pagination.hasNextPage, false);
  assert.equal(page.mock.callCount(), 1);
});

test('malformed cursors and product IDs are rejected', async () => {
  await assert.rejects(wishlistService.list(user, { limit: 20, after: 'bad!' }), { statusCode: 400 });
  await assert.rejects(wishlistService.remove(user, 'bad'), { statusCode: 400 });
});
