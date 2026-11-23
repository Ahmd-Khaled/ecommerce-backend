const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const { createLogger } = require('../dist/Utils/logging/logger');
const { logContext, setVerifiedActor } = require('../dist/Utils/logging/context');
const { createRequestLogging } = require('../dist/Middlewares/request-logging.middlewares');

test('logging projects safe fields, bounds events, and isolates sink failures', () => {
  const lines = [];
  const logger = createLogger({ write: line => { lines.push(line); return true; } });
  logger.write({ kind: 'operational', action: 'application.started', level: 'info', outcome: 'success',
    password: 'secret-value', error: new Error('secret-value'), metadata: { token: 'secret-value' } });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('secret-value'));
  const throwing = createLogger({ write() { throw new Error('sink failed'); } });
  assert.doesNotThrow(() => throwing.write({ action: 'application.started' }));
  assert.equal(throwing.dropped, 1);
  const congested = createLogger({ writableLength: 65536, write() { assert.fail('must drop'); } });
  congested.write({ action: 'application.started' });
  assert.equal(congested.dropped, 1);
});

test('finish and close emit exactly once; early close is an abort; sink throws are isolated', () => {
  for (const aborted of [false, true]) {
    const events = [];
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: !aborted, setHeader() {} });
    createRequestLogging({ write: event => events.push(event) })({ method: 'GET' }, res, () => {});
    if (!aborted) res.emit('finish');
    res.emit('close');
    res.emit('finish');
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, aborted ? 'aborted' : 'success');
  }
  const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader() {} });
  createRequestLogging({ write() { throw Error('offline'); } })({ method: 'GET' }, res, () => {});
  assert.doesNotThrow(() => res.emit('finish'));
});

test('HTTP requests keep isolated actors and omit sensitive URLs, headers, bodies and parser errors', async t => {
  const lines = [];
  const output = createLogger({ write: line => { lines.push(JSON.parse(line)); return true; } });
  const app = express();
  app.use(createRequestLogging(output));
  app.use(express.json());
  app.get('/actor/:type', async (req, res) => {
    const type = req.params.type;
    setVerifiedActor({ type, id: '123456789012345678901234', identityModel: type === 'admin' ? 'Admin' : 'User', role: type });
    await new Promise(resolve => setTimeout(resolve, type === 'admin' ? 10 : 25));
    res.json({ requestId: logContext.getStore().requestId });
  });
  app.post('/webhook', express.raw({ type: 'application/octet-stream' }), (req, res) => {
    assert.equal(req.body.toString(), 'secret-value');
    res.sendStatus(204);
  });
  app.use((err, req, res, next) => res.sendStatus(400));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const responses = await Promise.all(['admin', 'user'].map(type => fetch(`${url}/actor/${type}?token=secret-value`, {
    headers: { authorization: 'secret-value', 'x-request-id': 'secret-value' },
  })));
  const ids = responses.map(response => response.headers.get('x-request-id'));
  assert.notEqual(ids[0], ids[1]);
  assert.ok(ids.every(id => /^[a-f0-9-]{36}$/.test(id)));
  await Promise.all(responses.map(response => response.text()));
  await fetch(`${url}/secret-value`).then(response => response.text());
  await fetch(`${url}/bad`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"secret-value"' }).then(response => response.text());
  await fetch(`${url}/webhook`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'secret-value' }).then(response => response.text());
  assert.equal(lines.length, 5);
  assert.equal(lines.find(event => event.requestId === ids[0]).actor.identityModel, 'Admin');
  assert.equal(lines.find(event => event.requestId === ids[1]).actor.identityModel, 'User');
  assert.equal(lines.filter(event => event.http.route === '<unmatched>').length, 2);
  assert.ok(!JSON.stringify(lines).includes('secret-value'));
  assert.equal(logContext.getStore(), undefined);
});
