"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrap = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = require("dotenv");
const error_response_1 = require("./Utils/response/error.response");
const connection_1 = __importDefault(require("./DB/connection"));
const auth_routes_1 = require("./Modules/auth/auth.routes");
const cart_controller_1 = __importDefault(require("./Modules/cart/cart.controller"));
const categories_controller_1 = __importDefault(require("./Modules/categories/categories.controller"));
const orders_controller_1 = __importDefault(require("./Modules/orders/orders.controller"));
const payments_controller_1 = __importDefault(require("./Modules/payments/payments.controller"));
const products_controller_1 = __importDefault(require("./Modules/products/products.controller"));
const users_controller_1 = __importDefault(require("./Modules/users/users.controller"));
const rate_limit_1 = require("./Utils/middleware/rate-limit");
(0, dotenv_1.config)({
    path: node_path_1.default.resolve("./config/.env.dev"),
});
const bootstrap = async () => {
    const app = (0, express_1.default)();
    const port = Number(process.env.PORT) || 4000;
    app.use((0, cors_1.default)());
    app.use((0, helmet_1.default)());
    await (0, connection_1.default)();
    app.use("/api/v1/auth", rate_limit_1.authLimiter, express_1.default.json({ limit: "10kb" }), auth_routes_1.authRouter);
    app.use("/api/v1/products", rate_limit_1.productsLimiter, express_1.default.json({ limit: "1mb" }), products_controller_1.default);
    app.use("/api/v1/users", rate_limit_1.usersLimiter, express_1.default.json({ limit: "50kb" }), users_controller_1.default);
    app.use("/api/v1/categories", rate_limit_1.categoriesLimiter, express_1.default.json({ limit: "20kb" }), categories_controller_1.default);
    app.use("/api/v1/cart", rate_limit_1.cartLimiter, express_1.default.json({ limit: "50kb" }), cart_controller_1.default);
    app.use("/api/v1/orders", rate_limit_1.ordersLimiter, express_1.default.json({ limit: "100kb" }), orders_controller_1.default);
    app.use("/api/v1/payments", rate_limit_1.paymentsLimiter, express_1.default.json({ limit: "10kb" }), payments_controller_1.default);
    app.get("/test", (req, res) => {
        res.status(200).json({
            status: true,
            message: "Hello World",
        });
    });
    app.use((req, res) => {
        res.status(404).json({
            status: false,
            message: "Not Found",
        });
    });
    app.use(error_response_1.globalErrorHandler);
    const httpServer = app.listen(port, () => {
        console.log(`E-Commerce Backend Server is running on ${process.env.DEPLOYEDDOMAIN}:${port}`);
    });
    return httpServer;
};
exports.bootstrap = bootstrap;
