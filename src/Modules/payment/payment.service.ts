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

function providerIdempotencyKey(orderId: string, paymentKeyValue: string, attempt: string) {
  return createHash('sha256').update(orderId + ':' + paymentKeyValue + ':' + attempt).digest('hex');
}

export const paymentService = {
  async checkout(user: Types.ObjectId, input: unknown, rawKey: unknown) {
    const { orderId } = parsePayment(paymentInput, input);
    const suppliedKey = rawKey == null ? undefined : parsePayment(paymentKey, rawKey);
    const config = paymentConfig();
    let order = await OrderModel.findOne({ _id: orderId, user }).exec();
    if (!order) throw new NotFoundException('Order not found');

    if (order.schemaVersion !== 2 || order.currencyExponent !== 2 || !['EGP', 'USD', 'EUR', 'GBP', 'AED', 'SAR'].includes(order.currency) || !Number.isSafeInteger(order.grandTotalMinor) || order.grandTotalMinor <= 0 || order.grandTotalMinor > 99999999)
      throw new ConflictException('Order amount or currency is not supported for payment');
    if (order.status !== 'placed') throw new ConflictException('Order is not payable');

    if (!order.payment) {
      if (!suppliedKey) throw new ConflictException('Idempotency-Key is required to start a new payment');
      const claimed = await OrderModel.findOneAndUpdate(
        { _id: orderId, user, status: 'placed', payment: { $exists: false } },
        { $set: { payment: { status: 'pending', key: suppliedKey, startedAt: new Date(), successUrl: config.successUrl, cancelUrl: config.cancelUrl } } },
        { returnDocument: 'after', runValidators: true },
      ).exec();
      order = claimed ?? await OrderModel.findOne({ _id: orderId, user }).exec();
    }

    if (!order?.payment || order.status !== 'placed') throw new ConflictException('Order changed; refresh before payment');
    const payment = order.payment;
    if (suppliedKey && payment.key !== suppliedKey) throw new ConflictException('Use the original payment Idempotency-Key for this order');
    const key = payment.key;

    if (payment.status === 'paid') return response(order);

    let previousSessionId = payment.sessionId;
    if (previousSessionId) {
      // Never trust a saved Checkout URL without checking its live Stripe session state.
      const existingSession = await stripeGateway.request('/' + encodeURIComponent(previousSessionId));
      this.validateSession(order, existingSession);

      if (existingSession.payment_status === 'paid') {
        await OrderModel.updateOne(
          { _id: orderId, 'payment.key': key, 'payment.sessionId': existingSession.id, 'payment.status': { $ne: 'paid' } },
          { $set: { 'payment.status': 'paid', 'payment.paidAt': new Date() } },
        ).exec();
        const latest = await OrderModel.findOne({ _id: orderId, user }).exec();
        if (!latest) throw new NotFoundException('Order not found');
        return response(latest);
      }

      if (existingSession.status === 'open') {
        if (!existingSession.url || new URL(existingSession.url).origin !== 'https://checkout.stripe.com')
          throw new ApplicationException('Invalid checkout URL from provider', 502);
        await OrderModel.updateOne(
          { _id: orderId, 'payment.key': key, 'payment.sessionId': existingSession.id, 'payment.status': { $ne: 'paid' } },
          { $set: { 'payment.status': 'pending', 'payment.checkoutUrl': existingSession.url } },
        ).exec();
        const latest = await OrderModel.findOne({ _id: orderId, user }).exec();
        if (!latest) throw new NotFoundException('Order not found');
        return response(latest);
      }

      if (existingSession.status === 'complete') {
        // Completed but unpaid sessions may still be awaiting an asynchronous payment result.
        await OrderModel.updateOne(
          { _id: orderId, 'payment.key': key, 'payment.sessionId': existingSession.id, 'payment.status': { $ne: 'paid' } },
          { $unset: { 'payment.checkoutUrl': 1 } },
        ).exec();
        const latest = await OrderModel.findOne({ _id: orderId, user }).exec();
        if (!latest) throw new NotFoundException('Order not found');
        return response(latest);
      }

      if (existingSession.status !== 'expired') {
        throw new ConflictException('Payment session state is not ready for another checkout attempt');
      }
    }

    // Reuse the same provider idempotency key for concurrent retries of the same expired session.
    // A new expired session ID creates a distinct provider attempt without changing the order's payment key.
    const attempt = previousSessionId ?? payment.startedAt.toISOString();
    if (!previousSessionId && payment.status !== 'expired' && Date.now() - payment.startedAt.getTime() > 23 * 60 * 60 * 1000)
      throw new ConflictException('Payment outcome requires provider reconciliation');

    const body = new URLSearchParams({
      mode: 'payment',
      success_url: payment.successUrl,
      cancel_url: payment.cancelUrl,
      'metadata[orderId]': orderId,
      client_reference_id: orderId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': order.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(order.grandTotalMinor),
      'line_items[0][price_data][product_data][name]': 'Order ' + orderId,
      'adaptive_pricing[enabled]': 'false',
    });
    const session = await stripeGateway.request('', body, providerIdempotencyKey(orderId, key, attempt));
    this.validateSession(order, session, true);
    if (!session.url || new URL(session.url).origin !== 'https://checkout.stripe.com')
      throw new ApplicationException('Invalid checkout URL from provider', 502);

    const sessionFilter = previousSessionId
      ? { 'payment.sessionId': previousSessionId }
      : { 'payment.sessionId': { $exists: false } };
    await OrderModel.updateOne(
      { _id: orderId, 'payment.key': key, 'payment.status': { $in: ['pending', 'expired'] }, ...sessionFilter },
      { $set: {
        'payment.status': 'pending',
        'payment.sessionId': session.id,
        'payment.checkoutUrl': session.url,
        'payment.startedAt': new Date(),
      } },
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

  validateSession(order: InstanceType<typeof OrderModel>, session: CheckoutSession, allowReplacement = false) {
    if (session.mode !== 'payment' || session.metadata?.orderId !== String(order._id) || session.amount_total !== order.grandTotalMinor || session.currency !== order.currency.toLowerCase() || (!allowReplacement && order.payment?.sessionId && order.payment.sessionId !== session.id))
      throw new ConflictException('Provider payment does not match order');
  },

  async webhook(body: unknown, signature: unknown) {
    const event = parsePayment(z.object({
      id: z.string().min(1),
      type: z.string(),
      data: z.object({ object: z.object({ id: z.string().min(1) }) }),
    }), verifyWebhook(body, signature, paymentConfig().webhookSecret));

    if (!['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'].includes(event.type)) return;

    const session = await stripeGateway.request('/' + encodeURIComponent(event.data.object.id));
    if (!session.metadata?.orderId || !/^[a-f0-9]{24}$/.test(session.metadata.orderId)) return;
    const order = await OrderModel.findById(session.metadata.orderId).exec();
    if (!order?.payment) throw new ConflictException('Payment order is not available');

    // Ignore delayed events from a superseded Checkout session.
    if (order.payment.sessionId !== session.id) return;
    this.validateSession(order, session);

    const status = session.payment_status === 'paid'
      ? 'paid'
      : event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed'
        ? 'expired'
        : 'pending';
    if (status === 'pending') return;

    const updated = await OrderModel.updateOne(
      { _id: order._id, status: { $ne: 'cancelled' }, 'payment.sessionId': session.id, 'payment.status': { $in: ['pending', 'expired'] } },
      { $set: { 'payment.status': status, ...(status === 'paid' ? { 'payment.paidAt': new Date() } : {}) } },
    ).exec();

    if (!updated.matchedCount) {
      const latest = await OrderModel.findById(order._id).exec();
      if (latest?.payment?.status !== status || latest.payment.sessionId !== session.id)
        throw new ConflictException('Payment state requires reconciliation');
    }
  },
};
