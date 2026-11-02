import rateLimit from "express-rate-limit";

const MINUTE = 60 * 1000;

// Each limiter has its own per-IP counter. Tune these defaults to actual traffic.
const createLimiter = (limit: number, windowMs = 15 * MINUTE) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      status: false,
      message: "Too many requests. Please try again later.",
    },
  });

// Shared auth budget allows multi-step flows; endpoints have separate counters.
export const authLimiter = createLimiter(30);
export const registerLimiter = createLimiter(5);
export const loginLimiter = createLimiter(5);
export const otpLimiter = createLimiter(5, 10 * MINUTE);

// Catalog browsing typically generates more requests than account operations.
export const productsLimiter = createLimiter(300);
export const categoriesLimiter = createLimiter(300);
export const usersLimiter = createLimiter(100);
export const cartLimiter = createLimiter(150);

// Checkout and payment operations should be less frequent.
export const ordersLimiter = createLimiter(60);
export const paymentsLimiter = createLimiter(30);



export const resendEmailOTPLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    status: false,
    message: "Too many verification requests. Please try again later.",
  },
});
