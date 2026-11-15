const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { resolveLanguage, translate } = require('../dist/Utils/i18n');
const { languageMiddleware } = require('../dist/Middlewares/language.middlewares');
const { lowStockThreshold } = require('../dist/Modules/dashboard/dashboard.config');
const { overviewSchema, salesSchema } = require('../dist/Modules/dashboard/dashboard.validation');
const { bannerRouter } = require('../dist/Modules/banner/banner.routes');
const { homeRouter } = require('../dist/Modules/home/home.routes');
const { dashboardRouter } = require('../dist/Modules/dashboard/dashboard.routes');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');

test('language negotiation handles regions, quality, wildcard, malformed and missing preferences', () => {
  for (const [header, expected] of [
    [undefined, 'en'], ['', 'en'], ['fr', 'en'], ['AR-eg', 'ar'],
    ['ar;q=0.3,en-US;q=0.9', 'en'], ['fr;q=1,ar;q=0.8,en;q=0.5', 'ar'],
    ['en;q=0, *;q=0.5', 'ar'], ['ar;q=0,en;q=1', 'en'],
    ['ar;q=2,en;q=0.5', 'en'], ['ar;q=invalid', 'en'], ['ar,en', 'ar'],
  ]) assert.equal(resolveLanguage(header), expected, header);
  assert.equal(translate('en', 'bannerCreated'), 'Banner created successfully');
  assert.notEqual(translate('ar', 'bannerCreated'), translate('en', 'bannerCreated'));
  assert.equal(translate('unsupported', 'retrieved'), 'Data retrieved successfully');
});

test('threshold and date ranges are bounded and default to a trailing 30-day UTC period', () => {
  const original = process.env.LOW_STOCK_THRESHOLD;
  try {
    delete process.env.LOW_STOCK_THRESHOLD;
    assert.equal(lowStockThreshold(), 5);
    for (const value of ['0', '12']) {
      process.env.LOW_STOCK_THRESHOLD = value; assert.equal(lowStockThreshold(), Number(value));
    }
    for (const value of ['', '-1', '1.5', 'abc', '9007199254740992']) {
      process.env.LOW_STOCK_THRESHOLD = value; assert.throws(lowStockThreshold);
    }
  } finally {
    if (original === undefined) delete process.env.LOW_STOCK_THRESHOLD;
    else process.env.LOW_STOCK_THRESHOLD = original;
  }
  const defaults = overviewSchema.parse({});
  assert.equal(defaults.to - defaults.from, 30 * 86400000);
  for (const input of [
    { from: '2026-01-01', to: '2026-02-01' },
    { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    { groupBy: '$where' },
  ]) assert.equal(salesSchema.safeParse(input).success, false);
});

test('HTTP language headers preserve Vary and routes reject invalid input or missing admin authentication', async t => {
  const app = express();
  app.use((_req, res, next) => { res.vary('Origin'); next(); });
  app.use(languageMiddleware);
  app.get('/language', (req, res) => res.json({ language: req.language }));
  app.use('/banners', bannerRouter); app.use('/home', homeRouter); app.use('/dashboard', dashboardRouter);
  app.use(globalErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/language', { headers: { 'Accept-Language': 'ar-EG' } });
  assert.equal(response.headers.get('content-language'), 'ar');
  assert.equal(response.headers.get('vary'), 'Origin, Accept-Language');
  assert.deepEqual(await response.json(), { language: 'ar' });
  for (const path of ['/banners', '/banners/123', '/dashboard/overview', '/dashboard/sales', '/dashboard/top-products'])
    assert.equal((await fetch(base + path)).status, 401, path);
  for (const path of ['/banners/list', '/banners/list?view=moile', '/banners/list?view=mobile&language=ar',
    '/home?view=desktop&limit=21', '/home/products?section=bad', '/home/products?section=latest&limit=101',
    '/home/products?section=latest&page=0', '/home?view=desktop&view=mobile'])
    assert.equal((await fetch(base + path)).status, 400, path);
});
