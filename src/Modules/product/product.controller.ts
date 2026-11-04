
import type { RequestHandler } from "express";

import { productService } from "./product.service";

import { UnauthorizedException } from "../../Utils/response/error.response";

import type {
  CreateProductDTO,
  GetProductsDTO,
  ProductIdDTO,
  ProductSlugDTO,
  UpdateProductDTO,
} from "./product.dto";


class ProductController {
  /** Get active and inactive products. Admin only. */
  getAdminProducts: RequestHandler = async (req, res): Promise<void> => {
    const data = await productService.getAdminProducts(
      req.query as unknown as GetProductsDTO,
    );

    res.status(200).json({
      success: true,
      message: "Products retrieved successfully",
      data,
    });
  };

  /**
   * Create a product.
   * Admin only.
   */
  createProduct: RequestHandler<{}, {}, CreateProductDTO> = async (
    req,
    res,
  ): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedException("Missing authenticated user");
    }

    const createdBy = req.user._id;

    const product = await productService.createProduct(
      req.body,
      createdBy,
    );

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: { product },
    });
  };

  /**
   * Get public products with filtering and pagination.
   * Public.
   */
  getPublicProducts: RequestHandler = async (
    req,
    res,
  ): Promise<void> => {
    const data = await productService.getProducts(
      req.query as unknown as GetProductsDTO,
    );

    res.status(200).json({
      success: true,
      message: "Products retrieved successfully",
      data,
    });
  };


  /**
   * Get active product by ID.
   * Public.
   */
  getProductById: RequestHandler<ProductIdDTO> = async (
    req,
    res,
  ): Promise<void> => {
    const { productId } = req.params;

    const product = await productService.getActiveProductById(productId);

    res.status(200).json({
      success: true,
      message: "Product retrieved successfully",
      data: { product },
    });
  };


  /**
   * Get active product by slug.
   * Public.
   */
  getProductBySlug: RequestHandler<ProductSlugDTO> = async (
    req,
    res,
  ): Promise<void> => {
    const { slug } = req.params;

    const product = await productService.getProductBySlug(slug);

    res.status(200).json({
      success: true,
      message: "Product retrieved successfully",
      data: { product },
    });
  };

  /**
   * Get active products belonging to a category.
   * Public.
   */
  getProductsByCategory: RequestHandler<{ categoryId: string }> = async (
    req,
    res,
  ): Promise<void> => {
    const { categoryId } = req.params;

    const data = await productService.getProductsByCategory(
      categoryId,
      req.query as unknown as Omit<GetProductsDTO, "category">,
    );

    res.status(200).json({
      success: true,
      message: "Category products retrieved successfully",
      data,
    });
  };

  /**
   * Update a product.
   * Admin only.
   */
  updateProduct: RequestHandler<ProductIdDTO, {}, UpdateProductDTO> = async (
    req,
    res,
  ): Promise<void> => {
    const { productId } = req.params;

    const product = await productService.updateProduct(
      productId,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: { product },
    });
  };

  /**
   * Delete a product.
   * Admin only.
   */
  deleteProduct: RequestHandler<ProductIdDTO> = async (
    req,
    res,
  ): Promise<void> => {
    const { productId } = req.params;

    const data = await productService.deleteProduct(productId);

    res.status(200).json({
      success: true,
      message: data.message,
    });
  };
}

export const productController = new ProductController();
