import { Types } from "mongoose";

import { DatabaseRepository } from "./db.repository";

import { CartModel } from "../models/cart/cart.model";

import type {
  CartDocument,
  ICart,
} from "../models/cart/cart.interface";

class CartRepository extends DatabaseRepository<ICart> {
  constructor() {
    super(CartModel);
  }

  async findCartByUser(
    userId: Types.ObjectId,
  ): Promise<CartDocument | null> {
    return this.model.findOne({ user: userId }).exec();
  }

  async createCart(
    userId: Types.ObjectId,
  ): Promise<CartDocument> {
    try {
      return await this.model.findOneAndUpdate(
        { user: userId },
        { $setOnInsert: { user: userId, items: [], __v: 0 } },
        { upsert: true, returnDocument: "after", runValidators: true },
      ).exec() as CartDocument;
    } catch (error) {
      // Another request may win the unique user index race.
      if ((error as { code?: number }).code !== 11000) throw error;
      const cart = await this.findCartByUser(userId);
      if (!cart) throw error;
      return cart;
    }
  }

  async deleteCartByUser(
    userId: Types.ObjectId,
  ) {
    return this.model.deleteOne({ user: userId }).exec();
  }
}

export const cartRepository = new CartRepository();
