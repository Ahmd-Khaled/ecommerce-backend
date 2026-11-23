import { model, models, Schema, type Model } from 'mongoose';
import type { IWishlist, IWishlistItem } from './wishlist.interface';

const wishlistSchema = new Schema<IWishlist>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    itemCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);
wishlistSchema.index({ user: 1 }, { unique: true });

const wishlistItemSchema = new Schema<IWishlistItem>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    addedAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false },
);
wishlistItemSchema.index({ user: 1, product: 1 }, { unique: true });
wishlistItemSchema.index({ user: 1, addedAt: -1, _id: -1 });

export const WishlistModel = (models.Wishlist as Model<IWishlist> | undefined) ?? model<IWishlist>('Wishlist', wishlistSchema);
export const WishlistItemModel = (models.WishlistItem as Model<IWishlistItem> | undefined) ?? model<IWishlistItem>('WishlistItem', wishlistItemSchema);
