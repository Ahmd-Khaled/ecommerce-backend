import { z } from "zod";
import { cartLimits } from "./cart.config";

import { generalFields } from "../../Middlewares/validation.fields";

const quantitySchema = z
  .number()
  .int("Quantity must be an integer")
  .min(1, "Quantity must be at least 1")
  .refine(value => value <= cartLimits().maxQuantity, "Quantity exceeds cart limit");

export const addCartItemSchema = z
  .strictObject({
    productId: generalFields.id,
    quantity: quantitySchema.default(1),
  });

export const updateCartItemSchema = z
  .strictObject({
    quantity: quantitySchema,
  });

export const cartProductIdSchema = z
  .strictObject({
    productId: generalFields.id,
  });

export const adjustCartItemSchema = z
  .strictObject({
    quantity: quantitySchema.default(1),
  })
  .default({ quantity: 1 });
