
import { Router } from "express";

import { productController } from "./product.controller";

import {
  publicProductListSchema,
  productCategoryIdSchema,
  createProductSchema,
  updateProductSchema,
  productIdSchema,
  productSlugSchema,
} from "./product.validation";

import { validations } from "../../Middlewares/validation.middlewares";

import { authentication } from "../../Middlewares/authentication.middlewares";
import { TokenTypeEnum } from "../../Utils/security/token";

import { RoleEnum } from "../../DB/models/user/user.interface";


const router = Router();

/**
 * Public routes
 */

// GET /api/v1/products/list
router.get(
  "/list",
  validations(publicProductListSchema),
  productController.getPublicProducts,
);


// GET /api/v1/products/slug/:slug
// Keep this route before parameterized product routes.
router.get(
  "/slug/:slug",
  validations({ params: productSlugSchema }),
  productController.getProductBySlug,
);


// GET /api/v1/products/category/:categoryId
router.get(
  "/category/:categoryId",
  validations(productCategoryIdSchema),
  validations(publicProductListSchema),
  productController.getProductsByCategory,
);


// GET /api/v1/products/:productId
router.get(
  "/:productId",
  validations({ params: productIdSchema }),
  productController.getProductById,
);

/**
 * Admin routes
 */

// Apply authentication and admin authorization.
router.use(
  authentication(TokenTypeEnum.ACCESS, [RoleEnum.ADMIN]),
);


// GET /api/v1/products — includes active and inactive products.
router.get(
  "/",
  validations(publicProductListSchema),
  productController.getAdminProducts,
);

// POST /api/v1/products
router.post(
  "/",
  validations({ body: createProductSchema }),
  productController.createProduct,
);

// PATCH /api/v1/products/:productId
router.patch(
  "/:productId",
  validations({ params: productIdSchema, body: updateProductSchema }),
  productController.updateProduct,
);

// DELETE /api/v1/products/:productId
router.delete(
  "/:productId",
  validations({ params: productIdSchema }),
  productController.deleteProduct,
);

export const productRouter = router;
