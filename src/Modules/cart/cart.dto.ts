import { z } from "zod";

import {
  addCartItemSchema,
  adjustCartItemSchema,
  updateCartItemSchema,
  cartProductIdSchema,
} from "./cart.validation";

export type AdjustCartItemDTO = z.infer<typeof adjustCartItemSchema>;

/**
 * Add product to cart request body.
 */
export type AddCartItemDTO = z.infer<
  typeof addCartItemSchema
>;

/**
 * Update cart item quantity request body.
 */
export type UpdateCartItemDTO = z.infer<
  typeof updateCartItemSchema
>;

/**
 * Cart product ID route parameters.
 */
export type CartProductIdDTO = z.infer<
  typeof cartProductIdSchema
>;
