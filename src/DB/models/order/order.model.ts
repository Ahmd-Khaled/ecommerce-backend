import { model, Schema } from 'mongoose';
import { safeMoney } from '../../../Utils/money';
export const orderStatuses = ['placed', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof orderStatuses)[number];
const money = () => ({
  type: Number,
  required: true,
  immutable: true,
  min: 0,
  validate: Number.isSafeInteger,
});
const addressSchema = new Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    country: { type: String, required: true },
    city: { type: String, required: true },
    street: { type: String, required: true },
    building: String,
    apartment: String,
  },
  { _id: false },
);
addressSchema.eachPath((_name, path) => {
  path.options.immutable = true;
  path.immutable(true);
});
const orderSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    schemaVersion: { type: Number, required: true, enum: [2] },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    currencyExponent: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
      validate: Number.isInteger,
    },
    items: {
      type: [
        new Schema(
          {
            product: {
              type: Schema.Types.ObjectId,
              ref: 'Product',
              required: true,
              immutable: true,
            },
            name: { type: String, required: true, immutable: true },
            sku: { type: String, required: true, immutable: true },
            quantity: {
              type: Number,
              required: true,
              immutable: true,
              min: 1,
              validate: Number.isSafeInteger,
            },
            unitPriceMinor: money(),
            lineTotalMinor: money(),
            unitPrice: Number,
          },
          { _id: false },
        ),
      ],
      required: true,
      validate: (items: unknown[]) => items.length > 0,
    },
    shippingAddress: { type: addressSchema, required: true },
    subtotalMinor: money(),
    shippingMinor: money(),
    discountMinor: money(),
    taxMinor: money(),
    grandTotalMinor: money(),
    total: Number,
    status: {
      type: String,
      enum: orderStatuses,
      default: 'placed',
      required: true,
    },
    statusHistory: [
      new Schema(
        {
          status: { type: String, enum: orderStatuses, required: true },
          actor: { type: Schema.Types.ObjectId, required: true },
          at: { type: Date, required: true },
          reason: { type: String, maxlength: 500 },
        },
        { _id: false },
      ),
    ],
    cancelledAt: Date,
    cancelledBy: Schema.Types.ObjectId,
    cancellationReason: { type: String, maxlength: 500 },
    stockRestoredAt: Date,
    payment: {
      type: new Schema({
        status: { type: String, enum: ['pending', 'paid', 'expired'], required: true },
        key: { type: String, required: true },
        startedAt: { type: Date, required: true },
        successUrl: { type: String, required: true },
        cancelUrl: { type: String, required: true },
        sessionId: String,
        checkoutUrl: String,
        paidAt: Date,
      }, { _id: false }),
      default: undefined,
    },
    idempotencyKey: { type: String, required: true },
    requestFingerprint: { type: String, required: true },
  },
  { timestamps: true },
);
for (const field of [
  'user',
  'schemaVersion',
  'currency',
  'currencyExponent',
  'items',
  'shippingAddress',
  'subtotalMinor',
  'shippingMinor',
  'discountMinor',
  'taxMinor',
  'grandTotalMinor',
  'idempotencyKey',
  'requestFingerprint',
]) {
  orderSchema.path(field).options.immutable = true;
  orderSchema.path(field).immutable(true);
}
orderSchema.index({ user: 1, createdAt: -1, _id: -1 });
orderSchema.pre('validate', function () {
  if (this.schemaVersion !== 2) return;
  try {
    let subtotal = 0;
    for (const item of this.items) {
      const line = safeMoney(item.quantity * item.unitPriceMinor);
      if (line !== item.lineTotalMinor)
        throw new Error('Line total does not match quantity and price');
      subtotal = safeMoney(subtotal + line);
    }
    const beforeDiscount = safeMoney(safeMoney(subtotal + this.shippingMinor) + this.taxMinor);
    const total = safeMoney(beforeDiscount - this.discountMinor);
    if (subtotal !== this.subtotalMinor || total !== this.grandTotalMinor)
      throw new Error('Order totals are inconsistent');
  } catch (error) {
    this.invalidate(
      'grandTotalMinor',
      error instanceof Error ? error.message : 'Invalid monetary totals',
    );
  }
});
orderSchema.index({ status: 1, createdAt: -1, _id: -1 });
orderSchema.index(
  { user: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
export const OrderModel = model('Order', orderSchema);
