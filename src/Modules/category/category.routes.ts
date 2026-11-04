
import { Router } from "express";

import { categoryController } from "./category.controller";

import {
  publicCategoryListSchema,
  publicRootCategoriesSchema,
  publicChildCategoriesSchema,
  createCategorySchema,
  updateCategorySchema,
  categoryIdSchema,
  categorySlugSchema,
} from "./category.validation";

import { validations } from "../../Middlewares/validation.middlewares";

import {
  authentication,
} from "../../Middlewares/authentication.middlewares";
import { TokenTypeEnum } from "../../Utils/security/token";

import { RoleEnum } from "../../DB/models/user/user.interface";

const router = Router();

/**
 * Public routes
 */

// GET /api/v1/categories/list
router.get("/list", validations(publicCategoryListSchema), categoryController.getPublicCategories);

// GET /api/v1/categories/active
router.get(
  "/active",
  validations(publicCategoryListSchema),
  categoryController.getActiveCategories,
);

// GET /api/v1/categories/root
router.get(
  "/root",
  validations(publicRootCategoriesSchema),
  categoryController.getRootCategories,
);


/**
 * GET /api/v1/categories/tree
 * Public.
 */
router.get(
  "/tree",
  categoryController.getCategoryTree,
);

// GET /api/v1/categories/slug/:slug
// Keep the literal /slug prefix before the parameterized category routes.
router.get(
  "/slug/:slug",
  validations(categorySlugSchema),
  categoryController.getCategoryBySlug,
);

// GET /api/v1/categories/:categoryId/children
router.get(
  "/:categoryId/children",
  validations(publicChildCategoriesSchema),
  categoryController.getChildCategories,
);

// GET /api/v1/categories/:categoryId/tree
router.get(
  "/:categoryId/tree",
  validations(categoryIdSchema),
  categoryController.getCategoryTreeById,
);

/**
 * Admin routes
 */

// Apply authentication and admin authorization.
router.use(
  authentication(TokenTypeEnum.ACCESS, [RoleEnum.ADMIN]),
);

// GET /api/v1/categories
router.get(
  "/",
  categoryController.getCategories,
);

// GET /api/v1/categories/:categoryId
router.get(
  "/:categoryId",
  validations(categoryIdSchema),
  categoryController.getCategoryById,
);

// POST /api/v1/categories
router.post(
  "/",
  validations(createCategorySchema),
  categoryController.createCategory,
);

// PATCH /api/v1/categories/:categoryId
router.patch(
  "/:categoryId",
  validations(updateCategorySchema),
  categoryController.updateCategory,
);

// DELETE /api/v1/categories/:categoryId
router.delete(
  "/:categoryId",
  validations(categoryIdSchema),
  categoryController.deleteCategory,
);



export const categoryRouter = router;
