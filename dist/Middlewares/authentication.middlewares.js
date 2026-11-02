"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authentication = void 0;
const token_1 = require("../Utils/security/token");
const error_response_1 = require("../Utils/response/error.response");
const authentication = (tokenType = token_1.TokenTypeEnum.ACCESS, accessRoles = []) => {
    return async (req, _res, next) => {
        const authorization = req.headers.authorization;
        if (!authorization) {
            throw new error_response_1.UnauthorizedException("Missing Authorization Header");
        }
        const { user, decoded } = await (0, token_1.decodedToken)({
            authorization,
            tokenType,
        });
        if (accessRoles.length > 0 &&
            !accessRoles.includes(user.role)) {
            throw new error_response_1.ForbiddenException("Unauthorized Access");
        }
        req.user = user;
        req.decoded = decoded;
        next();
    };
};
exports.authentication = authentication;
