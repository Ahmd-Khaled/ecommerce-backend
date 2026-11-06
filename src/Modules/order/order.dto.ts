import { z } from "zod";
import { checkoutSchema } from "./order.validation";
export type CheckoutDTO = z.infer<typeof checkoutSchema>;
