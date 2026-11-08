import { z } from 'zod';
import { BadRequestException } from '../../Utils/response/error.response';
export const paymentInput = z.strictObject({ orderId: z.string().regex(/^[a-fA-F0-9]{24}$/).transform(v => v.toLowerCase()) });
export const paymentKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export function parsePayment<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException('Invalid payment request');
  return result.data;
}
