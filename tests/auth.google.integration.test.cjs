const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const { UserModel } = require('../dist/DB/models/user/user.model');
const { authService } = require('../dist/Modules/auth/auth.service');
const token = require('../dist/Utils/security/token');

test('MongoDB Google registration races preserve identity and email uniqueness', { skip: !process.env.MONGO_TEST_URI }, async t => {
  await mongoose.connect(process.env.MONGO_TEST_URI, {
    dbName: `google_auth_test_${new mongoose.Types.ObjectId()}`, serverSelectionTimeoutMS: 5000,
  });
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  await UserModel.createIndexes();
  t.mock.property(process, 'env', { ...process.env, GOOGLE_CLIENT_ID: 'test-client' });
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async ({ idToken }) => ({ getPayload: () => ({
    sub: idToken, email: 'same@example.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600,
  }) }));
  t.mock.method(token, 'createLoginCredentials', async () => ({ accessToken: 'access', refreshToken: 'refresh', signatureLevel: 'user' }));
  const results = await Promise.all(Array.from({ length: 8 }, () => authService.googleLogin({ idToken: 'same-sub' })));
  assert.equal(new Set(results.map(result => result.user.id)).size, 1);
  assert.equal(await UserModel.countDocuments(), 1);
  await assert.rejects(authService.googleLogin({ idToken: 'different-sub' }), { statusCode: 409 });
  await UserModel.deleteMany({});
  const different = await Promise.allSettled(['sub-a', 'sub-b'].map(idToken => authService.googleLogin({ idToken })));
  assert.equal(different.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(different.find(result => result.status === 'rejected').reason.statusCode, 409);
  assert.equal(await UserModel.countDocuments(), 1);
});
