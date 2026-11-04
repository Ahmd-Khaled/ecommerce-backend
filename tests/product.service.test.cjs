const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { productService: service } = require('../dist/Modules/product/product.service');
const { productRepository: repo } = require('../dist/DB/repository/product.repository');
const { categoryRepository } = require('../dist/DB/repository/category.repository');
const { ProductModel } = require('../dist/DB/models/product/product.model');

const id = new Types.ObjectId();
const input = { name: 'Sample', slug: 'sample', description: 'Sample product description', sku: 'SKU-001', price: 10, stock: 0, images: ['https://example.com/a.png'], category: id.toString() };

test('admin listing includes both statuses and counts the same filter', async t => {
  const products = [{ isActive: true }, { isActive: false }];
  t.mock.method(repo, 'findProducts', async (filter, options) => {
    assert.deepEqual(filter, {});
    assert.deepEqual(options, { skip: 0, limit: 20, sort: { createdAt: -1 } });
    return products;
  });
  t.mock.method(repo, 'countProducts', async filter => {
    assert.deepEqual(filter, {});
    return products.length;
  });
  const result = await service.getAdminProducts({});
  assert.deepEqual(result.products, products);
  assert.equal(result.pagination.total, 2);
});

test('creation maps editable fields and converts category IDs', async t => {
  t.mock.method(categoryRepository, 'findActiveCategoryById', async () => ({ _id: id }));
  t.mock.method(repo, 'createProduct', async data => data);
  const result = await service.createProduct({ ...input, compareAtPrice: undefined, injected: true }, id);
  assert.ok(result.category.equals(id));
  assert.equal(result.createdBy, id);
  assert.equal('compareAtPrice' in result, false);
  assert.equal('injected' in result, false);
});

test('updates validate effective prices and support explicit removal', async t => {
  t.mock.method(repo, 'findProductById', async () => ({ _id: id, price: 10, compareAtPrice: 20 }));
  const update = t.mock.method(repo, 'updateProduct', async (_, data) => data);
  await assert.rejects(service.updateProduct(id.toString(), { price: 25 }), { statusCode: 400 });
  assert.equal(update.mock.callCount(), 0);
  assert.deepEqual(await service.updateProduct(id.toString(), { price: 25, compareAtPrice: null }), {
    $set: { price: 25 }, $unset: { compareAtPrice: 1 },
  });
  assert.deepEqual(await service.updateProduct(id.toString(), { compareAtPrice: 30, name: undefined }), {
    $set: { compareAtPrice: 30, price: 10 },
  });
  update.mock.mockImplementation(async () => null);
  await assert.rejects(service.updateProduct(id.toString(), { stock: 0 }), { statusCode: 404 });
});

test('comparison price validator supports documents and update queries', async () => {
  const document = new ProductModel({ ...input, createdBy: id, compareAtPrice: 20 });
  await document.validate();
  const validator = ProductModel.schema.path('compareAtPrice').validators.find(v => v.type === 'user defined').validator;
  const query = ProductModel.findByIdAndUpdate(id, { $set: { price: 10, compareAtPrice: 20 } });
  assert.equal(validator.call(query, 20), true);
  assert.equal(validator.call(query, 5), false);
});

test('duplicate conflicts are translated and unrelated errors propagate', async t => {
  t.mock.method(categoryRepository, 'findActiveCategoryById', async () => ({ _id: id }));
  const create = t.mock.method(repo, 'createProduct', async () => { throw { code: 11000, keyPattern: { sku: 1 } }; });
  await assert.rejects(service.createProduct(input, id), { statusCode: 409, message: 'Product SKU already exists' });
  create.mock.mockImplementation(async () => { throw { code: 11000, keyPattern: { slug: 1 } }; });
  await assert.rejects(service.createProduct(input, id), { statusCode: 409, message: 'Product slug already exists' });
  const failure = new Error('Database unavailable');
  create.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(service.createProduct(input, id), error => error === failure);
});

test('invalid IDs and concurrent deletion return application errors', async t => {
  await assert.rejects(service.getProductById('invalid'), { statusCode: 400 });
  await assert.rejects(service.createProduct({ ...input, category: 'invalid' }, id), { statusCode: 400 });
  t.mock.method(repo, 'findProductById', async () => ({ _id: id }));
  t.mock.method(repo, 'deleteProduct', async () => null);
  await assert.rejects(service.deleteProduct(id.toString()), { statusCode: 404 });
});

test('listing preserves literal search, price filtering and pagination', async t => {
  t.mock.method(repo, 'findProducts', async (filter, options) => {
    assert.deepEqual(filter.price, { $gte: 5, $lte: 20 });
    assert.equal(filter.$or[0].name.$regex, 'a\\.b');
    assert.equal(filter.isActive, true);
    assert.deepEqual(options, { skip: 2, limit: 2, sort: { price: 1 } });
    return [];
  });
  t.mock.method(repo, 'countProducts', async () => 5);
  const result = await service.getProducts({ page: 2, limit: 2, search: ' a.b ', minPrice: 5, maxPrice: 20, sortBy: 'price', sortOrder: 'asc' });
  assert.deepEqual(result.pagination, { page: 2, limit: 2, total: 5, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
});
