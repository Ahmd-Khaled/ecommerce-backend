import type { HydratedDocument, Types } from 'mongoose';

export const reviewStates = ['pending', 'published', 'hidden', 'removed'] as const;
export type ReviewState = (typeof reviewStates)[number];

export interface IReviewModerationEvent {
  actor: Types.ObjectId;
  actorRole: string;
  from: ReviewState;
  to: ReviewState;
  at: Date;
  reason?: string;
}

export interface IReview {
  product: Types.ObjectId;
  user: Types.ObjectId;
  order: Types.ObjectId;
  rating: number;
  text?: string;
  state: ReviewState;
  moderationHistory: IReviewModerationEvent[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type ReviewDocument = HydratedDocument<IReview>;
