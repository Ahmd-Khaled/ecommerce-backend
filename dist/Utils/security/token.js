"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRevokeToken = exports.createRevokeTokens = exports.decodedToken = exports.createLoginCredentials = exports.getSignatures = exports.getSignatureLevel = exports.verifyToken = exports.generateToken = exports.LogoutEnum = exports.TokenTypeEnum = exports.SignatureLevelEnum = void 0;
const jsonwebtoken_1 = require("jsonwebtoken");
const mongoose_1 = require("mongoose");
const uuid_1 = require("uuid");
const user_interface_1 = require("../../DB/models/user/user.interface");
const token_model_1 = require("../../DB/models/token/token.model");
const token_repository_1 = require("../../DB/repository/token.repository");
const user_repository_1 = require("../../DB/repository/user.repository");
const error_response_1 = require("../response/error.response");
var SignatureLevelEnum;
(function (SignatureLevelEnum) {
    SignatureLevelEnum["USER"] = "user";
    SignatureLevelEnum["ADMIN"] = "admin";
})(SignatureLevelEnum || (exports.SignatureLevelEnum = SignatureLevelEnum = {}));
var TokenTypeEnum;
(function (TokenTypeEnum) {
    TokenTypeEnum["ACCESS"] = "access";
    TokenTypeEnum["REFRESH"] = "refresh";
})(TokenTypeEnum || (exports.TokenTypeEnum = TokenTypeEnum = {}));
var LogoutEnum;
(function (LogoutEnum) {
    LogoutEnum["ONLY"] = "only";
    LogoutEnum["ALL"] = "all";
})(LogoutEnum || (exports.LogoutEnum = LogoutEnum = {}));
const generateToken = async ({ payload, secret, options, }) => {
    return (0, jsonwebtoken_1.sign)(payload, secret, options);
};
exports.generateToken = generateToken;
const verifyToken = async ({ token, secret, }) => {
    const decoded = await (0, jsonwebtoken_1.verify)(token, secret);
    if (typeof decoded === "string" || !decoded) {
        throw new error_response_1.UnauthorizedException("Invalid Token Payload");
    }
    return decoded;
};
exports.verifyToken = verifyToken;
const getSignatureLevel = (role = user_interface_1.RoleEnum.USER) => {
    switch (role) {
        case user_interface_1.RoleEnum.USER:
            return SignatureLevelEnum.USER;
        case user_interface_1.RoleEnum.ADMIN:
            return SignatureLevelEnum.ADMIN;
        default:
            throw new error_response_1.ForbiddenException("This account is not allowed to generate login credentials");
    }
};
exports.getSignatureLevel = getSignatureLevel;
const getSignatures = async (signatureLevel = SignatureLevelEnum.USER) => {
    let access_token = "";
    let refresh_token = "";
    switch (signatureLevel) {
        case SignatureLevelEnum.USER:
            access_token = process.env.ACCESS_USER_TOKEN_SECRET ?? "";
            refresh_token = process.env.REFRESH_USER_TOKEN_SECRET ?? "";
            break;
        case SignatureLevelEnum.ADMIN:
            access_token = process.env.ACCESS_ADMIN_TOKEN_SECRET ?? "";
            refresh_token = process.env.REFRESH_ADMIN_TOKEN_SECRET ?? "";
            break;
    }
    return {
        access_token,
        refresh_token,
    };
};
exports.getSignatures = getSignatures;
const getTokenExpiration = (value, envName) => {
    const expiration = Number(value);
    if (!value ||
        !Number.isSafeInteger(expiration) ||
        expiration <= 0) {
        throw new Error(`Invalid JWT expiration configuration: ${envName}`);
    }
    return expiration;
};
const createLoginCredentials = async (user) => {
    const signatureLevel = (0, exports.getSignatureLevel)(user.role);
    const signatures = await (0, exports.getSignatures)(signatureLevel);
    if (!signatures.access_token || !signatures.refresh_token) {
        throw new Error("JWT signing secrets are not configured");
    }
    const accessExpiresIn = getTokenExpiration(process.env.ACCESS_EXPIRES_IN, "ACCESS_EXPIRES_IN");
    const refreshExpiresIn = getTokenExpiration(process.env.REFRESH_EXPIRES_IN, "REFRESH_EXPIRES_IN");
    const accessJti = (0, uuid_1.v4)();
    const refreshJti = (0, uuid_1.v4)();
    const tokenVersion = user.tokenVersion ?? 0;
    const accessToken = await (0, exports.generateToken)({
        payload: {
            _id: user._id.toString(),
            tokenVersion,
        },
        secret: signatures.access_token,
        options: {
            expiresIn: accessExpiresIn,
            jwtid: accessJti,
        },
    });
    const refreshToken = await (0, exports.generateToken)({
        payload: {
            _id: user._id.toString(),
            tokenVersion,
        },
        secret: signatures.refresh_token,
        options: {
            expiresIn: refreshExpiresIn,
            jwtid: refreshJti,
        },
    });
    return {
        accessToken,
        refreshToken,
        signatureLevel,
    };
};
exports.createLoginCredentials = createLoginCredentials;
const decodedToken = async ({ authorization, tokenType = TokenTypeEnum.ACCESS, allowRevoked = false, }) => {
    const tokenModel = new token_repository_1.TokenRepository(token_model_1.TokenModel);
    const parts = authorization.trim().split(/\s+/);
    if (parts.length !== 2) {
        throw new error_response_1.UnauthorizedException("Invalid Authorization Header");
    }
    const [signatureLevel, token] = parts;
    if (!token ||
        !Object.values(SignatureLevelEnum).includes(signatureLevel)) {
        throw new error_response_1.UnauthorizedException("Invalid Authorization Scheme");
    }
    const signatures = await (0, exports.getSignatures)(signatureLevel);
    const secret = tokenType === TokenTypeEnum.REFRESH
        ? signatures.refresh_token
        : signatures.access_token;
    if (!secret) {
        throw new error_response_1.UnauthorizedException("Invalid Token Configuration");
    }
    const decoded = await (0, exports.verifyToken)({
        token,
        secret,
    });
    if (typeof decoded._id !== "string" ||
        typeof decoded.jti !== "string" ||
        typeof decoded.iat !== "number" ||
        typeof decoded.exp !== "number" ||
        typeof decoded.tokenVersion !== "number" ||
        !Number.isSafeInteger(decoded.tokenVersion) ||
        decoded.tokenVersion < 0) {
        throw new error_response_1.UnauthorizedException("Invalid Token Payload");
    }
    const user = await user_repository_1.userRepository.findOne({
        filter: {
            _id: decoded._id,
        },
    });
    if (!user) {
        throw new error_response_1.UnauthorizedException("Invalid or old login credentials");
    }
    if (decoded.tokenVersion !== user.tokenVersion) {
        throw new error_response_1.UnauthorizedException("Your session has expired. Please login again.");
    }
    if ((user.changeCredentialsTime?.getTime() ?? 0) >
        decoded.iat * 1000) {
        throw new error_response_1.UnauthorizedException("Invalid or old login credentials, you need to login again");
    }
    const tokenCheck = await tokenModel.findOne({
        filter: {
            jti: decoded.jti,
        },
    });
    const isRevoked = Boolean(tokenCheck);
    if (isRevoked && !allowRevoked) {
        throw new error_response_1.UnauthorizedException("Invalid or old login credentials");
    }
    return {
        user,
        decoded,
        isRevoked,
    };
};
exports.decodedToken = decodedToken;
const createRevokeTokens = async (decodedTokens) => {
    if (!decodedTokens.length) {
        throw new error_response_1.BadRequestException("No tokens provided for revocation");
    }
    const records = decodedTokens.map((decoded) => {
        if (typeof decoded.jti !== "string" ||
            typeof decoded.exp !== "number" ||
            typeof decoded._id !== "string" ||
            !mongoose_1.Types.ObjectId.isValid(decoded._id)) {
            throw new error_response_1.BadRequestException("Invalid token payload");
        }
        const expiresAt = new Date(decoded.exp * 1000);
        if (Number.isNaN(expiresAt.getTime())) {
            throw new error_response_1.BadRequestException("Invalid token expiration");
        }
        return {
            jti: decoded.jti,
            expiresAt,
            userId: new mongoose_1.Types.ObjectId(decoded._id),
        };
    });
    const uniqueRecords = [
        ...new Map(records.map((record) => [record.jti, record])).values(),
    ];
    const tokenModel = new token_repository_1.TokenRepository(token_model_1.TokenModel);
    const results = await tokenModel.create({
        data: uniqueRecords,
    });
    if (!results || results.length !== uniqueRecords.length) {
        throw new error_response_1.BadRequestException("Failed to revoke tokens");
    }
    return results;
};
exports.createRevokeTokens = createRevokeTokens;
const createRevokeToken = async (decoded) => {
    const [result] = await (0, exports.createRevokeTokens)([decoded]);
    return result;
};
exports.createRevokeToken = createRevokeToken;
