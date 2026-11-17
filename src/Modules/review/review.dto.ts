import type { z } from 'zod';
import { createReviewBody, updateReviewBody, moderationBody, adminReviewsQuery } from './review.validation';
export type CreateReviewDTO = z.infer<typeof createReviewBody>;
export type UpdateReviewDTO = z.infer<typeof updateReviewBody>;
export type ModerationDTO = z.infer<typeof moderationBody>;
export type AdminReviewsQuery = z.infer<typeof adminReviewsQuery>;
