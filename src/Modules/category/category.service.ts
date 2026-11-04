
import { Types, type QueryFilter, type UpdateQuery } from "mongoose";

import { categoryRepository } from "../../DB/repository/category.repository";
import { productRepository } from "../../DB/repository/product.repository";

import {
  PublicCategoryListDTO,
  CreateCategoryDTO,
  UpdateCategoryDTO,
} from "./category.dto";

import { ICategory, CategoryDocument } from "../../DB/models/category/category.interface";
import { BadRequestException, ConflictException, NotFoundException } from "../../Utils/response/error.response";



type CategoryTreeNode = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  isActive: boolean;
  sortOrder: number;
  parent?: Types.ObjectId;
  children: CategoryTreeNode[];
  productCount: number;
  totalProductCount: number;
};

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
      await this.validateCategoryHierarchy(undefined, new Types.ObjectId(parent));
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
  async getCategoryById(categoryId: string, includeCounts = false) {
    const category =
      await categoryRepository.findCategoryById(
        new Types.ObjectId(categoryId),
      );

    if (!category) {
      throw new NotFoundException("Category not found");
    }

    if (includeCounts) {
      const [result] = await this.addProductCounts([category], false);
      return result!;
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

    await this.assertPublicCategory(category._id);
    const [result] = await this.addProductCounts([category], true);
    return result!;
  }

  /**
   * Get all categories.
   */
  async getCategories() {
    const categories = await categoryRepository.findCategories();
    return this.addProductCounts(categories, false, categories);
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
      await this.assertPublicCategory(new Types.ObjectId(query.parent));
      filter.parent = new Types.ObjectId(query.parent);
    }
    if (query.slug) filter.slug = query.slug;
    if (query.search) {
      // Escape regex metacharacters so search is literal.
      filter.name = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }
    // Filter before pagination/counting so hidden descendants cannot leak in totals.
    const tree = await this.getCategoryTree(false);
    const visibleIds: Types.ObjectId[] = [];
    const pending = [...tree];
    while (pending.length) {
      const category = pending.pop()!;
      visibleIds.push(category._id);
      pending.push(...category.children);
    }
    filter._id = { $in: visibleIds };
    const result = await categoryRepository.findPublicCategories(filter, query);
    return { ...result, categories: await this.addProductCounts(result.categories, true) };
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

    let updatedCategory;
    try {
      updatedCategory = await categoryRepository.updateCategory(
        { _id: category._id },
        updateData,
      );
    } catch (error) {
      this.handleDuplicateSlugError(error);
    }

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

    const hasProducts = await productRepository.existsProduct({
      category: category._id,
    });

    if (hasProducts) {
      throw new BadRequestException(
        "Cannot delete a category that has assigned products",
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

  // ------------------------------------------------------------





  /**
   * Get the complete active category tree.
   */
  async getCategoryTreeById(categoryId: string): Promise<CategoryTreeNode> {
    const id = new Types.ObjectId(categoryId).toString();
    // Search only the visible tree so ancestors outside the subtree are respected.
    const pending = await this.getCategoryTree();
    while (pending.length) {
      const category = pending.pop()!;
      if (category._id.toString() === id) return category;
      pending.push(...category.children);
    }
    throw new NotFoundException("Category not found");
  }

  /** Get the complete active category tree. */
  async getCategoryTree(includeCounts = true): Promise<CategoryTreeNode[]> {
    const categories =
      await categoryRepository.findAllActiveCategories();

    const categoryMap = new Map<string, CategoryTreeNode>();
    const counts = includeCounts ? await this.getProductCountMap(true, categories) : new Map();

    // First pass: create a node for every category.
    for (const category of categories) {
      const id = category._id.toString();

      categoryMap.set(id, {
        _id: category._id,
        name: category.name,
        slug: category.slug,
        ...(category.description !== undefined && { description: category.description }),
        ...(category.image !== undefined && { image: category.image }),
        isActive: category.isActive,
        sortOrder: category.sortOrder,
        ...(category.parent !== undefined && { parent: category.parent }),
        children: [],
        productCount: counts.get(id)?.productCount ?? 0,
        totalProductCount: counts.get(id)?.totalProductCount ?? 0,
      });
    }

    const rootCategories: CategoryTreeNode[] = [];

    // Second pass: connect each node to its parent.
    for (const category of categoryMap.values()) {
      if (!category.parent) {
        rootCategories.push(category);
        continue;
      }

      const parentId = category.parent.toString();

      const parent = categoryMap.get(parentId);

      if (parent) {
        parent.children.push(category);
      }
    }

    return rootCategories;
  }


  // ------------------------------------------------------------

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
    categoryId: Types.ObjectId | undefined,
    newParentId: Types.ObjectId,
  ) {
    let currentParentId:
      | Types.ObjectId
      | undefined = newParentId;

    const visited = new Set<string>();

    while (currentParentId) {
      const currentId = currentParentId.toString();

      // Prevent category from becoming its own parent.
      if (currentId === categoryId?.toString()) {
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

      if (!currentCategory.isActive) {
        throw new BadRequestException("Cannot assign an inactive parent category");
      }

      currentParentId = currentCategory.parent;
    }
  }

  /** Public lookups fail identically for missing, inactive or broken ancestry. */
  private async assertPublicCategory(categoryId: Types.ObjectId) {
    let currentId: Types.ObjectId | undefined = categoryId;
    const visited = new Set<string>();
    while (currentId) {
      const id = currentId.toString();
      if (visited.has(id)) throw new NotFoundException("Category not found");
      visited.add(id);
      const category = await categoryRepository.findCategoryById(currentId);
      if (!category || !category.isActive) {
        throw new NotFoundException("Category not found");
      }
      currentId = category.parent;
    }
  }

  private async addProductCounts(categories: CategoryDocument[], activeOnly: boolean, hierarchy?: CategoryDocument[]) {
    const counts = await this.getProductCountMap(activeOnly, hierarchy);
    return categories.map(category => ({
      ...(typeof category.toObject === "function" ? category.toObject() : category),
      productCount: counts.get(category._id.toString())?.productCount ?? 0,
      totalProductCount: counts.get(category._id.toString())?.totalProductCount ?? 0,
    }));
  }

  private async getProductCountMap(activeOnly: boolean, hierarchy?: CategoryDocument[]) {
    const [categories, grouped] = await Promise.all([
      hierarchy ?? (activeOnly ? categoryRepository.findAllActiveCategories() : categoryRepository.findCategories()),
      productRepository.countProductsByCategory(activeOnly),
    ]);
    const byId = new Map(categories.map(category => [category._id.toString(), category]));
    const counts = new Map(categories.map(category => [category._id.toString(), { productCount: 0, totalProductCount: 0 }]));
    for (const group of grouped) {
      if (!group._id) continue;
      const id = group._id.toString();
      const direct = counts.get(id);
      if (!direct) continue;
      const ancestors: string[] = [];
      const visited = new Set<string>();
      let current: string | undefined = id;
      while (current && byId.has(current) && !visited.has(current)) {
        visited.add(current);
        ancestors.push(current);
        current = byId.get(current)?.parent?.toString();
      }
      // Public totals exclude categories with hidden or broken ancestry.
      if (activeOnly && current) continue;
      direct.productCount += group.count;
      for (const ancestor of ancestors) counts.get(ancestor)!.totalProductCount += group.count;
    }
    return counts;
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
