const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Types } = require('mongoose');
const { categoryRepository: repo } = require('../dist/DB/repository/category.repository');
const { productRepository } = require('../dist/DB/repository/product.repository');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { categoryService: service } = require('../dist/Modules/category/category.service');
const token = require('../dist/Utils/security/token');
const { categoryRouter } = require('../dist/Modules/category/category.routes');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');
const { CategoryModel } = require('../dist/DB/models/category/category.model');

test('deletion child check includes inactive children', async t => {
  const parent = new Types.ObjectId();
  const exists = t.mock.method(CategoryModel, 'exists', filter => {
    assert.deepEqual(filter, { parent });
    return { exec: async () => ({ _id: new Types.ObjectId() }) };
  });
  assert.equal(await repo.hasChildCategories(parent), true);
  exists.mock.mockImplementation(() => ({ exec: async () => null }));
  assert.equal(await repo.hasChildCategories(parent), false);
});

test('management validates complete ancestry, duplicate slugs and deletion protection', async t => {
  t.mock.method(productRepository, 'existsProduct', async () => null);
  const root = { _id: new Types.ObjectId(), isActive: true };
  const child = { _id: new Types.ObjectId(), parent: root._id, isActive: true };
  const hidden = { _id: new Types.ObjectId(), isActive: false };
  const descendant = { _id: new Types.ObjectId(), parent: hidden._id, isActive: true };
  const orphan = { _id: new Types.ObjectId(), parent: new Types.ObjectId(), isActive: true };
  const cycle = { _id: new Types.ObjectId(), isActive: true };
  cycle.parent = cycle._id;
  const rows = [root, child, hidden, descendant, orphan, cycle];
  t.mock.method(repo, 'findCategoryById', async id => rows.find(r => r._id.equals(id)) ?? null);
  const create = t.mock.method(repo, 'createCategory', async data => data);
  const update = t.mock.method(repo, 'updateCategory', async (filter, data) => data);
  const input = { name: 'Books', slug: 'books', parent: child._id.toString() };
  const created = await service.createCategory(input, root._id);
  assert.ok(created.parent.equals(child._id));
  assert.ok(created.createdBy.equals(root._id));
  assert.deepEqual(await service.updateCategory(child._id.toString(), { parent: null, name: 'New name' }),
    { $set: { name: 'New name' }, $unset: { parent: 1 } });
  assert.ok((await service.updateCategory(child._id.toString(), { parent: root._id.toString() })).$set.parent.equals(root._id));
  for (const parent of [hidden, descendant, orphan, cycle, { _id: new Types.ObjectId() }]) {
    const statusCode = parent === orphan || !rows.includes(parent) ? 404 : 400;
    await assert.rejects(service.createCategory({ ...input, parent: parent._id.toString() }, root._id), { statusCode });
    await assert.rejects(service.updateCategory(child._id.toString(), { parent: parent._id.toString() }), { statusCode });
  }
  for (const parent of [root, child]) {
    await assert.rejects(service.updateCategory(root._id.toString(), { parent: parent._id.toString() }), { statusCode: 400 });
  }
  assert.equal(create.mock.callCount(), 1);
  assert.equal(update.mock.callCount(), 2);
  for (const method of ['createCategory', 'updateCategory']) {
    t.mock.method(repo, method, async () => { throw { code: 11000 }; });
  }
  await assert.rejects(service.createCategory(input, root._id), { statusCode: 409, message: 'A category with this slug already exists' });
  await assert.rejects(service.updateCategory(root._id.toString(), { slug: 'books' }), { statusCode: 409, message: 'A category with this slug already exists' });
  const children = t.mock.method(repo, 'hasChildCategories', async () => true);
  const remove = t.mock.method(repo, 'deleteCategory', async () => child);
  await assert.rejects(service.deleteCategory(root._id.toString()), { statusCode: 400 });
  assert.equal(remove.mock.callCount(), 0);
  children.mock.mockImplementation(async () => false);
  assert.equal(await service.deleteCategory(child._id.toString()), child);
  remove.mock.mockImplementation(async () => null);
  await assert.rejects(service.deleteCategory(child._id.toString()), { statusCode: 404 });
});

test('category deletion blocks assigned products of either status', async t => {
  const category = { _id: new Types.ObjectId() };
  t.mock.method(repo, 'findCategoryById', async () => category);
  t.mock.method(repo, 'hasChildCategories', async () => false);
  const remove = t.mock.method(repo, 'deleteCategory', async () => category);
  let assignedProduct;
  t.mock.method(ProductModel, 'exists', filter => {
    assert.deepEqual(filter, { category: category._id });
    return { exec: async () => assignedProduct ? { _id: assignedProduct._id } : null };
  });
  for (const isActive of [true, false]) {
    assignedProduct = { _id: new Types.ObjectId(), isActive };
    await assert.rejects(service.deleteCategory(category._id.toString()), {
      statusCode: 400,
      message: 'Cannot delete a category that has assigned products',
    });
    assert.equal(remove.mock.callCount(), 0);
  }
  assignedProduct = null;
  assert.equal(await service.deleteCategory(category._id.toString()), category);
  assert.equal(remove.mock.callCount(), 1);
});

test('category deletion stops if the product lookup fails', async t => {
  const category = { _id: new Types.ObjectId() };
  t.mock.method(repo, 'findCategoryById', async () => category);
  t.mock.method(repo, 'hasChildCategories', async () => false);
  const failure = new Error('Database unavailable');
  t.mock.method(productRepository, 'existsProduct', async () => { throw failure; });
  const remove = t.mock.method(repo, 'deleteCategory', async () => category);
  await assert.rejects(service.deleteCategory(category._id.toString()), error => error === failure);
  assert.equal(remove.mock.callCount(), 0);
});

test('management routes enforce real authorization middleware and input validation', async t => {
  const id = new Types.ObjectId();
  t.mock.method(token, 'decodedToken', async ({ authorization }) => ({ user: { _id: id, role: authorization }, decoded: {} }));
  const calls = [];
  for (const method of ['createCategory', 'updateCategory', 'deleteCategory', 'getCategories', 'getCategoryById']) {
    t.mock.method(service, method, async (...args) => { calls.push([method, ...args]); return {}; });
  }
  const app = express();
  app.use(express.json());
  app.use('/categories', categoryRouter);
  app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(method, path, role, body) {
    return fetch(`http://127.0.0.1:${server.address().port}/categories${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(role && { Authorization: role }) },
      ...(body && { body: JSON.stringify(body) }),
    });
  }
  for (const [method, path] of [['POST', '/'], ['PATCH', `/${id}`], ['DELETE', `/${id}`], ['GET', '/'], ['GET', `/${id}`]]) {
    assert.equal((await request(method, path)).status, 401);
    for (const role of ['user', 'guest']) assert.equal((await request(method, path, role)).status, 403);
  }
  assert.equal(calls.length, 0);
  for (const body of [{ name: ' ', slug: 'books' }, { name: 'Books', slug: 'bad slug' }, { name: 'Books', slug: 'books', parent: 'bad' }, { name: 'Books', slug: 'books', createdBy: id }]) {
    const res = await request('POST', '/', 'admin', body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, 'Validation Error');
  }
  assert.equal((await request('PATCH', `/${id}`, 'admin', {})).status, 400);
  assert.equal((await request('DELETE', '/bad-id', 'admin')).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request('POST', '/', 'admin', { name: ' Books ', slug: ' BOOKS ' })).status, 201);
  assert.deepEqual(calls[0].slice(1), [{ name: 'Books', slug: 'books' }, id]);
  assert.equal((await request('PATCH', `/${id}`, 'admin', { parent: null })).status, 200);
  assert.equal((await request('DELETE', `/${id}`, 'admin')).status, 200);
  assert.equal((await request('GET', '/', 'admin')).status, 200);
  assert.equal((await request('GET', `/${id}`, 'admin')).status, 200);
});
