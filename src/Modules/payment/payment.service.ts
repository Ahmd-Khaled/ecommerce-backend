import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { OrderModel } from '../../DB/models/order/order.model';
import { ApplicationException, ConflictException, NotFoundException } from '../../Utils/response/error.response';
import { paymentConfig } from './payment.config';
import { paymentInput, paymentKey, parsePayment } from './payment.validation';
import { stripeGateway, verifyWebhook } from './payment.gateway';
import type { CheckoutSession } from './payment.dto';
function response(order: InstanceType<typeof OrderModel>) {
  return {
    orderId: order._id,
    status: order.payment?.status ?? 'unpaid',
    amountMinor: order.grandTotalMinor,
    currency: order.currency,
    checkoutUrl: order.payment?.status === 'pending' ? order.payment.checkoutUrl ?? null : null,
    paidAt: order.payment?.paidAt ?? null,
  };
}
export const paymentService = {
  async checkout(user: Types.ObjectId, input: unknown, rawKey: unknown) {
    const { orderId } = parsePayment(paymentInput, input);
    const key = parsePayment(paymentKey, rawKey);
    const config = paymentConfig();
    let order = await OrderModel.findOne({ _id: orderId, user }).exec();
    if (!order) throw new NotFoundException('Order not found');
    // Explicit currency allowlist avoids special Stripe minor-unit conventions.
    if (order.schemaVersion !== 2 || order.currencyExponent !== 2 || !['EGP', 'USD', 'EUR', 'GBP', 'AED', 'SAR'].includes(order.currency) || !Number.isSafeInteger(order.grandTotalMinor) || order.grandTotalMinor <= 0 || order.grandTotalMinor > 99999999)
      throw new ConflictException('Order amount or currency is not supported for payment');
    if (order.status !== 'placed') throw new ConflictException('Order is not payable');
    if (!order.payment) {
      const claimed = await OrderModel.findOneAndUpdate(
        { _id: orderId, user, status: 'placed', payment: { $exists: false } },
        { $set: { payment: { status: 'pending', key, startedAt: new Date(), successUrl: config.successUrl, cancelUrl: config.cancelUrl } } },
        { returnDocument: 'after', runValidators: true },
      ).exec();
      order = claimed ?? await OrderModel.findOne({ _id: orderId, user }).exec();
    }
    if (!order?.payment || order.status !== 'placed') throw new ConflictException('Order changed; refresh before payment');
    const payment = order.payment;
    if (payment.key !== key) throw new ConflictException('Use the original payment Idempotency-Key for this order');
    if (payment.status !== 'pending' || payment.sessionId) return response(order);
    // Stripe may prune idempotency keys after 24 hours. Never recreate an uncertain session then.
    if (Date.now() - payment.startedAt.getTime() > 23 * 60 * 60 * 1000)
      throw new ConflictException('Payment outcome requires provider reconciliation');
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: payment.successUrl,
      cancel_url: payment.cancelUrl,
      'metadata[orderId]': orderId, client_reference_id: orderId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': order.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(order.grandTotalMinor),
      'line_items[0][price_data][product_data][name]': 'Order ' + orderId,
      'adaptive_pricing[enabled]': 'false',
    });
    const providerKey = createHash('sha256').update(orderId + ':' + key).digest('hex');
    const session = await stripeGateway.request('', body, providerKey);
    this.validateSession(order, session);
    if (!session.url || new URL(session.url).origin !== 'https://checkout.stripe.com')
      throw new ApplicationException('Invalid checkout URL from provider', 502);
    await OrderModel.updateOne(
      { _id: orderId, 'payment.key': key, $or: [{ 'payment.sessionId': { $exists: false } }, { 'payment.sessionId': session.id }] },
      { $set: { 'payment.sessionId': session.id, 'payment.checkoutUrl': session.url } },
    ).exec();
    const latest = await OrderModel.findOne({ _id: orderId, user }).exec();
    if (!latest) throw new NotFoundException('Order not found');
    return response(latest);
  },
  async details(user: Types.ObjectId, id: unknown) {
    const { orderId } = parsePayment(paymentInput, { orderId: id });
    const order = await OrderModel.findOne({ _id: orderId, user }).exec();
    if (!order) throw new NotFoundException('Order not found');
    return response(order);
  },
  validateSession(order: InstanceType<typeof OrderModel>, session: CheckoutSession) {
    if (session.mode !== 'payment' || session.metadata?.orderId !== String(order._id) || session.amount_total !== order.grandTotalMinor || session.currency !== order.currency.toLowerCase() || (order.payment?.sessionId && order.payment.sessionId !== session.id))
      throw new ConflictException('Provider payment does not match order');
  },
  async webhook(body: unknown, signature: unknown) {
    const event = parsePayment(z.object({
      id: z.string().min(1), type: z.string(),
      data: z.object({ object: z.object({ id: z.string().min(1) }) }),
    }), verifyWebhook(body, signature, paymentConfig().webhookSecret));
    if (!['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'].includes(event.type)) return;
    // Retrieve current state, so delayed events cannot regress a payment.
    const session = await stripeGateway.request('/' + encodeURIComponent(event.data.object.id));
    if (!session.metadata?.orderId || !/^[a-f0-9]{24}$/.test(session.metadata.orderId)) return;
    const order = await OrderModel.findById(session.metadata.orderId).exec();
    if (!order?.payment) throw new ConflictException('Payment order is not available');
    this.validateSession(order, session);
    const status = session.payment_status === 'paid' ? 'paid' : session.status === 'expired' ? 'expired' : 'pending';
    if (status === 'pending') return;
    const updated = await OrderModel.updateOne(
      { _id: order._id, status: { $ne: 'cancelled' }, 'payment.status': 'pending', $or: [{ 'payment.sessionId': { $exists: false } }, { 'payment.sessionId': session.id }] },
      { $set: { 'payment.status': status, 'payment.sessionId': session.id, ...(status === 'paid' ? { 'payment.paidAt': new Date() } : {}) } },
    ).exec();
    if (!updated.matchedCount) {
      const latest = await OrderModel.findById(order._id).exec();
      if (latest?.payment?.status !== status || latest.payment.sessionId !== session.id)
        throw new ConflictException('Payment state requires reconciliation');
    }
  },
};
