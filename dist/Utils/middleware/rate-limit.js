"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resendEmailOTPLimiter = exports.paymentsLimiter = exports.ordersLimiter = exports.cartLimiter = exports.usersLimiter = exports.categoriesLimiter = exports.productsLimiter = exports.otpLimiter = exports.loginLimiter = exports.registerLimiter = exports.authLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const MINUTE = 60 * 1000;
const createLimiter = (limit, windowMs = 15 * MINUTE) => (0, express_rate_limit_1.default)({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        status: false,
        message: "Too many requests. Please try again later.",
    },
});
exports.authLimiter = createLimiter(30);
exports.registerLimiter = createLimiter(5);
exports.loginLimiter = createLimiter(5);
exports.otpLimiter = createLimiter(5, 10 * MINUTE);
exports.productsLimiter = createLimiter(300);
exports.categoriesLimiter = createLimiter(300);
exports.usersLimiter = createLimiter(100);
exports.cartLimiter = createLimiter(150);
exports.ordersLimiter = createLimiter(60);
exports.paymentsLimiter = createLimiter(30);
exports.resendEmailOTPLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        status: false,
        message: "Too many verification requests. Please try again later.",
    },
});
