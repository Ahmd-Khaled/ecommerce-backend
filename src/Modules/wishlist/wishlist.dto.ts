import { z } from 'zod';
import { addWishlistItemSchema, wishlistListSchema, wishlistProductIdSchema } from './wishlist.validation';
export type AddWishlistItemDTO = z.infer<typeof addWishlistItemSchema>;
export type WishlistProductIdDTO = z.infer<typeof wishlistProductIdSchema>;
export type WishlistListDTO = z.infer<typeof wishlistListSchema.query>;
