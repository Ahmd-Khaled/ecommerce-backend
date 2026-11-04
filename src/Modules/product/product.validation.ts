
import { z } from "zod";

import { generalFields } from "../../Middlewares/validation.fields";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must contain at least 2 characters")
  .max(180, "Slug cannot exceed 180 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug can contain lowercase letters, numbers, and hyphens",
  );

const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "SKU must contain at least 3 characters")
  .max(100, "SKU cannot exceed 100 characters")
  .regex(
    /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
    "SKU can contain uppercase letters, numbers, and hyphens",
  );

const productNameSchema = z
  .string()
  .trim()
  .min(2, "Product name must contain at least 2 characters")
  .max(150, "Product name cannot exceed 150 characters");

const descriptionSchema = z
  .string()
  .trim()
  .min(10, "Description must contain at least 10 characters")
  .max(5000, "Description cannot exceed 5000 characters");

const priceSchema = z
  .number()
  .min(0, "Price cannot be negative");

const compareAtPriceSchema = z
  .number()
  .min(0, "Compare-at price cannot be negative");

const stockSchema = z
  .number()
  .int("Stock must be an integer")
  .min(0, "Stock cannot be negative");

const imagesSchema = z
  .array(z.url("Each image must be a valid URL"))
  .min(1, "At least one product image is required")
  .max(10, "A product cannot have more than 10 images");

export const createProductSchema = z
  .strictObject({
    name: productNameSchema,
    slug: slugSchema,
    description: descriptionSchema,
    sku: skuSchema,
    price: priceSchema,
    compareAtPrice: compareAtPriceSchema.optional(),
    stock: stockSchema.default(0),
    images: imagesSchema,
    category: generalFields.id,
  })
  .refine(
    (data) =>
      data.compareAtPrice === undefined || data.compareAtPrice > data.price,
    {
      path: ["compareAtPrice"],
      error: "Compare-at price must be greater than the current price",
    },
  );

export const updateProductSchema = z
  .strictObject({
    name: productNameSchema.optional(),
    slug: slugSchema.optional(),
    description: descriptionSchema.optional(),
    sku: skuSchema.optional(),
    price: priceSchema.optional(),
    compareAtPrice: compareAtPriceSchema.nullable().optional(),
    stock: stockSchema.optional(),
    images: imagesSchema.optional(),
    category: generalFields.id.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field is required for update",
  );

export const productIdSchema = z
  .strictObject({
    productId: generalFields.id,
  });

export const productSlugSchema = z
  .strictObject({
    slug: slugSchema,
  });

// -------------------------

const productListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),

    search: z.string().trim().max(150).optional(),

    minPrice: z.coerce.number().finite().min(0).optional(),
    maxPrice: z.coerce.number().finite().min(0).optional(),

    sortBy: z
      .enum(["createdAt", "price", "name"])
      .default("createdAt"),

    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .refine(
    (data) =>
      data.minPrice === undefined ||
      data.maxPrice === undefined ||
      data.minPrice <= data.maxPrice,
    {
      path: ["maxPrice"],
      message: "Maximum price must be greater than or equal to minimum price",
    },
  );

export const publicProductListSchema = {
  query: productListQuerySchema,
};

export const productCategoryIdSchema = {
  params: z.strictObject({
    categoryId: generalFields.id,
  }),
};

export const publicCategoryProductsSchema = z
  .object({
    params: z
      .object({
        categoryId: generalFields.id,
      })
      .strict(),

    query: productListQuerySchema,
  })
  .strict();
