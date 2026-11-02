"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_controller_1 = require("./app.controller");
const startServer = async () => {
    try {
        await (0, app_controller_1.bootstrap)();
    }
    catch (error) {
        console.error("Application startup failed:", error);
        process.exit(1);
    }
};
startServer();
