import express from "express";
import { startEmailQueue } from "./Utils/email/email.queue";
import type { Express, Request, Response } from "express";
import cors from "cors";
import { corsOptions } from "./Utils/middleware/cors";
import helmet from "helmet";
import path from "node:path";
import cookieParser from "cookie-parser";
import { config } from "dotenv";
import { globalErrorHandler } from "./Utils/response/error.response";
import connectDB from "./DB/connection";
import { Server } from "node:http";

import { authRouter } from "./Modules/auth/auth.routes";

import { categoryRouter } from "./Modules/category/category.routes";
import { orderRouter as ordersRouter } from "./Modules/order/order.routes";
import paymentsRouter from "./Modules/payment/payment.controller";
import { productRouter } from "./Modules/product/product.routes";
import usersRouter from "./Modules/user/user.controller";
import { cartRouter } from "./Modules/cart/cart.routes";
import { addressRouter } from "./Modules/address/address.routes";
import { CartModel } from "./DB/models/cart/cart.model";
import { OrderModel } from "./DB/models/order/order.model";
import { cartLimits } from "./Modules/cart/cart.config";
import {
  authLimiter,
  cartLimiter,
  categoriesLimiter,
  ordersLimiter,
  paymentsLimiter,
  productsLimiter,
  usersLimiter,
} from "./Utils/middleware/rate-limit";

config({
  path: path.resolve("./config/.env.dev"),
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

  // ==========================================
  // Database Connection
  // ==========================================

  cartLimits();
  await connectDB();
  // Cart creation safety requires the unique index before accepting traffic.
  await CartModel.createIndexes();
  await OrderModel.init();
  await startEmailQueue();

  // ==========================================
  // Routes
  // ==========================================

  // Authentication: credentials and verification codes.
  app.use(
    "/api/v1/auth",
    authLimiter,
    express.json({ limit: "10kb" }),
    authRouter,
  );

  // Products: descriptions, variants, attributes, and image URLs.
  app.use(
    "/api/v1/products",
    productsLimiter,
    express.json({ limit: "1mb" }),
    productRouter,
  );

  app.use(
    "/api/v1/addresses",
    usersLimiter,
    express.json({ limit: "10kb" }),
    addressRouter,
  );

  // Users: profile fields and saved addresses.
  app.use(
    "/api/v1/users",
    usersLimiter,
    express.json({ limit: "50kb" }),
    usersRouter,
  );

  // Categories: names, descriptions, and parent references.
  app.use(
    "/api/v1/categories",
    categoriesLimiter,
    express.json({ limit: "20kb" }),
    categoryRouter,
  );

  // Cart: item references, quantities, and selected options.
  app.use(
    "/api/v1/cart",
    cartLimiter,
    express.json({ limit: "50kb" }),
    cartRouter,
  );

  // Orders: line items, shipping details, and checkout metadata.
  app.use(
    "/api/v1/orders",
    ordersLimiter,
    express.json({ limit: "100kb" }),
    ordersRouter,
  );

  // Payments: order references and payment tokens.
  app.use(
    "/api/v1/payments",
    paymentsLimiter,
    express.json({ limit: "10kb" }),
    paymentsRouter,
  );

  // ==========================================
  // Test
  // ==========================================

  app.get("/test", (req: Request, res: Response) => {
    res.status(200).json({
      status: true,
      message: "Hello World",
    });
  });

  // ==========================================
  // 404 Handler
  // ==========================================

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      status: false,
      message: "Not Found",
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
    console.log(
      `E-Commerce Backend Server is running on ${process.env.DEPLOYEDDOMAIN}:${port}`,
    );
  });

  return httpServer;
};
