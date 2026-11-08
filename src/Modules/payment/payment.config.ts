import { ApplicationException } from '../../Utils/response/error.response';
export function paymentConfig() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const successUrl = process.env.PAYMENT_SUCCESS_URL;
  const cancelUrl = process.env.PAYMENT_CANCEL_URL;
  if (!secret || !webhookSecret || !successUrl || !cancelUrl)
    throw new ApplicationException('Payments are not configured', 503);
  for (const value of [successUrl, cancelUrl]) {
    let url: URL;
    try { url = new URL(value); } catch { throw new ApplicationException('Invalid payment URL configuration', 503); }
    if (url.username || url.password || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && url.hostname === 'localhost')))
      throw new ApplicationException('Invalid payment URL configuration', 503);
  }
  return { secret, webhookSecret, successUrl, cancelUrl };
}
