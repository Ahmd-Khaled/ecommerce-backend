import { type ClientSession, type QueryFilter, type UpdateQuery, Types } from 'mongoose';

import { DatabaseRepository } from './db.repository';
import { ProductModel } from '../models/product/product.model';
import { IProduct, ProductDocument } from '../models/product/product.interface';

export interface ProductQueryOptions {
  skip?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
}

class ProductRepository extends DatabaseRepository<IProduct> {
  async countProductsByCategory(activeOnly: boolean, session?: ClientSession) {
    return this.model
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: activeOnly ? { isActive: true } : {} },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ])
      .session(session ?? null)
      .exec();
  }

  constructor() {
    super(ProductModel);
  }

  async createProduct(data: Partial<IProduct>, session?: ClientSession): Promise<ProductDocument> {
    const [product] = await this.model.create([data], {
      session: session ?? null,
    });
    return product!;
  }

  async findProductById(
    productId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ProductDocument | null> {
    return this.model
      .findById(productId)
      .setOptions({ session: session ?? null })
      .exec();
  }

  async findProductBySlug(slug: string): Promise<ProductDocument | null> {
    return this.model.findOne({ slug }).exec();
  }

  async findProductBySKU(sku: string): Promise<ProductDocument | null> {
    return this.model.findOne({ sku }).exec();
  }

  async findProducts(
    filter: QueryFilter<IProduct> = {},
    options: ProductQueryOptions = {},
  ): Promise<ProductDocument[]> {
    const { skip = 0, limit = 20, sort = { createdAt: -1 } } = options;

    return this.model.find(filter).sort(sort).skip(skip).limit(limit).exec();
  }

  async findActiveProducts(
    filter: QueryFilter<IProduct> = {},
    options: ProductQueryOptions = {},
  ): Promise<ProductDocument[]> {
    return this.findProducts(
      {
        ...filter,
        isActive: true,
      },
      options,
    );
  }

  async findProductsByCategory(
    categoryId: Types.ObjectId,
    options: ProductQueryOptions = {},
  ): Promise<ProductDocument[]> {
    return this.findProducts(
      {
        category: categoryId,
        isActive: true,
      },
      options,
    );
  }

  async countProducts(filter: QueryFilter<IProduct> = {}): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  async countActiveProducts(filter: QueryFilter<IProduct> = {}): Promise<number> {
    return this.model
      .countDocuments({
        ...filter,
        isActive: true,
      })
      .exec();
  }

  async updateProduct(
    productId: Types.ObjectId,
    update: UpdateQuery<IProduct>,
    session?: ClientSession,
    expected?: { value: unknown },
  ) {
    return this.model
      .findOneAndUpdate(
        {
          _id: productId,
          ...(expected ? { images: expected.value as string[] } : {}),
        },
        update,
        {
          returnDocument: 'after',
          session: session ?? null,
          runValidators: true,
        },
      )
      .exec();
  }

  async deleteProduct(productId: Types.ObjectId): Promise<ProductDocument | null> {
    // Preserve inventory records for historical orders and cancellation.
    return this.model
      .findByIdAndUpdate(productId, { $set: { isActive: false } }, { returnDocument: 'after' })
      .exec();
  }

  async existsProduct(
    filter: QueryFilter<IProduct>,
    session?: ClientSession,
  ): Promise<{ _id: Types.ObjectId } | null> {
    return this.model
      .exists(filter)
      .setOptions({ session: session ?? null })
      .exec();
  }
}

export const productRepository = new ProductRepository();
