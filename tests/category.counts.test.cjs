const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { categoryService: service } = require('../dist/Modules/category/category.service');
const { categoryRepository: categories } = require('../dist/DB/repository/category.repository');
const { productRepository: products } = require('../dist/DB/repository/product.repository');
const { ProductModel } = require('../dist/DB/models/product/product.model');

test('category product aggregation filters active products only for public counts', async t => {
  const aggregate = t.mock.method(ProductModel, 'aggregate', pipeline => ({ exec: async () => pipeline }));
  for (const activeOnly of [true, false]) {
    const pipeline = await products.countProductsByCategory(activeOnly);
    assert.deepEqual(pipeline, [
      { $match: activeOnly ? { isActive: true } : {} },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
  }
  assert.equal(aggregate.mock.callCount(), 2);
});

test('category lists, details and trees count direct products and all visible descendants', async t => {
  const root = { _id: new Types.ObjectId(), name: 'Root', isActive: true };
  const child = { _id: new Types.ObjectId(), parent: root._id, isActive: true };
  const grandchild = { _id: new Types.ObjectId(), parent: child._id, isActive: true };
  const hidden = { _id: new Types.ObjectId(), parent: root._id, isActive: false };
  const hiddenChild = { _id: new Types.ObjectId(), parent: hidden._id, isActive: true };
  const empty = { _id: new Types.ObjectId(), isActive: true };
  const rows = [root, child, grandchild, hidden, hiddenChild, empty];
  t.mock.method(categories, 'findCategories', async () => rows);
  t.mock.method(categories, 'findAllActiveCategories', async () => rows.filter(row => row.isActive));
  t.mock.method(categories, 'findCategoryById', async id => rows.find(row => row._id.equals(id)));
  t.mock.method(categories, 'findCategoryBySlug', async () => root);
  const pagination = { page: 1, limit: 1, total: 4, totalPages: 4 };
  t.mock.method(categories, 'findPublicCategories', async () => ({ categories: [root], pagination }));
  t.mock.method(products, 'countProductsByCategory', async activeOnly => [
    { _id: root._id, count: activeOnly ? 2 : 3 },
    { _id: child._id, count: activeOnly ? 4 : 5 },
    { _id: grandchild._id, count: 6 },
    { _id: hidden._id, count: 7 },
    { _id: hiddenChild._id, count: 8 },
  ]);
  const admin = await service.getCategories();
  assert.equal(admin[0].productCount, 3);
  assert.equal(admin[0].totalProductCount, 29);
  assert.equal(admin[1].totalProductCount, 11);
  assert.equal(admin[5].productCount, 0);
  assert.equal(admin[5].totalProductCount, 0);
  const detail = await service.getCategoryById(root._id.toString(), true);
  assert.equal(detail.totalProductCount, 29);
  const publicDetail = await service.getCategoryBySlug('root');
  assert.equal(publicDetail.productCount, 2);
  assert.equal(publicDetail.totalProductCount, 12);
  const list = await service.getPublicCategories({ page: 1, limit: 1, sortBy: 'name', sortOrder: 'asc' });
  assert.deepEqual(list.pagination, pagination);
  assert.equal(list.categories[0].totalProductCount, 12);
  const tree = await service.getCategoryTreeById(root._id.toString());
  assert.equal(tree.totalProductCount, 12);
  assert.equal(tree.children[0].totalProductCount, 10);
  assert.equal(tree.children[0].children[0].productCount, 6);
});
