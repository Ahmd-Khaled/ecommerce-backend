import { HydratedDocument, Types } from 'mongoose';

export interface IProduct {
  name: string;
  slug: string;
  description: string;

  // Inventory identifier.
  sku: string;

  // Product pricing.
  price: number;
  compareAtPrice?: number;

  // Available inventory quantity.
  stock: number;

  /** Sum and count of published product reviews. */
  ratingsSum: number;
  ratingsCount: number;

  // Product images.
  images: string[];

  // Reference to the product category.
  category: Types.ObjectId;

  // Product visibility.
  isActive: boolean;

  // Admin who created the product.
  createdBy: Types.ObjectId;
}

export type ProductDocument = HydratedDocument<IProduct>;
