
import type { RequestHandler } from "express";

import { categoryService } from "./category.service";
import { UnauthorizedException } from "../../Utils/response/error.response";

import type {
  PublicCategoryListDTO,
  CreateCategoryDTO,
  UpdateCategoryDTO,
  CategoryIdDTO,
  CategorySlugDTO,
} from "./category.dto";

class CategoryController {
  /**
   * Create a category.
   * Admin only.
   */
  createCategory: RequestHandler<{}, {}, CreateCategoryDTO> = async (req, res): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedException("Missing authenticated user");
    }

    const createdBy = req.user._id;

    const category = await categoryService.createCategory(
      req.body,
      createdBy,
    );

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: { category },
    });
  };

  /**
   * Get all categories.
   * Admin only.
   */
  getCategories: RequestHandler = async (req, res): Promise<void> => {
    const categories =
      await categoryService.getCategories();

    res.status(200).json({
      success: true,
      message: "Categories retrieved successfully",
      data: { categories },
    });
  };

  /**
   * Get active categories.
   * Public.
   */
  getPublicCategories: RequestHandler = async (req, res): Promise<void> => {
    const data = await categoryService.getPublicCategories(req.query as unknown as PublicCategoryListDTO);
    res.status(200).json({ success: true, message: "Categories retrieved successfully", data });
  };

  getActiveCategories: RequestHandler = async (req, res): Promise<void> => {
    const data =
      await categoryService.getActiveCategories(req.query as unknown as PublicCategoryListDTO);

    res.status(200).json({
      success: true,
      message: "Categories retrieved successfully",
      data,
    });
  };

  /**
   * Get root categories.
   * Public.
   */
  getRootCategories: RequestHandler = async (req, res): Promise<void> => {
    const data =
      await categoryService.getRootCategories(req.query as unknown as PublicCategoryListDTO);

    res.status(200).json({
      success: true,
      message: "Root categories retrieved successfully",
      data,
    });
  };

  /**
   * Get category by ID.
   * Admin only.
   */
  getCategoryById: RequestHandler<CategoryIdDTO> = async (req, res): Promise<void> => {
    const { categoryId } = req.params;

    const category =
      await categoryService.getCategoryById(categoryId);

    res.status(200).json({
      success: true,
      message: "Category retrieved successfully",
      data: { category },
    });
  };

  /**
   * Get category by slug.
   * Public.
   */
  getCategoryBySlug: RequestHandler<CategorySlugDTO> = async (req, res): Promise<void> => {
    const { slug } = req.params;

    const category =
      await categoryService.getCategoryBySlug(slug);

    res.status(200).json({
      success: true,
      message: "Category retrieved successfully",
      data: { category },
    });
  };

  /**
   * Get direct child categories.
   * Public.
   */
  getChildCategories: RequestHandler<CategoryIdDTO> = async (req, res): Promise<void> => {
    const { categoryId } = req.params;

    const data =
      await categoryService.getChildCategories(categoryId, req.query as unknown as PublicCategoryListDTO);

    res.status(200).json({
      success: true,
      message: "Child categories retrieved successfully",
      data,
    });
  };

  /**
   * Update a category.
   * Admin only.
   */
  updateCategory: RequestHandler<CategoryIdDTO, {}, UpdateCategoryDTO> = async (req, res): Promise<void> => {
    const { categoryId } = req.params;

    const category =
      await categoryService.updateCategory(
        categoryId,
        req.body,
      );

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: { category },
    });
  };

  /**
   * Delete a category.
   * Admin only.
   */
  deleteCategory: RequestHandler<CategoryIdDTO> = async (req, res): Promise<void> => {
    const { categoryId } = req.params;

    await categoryService.deleteCategory(categoryId);

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  };
}

export const categoryController = new CategoryController();
