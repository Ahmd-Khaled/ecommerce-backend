
import { Types, type QueryFilter, type UpdateQuery } from "mongoose";

import { categoryRepository } from "../../DB/repository/category.repository";

import {
  PublicCategoryListDTO,
  CreateCategoryDTO,
  UpdateCategoryDTO,
} from "./category.dto";

import { ICategory } from "../../DB/models/category/category.interface";
import { BadRequestException, ConflictException, NotFoundException } from "../../Utils/response/error.response";

class CategoryService {
  /**
   * Create a new category.
   */
  async createCategory(
    data: CreateCategoryDTO,
    createdBy: Types.ObjectId,
  ) {
    const { parent, ...categoryData } = data;

    // Validate parent category if provided.
    if (parent) {
      await this.validateParentCategory(
        new Types.ObjectId(parent),
      );
    }

    try {
      return await categoryRepository.createCategory({
        ...this.getCategoryFields(categoryData),
        ...(parent && {
          parent: new Types.ObjectId(parent),
        }),
        createdBy,
      });
    } catch (error) {
      this.handleDuplicateSlugError(error);
    }
  }

  /**
   * Get category by ID.
   */
  async getCategoryById(categoryId: string) {
    const category =
      await categoryRepository.findCategoryById(
        new Types.ObjectId(categoryId),
      );

    if (!category) {
      throw new NotFoundException("Category not found");
    }

    return category;
  }

  /**
   * Get category by slug.
   */
  async getCategoryBySlug(slug: string) {
    const category =
      await categoryRepository.findCategoryBySlug(slug);

    if (!category) {
      throw new NotFoundException("Category not found");
    }

    return category;
  }

  /**
   * Get all categories.
   */
  async getCategories() {
    return categoryRepository.findCategories();
  }

  /**
   * Get active categories.
   *
   * Used by the public storefront.
   */
  async getActiveCategories(query: PublicCategoryListDTO) {
    return this.getPublicCategories(query);
  }

  /**
   * Get root categories.
   */
  async getRootCategories(query: PublicCategoryListDTO) {
    return this.getPublicCategories({ ...query, parent: "root" });
  }

  /**
   * Get direct child categories.
   */
  async getChildCategories(parentId: string, query: PublicCategoryListDTO) {
    return this.getPublicCategories({ ...query, parent: parentId });
  }

  async getPublicCategories(query: PublicCategoryListDTO) {
    const filter: QueryFilter<ICategory> = {};
    if (query.parent === "root") {
      filter.parent = { $exists: false };
    } else if (query.parent) {
      const parent = await this.getCategoryById(query.parent);
      if (!parent.isActive) {
        throw new NotFoundException("Category not found");
      }
      filter.parent = parent._id;
    }
    if (query.slug) filter.slug = query.slug;
    if (query.search) {
      // Escape regex metacharacters so search is literal.
      filter.name = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }
    return categoryRepository.findPublicCategories(filter, query);
  }

  /**
   * Update category.
   */
  async updateCategory(
    categoryId: string,
    data: UpdateCategoryDTO,
  ) {
    const category =
      await this.getCategoryById(categoryId);

    const { parent, ...categoryData } = data;

    // Validate parent only when the parent field is provided.
    if (parent !== undefined && parent !== null) {
      await this.validateParentCategory(
        new Types.ObjectId(parent),
      );

      await this.validateCategoryHierarchy(
        category._id,
        new Types.ObjectId(parent),
      );
    }

    // null means move category to root level.
    const categoryFields = this.getCategoryFields(categoryData);
    const updateData: UpdateQuery<ICategory> = { $set: categoryFields };

    if (parent !== undefined) {
      if (parent === null) {
        updateData.$unset = { parent: 1 };
      } else {
        categoryFields.parent = new Types.ObjectId(parent);
      }
    }

    const updatedCategory =
      await categoryRepository.updateCategory(
        { _id: category._id },
        updateData,
      );

    if (!updatedCategory) {
      throw new NotFoundException("Category not found");
    }

    return updatedCategory;
  }

  /**
   * Delete category.
   */
  async deleteCategory(categoryId: string) {
    const category =
      await this.getCategoryById(categoryId);

    const hasChildren =
      await categoryRepository.hasChildCategories(
        category._id,
      );

    if (hasChildren) {
      throw new BadRequestException(
        "Cannot delete a category that has child categories",
      );
    }

    const deletedCategory =
      await categoryRepository.deleteCategory(
        category._id,
      );

    if (!deletedCategory) {
      throw new NotFoundException("Category not found");
    }

    return deletedCategory;
  }

  /**
   * Validate that the parent category exists
   * and is not the category itself.
   */
  private async validateParentCategory(
    parentId: Types.ObjectId,
  ) {
    const parent =
      await categoryRepository.findCategoryById(parentId);

    if (!parent) {
      throw new NotFoundException(
        "Parent category not found",
      );
    }

    if (!parent.isActive) {
      throw new BadRequestException(
        "Cannot assign an inactive parent category",
      );
    }

    return parent;
  }

  /**
   * Prevent circular category hierarchies.
   *
   * Example:
   *
   * Electronics
   *   └── Smartphones
   *         └── Android
   *
   * Android cannot become the parent of Electronics.
   */
  private async validateCategoryHierarchy(
    categoryId: Types.ObjectId,
    newParentId: Types.ObjectId,
  ) {
    let currentParentId:
      | Types.ObjectId
      | undefined = newParentId;

    const visited = new Set<string>();

    while (currentParentId) {
      const currentId = currentParentId.toString();

      // Prevent category from becoming its own parent.
      if (currentId === categoryId.toString()) {
        throw new BadRequestException(
          "Cannot create a circular category hierarchy",
        );
      }

      // Defensive protection against existing corrupted cycles.
      if (visited.has(currentId)) {
        throw new BadRequestException(
          "Invalid category hierarchy detected",
        );
      }

      visited.add(currentId);

      const currentCategory =
        await categoryRepository.findCategoryById(
          currentParentId,
        );

      if (!currentCategory) {
        throw new NotFoundException(
          "Parent category not found",
        );
      }

      currentParentId = currentCategory.parent;
    }
  }

  private getCategoryFields(
    data: Omit<UpdateCategoryDTO, "parent">,
  ): Partial<ICategory> {
    return {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.image !== undefined && { image: data.image }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
    };
  }

  /**
   * Handle MongoDB duplicate slug errors.
   */
  private handleDuplicateSlugError(
    error: unknown,
  ): never {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      throw new ConflictException(
        "A category with this slug already exists",
      );
    }

    throw error;
  }
}

export const categoryService = new CategoryService();
