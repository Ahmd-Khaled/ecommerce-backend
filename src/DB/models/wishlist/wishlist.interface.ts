import { HydratedDocument, Types } from 'mongoose';

export interface IWishlist {
  user: Types.ObjectId;
  itemCount: number;
}

export interface IWishlistItem {
  user: Types.ObjectId;
  product: Types.ObjectId;
  addedAt: Date;
}

export type WishlistDocument = HydratedDocument<IWishlist>;
export type WishlistItemDocument = HydratedDocument<IWishlistItem>;
