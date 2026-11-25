const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const { corsOptions } = require('../dist/Utils/middleware/cors');
const { createRequestLogging } = require('../dist/Middlewares/request-logging.middlewares');
const { ApplicationException, globalErrorHandler } = require('../dist/Utils/response/error.response');
const { logger } = require('../dist/Utils/logging/logger');

for (const environment of ['development', 'staging', 'production']) {
  test(`${environment}: exposes server request IDs while preserving credentialed CORS restrictions`, async t => {
    const origins = environment === 'development'
      ? ['http://localhost:5173', 'http://localhost:5174']
      : [`https://dashboard.${environment}.example.com`, `https://admin.${environment}.example.com`];
    t.mock.property(process, 'env', {
      ...process.env, NODE_ENV: environment, CORS_ORIGINS: ` ${origins.join(', ')} , `,
    });
    t.mock.method(logger, 'write', () => {});
    const app = express();
    // Match bootstrap ordering, including errors raised before routes run.
    app.use(createRequestLogging({ write() {} }));
    app.use(cors(corsOptions()));
    app.use(express.json());
    app.get('/ok', (req, res) => res.json({ ok: true }));
    app.get('/error/:status', (req, res, next) => next(new ApplicationException('Test error', Number(req.params.status))));
    app.use((req, res) => res.sendStatus(404));
    app.use(globalErrorHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}`;
    const ids = new Set();
    const clientId = '11111111-1111-4111-8111-111111111111';
    const call = async (path, origin, options = {}) => {
      const response = await fetch(`${url}${path}`, {
        ...options,
        headers: { ...(origin ? { Origin: origin } : {}), 'X-Request-Id': clientId, ...options.headers },
      });
      await response.text();
      const id = response.headers.get('x-request-id');
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.notEqual(id, clientId);
      assert.ok(!ids.has(id), 'each response has a fresh server-generated ID');
      ids.add(id);
      return response;
    };
    const assertExposed = (response, origin) => {
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      assert.equal(response.headers.get('access-control-expose-headers'), 'X-Request-Id');
    };
    for (const origin of origins) {
      for (const [path, status] of [['/ok', 200], ['/missing', 404], ...[400, 401, 403, 429, 500].map(status => [`/error/${status}`, status])]) {
        const response = await call(path, origin);
        assert.equal(response.status, status);
        assertExposed(response, origin);
      }
      const malformed = await call('/ok', origin, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
      });
      assert.equal(malformed.status, 400);
      assertExposed(malformed, origin);
      const preflight = await call('/ok', origin, {
        method: 'OPTIONS', headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,x-request-id',
        },
      });
      assert.equal(preflight.status, 204);
      assertExposed(preflight, origin);
      assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET,HEAD,PUT,PATCH,POST,DELETE');
      assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization,content-type,x-request-id');
    }
    for (const origin of ['https://untrusted.example.com', `${origins[0]}.evil.example.com`]) {
      for (const method of ['GET', 'OPTIONS']) {
        const denied = await call('/ok', origin, { method });
        assert.equal(denied.status, 403);
        assert.equal(denied.headers.get('access-control-allow-origin'), null);
        assert.equal(denied.headers.get('access-control-expose-headers'), null);
      }
    }
    assert.equal((await call('/ok')).status, 200);
  });
}
