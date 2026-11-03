
import { z } from "zod";

/**
 * Reusable category fields.
 */
const categoryFields = {
  name: z
    .string()
    .trim()
    .min(2, "Category name must be at least 2 characters")
    .max(100, "Category name cannot exceed 100 characters"),

  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Category slug must be at least 2 characters")
    .max(120, "Category slug cannot exceed 120 characters")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must contain lowercase letters, numbers, and hyphens only",
    ),

  description: z
    .string()
    .trim()
    .max(1000, "Description cannot exceed 1000 characters")
    .optional(),

  image: z
    .url("Image must be a valid URL")
    .optional(),

  parent: z
    .string()
    .regex(
      /^[a-fA-F0-9]{24}$/,
      "Parent category ID must be a valid MongoDB ObjectId",
    )
    .optional(),

  isActive: z.boolean().optional(),

  sortOrder: z
    .number()
    .int("Sort order must be an integer")
    .min(0, "Sort order cannot be negative")
    .optional(),
};

/**
 * Create category validation.
 */
export const createCategorySchema = {
  body: z.strictObject({
    name: categoryFields.name,
    slug: categoryFields.slug,
    description: categoryFields.description,
    image: categoryFields.image,
    parent: categoryFields.parent,
    isActive: categoryFields.isActive,
    sortOrder: categoryFields.sortOrder,
  }),
};

/**
 * Update category validation.
 *
 * All fields are optional.
 * parent: null means moving the category to the root level.
 */
export const updateCategorySchema = {
  params: z.strictObject({
    categoryId: z
      .string()
      .regex(
        /^[a-fA-F0-9]{24}$/,
        "Category ID must be a valid MongoDB ObjectId",
      ),
  }),

  body: z
    .strictObject({
      name: categoryFields.name.optional(),
      slug: categoryFields.slug.optional(),
      description: categoryFields.description,
      image: categoryFields.image,
      parent: categoryFields.parent.nullable(),
      isActive: categoryFields.isActive,
      sortOrder: categoryFields.sortOrder,
    })
    .refine(
      (data) => Object.keys(data).length > 0,
      {
        message: "At least one field must be provided for update",
      },
    ),
};

/**
 * Category ID parameter validation.
 */
export const categoryIdSchema = {
  params: z.strictObject({
    categoryId: z
      .string()
      .regex(
        /^[a-fA-F0-9]{24}$/,
        "Category ID must be a valid MongoDB ObjectId",
      ),
  }),
};

/**
 * Category slug parameter validation.
 */
export const categorySlugSchema = {
  params: z.strictObject({
    slug: categoryFields.slug,
  }),
};

// Visibility is server-controlled; unknown public filters are rejected.
const publicQueryFields = {
  search: z.string().trim().min(1).max(100).optional(),
  slug: categoryFields.slug.optional(),
  page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100000)).default(1),
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100)).default(20),
  sortBy: z.enum(["name", "sortOrder", "createdAt"]).default("sortOrder"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
};
export const publicCategoryListSchema = {
  query: z.strictObject({
    ...publicQueryFields,
    parent: z.union([z.literal("root"), categoryFields.parent.unwrap()]).optional(),
  }),
};
export const publicRootCategoriesSchema = { query: z.strictObject(publicQueryFields) };
export const publicChildCategoriesSchema = {
  params: categoryIdSchema.params,
  query: z.strictObject(publicQueryFields),
};
