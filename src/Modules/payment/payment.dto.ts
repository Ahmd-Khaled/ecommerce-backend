import type { z } from 'zod';
import type { paymentInput } from './payment.validation';
export type PaymentInput = z.infer<typeof paymentInput>;
export interface CheckoutSession {
  id: string;
  url: string | null;
  mode: string;
  status: string;
  payment_status: string;
  amount_total: number;
  currency: string;
  metadata: { orderId?: string };
}
