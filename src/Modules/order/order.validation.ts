import { z } from "zod";
import { generalFields } from "../../Middlewares/validation.fields";
import { cartLimits } from "../cart/cart.config";

export const checkoutSchema = z.strictObject({
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  items: z.array(z.strictObject({
    productId: generalFields.id,
    unitPrice: z.number().nonnegative().finite(),
  })).min(1).refine(items => items.length <= cartLimits().maxItems, "Cart item limit exceeded"),
});
