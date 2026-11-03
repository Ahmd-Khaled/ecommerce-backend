
import { HydratedDocument, Types } from "mongoose";

export interface ICategory {
  name: string;
  slug: string;
  description?: string;
  image?: string;

  // Reference to the parent category.
  // Undefined means this is a root category.
  parent?: Types.ObjectId;

  isActive: boolean;
  sortOrder: number;

  // Admin who created the category.
  createdBy: Types.ObjectId;
}

export type CategoryDocument = HydratedDocument<ICategory>;
