"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalErrorHandler = exports.ForbiddenException = exports.UnauthorizedException = exports.ConflictException = exports.NotFoundException = exports.BadRequestException = exports.ApplicationException = void 0;
class ApplicationException extends Error {
    statusCode;
    constructor(message, statusCode = 400, options) {
        super(message, options);
        this.statusCode = statusCode;
        this.name = this.constructor.name;
    }
}
exports.ApplicationException = ApplicationException;
class BadRequestException extends ApplicationException {
    constructor(message, options) {
        super(message, 400, options);
    }
}
exports.BadRequestException = BadRequestException;
class NotFoundException extends ApplicationException {
    constructor(message, options) {
        super(message, 404, options);
    }
}
exports.NotFoundException = NotFoundException;
class ConflictException extends ApplicationException {
    constructor(message, options) {
        super(message, 409, options);
    }
}
exports.ConflictException = ConflictException;
class UnauthorizedException extends ApplicationException {
    constructor(message, options) {
        super(message, 401, options);
    }
}
exports.UnauthorizedException = UnauthorizedException;
class ForbiddenException extends ApplicationException {
    constructor(message, options) {
        super(message, 403, options);
    }
}
exports.ForbiddenException = ForbiddenException;
const globalErrorHandler = (err, req, res, next) => {
    return res.status(err.statusCode || 500).json({
        message: err.message || "Something went wrong",
        stack: process.env.MODE === "DEV" ? err.stack : undefined,
        cause: process.env.MODE === "DEV" ? err.cause : undefined
    });
};
exports.globalErrorHandler = globalErrorHandler;
