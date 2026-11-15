const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { CategoryModel } = require('../dist/DB/models/category/category.model');
const { OrderModel } = require('../dist/DB/models/order/order.model');
const { BannerModel } = require('../dist/DB/models/banner/banner.model');
const { UserModel } = require('../dist/DB/models/user/user.model');
const { homeRepository } = require('../dist/DB/repository/home.repository');
const { reportingRepository } = require('../dist/DB/repository/reporting.repository');
const { dashboardService } = require('../dist/Modules/dashboard/dashboard.service');
const { bannerService, publicBannerFilter } = require('../dist/Modules/banner/banner.service');
const { bannerRepository } = require('../dist/DB/repository/banner.repository');
const { homeRouter } = require('../dist/Modules/home/home.routes');
const { bannerRouter } = require('../dist/Modules/banner/banner.routes');
const { dashboardRouter } = require('../dist/Modules/dashboard/dashboard.routes');
const { languageMiddleware } = require('../dist/Middlewares/language.middlewares');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');
const { mediaRouter } = require('../dist/Utils/storage/storage.service');
const { reconcileUploads, activeUploads } = require('../dist/Utils/storage/upload.cleanup');
const { safePath } = require('../dist/Utils/storage/local.storage');

test('homepage, dashboard and banners on real MongoDB', { skip: !process.env.MONGO_TEST_URI }, async t => {
  const dbName = 'home_dashboard_test_' + new mongoose.Types.ObjectId();
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ecommerce-banner-tests-'));
  const oldStorage = process.env.STORAGE_ROOT, oldUrl = process.env.STORAGE_PUBLIC_URL;
  process.env.STORAGE_ROOT = storageRoot;
  process.env.STORAGE_PUBLIC_URL = 'https://assets.example.test/media';
  const actor = new mongoose.Types.ObjectId();
  t.mock.method(require('../dist/Modules/admin/admin.token'), 'decodedAdminToken', async role => ({
    admin: { _id: actor, role }, decoded: {},
  }));
  const app = express(); app.use(express.json()); app.use(languageMiddleware);
  app.use('/home', homeRouter); app.use('/banners', bannerRouter);
  app.use('/dashboard', dashboardRouter); app.use('/media', mediaRouter); app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    assert.ok(path.basename(storageRoot).startsWith('ecommerce-banner-tests-'));
    await fs.rm(storageRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (oldStorage === undefined) delete process.env.STORAGE_ROOT; else process.env.STORAGE_ROOT = oldStorage;
    if (oldUrl === undefined) delete process.env.STORAGE_PUBLIC_URL; else process.env.STORAGE_PUBLIC_URL = oldUrl;
  });
  await Promise.all([BannerModel.createIndexes(), ProductModel.createIndexes(), OrderModel.createIndexes(), CategoryModel.createIndexes()]);
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, options = {}, status = 200) {
    const response = await fetch(base + route, options);
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  }
  const admin = { authorization: 'admin' };
  const ids = Object.fromEntries(['root', 'child', 'hidden', 'hiddenChild', 'orphan', 'cycle', 'p1', 'p2', 'free', 'inactive', 'hiddenProduct', 'empty', 'orphanProduct', 'cycleProduct'].map(key => [key, new mongoose.Types.ObjectId()]));
  await CategoryModel.collection.insertMany([
    { _id: ids.root, name: 'Root', slug: 'root', isActive: true, sortOrder: 0 },
    { _id: ids.child, name: 'Child', slug: 'child', isActive: true, parent: ids.root },
    { _id: ids.hidden, name: 'Hidden', slug: 'hidden', isActive: false },
    { _id: ids.hiddenChild, name: 'Hidden child', slug: 'hidden-child', isActive: true, parent: ids.hidden },
    { _id: ids.orphan, name: 'Orphan', slug: 'orphan', isActive: true, parent: new mongoose.Types.ObjectId() },
    { _id: ids.cycle, name: 'Cycle', slug: 'cycle', isActive: true, parent: ids.cycle },
  ]);
  const product = (key, overrides = {}) => ({ _id: ids[key], name: key, slug: key, sku: key.toUpperCase(),
    price: 10, compareAtPrice: 20, stock: 5, isActive: true, category: ids.child, images: ['https://example.test/product.webp'],
    createdAt: new Date('2026-01-01T00:00:00Z'), ...overrides });
  await ProductModel.collection.insertMany([
    product('p1', { stock: 1 }), product('p2', { price: 5, createdAt: new Date('2026-02-01T00:00:00Z') }),
    product('free', { price: 0, stock: 6 }), product('inactive', { isActive: false }),
    product('hiddenProduct', { category: ids.hiddenChild }), product('empty', { stock: 0 }),
    product('orphanProduct', { category: ids.orphan }), product('cycleProduct', { category: ids.cycle }),
  ]);
  const period = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-02-01T00:00:00Z') };
  const paidAt = new Date('2026-01-15T12:00:00Z');
  const line = (product, quantity, unitPriceMinor = 100) => ({ product, quantity, unitPriceMinor,
    lineTotalMinor: quantity * unitPriceMinor, name: 'Snapshot name', sku: 'SNAPSHOT' });
  const order = (items, overrides = {}) => ({ schemaVersion: 2, currency: 'EGP', currencyExponent: 2,
    user: actor, status: 'delivered', payment: { status: 'paid', paidAt }, items,
    grandTotalMinor: 1000, subtotalMinor: items.reduce((sum, item) => sum + item.lineTotalMinor, 0),
    discountMinor: 0, taxMinor: 0, shippingMinor: 0, statusHistory: [],
    createdAt: paidAt, updatedAt: paidAt, idempotencyKey: new mongoose.Types.ObjectId().toString(), ...overrides });
  await OrderModel.collection.insertMany([
    order([line(ids.p1, 2), line(ids.p1, 1), line(ids.p2, 2)]),
    order([line(ids.p1, 1)], { grandTotalMinor: 500 }),
    order([line(ids.p2, 4)], { currency: 'USD', grandTotalMinor: 900 }),
    order([line(ids.p1, 100)], { status: 'cancelled' }),
    order([line(ids.p1, 100)], { payment: { status: 'pending' } }),
    order([line(ids.p1, 100)], { schemaVersion: 1 }),
    order([line(ids.hiddenProduct, 50)]),
    order([line(ids.p1, 1)], { payment: { status: 'paid', paidAt: new Date('2025-01-01T00:00:00Z') }, grandTotalMinor: 200 }),
  ]);

  await t.test('rankings filter availability and complete ancestry, paginate, and never select a free best deal', async () => {
    const latest = await homeRepository.products({ section: 'latest', page: 1, limit: 20 });
    assert.equal(latest.products.length, 3);
    assert.equal(String(latest.products[0]._id), String(ids.p2));
    const offers = await homeRepository.products({ section: 'best-offers', page: 1, limit: 1 });
    assert.equal(offers.pagination.total, 2);
    assert.equal(String(offers.products[0]._id), String(ids.p2));
    assert.equal(offers.products[0].discountPercentage, 75);
    assert.equal(offers.products[0].savings, 15);
    const second = await homeRepository.products({ section: 'best-offers', page: 2, limit: 1 });
    assert.equal(String(second.products[0]._id), String(ids.p1));
    const sellers = await homeRepository.products({ section: 'best-sellers', page: 1, limit: 20 });
    assert.deepEqual(sellers.products.map(row => [String(row._id), row.unitsSold]), [[String(ids.p2), 6], [String(ids.p1), 5]]);
    const home = await request('/home?view=desktop');
    assert.equal(home.data.bestDeal._id, home.data.bestOffers[0]._id);
    assert.equal(home.data.categories.length, 1);
    assert.equal(home.data.latestProducts.some(row => row.createdBy), false);
  });

  await t.test('paid revenue uses stored totals once per order, separates currencies and filters paid dates', async () => {
    const rows = await reportingRepository.sales(period);
    assert.deepEqual(rows.map(row => [row.currency, row.paidOrders, row.paidSalesMinor]), [['EGP', 3, 2500], ['USD', 1, 900]]);
    const charts = await reportingRepository.sales(period, 'day');
    assert.equal(charts[0].period, '2026-01-15');
    const top = await reportingRepository.topProducts(period, 1, 20, 'EGP');
    const p1 = top.products.find(row => String(row.productId) === String(ids.p1));
    assert.equal(p1.unitsSold, 4); assert.equal(p1.orderCount, 2); assert.equal(p1.lineSalesMinor, 400);
    await ProductModel.collection.updateOne({ _id: ids.p1 }, { $set: { price: 999 } });
    assert.deepEqual(await reportingRepository.sales(period), rows);
    await ProductModel.collection.updateOne({ _id: ids.p1 }, { $set: { price: 10 } });
    assert.deepEqual(await reportingRepository.sales({ from: new Date('2020-01-01Z'), to: new Date('2020-01-02Z') }), []);
  });

  await t.test('reporting separates currency exponents and retains historical sales for removed products', async () => {
    const id = new mongoose.Types.ObjectId();
    await OrderModel.collection.insertOne({ _id: id, ...order([line(new mongoose.Types.ObjectId(), 2)], {
      currencyExponent: 3, grandTotalMinor: 1234,
    }) });
    try {
      const rows = await reportingRepository.sales(period, 'month');
      assert.equal(rows.filter(row => row.currency === 'EGP').length, 2);
      assert.ok(rows.every(row => row.period === '2026-01'));
      const top = await reportingRepository.topProducts(period, 1, 100);
      assert.ok(top.products.some(row => row.currencyExponent === 3 && row.unitsSold === 2));
    } finally { await OrderModel.collection.deleteOne({ _id: id }); }
  });

  await t.test('banner schedule boundaries and sorting are enforced before pagination', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const seed = { language: 'en', view: 'desktop', image: 'https://example.test/fixture.webp', createdBy: actor };
    const rows = await BannerModel.create([
      { ...seed, sortOrder: 2, title: 'second', startsAt: now },
      { ...seed, sortOrder: 1, title: 'first', startsAt: null, endsAt: null },
      { ...seed, sortOrder: 0, title: 'ended', endsAt: now },
      { ...seed, sortOrder: 0, title: 'future', startsAt: new Date(now.getTime() + 1) },
      { ...seed, sortOrder: 0, title: 'inactive', isActive: false },
    ]);
    try {
      const result = await bannerRepository.list(publicBannerFilter('en', 'desktop', now), 2, 1, true);
      assert.equal(result.pagination.total, 2);
      assert.equal(result.banners[0].title, 'second');
      assert.equal(result.banners[0].createdBy, undefined);
    } finally { await BannerModel.deleteMany({ _id: { $in: rows.map(row => row._id) } }); }
  });

  await t.test('empty promotional sections have no fabricated fallback deal', async () => {
    await ProductModel.collection.updateMany({ _id: { $in: [ids.p1, ids.p2] } }, { $set: { isActive: false } });
    try {
      const home = await request('/home?view=mobile');
      assert.equal(home.data.bestDeal, null);
      assert.deepEqual(home.data.bestOffers, []);
      assert.deepEqual(home.data.bestSellers, []);
    } finally { await ProductModel.collection.updateMany({ _id: { $in: [ids.p1, ids.p2] } }, { $set: { isActive: true } }); }
  });

  await t.test('dashboard threshold boundaries, customers, metadata and authorization', async () => {
    await UserModel.collection.insertMany([
      { email: 'user@example.test', role: 'user' }, { email: 'guest@example.test', role: 'guest' },
      { email: 'deleted@example.test', role: 'user', deletedAt: new Date() },
    ]);
    const oldThreshold = process.env.LOW_STOCK_THRESHOLD;
    try {
      process.env.LOW_STOCK_THRESHOLD = '5';
      const result = await dashboardService.overview(period);
      assert.equal(result.totals.products.total, 8);
      assert.equal(result.totals.products.lowStock, 6);
      assert.equal(result.totals.products.outOfStock, 1);
      assert.equal(result.totals.customers, 1);
      assert.equal(result.reporting.refundsTracked, false);
      assert.equal(result.recentOrders.some(row => row.payment?.key), false);
      process.env.LOW_STOCK_THRESHOLD = '1';
      assert.equal((await dashboardService.overview(period)).totals.products.lowStock, 1);
    } finally {
      if (oldThreshold === undefined) delete process.env.LOW_STOCK_THRESHOLD; else process.env.LOW_STOCK_THRESHOLD = oldThreshold;
    }
    for (const endpoint of ['overview', 'sales', 'top-products']) {
      await request('/dashboard/' + endpoint, { headers: { authorization: 'user' } }, 403);
      await request('/dashboard/' + endpoint, { headers: admin });
      await request('/dashboard/' + endpoint + '?from=invalid', { headers: admin }, 400);
    }
  });

  await t.test('banner upload CRUD, schedules, language/view filters and deferred image cleanup', async () => {
    const png = await sharp({ create: { width: 4, height: 2, channels: 3, background: 'blue' } }).png().toBuffer();
    const form = (values = {}) => {
      const body = new FormData();
      for (const [key, value] of Object.entries(values)) body.append(key, value);
      body.append('image', new Blob([png], { type: 'image/png' }), 'banner.png');
      return body;
    };
    await request('/banners', { method: 'POST', body: form({ language: 'ar', view: 'mobile' }) }, 401);
    await request('/banners', { method: 'POST', headers: { authorization: 'user' }, body: form({ language: 'ar', view: 'mobile' }) }, 403);
    const created = (await request('/banners', { method: 'POST', headers: admin,
      body: form({ language: 'ar', view: 'mobile', title: 'عرض', sortOrder: '2' }) }, 201)).data.banner;
    assert.match(created.image, new RegExp(`/banners/${created._id}/image/`));
    const imagePath = new URL(created.image).pathname;
    assert.equal((await fetch(base + imagePath)).status, 200);
    const query = '/banners/list?view=mobile';
    assert.equal((await request(query, { headers: { 'Accept-Language': 'ar-EG' } })).data.banners.length, 1);
    assert.equal((await request(query, { headers: { 'Accept-Language': 'en' } })).data.banners.length, 0);
    assert.equal((await request('/banners/list?view=desktop', { headers: { 'Accept-Language': 'ar' } })).data.banners.length, 0);
    const patch = body => request('/banners/' + created._id, { method: 'PATCH', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await patch({ startsAt: '2099-01-01T00:00:00Z' });
    assert.equal((await request(query, { headers: { 'Accept-Language': 'ar' } })).data.banners.length, 0);
    await request('/banners/' + created._id, { method: 'PATCH', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ endsAt: '2020-01-01T00:00:00Z' }) }, 400);
    await patch({ startsAt: null, endsAt: '2020-01-01T00:00:00Z' });
    assert.equal((await request(query, { headers: { 'Accept-Language': 'ar' } })).data.banners.length, 0);
    await patch({ endsAt: null, isActive: false });
    assert.equal((await request(query, { headers: { 'Accept-Language': 'ar' } })).data.banners.length, 0);
    await patch({ isActive: true });
    assert.equal((await request('/banners?language=ar&view=mobile&isActive=true', { headers: admin })).data.pagination.total, 1);
    await request('/banners/' + created._id, { headers: admin });
    await request('/banners', { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'en', view: 'desktop', image: 'https://example.test/x.webp' }) }, 400);
    const replacement = (await request('/banners/' + created._id, { method: 'PATCH', headers: admin, body: form({}) })).data.banner;
    assert.notEqual(replacement.image, created.image);
    assert.equal((await fetch(base + imagePath)).status, 404);
    await assert.rejects(bannerService.update(created._id, { image: 'stale' }, { value: created.image }), { statusCode: 409 });
    const first = await bannerRepository.findById(created._id), second = await bannerRepository.findById(created._id);
    first.title = 'winner'; second.title = 'loser';
    await bannerRepository.save(first);
    await assert.rejects(bannerRepository.save(second), { name: 'VersionError' });
    const old = new Date(Date.now() - 72 * 3600000);
    const oldKey = imagePath.slice('/media/'.length);
    const newKey = new URL(replacement.image).pathname.slice('/media/'.length);
    await fs.utimes(await safePath(oldKey + '.json'), old, old);
    await fs.utimes(await safePath(newKey + '.json'), old, old);
    for (let i = 0; i < 100 && activeUploads.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
    await reconcileUploads();
    await assert.rejects(fs.stat(await safePath(oldKey)), { code: 'ENOENT' });
    assert.ok(await fs.stat(await safePath(newKey)));
    await request('/banners/' + created._id, { method: 'DELETE', headers: admin });
    await reconcileUploads();
    await assert.rejects(fs.stat(await safePath(newKey)), { code: 'ENOENT' });
    await request('/banners/' + created._id, { headers: admin }, 404);
    await request('/banners/' + created._id, { method: 'DELETE', headers: admin }, 404);
  });
});
