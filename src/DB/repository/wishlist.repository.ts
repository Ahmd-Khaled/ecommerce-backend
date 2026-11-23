import { Types } from 'mongoose';
import { WishlistItemModel, WishlistModel } from '../models/wishlist/wishlist.model';

class WishlistRepository {
  async reserve(user: Types.ObjectId, max: number) {
    try {
      await WishlistModel.updateOne(
        { user },
        { $setOnInsert: { user, itemCount: 0 } },
        { upsert: true },
      ).exec();
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
    }
    return WishlistModel.findOneAndUpdate(
      { user, itemCount: { $lt: max } },
      { $inc: { itemCount: 1 } },
      { new: true },
    ).lean().exec();
  }

  async release(user: Types.ObjectId) {
    await WishlistModel.updateOne({ user, itemCount: { $gt: 0 } }, { $inc: { itemCount: -1 } }).exec();
  }

  async insert(user: Types.ObjectId, product: Types.ObjectId) {
    try {
      await WishlistItemModel.create({ user, product });
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return false;
      throw error;
    }
  }

  async remove(user: Types.ObjectId, product: Types.ObjectId) {
    const result = await WishlistItemModel.deleteOne({ user, product }).exec();
    if (result.deletedCount) await this.release(user);
    return result.deletedCount > 0;
  }

  async has(user: Types.ObjectId, product: Types.ObjectId) {
    return !!(await WishlistItemModel.exists({ user, product }).exec());
  }

  async productIds(user: Types.ObjectId, products: Types.ObjectId[]) {
    if (!products.length) return new Set<string>();
    const rows = await WishlistItemModel.find({ user, product: { $in: products } }).select('product').lean().exec() as Array<{ product: Types.ObjectId }>;
    return new Set(rows.map((row) => row.product.toString()));
  }

  async pageRows(user: Types.ObjectId, after?: { addedAt: Date; id: Types.ObjectId }, limit = 20) {
    const cursor = after ? {
      $or: [
        { addedAt: { $lt: after.addedAt } },
        { addedAt: after.addedAt, _id: { $lt: after.id } },
      ],
    } : {};
    return WishlistItemModel.find({ user, ...cursor })
      .sort({ addedAt: -1, _id: -1 }).limit(limit).lean().exec() as unknown as Promise<Array<{ _id: Types.ObjectId; product: Types.ObjectId; addedAt: Date }>>;
  }
}

export const wishlistRepository = new WishlistRepository();
