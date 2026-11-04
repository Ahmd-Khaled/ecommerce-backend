import { Types, type QueryFilter } from "mongoose";

import { productRepository } from "../../DB/repository/product.repository";
import { categoryRepository } from "../../DB/repository/category.repository";

import type { IProduct } from "../../DB/models/product/product.interface";

import type {
  CreateProductDTO,
  UpdateProductDTO,
  GetProductsDTO,
} from "./product.dto";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "../../Utils/response/error.response";

class ProductService {
  /** Create a product in an active category. */
  async createProduct(
    data: CreateProductDTO,
    createdBy: Types.ObjectId,
  ) {
    await this.validateActiveCategory(data.category);

    if (
      data.compareAtPrice !== undefined &&
      data.compareAtPrice <= data.price
    ) {
      throw new BadRequestException(
        "Compare-at price must be greater than the current price",
      );
    }

    try {
      return await productRepository.createProduct({
        ...this.getProductFields(data),
        category: new Types.ObjectId(data.category),
        createdBy,
      });
    } catch (error) {
      this.handleDuplicateKeyError(error);
    }
  }

  /** Get a product for management. */
  async getProductById(productId: string) {
    return this.getProductOrThrow(productId);
  }

  /** Get an active product for the storefront. */
  async getActiveProductById(productId: string) {
    const product = await this.getProductOrThrow(productId);

    if (!product.isActive) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  /** Get an active product by slug. */
  async getProductBySlug(slug: string) {
    const product = await productRepository.findProductBySlug(slug);

    if (!product || !product.isActive) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  /** Get a product by inventory identifier. */
  async getProductBySKU(sku: string) {
    const product = await productRepository.findProductBySKU(sku);

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  /** Get active products with filtering and pagination. */
  async getProducts(query: GetProductsDTO) {
    return this.listProducts(query, true);
  }

  /** Get active and inactive products for management. */
  async getAdminProducts(query: GetProductsDTO) {
    return this.listProducts(query, false);
  }

  private async listProducts(query: GetProductsDTO, activeOnly: boolean) {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      minPrice,
      maxPrice,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = query;

    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException("Page must be a positive integer");
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException(
        "Limit must be an integer between 1 and 100",
      );
    }

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      throw new BadRequestException(
        "Minimum price cannot be greater than maximum price",
      );
    }

    const filter: QueryFilter<IProduct> = activeOnly ? { isActive: true } : {};

    if (category) {
      await this.validateActiveCategory(category);

      filter.category = new Types.ObjectId(category);
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};

      if (minPrice !== undefined) {
        filter.price.$gte = minPrice;
      }

      if (maxPrice !== undefined) {
        filter.price.$lte = maxPrice;
      }
    }

    if (search?.trim()) {
      const escapedSearch = search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { description: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === "asc" ? 1 : -1,
    };

    const [products, total] = await Promise.all([
      productRepository.findProducts(filter, {
        skip,
        limit,
        sort,
      }),
      productRepository.countProducts(filter),
    ]);

    return {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  /** Get active products in a category. */
  async getProductsByCategory(
    categoryId: string,
    query: Omit<GetProductsDTO, "category">,
  ) {
    return this.getProducts({
      ...query,
      category: categoryId,
    });
  }

  /** Update supplied fields and validate the resulting prices. */
  async updateProduct(
    productId: string,
    data: UpdateProductDTO,
  ) {
    const existingProduct = await this.getProductOrThrow(productId);

    if (data.category !== undefined) {
      await this.validateActiveCategory(data.category);
    }

    const nextPrice = data.price ?? existingProduct.price;

    const nextCompareAtPrice =
      data.compareAtPrice === null
        ? undefined
        : data.compareAtPrice ?? existingProduct.compareAtPrice;

    if (
      nextCompareAtPrice !== undefined &&
      nextCompareAtPrice <= nextPrice
    ) {
      throw new BadRequestException(
        "Compare-at price must be greater than the current price",
      );
    }

    const { compareAtPrice, category, ...rest } = data;

    const update: Record<string, unknown> = {
      ...rest,
    };

    if (category !== undefined) {
      update.category = new Types.ObjectId(category);
    }

    if (compareAtPrice === null) {
      update.$unset = {
        compareAtPrice: 1,
      };
    } else if (compareAtPrice !== undefined) {
      update.compareAtPrice = compareAtPrice;
    }

    try {
      const updatedProduct = await productRepository.updateProduct(
        new Types.ObjectId(productId),
        update,
      );

      if (!updatedProduct) {
        throw new NotFoundException("Product not found");
      }

      return updatedProduct;
    } catch (error) {
      this.handleDuplicateKeyError(error);
    }
  }

  /** Delete a product. */
  async deleteProduct(productId: string) {
    const product = await this.getProductOrThrow(productId);

    // Later, before deleting a product, check whether it is referenced
    // by existing orders. Products in historical orders should usually
    // be deactivated instead of permanently deleted.

    const deletedProduct = await productRepository.deleteProduct(product._id);

    if (!deletedProduct) {
      throw new NotFoundException("Product not found");
    }

    return {
      message: "Product deleted successfully",
    };
  }
  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /** Map only supplied, editable fields to the persistence model. */
  private getProductFields(data: UpdateProductDTO): Partial<IProduct> {
    return {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.sku !== undefined && { sku: data.sku }),
      ...(data.price !== undefined && { price: data.price }),
      ...(data.stock !== undefined && { stock: data.stock }),
      ...(data.images !== undefined && { images: data.images }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.compareAtPrice !== undefined && data.compareAtPrice !== null && {
        compareAtPrice: data.compareAtPrice,
      }),
    };
  }

  private async validateActiveCategory(categoryId: string) {
    if (!Types.ObjectId.isValid(categoryId)) {
      throw new BadRequestException("Invalid category ID");
    }

    const category = await categoryRepository.findActiveCategoryById(
      new Types.ObjectId(categoryId),
    );

    if (!category) {
      throw new NotFoundException("Category not found");
    }

    return category;
  }

  private async getProductOrThrow(productId: string) {
    if (!Types.ObjectId.isValid(productId)) {
      throw new BadRequestException("Invalid product ID");
    }

    const product = await productRepository.findProductById(
      new Types.ObjectId(productId),
    );

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    );
  }

  private getDuplicateField(error: unknown): string | undefined {
    if (
      typeof error !== "object" ||
      error === null ||
      !("keyPattern" in error)
    ) {
      return undefined;
    }

    const keyPattern = error.keyPattern;

    if (
      typeof keyPattern === "object" &&
      keyPattern !== null
    ) {
      if ("slug" in keyPattern) return "slug";
      if ("sku" in keyPattern) return "sku";
    }

    return undefined;
  }

  private handleDuplicateKeyError(error: unknown): never {
    if (!this.isDuplicateKeyError(error)) {
      throw error;
    }

    const field = this.getDuplicateField(error);

    if (field === "slug") {
      throw new ConflictException("Product slug already exists");
    }

    if (field === "sku") {
      throw new ConflictException("Product SKU already exists");
    }

    throw new ConflictException("A product with these values already exists");
  }

}

export const productService = new ProductService();
