import mongoose, { Types } from 'mongoose';
import { ReviewModel } from '../../DB/models/review/review.model';
import { ProductModel } from '../../DB/models/product/product.model';
import { OrderModel } from '../../DB/models/order/order.model';
import { UserModel } from '../../DB/models/user/user.model';
import { reviewRepository } from '../../DB/repository/review.repository';
import { reviewSettingsRepository } from '../../DB/repository/review-settings.repository';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '../../Utils/response/error.response';
import { AdminRoleEnum, type HAdminDocument } from '../../DB/models/admin/admin.interface';
import type { HUserDocument } from '../../DB/models/user/user.interface';
import type { ReviewState } from '../../DB/models/review/review.interface';
import { createReviewBody, updateReviewBody, moderationBody, adminReviewsQuery, productReviewsQuery, myReviewsQuery, settingsBody } from './review.validation';
import { z } from 'zod';

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException('Invalid review request', { cause: result.error.issues });
  return result.data;
}
function oid(value: string, label: string) {
  if (!Types.ObjectId.isValid(value)) throw new BadRequestException(`Invalid ${label}`);
  return new Types.ObjectId(value);
}
function cursor(value?: string) {
  if (!value) return undefined;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8').split('|');
    if (decoded.length !== 2 || !Types.ObjectId.isValid(decoded[1]!) || Number.isNaN(Date.parse(decoded[0]!))) throw new Error();
    return { createdAt: new Date(decoded[0]!), id: new Types.ObjectId(decoded[1]!) };
  } catch { throw new BadRequestException('Invalid review cursor'); }
}
function nextCursor(docs: Array<{ createdAt?: Date; _id: Types.ObjectId }>, limit: number) {
  if (docs.length <= limit) return null;
  const last = docs[limit - 1]!;
  return Buffer.from(`${last.createdAt!.toISOString()}|${last._id.toString()}`).toString('base64url');
}
const reviewView = (doc: any) => ({
  id: String(doc._id), productId: String(doc.product), rating: doc.rating, text: doc.text,
  state: doc.state, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  user: doc.user && typeof doc.user === 'object' ? {
    firstName: doc.user.firstName,
    ...(doc.user.avatar ? { avatar: doc.user.avatar } : {}),
  } : undefined,
  moderationHistory: doc.moderationHistory?.map((event: any) => ({
    actorId: String(event.actor), actorRole: event.actorRole, from: event.from,
    to: event.to, at: event.at, reason: event.reason,
  })),
});
const customerReviewView = (doc: any) => ({
  id: String(doc._id), productId: String(doc.product), rating: doc.rating, text: doc.text,
  state: doc.state, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
});

class ReviewService {
  async publicList(productId: string, input: unknown) {
    const query = parse(productReviewsQuery, input);
    const product = await ProductModel.findOne({ _id: oid(productId, 'product ID'), isActive: true }).select('ratingsSum ratingsCount').lean().exec();
    if (!product) throw new NotFoundException('Product not found');
    const docs = await reviewRepository.list({ product: product._id, state: 'published' }, cursor(query.after), query.limit);
    const more = docs.length > query.limit;
    const rows = docs.slice(0, query.limit);
    const users = await UserModel.find({ _id: { $in: rows.map((r) => r.user) }, deletedAt: null }).select('firstName avatar').lean().exec();
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    const sanitized = rows.map((row) => ({
      id: String(row._id), rating: row.rating, text: row.text, createdAt: row.createdAt,
      reviewer: (() => { const user = userMap.get(String(row.user)); return user ? { firstName: user.firstName, ...(user.avatar ? { avatar: user.avatar } : {}) } : { firstName: 'Deleted customer' }; })(),
    }));
    return { reviews: sanitized, rating: { average: product.ratingsCount ? Math.round((product.ratingsSum / product.ratingsCount) * 100) / 100 : 0, count: product.ratingsCount }, nextCursor: more ? nextCursor(docs, query.limit) : null };
  }

  async create(user: HUserDocument, productId: string, input: unknown) {
    const data = parse(createReviewBody, input); const product = oid(productId, 'product ID');
    try {
      return await mongoose.connection.transaction(async (session) => {
        const currentProduct = await ProductModel.findOne({ _id: product, isActive: true }).session(session).exec();
        if (!currentProduct) throw new NotFoundException('Product not found');
        const order = await OrderModel.findOne({ user: user._id, status: 'delivered', 'items.product': product }).sort({ updatedAt: -1 }).session(session).exec();
        if (!order) throw new ForbiddenException('A delivered order containing this product is required');
        const settings = await reviewSettingsRepository.get(session);
        const state: ReviewState = settings.autoApproveReviews ? 'published' : 'pending';
        const review = await reviewRepository.create({ product, user: user._id, order: order._id, rating: data.rating, ...(data.text !== undefined ? { text: data.text } : {}), state }, session);
        if (state === 'published') await this.adjustSummary(product, data.rating, 1, session);
        return { id: String(review._id), rating: review.rating, text: review.text, state: review.state, createdAt: review.createdAt };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } catch (error) { if (this.duplicate(error)) throw new ConflictException('You have already reviewed this product'); throw error; }
  }

  async mine(user: HUserDocument, input: unknown) {
    const query = parse(myReviewsQuery, input);
    const docs = await reviewRepository.list({ user: user._id }, cursor(query.after), query.limit);
    const more = docs.length > query.limit;
    const rows = docs.slice(0, query.limit);
    return { reviews: rows.map((doc) => customerReviewView(doc)), nextCursor: more ? nextCursor(docs, query.limit) : null };
  }

  async edit(user: HUserDocument, reviewId: string, input: unknown) {
    const data = parse(updateReviewBody, input); const id = oid(reviewId, 'review ID');
    return mongoose.connection.transaction(async (session) => {
      const review = await ReviewModel.findOne({ _id: id, user: user._id }).session(session).exec();
      if (!review) throw new NotFoundException('Review not found');
      if (review.state === 'removed') throw new ConflictException('Removed reviews cannot be edited');
      const product = await ProductModel.findById(review.product).session(session).exec();
      if (!product) throw new NotFoundException('Product not found');
      const settings = await reviewSettingsRepository.get(session);
      const before = review.state; const oldRating = review.rating;
      const rating = data.rating ?? oldRating;
      let state = before;
      if (before === 'published' && !settings.autoApproveReviews) state = 'pending';
      const update: Record<string, unknown> = { $set: { rating, state }, $currentDate: { updatedAt: true } };
      if (data.text === null) update.$unset = { text: 1 };
      else if (data.text !== undefined) (update.$set as Record<string, unknown>).text = data.text;
      const changed = await reviewRepository.transition(id, { state: before, rating: oldRating }, update, session);
      if (!changed) throw new ConflictException('Review changed; reload and retry');
      if (before === 'published' && state !== 'published') await this.adjustSummary(review.product, -oldRating, -1, session);
      else if (before === 'published' && state === 'published' && rating !== oldRating) await this.adjustSummary(review.product, rating - oldRating, 0, session);
      return { id: String(changed._id), rating: changed.rating, text: changed.text, state: changed.state, updatedAt: changed.updatedAt };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  }

  async withdraw(user: HUserDocument, reviewId: string) {
    return this.customerTransition(user, reviewId, 'removed');
  }

  private async customerTransition(user: HUserDocument, reviewId: string, target: ReviewState) {
    const id = oid(reviewId, 'review ID');
    return mongoose.connection.transaction(async (session) => {
      const review = await ReviewModel.findOne({ _id: id, user: user._id }).session(session).exec();
      if (!review) throw new NotFoundException('Review not found');
      if (review.state === 'removed') return { id: String(review._id), state: 'removed' };
      const from = review.state;
      const changed = await reviewRepository.transition(id, { state: from, rating: review.rating }, { $set: { state: target }, $currentDate: { updatedAt: true } }, session);
      if (!changed) throw new ConflictException('Review changed; reload and retry');
      if (from === 'published') await this.adjustSummary(review.product, -review.rating, -1, session);
      return { id: String(changed._id), state: changed.state };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  }

  async adminList(input: unknown) {
    const query = parse(adminReviewsQuery, input);
    const filter: Record<string, unknown> = {};
    if (query.productId) filter.product = oid(query.productId, 'product ID');
    if (query.state) filter.state = query.state;
    if (query.queue === 'new') filter.state = 'pending';
    const docs = await reviewRepository.list(filter, cursor(query.after), query.limit);
    const more = docs.length > query.limit; const rows = docs.slice(0, query.limit);
    const userIds = [...new Set(rows.map((doc) => String(doc.user)))].map((id) => new Types.ObjectId(id));
    const productIds = [...new Set(rows.map((doc) => String(doc.product)))].map((id) => new Types.ObjectId(id));
    const [users, products] = await Promise.all([
      UserModel.find({ _id: { $in: userIds } }).select('firstName lastName email avatar').lean().exec(),
      ProductModel.find({ _id: { $in: productIds } }).select('name slug isActive').lean().exec(),
    ]);
    const userMap = new Map(users.map((u) => [String(u._id), { firstName: u.firstName, lastName: u.lastName, email: u.email, avatar: u.avatar }]));
    const productMap = new Map(products.map((p) => [String(p._id), { name: p.name, slug: p.slug, isActive: p.isActive }]));
    return { reviews: rows.map((doc) => ({ ...reviewView(doc), user: userMap.get(String(doc.user)) ?? null, product: productMap.get(String(doc.product)) ?? null })), nextCursor: more ? nextCursor(docs, query.limit) : null };
  }

  async moderate(actor: HAdminDocument, reviewId: string, input: unknown) {
    const data = parse(moderationBody, input); const id = oid(reviewId, 'review ID');
    return mongoose.connection.transaction(async (session) => {
      const review = await ReviewModel.findById(id).session(session).exec();
      if (!review) throw new NotFoundException('Review not found');
      const from = review.state; const to = data.state;
      if (from === 'removed') throw new ConflictException('Removed reviews require SUPER_ADMIN restoration');
      if (from === to) return { id: String(review._id), state: review.state };
      const update = { $set: { state: to }, $push: { moderationHistory: { actor: actor._id, actorRole: actor.role, from, to, at: new Date(), ...(data.reason ? { reason: data.reason } : {}) } }, $currentDate: { updatedAt: true } };
      const changed = await reviewRepository.transition(id, { state: from, rating: review.rating }, update, session);
      if (!changed) throw new ConflictException('Review changed; reload and retry');
      if (from === 'published' && to !== 'published') await this.adjustSummary(review.product, -review.rating, -1, session);
      if (from !== 'published' && to === 'published') await this.adjustSummary(review.product, review.rating, 1, session);
      return { id: String(changed._id), state: changed.state };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  }

  async restore(actor: HAdminDocument, reviewId: string, reason?: string) {
    if (actor.role !== AdminRoleEnum.SUPER_ADMIN) throw new ForbiddenException('SUPER_ADMIN role required');
    const id = oid(reviewId, 'review ID');
    return mongoose.connection.transaction(async (session) => {
      const review = await ReviewModel.findOne({ _id: id, state: 'removed' }).session(session).exec();
      if (!review) throw new NotFoundException('Removed review not found');
      const changed = await reviewRepository.transition(id, { state: 'removed', rating: review.rating }, { $set: { state: 'hidden' }, $push: { moderationHistory: { actor: actor._id, actorRole: actor.role, from: 'removed', to: 'hidden', at: new Date(), ...(reason ? { reason } : {}) } }, $currentDate: { updatedAt: true } }, session);
      if (!changed) throw new ConflictException('Review changed; reload and retry');
      return { id: String(changed._id), state: changed.state };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
  }

  async getSettings() { return reviewSettingsRepository.get(); }
  async setSettings(input: unknown) { const data = parse(settingsBody, input); return reviewSettingsRepository.set(data.autoApproveReviews); }

  private async adjustSummary(product: Types.ObjectId, sumDelta: number, countDelta: number, session: mongoose.ClientSession) {
    const changed = await ProductModel.updateOne({ _id: product, ratingsSum: { $gte: Math.max(0, -sumDelta) }, ratingsCount: { $gte: Math.max(0, -countDelta) } }, { $inc: { ratingsSum: sumDelta, ratingsCount: countDelta } }, { session }).exec();
    if (changed.matchedCount !== 1) throw new ConflictException('Product rating summary changed or product is missing');
  }
  private duplicate(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000; }
}

export const reviewService = new ReviewService();
