const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { Types } = require('mongoose');
const token = require('../dist/Utils/security/token');
const { activeUploads } = require('../dist/Utils/storage/upload.cleanup');
const { storageService } = require('../dist/Utils/storage/storage.service');
const { categoryRouter } = require('../dist/Modules/category/category.routes');
const { productRouter } = require('../dist/Modules/product/product.routes');
const { authRouter } = require('../dist/Modules/auth/auth.routes');
const { categoryService } = require('../dist/Modules/category/category.service');
const { productService } = require('../dist/Modules/product/product.service');
const { authService } = require('../dist/Modules/auth/auth.service');
const { categoryRepository } = require('../dist/DB/repository/category.repository');
const { productRepository } = require('../dist/DB/repository/product.repository');
const { userRepository } = require('../dist/DB/repository/user.repository');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');

test('module routes authenticate before uploads and pass record IDs, typed body, and media snapshot to services', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ecommerce-upload-routes-'));
  process.env.STORAGE_ROOT = root;
  process.env.STORAGE_PUBLIC_URL = 'https://assets.example.test/media';
  const id = new Types.ObjectId();
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  t.mock.method(token, 'decodedToken', async ({ authorization }) => ({ user: { _id: id, role: authorization }, decoded: {} }));
  const lookup = t.mock.method(storageService, 'owner', async () => ({ value: 'old' }));
  const calls = [];
  for (const [service, method] of [[categoryService, 'createCategory'], [categoryService, 'updateCategory'], [productService, 'createProduct'], [authService, 'updateProfile']]) {
    t.mock.method(service, method, async (...args) => { calls.push([method, ...args]); return {}; });
  }
  const app = express(); app.use(express.json());
  app.use('/categories', categoryRouter); app.use('/products', productRouter); app.use('/auth', authRouter); app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (let i = 0; i < 100 && activeUploads.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(activeUploads.size, 0);
    assert.ok(path.basename(root).startsWith('ecommerce-upload-routes-'));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const request = (route, form, role = 'admin', method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method, headers: role ? { authorization: role } : {}, body: form,
  });
  const form = (field, values) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(values)) body.append(key, value);
    body.append(field, new Blob([png], { type: 'image/png' }), 'image.png');
    return body;
  };
  for (const role of [undefined, 'user', 'guest']) {
    const response = await request('/categories', form('image', { name: 'Books', slug: 'books' }), role ?? '');
    assert.equal(response.status, role ? 403 : 401);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal((await fs.readdir(root)).length, 0);
  assert.equal((await request('/categories', form('image', { name: 'Books', slug: 'books' }))).status, 201);
  const create = calls.shift();
  assert.equal(create[0], 'createCategory');
  assert.equal(create[2], id);
  assert.ok(create[3] instanceof Types.ObjectId);
  assert.ok(create[1].image.includes(`/categories/${create[3]}/image/`));
  assert.equal((await request(`/categories/${id}`, form('image', { parent: 'null', isActive: 'false' }), 'admin', 'PATCH')).status, 200);
  const update = calls.shift();
  assert.equal(update[1], id.toString()); assert.equal(update[2].isActive, false); assert.equal(update[2].parent, null);
  assert.deepEqual(update[3], { value: 'old' });
  assert.equal((await request('/auth/profile', form('avatar', { firstName: 'Ahmed' }), 'user', 'PATCH')).status, 200);
  const profile = calls.shift();
  assert.equal(profile[1], id); assert.ok(profile[2].avatar.includes(`/users/${id}/avatar/`));
  assert.equal((await request('/products', form('images', { name: 'Camera', slug: 'camera', description: 'Camera description', sku: 'CAM-123', price: '10', category: id.toString() }))).status, 201);
  const product = calls.shift(); assert.equal(product[1].price, 10); assert.ok(product[1].images[0].includes(`/products/${product[3]}/images/`));
  const beforeInvalid = lookup.mock.callCount();
  assert.equal((await request('/categories/invalid', form('image', {}), 'admin', 'PATCH')).status, 400);
  assert.equal(lookup.mock.callCount(), beforeInvalid);
});

test('create services persist the preallocated upload owner ID', async t => {
  const id = new Types.ObjectId(); const owner = new Types.ObjectId();
  t.mock.method(categoryRepository, 'withHierarchyTransaction', async work => work(undefined));
  t.mock.method(categoryRepository, 'createCategory', async data => data);
  t.mock.method(categoryRepository, 'findActiveCategoryById', async () => ({ _id: owner }));
  t.mock.method(productRepository, 'createProduct', async data => data);
  assert.equal((await categoryService.createCategory({ name: 'Books', slug: 'books' }, owner, id))._id, id);
  const product = await productService.createProduct({ name: 'Camera', slug: 'camera', description: 'Camera description', sku: 'CAM-123', price: 10, stock: 1, images: ['https://example.test/a.png'], category: owner.toString() }, owner, id);
  assert.equal(product._id, id);
});

test('product replacement uses atomic comparison and rejects a losing concurrent update', async t => {
  const id = new Types.ObjectId();
  t.mock.method(productRepository, 'findProductById', async () => ({ _id: id, price: 10, images: ['old'] }));
  const captured = [];
  t.mock.method(ProductModel, 'findOneAndUpdate', (filter, update) => {
    captured.push(filter);
    return { exec: async () => captured.length === 1 ? { ...update.$set } : null };
  });
  const input = { images: ['new'] }; const snapshot = { value: ['old'] };
  await productService.updateProduct(id.toString(), input, snapshot);
  await assert.rejects(productService.updateProduct(id.toString(), input, snapshot), { statusCode: 409 });
  assert.deepEqual(captured[0].images, ['old']);
});

test('category/avatar replacements reject stale snapshots and avatar save races', async t => {
  const id = new Types.ObjectId();
  t.mock.method(categoryRepository, 'withHierarchyTransaction', async work => work(undefined));
  t.mock.method(categoryRepository, 'findCategoryById', async () => ({ _id: id, image: 'winner' }));
  await assert.rejects(categoryService.updateCategory(id.toString(), { image: 'loser' }, { value: 'old' }), { statusCode: 409 });
  const user = { _id: id, avatar: 'winner', save: async () => {}, set() {} };
  t.mock.method(userRepository, 'findUserById', async () => user);
  await assert.rejects(authService.updateProfile(id, { avatar: 'loser' }, { value: 'old' }), { statusCode: 409 });
  user.save = async () => { assert.equal(user.$where.avatar, 'winner'); throw Object.assign(new Error('Race'), { name: 'DocumentNotFoundError' }); };
  await assert.rejects(authService.updateProfile(id, { avatar: 'loser' }, { value: 'winner' }), { statusCode: 409 });
});
