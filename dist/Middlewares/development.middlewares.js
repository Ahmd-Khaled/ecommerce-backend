"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.developmentOnly = void 0;
const error_response_1 = require("../Utils/response/error.response");
const developmentOnly = (_req, _res, next) => {
    if (process.env.MODE !== "DEV" || process.env.NODE_ENV === "production") {
        throw new error_response_1.NotFoundException("Not Found");
    }
    next();
};
exports.developmentOnly = developmentOnly;
