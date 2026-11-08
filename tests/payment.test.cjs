const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { Types } = require('mongoose');
const express = require('express');
const { verifyWebhook, stripeGateway } = require('../dist/Modules/payment/payment.gateway');
const { paymentService } = require('../dist/Modules/payment/payment.service');
const { OrderModel } = require('../dist/DB/models/order/order.model');
const { paymentRouter } = require('../dist/Modules/payment/payment.routes');
const { globalErrorHandler } = require('../dist/Utils/response/error.response');
const token = require('../dist/Utils/security/token');
function configure(t) {
  for (const [key, value] of Object.entries({ STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test', PAYMENT_SUCCESS_URL: 'https://example.com/success', PAYMENT_CANCEL_URL: 'https://example.com/cancel' })) { const previous = process.env[key]; process.env[key] = value; t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }); }
}
function signed(event, stamp = Math.floor(Date.now() / 1000)) {
  const body = Buffer.from(JSON.stringify(event));
  return [body, `t=${stamp},v1=${createHmac('sha256', 'whsec_test').update(stamp + '.').update(body).digest('hex')}`];
}
test('webhook authentication rejects altered, expired, future and parsed payloads', () => {
  const [body, signature] = signed({ id: 'evt_test' });
  assert.deepEqual(verifyWebhook(body, signature, 'whsec_test'), { id: 'evt_test' });
  assert.throws(() => verifyWebhook(Buffer.from('{}'), signature, 'whsec_test'), { statusCode: 400 });
  assert.throws(() => verifyWebhook({}, signature, 'whsec_test'), { statusCode: 400 });
  for (const offset of [-301, 301]) {
    const [b, s] = signed({}, Math.floor(Date.now() / 1000) + offset);
    assert.throws(() => verifyWebhook(b, s, 'whsec_test'), { statusCode: 400 });
  }
});
test('checkout uses stored totals and stable provider key; rejects key changes and stale uncertainty', async t => {
  configure(t);
  const user = new Types.ObjectId(), id = new Types.ObjectId();
  const order = { _id: id, user, schemaVersion: 2, status: 'placed', currency: 'EGP', currencyExponent: 2, grandTotalMinor: 1234,
    payment: { key: 'payment-key-123456', status: 'pending', startedAt: new Date(), successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' } };
  t.mock.method(OrderModel, 'findOne', filter => {
    assert.equal(filter.user, user);
    return { exec: async () => order };
  });
  t.mock.method(OrderModel, 'updateOne', () => ({ exec: async () => ({ matchedCount: 1 }) }));
  const keys = [];
  t.mock.method(stripeGateway, 'request', async (path, body, key) => {
    keys.push(key);
    assert.equal(body.get('line_items[0][price_data][unit_amount]'), '1234');
    return { id: 'cs_test', url: 'https://checkout.stripe.com/test', mode: 'payment', metadata: { orderId: String(id) }, amount_total: 1234, currency: 'egp' };
  });
  await paymentService.checkout(user, { orderId: String(id) }, order.payment.key);
  await paymentService.checkout(user, { orderId: String(id) }, order.payment.key);
  assert.equal(keys[0], keys[1]);
  await assert.rejects(paymentService.checkout(user, { orderId: String(id), amount: 1 }, order.payment.key), { statusCode: 400 });
  await assert.rejects(paymentService.checkout(user, { orderId: String(id) }, 'different-key-123456'), { statusCode: 409 });
  order.payment.startedAt = new Date(Date.now() - 24 * 3600000);
  await assert.rejects(paymentService.checkout(user, { orderId: String(id) }, order.payment.key), { statusCode: 409 });
  assert.equal(keys.length, 2);
});
test('webhooks verify totals, persist paid once, and tolerate duplicate deliveries', async t => {
  configure(t);
  const id = new Types.ObjectId();
  const order = { _id: id, grandTotalMinor: 100, currency: 'USD', payment: { status: 'pending', sessionId: 'cs_test' } };
  const session = { id: 'cs_test', mode: 'payment', metadata: { orderId: String(id) }, amount_total: 100, currency: 'usd', status: 'complete', payment_status: 'paid' };
  t.mock.method(stripeGateway, 'request', async () => session);
  t.mock.method(OrderModel, 'findById', () => ({ exec: async () => order }));
  let writes = 0;
  t.mock.method(OrderModel, 'updateOne', (filter, update) => ({ exec: async () => {
    assert.equal(filter['payment.status'], 'pending');
    if (order.payment.status !== 'pending') return { matchedCount: 0 };
    order.payment.status = update.$set['payment.status']; writes++;
    return { matchedCount: 1 };
  } }));
  const args = signed({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test' } } });
  await paymentService.webhook(...args);
  await paymentService.webhook(...args);
  assert.equal(writes, 1);
  session.amount_total = 99;
  await assert.rejects(paymentService.webhook(...args), { statusCode: 409 });
});
test('HTTP preserves raw webhook bytes, enforces customer role and scopes reads', async t => {
  configure(t);
  const user = new Types.ObjectId();
  t.mock.method(token, 'decodedToken', async ({ authorization }) => ({ user: { _id: user, role: authorization }, decoded: {} }));
  t.mock.method(OrderModel, 'findOne', filter => { assert.equal(filter.user, user); return { exec: async () => null }; });
  const app = express(); app.use('/payments', paymentRouter); app.use(globalErrorHandler);
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port + '/payments';
  assert.equal((await fetch(base + '/orders/' + user)).status, 401);
  assert.equal((await fetch(base + '/orders/' + user, { headers: { authorization: 'admin' } })).status, 403);
  assert.equal((await fetch(base + '/orders/' + user, { headers: { authorization: 'user' } })).status, 404);
  const [body, signature] = signed({ id: 'evt_ignore', type: 'ignored', data: { object: { id: 'obj_1' } } });
  assert.equal((await fetch(base + '/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'stripe-signature': signature } })).status, 200);
  assert.equal((await fetch(base + '/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json' } })).status, 400);
});

