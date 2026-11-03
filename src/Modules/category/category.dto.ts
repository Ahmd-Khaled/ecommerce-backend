
import { z } from "zod";

import {
  publicCategoryListSchema,
  createCategorySchema,
  updateCategorySchema,
  categoryIdSchema,
  categorySlugSchema,
} from "./category.validation";

/**
 * Create category request body.
 */
export type CreateCategoryDTO = z.infer<
  typeof createCategorySchema.body
>;

/**
 * Update category request body.
 */
export type UpdateCategoryDTO = z.infer<
  typeof updateCategorySchema.body
>;

/**
 * Category ID route parameters.
 */
export type CategoryIdDTO = z.infer<
  typeof categoryIdSchema.params
>;

/**
 * Category slug route parameters.
 */
export type CategorySlugDTO = z.infer<
  typeof categorySlugSchema.params
>;

export type PublicCategoryListDTO = z.infer<typeof publicCategoryListSchema.query>;
