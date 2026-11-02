"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const auth_service_1 = require("./auth.service");
const token_1 = require("../../Utils/security/token");
const error_response_1 = require("../../Utils/response/error.response");
class AuthController {
    testRevoke = async (req, res) => {
        if (!req.decoded) {
            throw new error_response_1.UnauthorizedException("Missing authenticated token");
        }
        const result = await (0, token_1.createRevokeToken)(req.decoded);
        if (!result) {
            throw new error_response_1.BadRequestException("Failed to revoke token");
        }
        res.status(200).json({
            success: true,
            message: "Token revoked successfully",
            data: {
                jti: result.jti,
                expiresAt: result.expiresAt,
            },
        });
    };
    register = async (req, res) => {
        const data = req.body;
        const result = await auth_service_1.authService.register(data);
        res.status(201).json({
            success: true,
            message: result.message,
        });
    };
    confirmEmail = async (req, res) => {
        const data = req.body;
        const result = await auth_service_1.authService.confirmEmail(data);
        res.status(200).json({
            success: true,
            message: result.message,
        });
    };
    resendConfirmEmail = async (req, res) => {
        const data = req.body;
        const result = await auth_service_1.authService.resendConfirmEmail(data.email);
        res.status(200).json({
            success: true,
            message: result.message,
        });
    };
    login = async (req, res) => {
        const data = req.body;
        const result = await auth_service_1.authService.login(data);
        res.status(200).json({
            success: true,
            ...result,
        });
    };
    logoutCurrentDevice = async (req, res) => {
        const result = await auth_service_1.authService.logoutCurrentDevice({
            authorization: req.headers.authorization,
            accessDecoded: req.decoded,
            refreshToken: req.body.refreshToken,
        });
        res.status(200).json({
            success: true,
            ...result,
        });
    };
    logoutAllDevices = async (req, res) => {
        const result = await auth_service_1.authService.logoutAllDevices(req.user._id);
        res.status(200).json({
            success: true,
            ...result,
        });
    };
    refreshToken = async (req, res) => {
        const result = await auth_service_1.authService.refreshToken(req.headers.authorization ?? "");
        res.status(200).json({
            success: true,
            ...result,
        });
    };
    getProfile = async (req, res) => {
        const result = await auth_service_1.authService.getProfile(req.user._id);
        res.status(200).json({
            success: true,
            message: "Profile retrieved successfully",
            ...result,
        });
    };
    updateProfile = async (req, res) => {
        const result = await auth_service_1.authService.updateProfile(req.user._id, req.body);
        res.status(200).json({
            success: true,
            ...result,
        });
    };
    changePassword = async (req, res) => {
        const result = await auth_service_1.authService.changePassword(req.user._id, req.body);
        res.status(200).json({
            success: true,
            ...result,
        });
    };
    forgotPassword = async (req, res) => {
        const result = await auth_service_1.authService.forgotPassword(req.body);
        res.status(200).json({
            success: true,
            ...result,
        });
    };
    resetPassword = async (req, res) => {
        const result = await auth_service_1.authService.resetPassword(req.body);
        res.status(200).json({
            success: true,
            ...result,
        });
    };
}
exports.authController = new AuthController();
