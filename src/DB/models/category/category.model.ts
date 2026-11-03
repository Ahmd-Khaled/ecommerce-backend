
import {
  model,
  models,
  Schema,
} from "mongoose";

import {
  ICategory,
} from "./category.interface";

const categorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      minlength: [2, "Category name must be at least 2 characters"],
      maxlength: [100, "Category name cannot exceed 100 characters"],
    },

    slug: {
      type: String,
      required: [true, "Category slug is required"],
      trim: true,
      lowercase: true,
      unique: true,
      minlength: [2, "Category slug must be at least 2 characters"],
      maxlength: [120, "Category slug cannot exceed 120 characters"],
      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must contain lowercase letters, numbers, and hyphens only",
      ],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },

    image: {
      type: String,
      trim: true,
    },

    parent: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: undefined,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
      min: [0, "Sort order cannot be negative"],
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Category creator is required"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes
categorySchema.index({ parent: 1, sortOrder: 1 });
categorySchema.index({ isActive: 1, sortOrder: 1 });

export const CategoryModel =
  models.Category ||
  model<ICategory>("Category", categorySchema);
