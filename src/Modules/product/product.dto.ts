import { z } from "zod";

import {
  createProductSchema,
  updateProductSchema,
  productIdSchema,
  productSlugSchema,
} from "./product.validation";

/**
 * Create product request body.
 */
export type CreateProductDTO = z.infer<typeof createProductSchema>;

/**
 * Update product request body.
 */
export type UpdateProductDTO = z.infer<typeof updateProductSchema>;

/**
 * Product ID route parameters.
 */
export type ProductIdDTO = z.infer<typeof productIdSchema>;

/**
 * Product slug route parameters.
 */
export type ProductSlugDTO = z.infer<typeof productSlugSchema>;

/** Product list filters and pagination. */
export interface GetProductsDTO {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: "createdAt" | "price" | "name";
  sortOrder?: "asc" | "desc";
}
