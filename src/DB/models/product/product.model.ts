
import {
  Query,
  model,
  models,
  Schema,
} from "mongoose";

import {
  IProduct,
} from "./product.interface";

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      minlength: [2, "Product name must be at least 2 characters"],
      maxlength: [150, "Product name cannot exceed 150 characters"],
    },

    slug: {
      type: String,
      required: [true, "Product slug is required"],
      trim: true,
      lowercase: true,
      unique: true,
      minlength: [2, "Product slug must be at least 2 characters"],
      maxlength: [180, "Product slug cannot exceed 180 characters"],
      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must contain lowercase letters, numbers, and hyphens only",
      ],
    },

    description: {
      type: String,
      required: [true, "Product description is required"],
      trim: true,
      minlength: [10, "Description must be at least 10 characters"],
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },

    sku: {
      type: String,
      required: [true, "Product SKU is required"],
      trim: true,
      uppercase: true,
      unique: true,
      minlength: [3, "SKU must be at least 3 characters"],
      maxlength: [100, "SKU cannot exceed 100 characters"],
      match: [
        /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
        "SKU must contain uppercase letters, numbers, and hyphens only",
      ],
    },

    price: {
      type: Number,
      required: [true, "Product price is required"],
      min: [0, "Product price cannot be negative"],
    },

    compareAtPrice: {
      type: Number,
      min: [0, "Original price cannot be negative"],
      validate: {
        validator: function (this: IProduct | Query<unknown, IProduct>, value?: number) {
          if (value === undefined) {
            return true;
          }

          const price = this instanceof Query ? this.get("price") : this.price;
          return value > price;
        },
        message: "Original price must be greater than selling price",
      },
    },

    stock: {
      type: Number,
      required: [true, "Product stock is required"],
      default: 0,
      min: [0, "Product stock cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Product stock must be an integer",
      },
    },

    images: {
      type: [String],
      required: [true, "Product images are required"],
      validate: {
        validator: function (images: string[]) {
          return images.length > 0;
        },
        message: "A product must have at least one image",
      },
    },

    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Product category is required"],
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Product creator is required"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes for common queries.
productSchema.index({ category: 1, isActive: 1 });

productSchema.index({ isActive: 1, price: 1 });

productSchema.index({ createdAt: -1 });

// Compare-at price must be greater than selling price.
productSchema.pre("validate", function () {
  if (
    this.compareAtPrice !== undefined &&
    this.compareAtPrice <= this.price
  ) {
    this.invalidate(
      "compareAtPrice",
      "Original price must be greater than selling price",
    );
  }
});

export const ProductModel =
  models.Product ||
  model<IProduct>("Product", productSchema);
