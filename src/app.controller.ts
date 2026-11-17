import { adminRouter } from './Modules/admin/admin.routes';
import { languageMiddleware } from './Middlewares/language.middlewares';
import { bannerRouter } from './Modules/banner/banner.routes';
import { homeRouter } from './Modules/home/home.routes';
import { dashboardRouter } from './Modules/dashboard/dashboard.routes';
import { lowStockThreshold } from './Modules/dashboard/dashboard.config';
import { BannerModel } from './DB/models/banner/banner.model';
import { ProductModel } from './DB/models/product/product.model';
import { ReviewModel } from './DB/models/review/review.model';
import { reviewSettingsRepository } from './DB/repository/review-settings.repository';
import { AdminModel } from './DB/models/admin/admin.model';
import { mediaRouter } from './Utils/storage/storage.service';
import { storageConfig } from './Utils/storage/storage.config';
import { startUploadCleanup } from './Utils/storage/upload.cleanup';
import express from 'express';
import { startEmailQueue } from './Utils/email/email.queue';
import type { Express, Request, Response } from 'express';
import cors from 'cors';
import { corsOptions } from './Utils/middleware/cors';
import helmet from 'helmet';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import { globalErrorHandler } from './Utils/response/error.response';
import connectDB from './DB/connection';
import { Server } from 'node:http';

import { authRouter } from './Modules/auth/auth.routes';

import { categoryRouter } from './Modules/category/category.routes';
import { orderRouter as ordersRouter } from './Modules/order/order.routes';
import { paymentRouter } from './Modules/payment/payment.routes';
import { productRouter } from './Modules/product/product.routes';
import { userRouter } from './Modules/user/user.routes';
import { cartRouter } from './Modules/cart/cart.routes';
import { addressRouter } from './Modules/address/address.routes';
import { CartModel } from './DB/models/cart/cart.model';
import { OrderModel } from './DB/models/order/order.model';
import { cartLimits } from './Modules/cart/cart.config';
import { storeMoney } from './Utils/money';
import {
  authLimiter,
  cartLimiter,
  categoriesLimiter,
  ordersLimiter,
  productsLimiter,
  usersLimiter,
} from './Utils/middleware/rate-limit';

config({
  path: path.resolve('./config/.env.dev'),
});

// ============================================
// Bootstrap
// ============================================

export const bootstrap = async (): Promise<Server> => {
  const app: Express = express();

  const port = Number(process.env.PORT) || 4000;

  // ==========================================
  // Global Middleware
  // ==========================================

  app.use(cors(corsOptions()));
  app.use(helmet());
  app.use(cookieParser());
  app.use(languageMiddleware);

  // ==========================================
  // Database Connection
  // ==========================================

  storageConfig();
  cartLimits();
  storeMoney();
  lowStockThreshold();
  await connectDB();
  // Cart creation safety requires the unique index before accepting traffic.
  await CartModel.createIndexes();
  await AdminModel.init();
  await OrderModel.init();
  await OrderModel.createIndexes();
  await BannerModel.createIndexes();
  // Existing product documents predate review counters; initialize them before review writes.
  await ProductModel.updateMany(
    { $or: [{ ratingsSum: { $exists: false } }, { ratingsCount: { $exists: false } }] },
    { $set: { ratingsSum: 0, ratingsCount: 0 } },
  ).exec();
  await ProductModel.createIndexes();
  await reviewSettingsRepository.initialize();
  await ReviewModel.init();
  await ReviewModel.createIndexes();
  await startEmailQueue();

  // ==========================================
  // Routes
  // ==========================================

  app.use('/media', productsLimiter, mediaRouter);
  app.use('/api/v1/banners', productsLimiter, express.json({ limit: '20kb' }), bannerRouter);
  app.use('/api/v1/home', productsLimiter, homeRouter);
  app.use('/api/v1/dashboard', ordersLimiter, dashboardRouter);

  // Authentication: credentials and verification codes.
  app.use('/api/v1/admin', authLimiter, express.json({ limit: '50kb' }), adminRouter);

  app.use('/api/v1/auth', authLimiter, express.json({ limit: '10kb' }), authRouter);

  // Products: descriptions, variants, attributes, and image URLs.
  app.use('/api/v1/products', productsLimiter, express.json({ limit: '1mb' }), productRouter);

  app.use('/api/v1/addresses', usersLimiter, express.json({ limit: '10kb' }), addressRouter);

  // Users: profile fields and saved addresses.
  app.use('/api/v1/users', usersLimiter, express.json({ limit: '50kb' }), userRouter);

  // Categories: names, descriptions, and parent references.
  app.use('/api/v1/categories', categoriesLimiter, express.json({ limit: '20kb' }), categoryRouter);

  // Cart: item references, quantities, and selected options.
  app.use('/api/v1/cart', cartLimiter, express.json({ limit: '50kb' }), cartRouter);

  // Orders: line items, shipping details, and checkout metadata.
  app.use('/api/v1/orders', ordersLimiter, express.json({ limit: '100kb' }), ordersRouter);

  // Payments: order references and payment tokens.
  app.use('/api/v1/payments', paymentRouter);

  // ==========================================
  // Test
  // ==========================================

  app.get('/test', (req: Request, res: Response) => {
    res.status(200).json({
      status: true,
      message: 'Hello World',
    });
  });

  // ==========================================
  // 404 Handler
  // ==========================================

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      status: false,
      message: 'Not Found',
    });
  });

  // ==========================================
  // Error Handler
  // ==========================================

  app.use(globalErrorHandler);

  // ==========================================
  // Start Server
  // ==========================================

  const httpServer = app.listen(port, () => {
    console.log(`E-Commerce Backend Server is running on ${process.env.DEPLOYEDDOMAIN}:${port}`);
  });

  httpServer.requestTimeout = 120000;
  const stopUploadCleanup = startUploadCleanup();
  httpServer.once('close', stopUploadCleanup);
  return httpServer;
};

// docker compose up -d
// npm run dev

// In Powershell
// stripe listen --forward-to localhost:4000/api/v1/payments/webhook --all-snapshot
