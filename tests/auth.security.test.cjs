const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { forgotPasswordLimiter, resetPasswordLimiter } = require('../dist/Utils/middleware/rate-limit');
const { monitorOTPFailure } = require('../dist/Utils/security/otp-monitor');

test('password reset limiters count by IP and have separate budgets', async (t) => {
  const app = express();
  app.patch('/forgot-password', forgotPasswordLimiter, (_req, res) => res.sendStatus(204));
  app.patch('/reset-password', resetPasswordLimiter, (_req, res) => res.sendStatus(204));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/forgot-password', '/reset-password']) {
    for (let i = 0; i < 5; i++) {
      const response = await fetch(base + route, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `account${i}@example.com` }),
      });
      assert.equal(response.status, 204);
    }
    const blocked = await fetch(base + route, { method: 'PATCH' });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    assert.ok(blocked.headers.get('ratelimit'));
  }
});

test('OTP monitoring reports repeated failures and lockout without secrets', (t) => {
  const events = [];
  t.mock.method(console, 'warn', value => events.push(JSON.parse(value)));
  for (const flow of ['confirm-email', 'reset-password']) {
    for (const attempts of [null, 1, 2, 3, 4, 5]) {
      monitorOTPFailure({ flow, userId: 'user-id', ip: '127.0.0.1', attempts,
        maxAttempts: 5, otp: 'secret-code', email: 'private@example.com' });
    }
  }
  assert.deepEqual(events.map(e => e.attempts), [3, 5, 3, 5]);
  assert.deepEqual(events.map(e => e.attemptLimitReached), [false, true, false, true]);
  assert.equal(events[0].event, 'otp_repeated_failure');
  assert.ok(events.every(e => !('otp' in e) && !('email' in e)));
});
