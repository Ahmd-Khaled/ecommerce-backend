import express, { Router } from 'express';
import { paymentController } from './payment.controller';
import { paymentCustomer } from './payment.authorization';
import { paymentsLimiter } from '../../Utils/middleware/rate-limit';
export const paymentRouter = Router();
// Must precede JSON parsing; provider retries must not share the customer rate limiter.
paymentRouter.post('/webhook', express.raw({ type: 'application/json', limit: '256kb' }), paymentController.webhook);
paymentRouter.use(paymentsLimiter, paymentCustomer);
paymentRouter.post('/checkout', express.json({ limit: '10kb' }), paymentController.checkout);
paymentRouter.get('/orders/:orderId', paymentController.details);
