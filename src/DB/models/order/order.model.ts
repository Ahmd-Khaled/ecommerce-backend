import { model, Schema } from "mongoose";

const orderSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  items: { type: [new Schema({
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
  }, { _id: false })], required: true },
  total: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["placed"], default: "placed" },
}, { timestamps: true });

export const OrderModel = model("Order", orderSchema);
