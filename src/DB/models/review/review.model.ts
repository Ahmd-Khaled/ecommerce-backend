import { model, models, Schema, type Model } from 'mongoose';
import { reviewStates, type IReview } from './review.interface';

const moderationEventSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, required: true, ref: 'Admin' },
    actorRole: { type: String, required: true },
    from: { type: String, enum: reviewStates, required: true },
    to: { type: String, enum: reviewStates, required: true },
    at: { type: Date, required: true },
    reason: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const reviewSchema = new Schema<IReview>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    text: { type: String, trim: true, maxlength: 2000 },
    state: { type: String, enum: reviewStates, required: true },
    moderationHistory: { type: [moderationEventSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

reviewSchema.index({ user: 1, product: 1 }, { unique: true });
reviewSchema.index({ product: 1, state: 1, createdAt: -1, _id: -1 });
reviewSchema.index({ user: 1, createdAt: -1, _id: -1 });
reviewSchema.index({ state: 1, createdAt: -1, _id: -1 });

export const ReviewModel = (models.Review as Model<IReview> | undefined) ?? model<IReview>('Review', reviewSchema);
