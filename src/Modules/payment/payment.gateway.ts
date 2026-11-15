import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApplicationException, BadRequestException } from '../../Utils/response/error.response';
import { paymentConfig } from './payment.config';
import type { CheckoutSession } from './payment.dto';
export function verifyWebhook(body: unknown, signature: unknown, secret: string, now = Date.now()) {
  if (!Buffer.isBuffer(body) || typeof signature !== 'string') throw new BadRequestException('Invalid webhook signature');
  const parts = signature.split(',').map(v => v.trim());
  const timestamps = parts.filter(v => v.startsWith('t='));
  const stamp = timestamps[0]?.slice(2) ?? '';
  if (timestamps.length !== 1 || !/^\d+$/.test(stamp) || Math.abs(now / 1000 - Number(stamp)) > 300)
    throw new BadRequestException('Invalid webhook signature');
  const expected = createHmac('sha256', secret).update(stamp + '.').update(body).digest();
  if (!parts.some(v => /^v1=[a-fA-F0-9]{64}$/.test(v) && timingSafeEqual(expected, Buffer.from(v.slice(3), 'hex'))))
    throw new BadRequestException('Invalid webhook signature');
  try { return JSON.parse(body.toString('utf8')) as unknown; }
  catch { throw new BadRequestException('Invalid webhook payload'); }
}
export const stripeGateway = {
  async request(path: string, body?: URLSearchParams, key?: string): Promise<CheckoutSession> {
    try {
      const response = await fetch('https://api.stripe.com/v1/checkout/sessions' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: 'Bearer ' + paymentConfig().secret,
          'Stripe-Version': '2026-10-28.endive',
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Provider request failed');
      const result = await response.json() as CheckoutSession;
      if (!result || typeof result.id !== 'string' || !result.id.startsWith('cs_')) throw new Error('Invalid provider response');
      return result;
    } catch (error) {
      console.error('[Stripe Gateway Error]', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new ApplicationException(
        'Payment provider unavailable; retry with the same Idempotency-Key',
        503,
      );
    }
  },
};
