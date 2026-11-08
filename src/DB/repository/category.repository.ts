import { QueryFilter, Types, UpdateQuery, type ClientSession } from 'mongoose';

import { categoryTransactions } from './category.transaction';

import { DatabaseRepository } from './db.repository';
import { ICategory, CategoryDocument } from '../models/category/category.interface';
import { CategoryModel } from '../models/category/category.model';

class CategoryRepository extends DatabaseRepository<ICategory> {
  withHierarchyTransaction<T>(work: (session: ClientSession) => Promise<T>) {
    return categoryTransactions.write(work);
  }

  withSnapshot<T>(work: (session: ClientSession) => Promise<T>) {
    return categoryTransactions.read(work);
  }

  constructor() {
    super(CategoryModel);
  }

  async findPublicCategories(
    filter: QueryFilter<ICategory>,
    options: {
      page: number;
      limit: number;
      sortBy: 'name' | 'sortOrder' | 'createdAt';
      sortOrder: 'asc' | 'desc';
    },
    session?: ClientSession,
  ) {
    const publicFilter = { ...filter, isActive: true };
    const direction = options.sortOrder === 'asc' ? 1 : -1;
    const categories = await this.model
      .find(publicFilter)
      .sort({ [options.sortBy]: direction, _id: 1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .setOptions({ session: session ?? null })
      .exec();
    const total = await this.model
      .countDocuments(publicFilter)
      .setOptions({ session: session ?? null })
      .exec();
    return {
      categories,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  /**
   * Create a new category.
   */
  async createCategory(
    data: Partial<ICategory>,
    session?: ClientSession,
  ): Promise<CategoryDocument> {
    const [category] = await this.model.create([data], {
      session: session ?? null,
    });
    return category!;
  }

  /**
   * Find a category by its MongoDB ID.
   */
  async findCategoryById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findById(id)
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Find a category by its unique slug.
   */
  async findCategoryBySlug(
    slug: string,
    session?: ClientSession,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findOne({ slug, isActive: true })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Find categories using a filter.
   */
  async findCategories(
    filter: QueryFilter<ICategory> = {},
    session?: ClientSession,
  ): Promise<CategoryDocument[]> {
    return this.model
      .find(filter)
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Find all direct children of a category.
   */
  async findChildCategories(
    parentId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CategoryDocument[]> {
    return this.model
      .find({ parent: parentId, isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Find root categories.
   */
  async findRootCategories(session?: ClientSession): Promise<CategoryDocument[]> {
    return this.model
      .find({ parent: { $exists: false }, isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Find active categories.
   */
  async findActiveCategories(session?: ClientSession): Promise<CategoryDocument[]> {
    return this.model
      .find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Update a category.
   */
  async updateCategory(
    filter: QueryFilter<ICategory>,
    update: UpdateQuery<ICategory>,
    session?: ClientSession,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findOneAndUpdate(filter, update, {
        returnDocument: 'after',
        runValidators: true,
      })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Delete a category.
   */
  async deleteCategory(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findByIdAndDelete(id)
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Check whether a category has children.
   */
  async hasChildCategories(parentId: Types.ObjectId, session?: ClientSession): Promise<boolean> {
    const child = await this.model
      .exists({ parent: parentId })
      .setOptions({ session: session ?? null })
      .exec();

    return Boolean(child);
  }

  // -------------------------------------------------

  /**
   * Find an active category by ID.
   */
  async findActiveCategoryById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findOne({
        _id: id,
        isActive: true,
      })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Find an active category by slug.
   */
  async findActiveCategoryBySlug(
    slug: string,
    session?: ClientSession,
  ): Promise<CategoryDocument | null> {
    return this.model
      .findOne({
        slug,
        isActive: true,
      })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Find active root categories.
   */
  async findActiveRootCategories(session?: ClientSession): Promise<CategoryDocument[]> {
    return this.model
      .find({
        isActive: true,
        parent: { $exists: false },
      })
      .sort({ sortOrder: 1, name: 1 })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Find active direct children of a category.
   */
  async findActiveChildCategories(
    parentId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CategoryDocument[]> {
    return this.model
      .find({
        parent: parentId,
        isActive: true,
      })
      .sort({ sortOrder: 1, name: 1 })
      .setOptions({ session: session ?? null })
      .exec();
  }

  /**
   * Retrieve all active categories.
   */
  async findAllActiveCategories(session?: ClientSession): Promise<CategoryDocument[]> {
    return this.model
      .find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .setOptions({ session: session ?? null })
      .exec();
  }
}

export const categoryRepository = new CategoryRepository();
