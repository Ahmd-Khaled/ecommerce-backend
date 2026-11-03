const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Types } = require('mongoose');
const { CategoryModel } = require('../dist/DB/models/category/category.model');
const { categoryRouter } = require('../dist/Modules/category/category.routes');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');

test('public categories enforce visibility, filters, pagination and validation', async () => {
  const root = new Types.ObjectId();
  const hidden = new Types.ObjectId();
  const rows = [
    { _id: root, name: 'Books', slug: 'books', isActive: true, sortOrder: 0 },
    { _id: hidden, name: 'Hidden', slug: 'hidden', isActive: false, sortOrder: 0 },
    { _id: new Types.ObjectId(), name: 'Books.*', slug: 'special', parent: root, isActive: true, sortOrder: 1 },
    { _id: new Types.ObjectId(), name: 'Hidden child', slug: 'hidden-child', parent: root, isActive: false, sortOrder: 2 },
  ];
  function matches(row, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (value && '$exists' in Object(value)) return (row[key] !== undefined) === value.$exists;
      if (value && '$regex' in Object(value)) return new RegExp(value.$regex, value.$options).test(row[key]);
      return String(row[key]) === String(value);
    });
  }
  const patches = [
    mock.method(CategoryModel, 'find', filter => {
      // Every public collection query must enforce visibility in MongoDB.
      assert.equal(filter.isActive, true);
      let result = rows.filter(row => matches(row, filter));
      const query = {
        sort(order) {
          result.sort((a, b) => {
            for (const [key, direction] of Object.entries(order)) {
              if (a[key] < b[key]) return -direction;
              if (a[key] > b[key]) return direction;
            }
            return 0;
          });
          return query;
        },
        skip(n) { result = result.slice(n); return query; },
        limit(n) { result = result.slice(0, n); return query; },
        async exec() { return result; },
      };
      return query;
    }),
    mock.method(CategoryModel, 'countDocuments', filter => {
      assert.equal(filter.isActive, true);
      return { exec: async () => rows.filter(row => matches(row, filter)).length };
    }),
    mock.method(CategoryModel, 'findOne', filter => {
      assert.equal(filter.isActive, true);
      return { exec: async () => rows.find(row => matches(row, filter)) ?? null };
    }),
    mock.method(CategoryModel, 'findById', id => ({ exec: async () => rows.find(row => row._id.equals(id)) ?? null })),
  ];
  const app = express();
  app.use('/categories', categoryRouter);
  app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function get(path, status = 200) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/categories${path}`);
    assert.equal(res.status, status, path);
    return res.json();
  }
  try {
    for (const path of ['/list', '/active']) {
      const result = await get(path);
      assert.equal(result.data.categories.length, 2);
      assert.equal(result.data.pagination.total, 2);
      assert.ok(result.data.categories.every(row => row.isActive));
    }
    assert.equal((await get('/root')).data.categories.length, 1);
    assert.equal((await get(`/${root}/children`)).data.categories.length, 1);
    await get(`/${hidden}/children`, 404);
    await get(`/list?parent=${hidden}`, 404);
    await get('/slug/hidden', 404);
    assert.equal((await get('/slug/books')).data.category.slug, 'books');
    assert.equal((await get('/list?parent=root')).data.categories.length, 1);
    assert.equal((await get(`/list?parent=${root}`)).data.categories[0].slug, 'special');
    assert.equal((await get('/list?search=Books.*')).data.categories.length, 1);
    assert.equal((await get('/list?slug=BOOKS')).data.categories[0].slug, 'books');
    const paged = await get('/list?limit=1&page=2&sortBy=name&sortOrder=asc');
    assert.equal(paged.data.categories[0].slug, 'special');
    assert.deepEqual(paged.data.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
    assert.equal((await get('/list?page=3&limit=1')).data.categories.length, 0);
    for (const query of ['isActive=false', 'limit=101', 'page=0', 'sortBy=password', 'parent=invalid', 'search[$ne]=x', 'limit=1&limit=2']) {
      await get(`/list?${query}`, 400);
    }
    await get('/root?parent=root', 400);
    await get(`/${root}/children?isActive=false`, 400);
    await get('/active?isActive=false', 400);
    await get('/', 401);
    await get(`/${hidden}`, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    patches.forEach(patch => patch.mock.restore());
  }
});
