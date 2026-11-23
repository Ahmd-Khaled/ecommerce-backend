import { z } from 'zod';
import { generalFields } from '../../Middlewares/validation.fields';

const productId = z.strictObject({ productId: generalFields.id });
export const addWishlistItemSchema = z.strictObject({ productId: generalFields.id });
export const wishlistProductIdSchema = productId;
export const wishlistListSchema = {
  query: z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(20), after: z.string().min(1).max(256).optional() }),
};
