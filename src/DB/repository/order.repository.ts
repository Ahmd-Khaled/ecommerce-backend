import mongoose, { Types, type Model } from "mongoose";
import { CartModel } from "../models/cart/cart.model";
import { ProductModel } from "../models/product/product.model";
import { OrderModel } from "../models/order/order.model";
import type { CartDocument, ICart } from "../models/cart/cart.interface";
import type { CheckoutDTO } from "../../Modules/order/order.dto";
import { cartLimits } from "../../Modules/cart/cart.config";
import { BadRequestException, ConflictException } from "../../Utils/response/error.response";

import type { IProduct } from "../models/product/product.interface";

const carts = CartModel as Model<ICart>;
const products = ProductModel as Model<IProduct>;

class OrderRepository {
  async checkout(user: Types.ObjectId, input: CheckoutDTO) {
    // The driver retries transient transaction conflicts, and commits all writes
    // together. Never fall back to non-transactional inventory writes.
    return mongoose.connection.transaction(async session => {
      const cart = await carts.findOne({ user }).session(session).exec() as CartDocument | null;
      if (!cart || cart.items.length === 0) throw new BadRequestException("Cart is empty");
      if (cart.__v !== input.version) throw new ConflictException("Cart changed; refresh before checkout");
      const limits = cartLimits();
      if (cart.items.length > limits.maxItems || cart.items.some(item =>
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > limits.maxQuantity)) {
        throw new BadRequestException("Cart exceeds configured limits");
      }
      const prices = new Map(input.items.map(item => [item.productId.toLowerCase(), item.unitPrice]));
      if (prices.size !== input.items.length || prices.size !== cart.items.length) {
        throw new ConflictException("Checkout items do not match cart");
      }
      const items = [];
      // Sequential operations: parallel queries on one transaction are unsupported.
      for (const item of cart.items) {
        const price = prices.get(item.product.toString());
        if (price === undefined) throw new ConflictException("Checkout items do not match cart");
        const product = await products.findOneAndUpdate({
          _id: item.product, isActive: true, price, stock: { $gte: item.quantity },
        }, { $inc: { stock: -item.quantity } }, {
          session, returnDocument: "after",
        }).exec();
        if (!product) throw new ConflictException("Product price, availability or stock changed; refresh cart");
        items.push({ product: item.product, quantity: item.quantity, unitPrice: product.price as number });
      }
      const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      if (!Number.isFinite(total)) throw new BadRequestException("Invalid order total");
      const [order] = await OrderModel.create([{ user, items, total }], { session });
      const cleared = await carts.updateOne({ _id: cart._id, __v: input.version },
        { $set: { items: [] }, $inc: { __v: 1 } }, { session }).exec();
      if (cleared.modifiedCount !== 1) throw new ConflictException("Cart changed; refresh before checkout");
      return order!;
    });
  }
}
export const orderRepository = new OrderRepository();

