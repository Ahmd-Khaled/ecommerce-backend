import type { RequestHandler } from "express";

import { cartService } from "./cart.service";

import type {
  AddCartItemDTO,
  AdjustCartItemDTO,
  CartProductIdDTO,
  UpdateCartItemDTO,
} from "./cart.dto";

class CartController {
  increaseCartItem: RequestHandler<CartProductIdDTO, {}, AdjustCartItemDTO> = async (req, res): Promise<void> => {
    const data = await cartService.increaseCartItem(req.user!._id, req.params.productId, req.body);
    res.status(200).json({ success: true, message: "Cart item quantity increased successfully", data });
  };

  decreaseCartItem: RequestHandler<CartProductIdDTO, {}, AdjustCartItemDTO> = async (req, res): Promise<void> => {
    const data = await cartService.decreaseCartItem(req.user!._id, req.params.productId, req.body);
    res.status(200).json({ success: true, message: "Cart item quantity decreased successfully", data });
  };

  /**
   * Get the authenticated user's cart.
   */
  getCart: RequestHandler = async (req, res): Promise<void> => {
    const data = await cartService.getCart(req.user!._id);

    res.status(200).json({
      success: true,
      message: "Cart retrieved successfully",
      data,
    });
  };

  /**
   * Add a product to the cart.
   */
  addCartItem: RequestHandler<
    {},
    {},
    AddCartItemDTO
  > = async (req, res): Promise<void> => {
    const data = await cartService.addCartItem(
      req.user!._id,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "Product added to cart successfully",
      data,
    });
  };

  /**
   * Update a product's quantity in the cart.
   */
  updateCartItem: RequestHandler<
    CartProductIdDTO,
    {},
    UpdateCartItemDTO
  > = async (req, res): Promise<void> => {
    const { productId } = req.params;

    const data = await cartService.updateCartItem(
      req.user!._id,
      productId,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "Cart item updated successfully",
      data,
    });
  };

  /**
   * Remove a product from the cart.
   */
  removeCartItem: RequestHandler<
    CartProductIdDTO
  > = async (req, res): Promise<void> => {
    const { productId } = req.params;

    const data = await cartService.removeCartItem(
      req.user!._id,
      productId,
    );

    res.status(200).json({
      success: true,
      message: "Cart item removed successfully",
      data,
    });
  };

  /**
   * Clear the authenticated user's cart.
   */
  clearCart: RequestHandler = async (
    req,
    res,
  ): Promise<void> => {
    const data = await cartService.clearCart(
      req.user!._id,
    );

    res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
      data,
    });
  };
}

export const cartController = new CartController();
