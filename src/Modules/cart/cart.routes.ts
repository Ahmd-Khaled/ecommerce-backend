import { Router } from "express";

import { cartController } from "./cart.controller";

import {
  addCartItemSchema,
  adjustCartItemSchema,
  updateCartItemSchema,
  cartProductIdSchema,
} from "./cart.validation";

import { validations } from "../../Middlewares/validation.middlewares";

import { authentication } from "../../Middlewares/authentication.middlewares";

import { TokenTypeEnum } from "../../Utils/security/token";
import { RoleEnum } from "../../DB/models/user/user.interface";

const router = Router();

/**
 * Apply authentication to all Cart routes.
 */
router.use(
  authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]),
);

/**
 * GET /api/v1/cart
 *
 * Get the authenticated user's cart.
 */
router.get(
  "/",
  cartController.getCart,
);

/**
 * POST /api/v1/cart/items
 *
 * Add a product to the cart.
 */
router.post(
  "/items",
  validations({
    body: addCartItemSchema,
  }),
  cartController.addCartItem,
);

/**
 * PATCH /api/v1/cart/items/:productId
 *
 * Update a product's quantity.
 */
router.patch(
  "/items/:productId",
  validations({
    params: cartProductIdSchema,
    body: updateCartItemSchema,
  }),
  cartController.updateCartItem,
);

/** Increase or decrease the current quantity (defaults to 1). */
router.patch(
  "/items/:productId/increase",
  validations({ params: cartProductIdSchema, body: adjustCartItemSchema }),
  cartController.increaseCartItem,
);

router.patch(
  "/items/:productId/decrease",
  validations({ params: cartProductIdSchema, body: adjustCartItemSchema }),
  cartController.decreaseCartItem,
);

/**
 * DELETE /api/v1/cart/items/:productId
 *
 * Remove a product from the cart.
 */
router.delete(
  "/items/:productId",
  validations({
    params: cartProductIdSchema,
  }),
  cartController.removeCartItem,
);

/**
 * DELETE /api/v1/cart/clear
 *
 * Clear all items from the cart.
 */
router.delete(
  "/clear",
  cartController.clearCart,
);

export const cartRouter = router;
