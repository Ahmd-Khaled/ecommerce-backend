import { z } from 'zod';
import { generalFields } from '../../Middlewares/validation.fields';
import { cartLimits } from '../cart/cart.config';
import { orderStatuses } from '../../DB/models/order/order.model';
const id = generalFields.id.transform((value) => value.toLowerCase());
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const checkoutSchema = z.strictObject({
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  addressId: id,
  items: z
    .array(
      z.strictObject({
        productId: id,
        unitPriceMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1)
    .refine((items) => items.length <= cartLimits().maxItems, 'Cart item limit exceeded')
    .refine(
      (items) => new Set(items.map((item) => item.productId)).size === items.length,
      'Duplicate products',
    ),
});
export const orderIdSchema = z.strictObject({ orderId: id });
export const cancelSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500).optional(),
});
export const transitionSchema = cancelSchema.extend({
  expectedStatus: z.enum(orderStatuses),
  status: z.enum(orderStatuses),
});
const pagination = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const orderListSchema = z.strictObject(pagination);
export const adminOrderListSchema = z
  .strictObject({
    ...pagination,
    status: z.enum(orderStatuses).optional(),
    user: id.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine(
    (value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to),
    'Invalid date range',
  );
