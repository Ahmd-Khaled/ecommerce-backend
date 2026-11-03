const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const mail = require('../dist/Utils/email/send.email');
const { deliverEmail } = require('../dist/Utils/email/email.queue');

test('SMTP failures propagate for BullMQ retries', async () => {
  const failure = new Error('Temporary SMTP failure');
  const send = mock.method(mail, 'sendEmail', async () => { throw failure; });
  try {
    await assert.rejects(deliverEmail('confirmEmail', {
      to: 'test@example.com', username: 'Test', otp: '123456', expiresAt: Date.now() + 60000,
    }), error => error === failure);
    assert.equal(send.mock.callCount(), 1);
  } finally { send.mock.restore(); }
});

test('expired codes are never delivered or retried', async () => {
  const send = mock.method(mail, 'sendEmail', async () => {});
  try {
    await assert.rejects(deliverEmail('resetPassword', {
      to: 'test@example.com', username: 'Test', otp: '123456', expiresAt: Date.now() - 1,
    }), { name: 'UnrecoverableError' });
    assert.equal(send.mock.callCount(), 0);
  } finally { send.mock.restore(); }
});

test('both email types render the queued code and correct subject', async () => {
  const send = mock.method(mail, 'sendEmail', async () => {});
  try {
    for (const [event, subject] of [['confirmEmail', 'Confirm Your Email'], ['resetPassword', 'Reset Your Password']]) {
      await deliverEmail(event, {
        to: 'test@example.com', username: '<Test>', otp: '123456', expiresAt: Date.now() + 60000,
      });
      const options = send.mock.calls.at(-1).arguments[0];
      assert.equal(options.subject, subject);
      assert.equal(options.to, 'test@example.com');
      assert.match(options.html, /123456/);
      assert.match(options.html, /&lt;Test&gt;/);
    }
  } finally { send.mock.restore(); }
});
