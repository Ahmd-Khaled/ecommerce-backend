const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { createLogger } = require('../dist/Utils/logging/logger');
const { SystemLogWriter } = require('../dist/Utils/logging/system-log.writer');
const { systemLogService: service } = require('../dist/Modules/system-log/system-log.service');
const { systemLogRepository: repo } = require('../dist/DB/repository/system-log.repository');
const { createSystemLogRouter, systemLogErrors } = require('../dist/Modules/system-log/system-log.routes');
const { createRequestLogging } = require('../dist/Middlewares/request-logging.middlewares');
const { adminRepository } = require('../dist/DB/repository/admin.repository');
const { TokenRepository } = require('../dist/DB/repository/token.repository');
const { createAdminCredentials } = require('../dist/Modules/admin/admin.token');
const { Types } = require('mongoose');

const admin = () => ({ _id: new Types.ObjectId(), role: 'super-admin', tokenVersion: 0 });
function environment(t) {
  t.mock.property(process, 'env', { ...process.env, SYSTEM_LOGS_ENABLED: 'true', SYSTEM_LOGS_MONGO_URI: 'mongodb://unused',
    SYSTEM_LOGS_CURSOR_SECRET: 'test-cursor-secret-of-at-least-32-bytes', SYSTEM_LOGS_RETENTION_DAYS: '14',
    ACCESS_ADMIN_TOKEN_SECRET: 'test-admin-access', REFRESH_ADMIN_TOKEN_SECRET: 'test-admin-refresh',
    ACCESS_EXPIRES_IN: '900', REFRESH_EXPIRES_IN: '3600', MODE: 'DEV' });
}
const event = (overrides = {}) => ({ schemaVersion: 1, eventId: randomUUID(), occurredAt: new Date().toISOString(),
  requestId: randomUUID(), kind: 'request', action: 'http.request', service: 'backend', environment: 'test',
  level: 'info', outcome: 'success', actor: { type: 'anonymous' },
  http: { method: 'GET', route: '/:id', statusCode: 200, durationMs: 12, completed: true }, ...overrides });
const row = (overrides = {}) => { const { eventId, occurredAt, ...safe } = event();
  return { ...safe, _id: eventId, occurredAt: new Date(occurredAt), ingestedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), ...overrides }; };

test('writer projects secrets out, excludes operational events and expired records, retries and bounds memory', async t => {
  const batches = [];
  const writer = new SystemLogWriter(async records => batches.push(records), 86400000, 2, 10000);
  t.after(() => writer.close());
  writer.enqueue(event({ password: 'secret', actor: { type: 'anonymous', token: 'secret' }, error: { code: 'HTTP_400', stack: 'secret' } }));
  writer.enqueue(event({ occurredAt: new Date(0).toISOString() }));
  writer.enqueue(event({ kind: 'operational' }));
  writer.enqueue(event()); writer.enqueue(event());
  assert.equal(writer.snapshot().pending, 2);
  assert.equal(writer.metrics.dropped, 3);
  await writer.flush();
  assert.ok(!JSON.stringify(batches).includes('secret'));
  assert.equal(writer.metrics.persisted, 2);
  assert.equal(writer.snapshot().pendingBytes, 0);
  let attempts = 0;
  const failed = new SystemLogWriter(async () => { attempts++; throw Error('secret database error'); }, 86400000);
  failed.enqueue(event());
  await failed.flush(); await failed.flush(); await failed.flush();
  assert.equal(attempts, 3); assert.equal(failed.metrics.dropped, 1);
  await failed.close();
});

test('stdout failures and backpressure do not prevent safe persistence; persistence failures do not prevent stdout', () => {
  const persisted = [];
  for (const sink of [{ write() { throw Error('pipe'); } }, { writableLength: 65536, write() { assert.fail(); } }]) {
    createLogger(sink, value => persisted.push(value)).write({ kind: 'request', action: 'http.request', level: 'info', outcome: 'success' });
  }
  assert.equal(persisted.length, 2);
  const lines = [];
  createLogger({ write(line) { lines.push(line); return true; } }, () => { throw Error(); })
    .write({ kind: 'request', action: 'http.request', level: 'info', outcome: 'success', password: 'secret' });
  assert.equal(lines.length, 1); assert.ok(!lines[0].includes('secret'));
});

test('writer close has a deadline and accounts for in-flight capacity', async () => {
  let release;
  const writer = new SystemLogWriter(() => new Promise(resolve => { release = resolve; }), 86400000, 1);
  writer.enqueue(event()); const active = writer.flush(); writer.enqueue(event());
  assert.equal(writer.metrics.dropped, 1);
  await writer.close(20);
  assert.equal(writer.snapshot().pending, 0);
  release(); await active;
});

test('validated filters and signed cursors preserve ordering, dates, expiry and filter binding', async t => {
  environment(t);
  const account = admin(); const when = new Date(Date.now() - 60000);
  const rows = [row({ occurredAt: when }), row({ occurredAt: when })].sort((a, b) => b._id.localeCompare(a._id));
  const calls = [];
  t.mock.method(repo, 'list', async (filter, limit) => { calls.push({ filter, limit }); return calls.length === 1 ? rows : []; });
  const requestId = randomUUID();
  const query = { limit: '1', requestId, method: 'GET', statusGroup: '2xx', minDurationMs: '10', route: '/:id' };
  const first = await service.list(account, query);
  assert.equal(first.items.length, 1); assert.equal(first.pageInfo.hasNextPage, true);
  assert.equal(calls[0].filter.requestId, requestId);
  assert.deepEqual(calls[0].filter['http.statusCode'], { $gte: 200, $lt: 300 });
  assert.equal(calls[0].filter['http.route'], '/:id');
  await service.list(account, { ...query, after: first.pageInfo.nextCursor });
  assert.deepEqual(calls[1].filter.occurredAt, calls[0].filter.occurredAt);
  assert.equal(calls[1].filter.$or[1]._id.$lt, rows[0]._id);
  assert.ok(calls[1].filter.expiresAt.$gt instanceof Date);
  await assert.rejects(service.list(account, { ...query, method: 'POST', after: first.pageInfo.nextCursor }), { statusCode: 400 });
  await assert.rejects(service.list(account, { ...query, after: first.pageInfo.nextCursor + 'x' }), { statusCode: 400 });
  const { readCursor } = require('../dist/Modules/system-log/system-log.cursor');
  assert.throws(() => readCursor(first.pageInfo.nextCursor, process.env.SYSTEM_LOGS_CURSOR_SECRET, Date.now() + 1000000), { statusCode: 400 });
  for (const invalid of [{ unknown: 'x' }, { limit: '101' }, { limit: ['1'] }, { requestId: { $ne: null } },
    { statusCode: '500', statusGroup: '5xx' }, { from: 'yesterday' }, { minDurationMs: '-1' }, { userId: String(account._id) },
    { from: '2020-01-01T00:00:00Z', to: '2020-02-01T00:00:00Z' },
    { from: '2020-01-02T00:00:00Z', to: '2020-01-01T00:00:00Z' }, { to: '2099-01-01T00:00:00Z' }]) {
    await assert.rejects(service.list(account, invalid), { statusCode: 400 });
  }
});

test('service rechecks roles, distinguishes missing records from failures, and projects nested response fields', async t => {
  environment(t); const account = admin();
  await assert.rejects(service.list({ ...account, role: 'admin' }, {}), { statusCode: 403 });
  await assert.rejects(service.details(undefined, randomUUID()), { statusCode: 403 });
  t.mock.method(repo, 'details', async () => null);
  await assert.rejects(service.details(account, randomUUID()), { statusCode: 404 });
  await assert.rejects(service.details(account, 'invalid'), { statusCode: 400 });
  t.mock.method(repo, 'details', async () => { throw Error('mongodb://secret'); });
  await assert.rejects(service.details(account, randomUUID()), { statusCode: 503, message: 'System Logs unavailable' });
  t.mock.method(repo, 'list', async () => { throw Error('secret'); });
  await assert.rejects(service.list(account, {}), { statusCode: 503 });
  t.mock.method(repo, 'details', async () => row({ secret: 'secret', actor: { type: 'anonymous', password: 'secret' } }));
  assert.ok(!JSON.stringify(await service.details(account, randomUUID())).includes('secret'));
});

async function httpFixture(t, options = {}) {
  environment(t); const account = admin();
  t.mock.method(adminRepository, 'findOne', async () => account);
  t.mock.method(TokenRepository.prototype, 'findOne', async () => null);
  const credentials = await createAdminCredentials(account);
  t.mock.method(repo, 'list', async () => []);
  const events = []; const app = express();
  app.use(createRequestLogging({ write: input => events.push(input) }));
  app.use('/api/v1/admin/system-logs', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(require('cors')(require('../dist/Utils/middleware/cors').corsOptions()));
  app.use('/api/v1/admin/system-logs', createSystemLogRouter(options));
  app.use('/api/v1/admin/system-logs', systemLogErrors);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (authorization, path = '', headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/admin/system-logs${path}`, {
      headers: { ...(authorization ? { Authorization: authorization } : {}), ...headers },
    });
    const body = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('x-request-id'));
    assert.equal(body.stack, undefined); assert.equal(body.cause, undefined);
    return { status: response.status, body };
  };
  return { account, credentials, events, call, authorization: `admin ${credentials.accessToken}` };
}

test('HTTP authentication and authorization use real tokens and safe errors in DEV', async t => {
  const f = await httpFixture(t);
  assert.equal((await f.call()).status, 401);
  assert.equal((await f.call('user invalid')).status, 401);
  assert.equal((await f.call('admin invalid')).status, 401);
  const jwt = require('jsonwebtoken');
  const expired = jwt.sign({ ...jwt.decode(f.credentials.accessToken), exp: 1 }, process.env.ACCESS_ADMIN_TOKEN_SECRET);
  assert.equal((await f.call(`admin ${expired}`)).status, 401);
  assert.equal((await f.call(f.authorization, '', { Origin: 'https://untrusted.example.com' })).status, 403);
  assert.equal((await f.call(`admin ${f.credentials.refreshToken}`)).status, 401);
  assert.equal((await f.call(f.authorization)).status, 200);
  f.account.role = 'admin'; assert.equal((await f.call(f.authorization)).status, 403);
  f.account.role = 'super-admin'; f.account.freezedAt = new Date(); assert.equal((await f.call(f.authorization)).status, 403);
  delete f.account.freezedAt; f.account.deletedAt = new Date(); assert.equal((await f.call(f.authorization)).status, 401);
  delete f.account.deletedAt; f.account.tokenVersion++; assert.equal((await f.call(f.authorization)).status, 401);
  f.account.tokenVersion--;
  t.mock.method(TokenRepository.prototype, 'findOne', async () => ({ jti: 'revoked' }));
  assert.equal((await f.call(f.authorization)).status, 401);
  t.mock.method(TokenRepository.prototype, 'findOne', async () => null);
  assert.equal((await f.call(f.authorization, '?limit=101')).status, 400);
  t.mock.method(repo, 'list', async () => { throw Error('secret database details'); });
  const failure = await f.call(f.authorization);
  assert.equal(failure.status, 503); assert.ok(!JSON.stringify(failure).includes('secret'));
  assert.equal(f.events.length, 14, 'one terminal event per reader request, no recursive logging');
});

test('HTTP IP and administrator rate limits return no-store errors', async t => {
  await t.test('IP budget includes unauthenticated requests', async t => {
    const f = await httpFixture(t, { ipLimit: 1 });
    assert.equal((await f.call()).status, 401);
    assert.equal((await f.call(f.authorization)).status, 429);
  });
  await t.test('administrator budget', async t => {
    const f = await httpFixture(t, { adminLimit: 1 });
    assert.equal((await f.call(f.authorization)).status, 200);
    assert.equal((await f.call(f.authorization)).status, 429);
  });
});

test('shared rate-store failure fails closed without leaking internal details', async t => {
  const store = { localKeys: false, prefix: 'test:', async increment() { throw Error('redis://secret'); }, decrement() {}, resetKey() {} };
  const f = await httpFixture(t, { ipStore: store });
  const response = await f.call(f.authorization);
  assert.equal(response.status, 503); assert.ok(!JSON.stringify(response).includes('secret'));
});

test('statistics enforce authorization, bounded dates and allowlisted filters', async t => {
  environment(t); const account = admin(); const calls = [];
  const { emptySystemLogStatistics } = require('../dist/DB/repository/system-log.repository');
  t.mock.method(repo, 'statistics', async (filter, threshold) => { calls.push({ filter, threshold }); return emptySystemLogStatistics(); });
  const result = await service.statistics(account, { method: 'GET', route: '/:id', slowThresholdMs: '500' });
  assert.equal(result.totalRequests, 0); assert.equal(result.averageDurationMs, 0);
  for (const key of ['maxDurationMs', 'p50DurationMs', 'p95DurationMs', 'p99DurationMs']) assert.equal(result[key], 0);
  assert.equal(calls[0].threshold, 500); assert.equal(calls[0].filter['http.method'], 'GET');
  assert.equal(calls[0].filter['http.route'], '/:id'); assert.ok(calls[0].filter.expiresAt.$gt instanceof Date);
  assert.equal(new Date(result.to) - new Date(result.from), 86400000);
  await assert.rejects(service.statistics({ ...account, role: 'admin' }, {}), { statusCode: 403 });
  for (const query of [{ slowThresholdMs: '0' }, { slowThresholdMs: '-1' }, { slowThresholdMs: ['100'] },
    { limit: '10' }, { route: { $ne: '' } }, { method: 'BAD' }, { from: 'bad' }, { to: '2099-01-01T00:00:00Z' },
    { from: '2020-01-02T00:00:00Z', to: '2020-01-01T00:00:00Z' },
    { from: '2020-01-01T00:00:00Z', to: '2020-03-01T00:00:00Z' }]) {
    await assert.rejects(service.statistics(account, query), { statusCode: 400 });
  }
  t.mock.method(repo, 'statistics', async () => { throw Error('secret database error'); });
  await assert.rejects(service.statistics(account, {}), { statusCode: 503, message: 'System Logs unavailable' });
  process.env.SYSTEM_LOGS_ENABLED = 'false';
  await assert.rejects(service.statistics(account, {}), { statusCode: 503 });
});

test('statistics route precedes logId and inherits safe errors, authentication and rate limiting', async t => {
  const f = await httpFixture(t, { adminLimit: 4 });
  const { emptySystemLogStatistics } = require('../dist/DB/repository/system-log.repository');
  t.mock.method(repo, 'statistics', async () => emptySystemLogStatistics());
  assert.equal((await f.call(undefined, '/statistics')).status, 401);
  f.account.role = 'admin'; assert.equal((await f.call(f.authorization, '/statistics')).status, 403);
  f.account.role = 'super-admin';
  const response = await f.call(f.authorization, '/statistics');
  assert.equal(response.status, 200); assert.equal(response.body.data.slowThresholdMs, 1000);
  assert.equal((await f.call(f.authorization, '/statistics?slowThresholdMs=bad')).status, 400);
  t.mock.method(repo, 'statistics', async () => { throw Error('secret'); });
  const failure = await f.call(f.authorization, '/statistics');
  assert.equal(failure.status, 503); assert.ok(!JSON.stringify(failure).includes('secret'));
  await f.call(f.authorization, '/statistics');
  assert.equal((await f.call(f.authorization, '/statistics')).status, 429);
});

test('configuration defaults off and rejects unsafe enabled configuration', t => {
  const { systemLogConfig } = require('../dist/Utils/logging/system-log.config');
  t.mock.property(process, 'env', {});
  assert.equal(systemLogConfig().enabled, false);
  assert.equal(systemLogConfig().retentionMs, 14 * 86400000);
  process.env.SYSTEM_LOGS_ENABLED = 'true'; assert.throws(systemLogConfig);
  process.env.SYSTEM_LOGS_MONGO_URI = 'mongodb://unused'; process.env.SYSTEM_LOGS_CURSOR_SECRET = 'short'; assert.throws(systemLogConfig);
  process.env.SYSTEM_LOGS_CURSOR_SECRET = 'x'.repeat(32); assert.equal(systemLogConfig().enabled, true);
  process.env.SYSTEM_LOGS_RETENTION_DAYS = '91'; assert.throws(systemLogConfig);
});
