import { model, models, Schema } from "mongoose";

import type { ICart } from "./cart.interface";

const cartItemSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Cart product is required"],
    },

    quantity: {
      type: Number,
      required: [true, "Cart item quantity is required"],
      min: [1, "Cart item quantity must be at least 1"],
      validate: {
        validator: Number.isInteger,
        message: "Cart item quantity must be an integer",
      },
    },
  },
  {
    _id: false,
  },
);

const cartSchema = new Schema<ICart>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Cart user is required"],
    },

    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

// A user must have only one cart.
cartSchema.index({ user: 1 }, { unique: true });

export const CartModel =
  models.Cart || model<ICart>("Cart", cartSchema);
