
import { QueryFilter, Types, UpdateQuery } from "mongoose";

import { DatabaseRepository } from "./db.repository";
import {
  ICategory,
  CategoryDocument,
} from "../models/category/category.interface";
import { CategoryModel } from "../models/category/category.model";

class CategoryRepository extends DatabaseRepository<ICategory> {
  constructor() {
    super(CategoryModel);
  }

  async findPublicCategories(
    filter: QueryFilter<ICategory>,
    options: { page: number; limit: number; sortBy: "name" | "sortOrder" | "createdAt"; sortOrder: "asc" | "desc" },
  ) {
    const publicFilter = { ...filter, isActive: true };
    const direction = options.sortOrder === "asc" ? 1 : -1;
    const [categories, total] = await Promise.all([
      this.model.find(publicFilter)
        .sort({ [options.sortBy]: direction, _id: 1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit).exec(),
      this.model.countDocuments(publicFilter).exec(),
    ]);
    return {
      categories,
      pagination: { page: options.page, limit: options.limit, total, totalPages: Math.ceil(total / options.limit) },
    };
  }

  /**
   * Create a new category.
   */
  async createCategory(
    data: Partial<ICategory>,
  ): Promise<CategoryDocument> {
    return this.model.create(data);
  }

  /**
   * Find a category by its MongoDB ID.
   */
  async findCategoryById(
    id: Types.ObjectId,
  ): Promise<CategoryDocument | null> {
    return this.model.findById(id).exec();
  }

  /**
   * Find a category by its unique slug.
   */
  async findCategoryBySlug(
    slug: string,
  ): Promise<CategoryDocument | null> {
    return this.model.findOne({ slug, isActive: true }).exec();
  }

  /**
   * Find categories using a filter.
   */
  async findCategories(
    filter: QueryFilter<ICategory> = {},
  ): Promise<CategoryDocument[]> {
    return this.model.find(filter).exec();
  }

  /**
   * Find all direct children of a category.
   */
  async findChildCategories(
    parentId: Types.ObjectId,
  ): Promise<CategoryDocument[]> {
    return this.model
      .find({ parent: parentId, isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  /**
   * Find root categories.
   */
  async findRootCategories(): Promise<CategoryDocument[]> {
    return this.model
      .find({ parent: { $exists: false }, isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  /**
   * Find active categories.
   */
  async findActiveCategories(): Promise<CategoryDocument[]> {
    return this.model
      .find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  /**
   * Update a category.
   */
  async updateCategory(
    filter: QueryFilter<ICategory>,
    update: UpdateQuery<ICategory>,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findOneAndUpdate(filter, update, {
        afterDocument: true,
        runValidators: true,
      })
      .exec();
  }

  /**
   * Delete a category.
   */
  async deleteCategory(
    id: Types.ObjectId,
  ): Promise<CategoryDocument | null> {
    return this.model.findByIdAndDelete(id).exec();
  }

  /**
   * Check whether a category has children.
   */
  async hasChildCategories(
    parentId: Types.ObjectId,
  ): Promise<boolean> {
    const child = await this.model
      .exists({ parent: parentId })
      .exec();

    return Boolean(child);
  }

  // -------------------------------------------------

  /**
   * Find an active category by ID.
   */
  async findActiveCategoryById(
    id: Types.ObjectId,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findOne({
        _id: id,
        isActive: true,
      })
      .exec();
  }

  /**
   * Find an active category by slug.
   */
  async findActiveCategoryBySlug(
    slug: string,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findOne({
        slug,
        isActive: true,
      })
      .exec();
  }

  /**
   * Find active root categories.
   */
  async findActiveRootCategories(): Promise<CategoryDocument[]> {
    return this.model
      .find({
        isActive: true,
        parent: { $exists: false },
      })
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  /**
   * Find active direct children of a category.
   */
  async findActiveChildCategories(
    parentId: Types.ObjectId,
  ): Promise<CategoryDocument[]> {
    return this.model
      .find({
        parent: parentId,
        isActive: true,
      })
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  /**
   * Retrieve all active categories.
   */
  async findAllActiveCategories(): Promise<CategoryDocument[]> {
    return this.model
      .find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

}

export const categoryRepository = new CategoryRepository();
