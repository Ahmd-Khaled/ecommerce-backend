const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { systemLogModel } = require('../dist/DB/models/system-log/system-log.model');
const { startSystemLogs, closeSystemLogs, getSystemLogModel, enqueueSystemLog } = require('../dist/Utils/logging/system-log.transport');
const { systemLogService: service } = require('../dist/Modules/system-log/system-log.service');
const { systemLogRepository: repo } = require('../dist/DB/repository/system-log.repository');

test('real MongoDB: stable pages, lookup, TTL, idempotent ingestion and query plans', { skip: !process.env.MONGO_TEST_URI }, async t => {
  const dbName = `system_logs_test_${new mongoose.Types.ObjectId()}`;
  // Use a unique database, never the application database.
  const connection = await mongoose.createConnection(process.env.MONGO_TEST_URI, { dbName, serverSelectionTimeoutMS: 5000 }).asPromise();
  const model = systemLogModel(connection);
  t.after(async () => { await closeSystemLogs(); if (connection.name === dbName) await connection.dropDatabase(); await connection.close(); });
  await model.createIndexes();
  const uri = new URL(process.env.MONGO_TEST_URI); uri.pathname = `/${dbName}`;
  t.mock.property(process, 'env', { ...process.env, SYSTEM_LOGS_ENABLED: 'true', SYSTEM_LOGS_MONGO_URI: uri.toString(),
    SYSTEM_LOGS_CURSOR_SECRET: 'integration-cursor-secret-32-bytes-minimum', SYSTEM_LOGS_RETENTION_DAYS: '14' });
  startSystemLogs();
  const deadline = Date.now() + 10000;
  while (true) {
    try { getSystemLogModel(); break; } catch { if (Date.now() > deadline) throw Error('Transport did not connect'); await new Promise(r => setTimeout(r, 50)); }
  }
  const when = new Date(Date.now() - 60000); const requestId = randomUUID();
  const record = () => ({ _id: randomUUID(), schemaVersion: 1, occurredAt: when, ingestedAt: when,
    expiresAt: new Date(Date.now() + 86400000), requestId, kind: 'request', action: 'http.request',
    service: 'backend', environment: 'test', level: 'info', outcome: 'success', actor: { type: 'anonymous' },
    http: { method: 'GET', route: '/:id', statusCode: 200, durationMs: 10, completed: true } });
  const records = Array.from({ length: 150 }, record);
  await model.insertMany(records);
  const account = { role: 'super-admin' }; const ids = [];
  let after;
  do {
    const page = await service.list(account, { limit: '17', ...(after ? { after } : {}), requestId });
    ids.push(...page.items.map(item => item.logId)); after = page.pageInfo.nextCursor;
  } while (after);
  assert.deepEqual(ids, records.map(r => r._id).sort().reverse());
  assert.equal(new Set(ids).size, 150);
  const first = await service.list(account, { limit: '17', requestId });
  await new Promise(r => setTimeout(r, 5));
  const late = record(); late.ingestedAt = new Date();
  await model.create(late);
  const second = await service.list(account, { limit: '17', requestId, after: first.pageInfo.nextCursor });
  assert.ok(!second.items.some(item => item.logId === late._id));
  assert.equal((await service.details(account, ids[0])).requestId, requestId);
  const expired = record(); expired.expiresAt = new Date(Date.now() - 1000);
  await model.create(expired);
  await assert.rejects(service.details(account, expired._id), { statusCode: 404 });
  const visible = await repo.list({ expiresAt: { $gt: new Date() } }, 200);
  assert.ok(!visible.some(r => r._id === expired._id));
  const event = record(); const { _id, ingestedAt, expiresAt, ...rest } = event;
  const input = { ...rest, eventId: _id, occurredAt: when.toISOString(), password: 'secret' };
  enqueueSystemLog(input); enqueueSystemLog(input);
  const ingestDeadline = Date.now() + 5000;
  while (!await model.exists({ _id })) { assert.ok(Date.now() < ingestDeadline); await new Promise(r => setTimeout(r, 100)); }
  assert.equal(await model.countDocuments({ _id }), 1);
  assert.ok(!JSON.stringify(await model.findById(_id).lean()).includes('secret'));
  const plan = await model.find({ requestId, occurredAt: { $gte: new Date(when.getTime() - 1000) } })
    .sort({ occurredAt: -1, _id: -1 }).limit(26).explain('executionStats');
  assert.ok(!JSON.stringify(plan.queryPlanner.winningPlan).includes('COLLSCAN'));
  assert.ok(plan.executionStats.totalDocsExamined <= 27);
  t.diagnostic(JSON.stringify({ query: 'requestId', returned: plan.executionStats.nReturned,
    keys: plan.executionStats.totalKeysExamined, documents: plan.executionStats.totalDocsExamined }));
  const base = { occurredAt: { $gte: new Date(when.getTime() - 1000), $lt: new Date() }, expiresAt: { $gt: new Date() } };
  for (const [name, filter] of Object.entries({ recent: base, route: { ...base, 'http.route': '/:id' },
    slow: { ...base, 'http.durationMs': { $gte: 1000 } }, errors: { ...base, 'http.statusCode': { $gte: 500 } },
    empty: { ...base, requestId: randomUUID() },
    deep: { ...base, $or: [{ occurredAt: { $lt: when } }, { occurredAt: when, _id: { $lt: ids[100] } }] } })) {
    const result = await model.find(filter).sort({ occurredAt: -1, _id: -1 }).limit(26).explain('executionStats');
    assert.ok(!JSON.stringify(result.queryPlanner.winningPlan).includes('COLLSCAN'), name);
    t.diagnostic(JSON.stringify({ query: name, returned: result.executionStats.nReturned,
      keys: result.executionStats.totalKeysExamined, documents: result.executionStats.totalDocsExamined }));
  }
  const samples = [
    [200, 'success', true, 100], [302, 'success', true, 200], [401, 'denied', true, 1000],
    [500, 'failure', true, 2000], [200, 'aborted', false, 50], [400, 'failure', true, 1500],
  ].map(([statusCode, outcome, completed, durationMs]) => ({ ...record(), outcome,
    http: { method: 'POST', route: '/stats-test', statusCode, durationMs, completed } }));
  await model.insertMany([...samples,
    { ...samples[0], _id: randomUUID(), expiresAt: new Date(Date.now() - 1000) },
    { ...samples[0], _id: randomUUID(), occurredAt: new Date(0) }]);
  const statistics = await service.statistics(account, { route: '/stats-test', method: 'POST' });
  const { from, to, slowThresholdMs, p50DurationMs, p95DurationMs, p99DurationMs, ...metrics } = statistics;
  assert.ok(p50DurationMs >= 200 && p50DurationMs <= 1000);
  assert.equal(p95DurationMs, 2000); assert.equal(p99DurationMs, 2000);
  assert.equal(slowThresholdMs, 1000);
  assert.deepEqual(metrics, { totalRequests: 6, successfulRequests: 2, failedRequests: 4, completedRequests: 5,
    abortedRequests: 1, deniedRequests: 1, slowRequests: 3, clientErrorRequests: 2, serverErrorRequests: 1,
    averageDurationMs: 808.33, maxDurationMs: 2000 });
  assert.equal((await service.statistics(account, { route: '/stats-test', slowThresholdMs: '1501' })).slowRequests, 1);
  assert.equal((await service.statistics(account, { route: '/stats-test', method: 'GET' })).totalRequests, 0);
  const durationKeys = ['averageDurationMs', 'maxDurationMs', 'p50DurationMs', 'p95DurationMs', 'p99DurationMs'];
  const empty = await service.statistics(account, { route: '/percentiles-empty' });
  for (const key of durationKeys) assert.equal(empty[key], 0, key);
  for (const [name, durations] of [
    ['single', [37]], ['identical', Array(200).fill(42)],
    ['outlier', [...Array(999).fill(10), 1000000]],
    ['large', Array.from({ length: 10000 }, (_, i) => i + 1)],
  ]) {
    await t.test(`duration percentiles: ${name}`, async () => {
      const route = `/percentiles-${name}`;
      // All aborted: verifies inclusion in exactly the same population as average/max.
      for (let offset = 0; offset < durations.length; offset += 1000) {
        await model.insertMany(durations.slice(offset, offset + 1000).map(durationMs => ({ ...record(), outcome: 'aborted',
          http: { method: 'POST', route, statusCode: 200, durationMs, completed: false } })));
      }
      // Excluded records must not pollute any percentile.
      const excluded = { ...record(), http: { method: 'POST', route, statusCode: 200, durationMs: 99999999, completed: true } };
      await model.insertMany([
        { ...excluded, _id: randomUUID(), expiresAt: new Date(0) },
        { ...excluded, _id: randomUUID(), occurredAt: new Date(0) },
        { ...excluded, _id: randomUUID(), http: { ...excluded.http, method: 'GET' } },
        { ...excluded, _id: randomUUID(), ingestedAt: new Date(Date.now() + 86400000) },
      ]);
      const result = await service.statistics(account, { route, method: 'POST', slowThresholdMs: '100' });
      assert.equal(result.totalRequests, durations.length);
      assert.equal(result.abortedRequests, durations.length);
      assert.equal(result.maxDurationMs, Math.max(...durations));
      assert.equal(result.slowRequests, durations.filter(value => value >= 100).length);
      if (name === 'large') {
        // Independent nearest-rank reference; allow 1% rank error for approximate t-digest.
        for (const [key, p] of [['p50DurationMs', 0.5], ['p95DurationMs', 0.95], ['p99DurationMs', 0.99]])
          assert.ok(Math.abs(result[key] - Math.ceil(durations.length * p)) <= 100, `${key}: ${result[key]}`);
      } else {
        for (const key of ['p50DurationMs', 'p95DurationMs', 'p99DurationMs'])
          assert.equal(result[key], name === 'single' ? 37 : name === 'identical' ? 42 : 10, key);
      }
      assert.ok(result.p50DurationMs <= result.p95DurationMs && result.p95DurationMs <= result.p99DurationMs);
      assert.ok(result.p99DurationMs <= result.maxDurationMs);
    });
  }
  // TTL is asynchronous. Allow multiple monitor passes without assuming exact timing.
  const ttlDeadline = Date.now() + 150000;
  while (await model.exists({ _id: expired._id })) {
    assert.ok(Date.now() < ttlDeadline, 'TTL did not delete expired record');
    await new Promise(r => setTimeout(r, 1000));
  }
});

test('real Redis: shared counters, separate budgets, expiry and fail-closed outages', { skip: !process.env.REDIS_TEST_URL }, async t => {
  const { systemLogRateStores, closeSystemLogRateStores } = require('../dist/Utils/logging/system-log.rate-store');
  t.mock.property(process, 'env', { ...process.env, SYSTEM_LOGS_REDIS_URL: process.env.REDIS_TEST_URL });
  const first = systemLogRateStores(); const second = systemLogRateStores();
  t.after(closeSystemLogRateStores);
  const key = randomUUID();
  first.ipStore.init({ windowMs: 100 }); second.ipStore.init({ windowMs: 100 });
  const deadline = Date.now() + 5000;
  while (true) {
    try { await first.ipStore.resetKey(key); break; } catch { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 30)); }
  }
  assert.equal((await first.ipStore.increment(key)).totalHits, 1);
  assert.equal((await second.ipStore.increment(key)).totalHits, 2);
  assert.equal((await first.adminStore.increment(key)).totalHits, 1);
  await new Promise(r => setTimeout(r, 120));
  assert.equal((await second.ipStore.increment(key)).totalHits, 1);
  await first.ipStore.resetKey(key); await first.adminStore.resetKey(key);
  closeSystemLogRateStores();
  await assert.rejects(first.ipStore.increment(key));
});
