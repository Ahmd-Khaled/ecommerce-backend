import type { RequestHandler } from 'express';
import { paymentService } from './payment.service';
export const paymentController: Record<'checkout' | 'details' | 'webhook', RequestHandler> = {
  checkout: async (req, res) => {
    res.json({ success: true, data: await paymentService.checkout(req.user!._id, req.body, req.headers['idempotency-key']) });
  },
  details: async (req, res) => {
    res.json({ success: true, data: await paymentService.details(req.user!._id, req.params.orderId) });
  },
  webhook: async (req, res) => {
    await paymentService.webhook(req.body, req.headers['stripe-signature']);
    res.json({ received: true });
  },
};
