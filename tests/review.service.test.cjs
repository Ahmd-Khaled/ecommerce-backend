const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { ReviewModel } = require('../dist/DB/models/review/review.model');
const { ReviewSettingsModel } = require('../dist/DB/models/settings/review-settings.model');
const { createReviewBody, updateReviewBody, moderationBody, settingsBody } = require('../dist/Modules/review/review.validation');

test('review schemas constrain rating, text, moderation, and dashboard settings', () => {
  assert.equal(createReviewBody.safeParse({ rating: 5, text: 'Good' }).success, true);
  for (const rating of [0, 6, 2.5]) assert.equal(createReviewBody.safeParse({ rating }).success, false);
  assert.equal(createReviewBody.safeParse({ rating: 4, state: 'published' }).success, false);
  assert.equal(updateReviewBody.safeParse({ text: null }).success, true);
  assert.equal(updateReviewBody.safeParse({}).success, false);
  assert.equal(moderationBody.safeParse({ state: 'hidden', rating: 1 }).success, false);
  assert.equal(settingsBody.safeParse({ autoApproveReviews: false }).success, true);
});

test('review and settings schemas expose required indexes and safe defaults', () => {
  const indexes = ReviewModel.schema.indexes().map(([keys]) => keys);
  assert.ok(indexes.some(index => index.user === 1 && index.product === 1));
  assert.ok(indexes.some(index => index.product === 1 && index.state === 1));
  assert.equal(ReviewSettingsModel.schema.path('autoApproveReviews').defaultValue, false);
  assert.equal(ProductModel.schema.path('ratingsSum').defaultValue, 0);
  assert.equal(ProductModel.schema.path('ratingsCount').defaultValue, 0);
  const product = new ProductModel({ name: 'Average test', slug: 'average-test', description: 'long enough description', sku: 'AVG-001', price: 10, stock: 0, images: ['https://example.test/a.jpg'], category: new mongoose.Types.ObjectId(), createdBy: new mongoose.Types.ObjectId(), ratingsSum: 9, ratingsCount: 2 });
  const serialized = product.toJSON();
  assert.equal(serialized.ratingsAverage, 4.5);
  assert.equal('ratingsSum' in serialized, false);
});

test('review lifecycle transactions on a real replica set', { skip: process.env.MONGO_TEST_URI ? false : 'MONGO_TEST_URI is unset; transactional integration behavior is not verified' }, async t => {
  const dbName = 'review_test_' + new mongoose.Types.ObjectId();
  await mongoose.connect(process.env.MONGO_TEST_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  t.after(async () => { if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  await Promise.all([ReviewModel.init(), ProductModel.init(), ReviewSettingsModel.init()]);
  const { reviewService } = require('../dist/Modules/review/review.service');
  const { UserModel } = require('../dist/DB/models/user/user.model');
  const { OrderModel } = require('../dist/DB/models/order/order.model');
  const userId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  await UserModel.collection.insertOne({ _id: userId, firstName: 'Test', lastName: 'Buyer', email: `${userId}@example.test`, role: 'USER', deletedAt: null });
  await ProductModel.collection.insertOne({ _id: productId, name: 'Review item', slug: productId.toString(), sku: productId.toString(), price: 10, stock: 1, images: ['https://example.test/a.jpg'], category: new mongoose.Types.ObjectId(), createdBy: new mongoose.Types.ObjectId(), isActive: true, ratingsSum: 0, ratingsCount: 0 });
  const orderId = new mongoose.Types.ObjectId();
  await OrderModel.collection.insertOne({ _id: orderId, user: userId, status: 'delivered', items: [{ product: productId }], schemaVersion: 1 });
  await ReviewSettingsModel.updateOne({ _id: 'product-reviews' }, { $set: { autoApproveReviews: true } }, { upsert: true });
  const user = await UserModel.findById(userId).exec();
  const created = await reviewService.create(user, productId.toString(), { rating: 4, text: 'Good' });
  assert.equal(created.state, 'published');
  assert.equal((await ProductModel.findById(productId)).ratingsSum, 4);
  assert.equal((await ProductModel.findById(productId)).ratingsCount, 1);
  await assert.rejects(reviewService.create(user, productId.toString(), { rating: 5 }), { statusCode: 409 });
  await reviewService.moderate({ _id: new mongoose.Types.ObjectId(), role: 'admin' }, created.id, { state: 'hidden' });
  assert.equal((await ProductModel.findById(productId)).ratingsCount, 0);
  assert.equal((await ReviewModel.findById(created.id)).state, 'hidden');
});
