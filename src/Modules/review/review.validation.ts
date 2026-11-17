import { z } from 'zod';
import { generalFields } from '../../Middlewares/validation.fields';

const cursor = z.string().max(256).regex(/^[A-Za-z0-9_-]+$/).optional();
const pagination = { limit: z.coerce.number().int().min(1).max(100).default(20), after: cursor };
export const productReviewsQuery = z.strictObject(pagination);
export const myReviewsQuery = z.strictObject(pagination);
export const adminReviewsQuery = z.strictObject({
  ...pagination,
  productId: generalFields.id.optional(),
  state: z.enum(['pending', 'published', 'hidden', 'removed']).optional(),
  queue: z.enum(['new']).optional(),
});
export const productIdParams = z.strictObject({ productId: generalFields.id });
export const reviewIdParams = z.strictObject({ reviewId: generalFields.id });
export const createReviewBody = z.strictObject({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000).optional(),
});
export const updateReviewBody = z.strictObject({
  rating: z.number().int().min(1).max(5).optional(),
  text: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide rating or text');
export const moderationBody = z.strictObject({
  state: z.enum(['published', 'hidden', 'removed']),
  reason: z.string().trim().max(500).optional(),
});
export const restoreBody = z.strictObject({ reason: z.string().trim().max(500).optional() }).default({});
export const settingsBody = z.strictObject({ autoApproveReviews: z.boolean() });
