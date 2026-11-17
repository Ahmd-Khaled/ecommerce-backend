import type { ClientSession, QueryFilter, Types } from 'mongoose';
import { ReviewModel } from '../models/review/review.model';
import type { IReview, ReviewState } from '../models/review/review.interface';

export const reviewRepository = {
  create(data: Pick<IReview, 'product' | 'user' | 'order' | 'rating' | 'text' | 'state'>, session: ClientSession) {
    return ReviewModel.create([{ ...data, moderationHistory: [] }], { session }).then((reviews) => reviews[0]!);
  },
  findById(id: Types.ObjectId, session?: ClientSession) {
    return ReviewModel.findOne({ _id: id }).session(session ?? null).exec();
  },
  findByOwnerProduct(user: Types.ObjectId, product: Types.ObjectId, session: ClientSession) {
    return ReviewModel.findOne({ user, product }).session(session).exec();
  },
  list(filter: QueryFilter<any>, after: { createdAt: Date; id: Types.ObjectId } | undefined, limit: number) {
    const cursor = after ? { $or: [
      { createdAt: { $lt: after.createdAt } },
      { createdAt: after.createdAt, _id: { $lt: after.id } },
    ] } : {};
    return ReviewModel.find({ ...filter, ...cursor }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).exec();
  },
  async transition(id: Types.ObjectId, expected: { state: ReviewState; rating: number }, update: Record<string, unknown>, session: ClientSession) {
    return ReviewModel.findOneAndUpdate({ _id: id, ...expected }, update, { session, new: true, includeResultMetadata: false, runValidators: true }).exec();
  },
};
