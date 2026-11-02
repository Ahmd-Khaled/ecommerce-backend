"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = void 0;
const token_1 = require("../../Utils/security/token");
const user_repository_1 = require("../../DB/repository/user.repository");
const error_response_1 = require("../../Utils/response/error.response");
const hash_1 = require("../../Utils/security/hash");
const generateOTP_1 = require("../../Utils/generateOTP");
const email_events_1 = require("../../Utils/events/email.events");
const error_response_2 = require("../../Utils/response/error.response");
const CONFIRM_EMAIL_OTP_TTL = 10 * 60 * 1000;
const OTP_EXPIRATION_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_RESEND_WINDOW_HOURS = 1;
const MAX_OTP_RESENDS_PER_WINDOW = 5;
const RESET_PASSWORD_OTP_TTL = 10 * 60 * 1000;
const RESET_PASSWORD_RESEND_COOLDOWN = 60 * 1000;
const RESET_PASSWORD_RESEND_WINDOW = 10 * 60 * 1000;
const RESET_PASSWORD_MAX_SENDS = 5;
const FORGOT_PASSWORD_RESPONSE = "If an eligible account exists, a password reset code has been sent to its email address.";
const isDuplicateEmailError = (error) => {
    if (typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== 11000) {
        return false;
    }
    if (!("keyPattern" in error))
        return true;
    const keyPattern = error.keyPattern;
    return (typeof keyPattern === "object" &&
        keyPattern !== null &&
        "email" in keyPattern);
};
const isDuplicateKeyError = (error) => {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000);
};
class AuthService {
    MAX_OTP_ATTEMPTS = 5;
    async register(data) {
        const { firstName, lastName, email, password } = data;
        const normalizedData = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim().toLowerCase(),
        };
        const existingUser = await user_repository_1.userRepository.findByEmail(normalizedData.email);
        if (existingUser) {
            throw new error_response_1.ConflictException("An account with this email already exists");
        }
        const now = new Date();
        const otp = (0, generateOTP_1.generateOTP)();
        const confirmEmailOTPExpiresAt = new Date(now.getTime() + OTP_EXPIRATION_MINUTES * 60 * 1000);
        try {
            await user_repository_1.userRepository.createUser({
                ...normalizedData,
                password,
                confirmEmailOTP: otp,
                confirmEmailOTPExpiresAt,
                confirmEmailOTPAttempts: 0,
                confirmEmailOTPSentAt: now,
                confirmEmailOTPResendCount: 0,
                confirmEmailOTPResendWindowStartedAt: now,
            });
        }
        catch (error) {
            if (isDuplicateEmailError(error)) {
                throw new error_response_1.ConflictException("An account with this email already exists");
            }
            throw error;
        }
        return {
            message: "Registration successful. Please check your email to verify your account.",
        };
    }
    async confirmEmail(data) {
        const { email, otp } = data;
        const user = await user_repository_1.userRepository.findByEmailWithConfirmEmailOTP(email);
        const invalidOTP = () => new error_response_1.BadRequestException("Invalid or expired verification code");
        if (!user ||
            user.confirmedAt ||
            !user.confirmEmailOTP ||
            !user.confirmEmailOTPExpiresAt) {
            throw invalidOTP();
        }
        if (user.confirmEmailOTPExpiresAt.getTime() <= Date.now() ||
            (user.confirmEmailOTPAttempts ?? 0) >= this.MAX_OTP_ATTEMPTS) {
            throw invalidOTP();
        }
        const isOTPValid = await (0, hash_1.compareHash)(otp, user.confirmEmailOTP);
        if (!isOTPValid) {
            await user_repository_1.userRepository.incrementConfirmEmailOTPAttempts(user._id, user.confirmEmailOTP, this.MAX_OTP_ATTEMPTS);
            throw invalidOTP();
        }
        const isUpdated = await user_repository_1.userRepository.confirmUserEmail(user._id, user.confirmEmailOTP, this.MAX_OTP_ATTEMPTS);
        if (!isUpdated) {
            throw invalidOTP();
        }
        return {
            message: "Email verified successfully",
        };
    }
    async resendConfirmEmail(email) {
        const genericResponse = {
            message: "If an unverified account exists for this email, a verification code will be sent.",
        };
        const user = await user_repository_1.userRepository.findByEmailWithConfirmEmailOTP(email);
        if (!user || user.confirmedAt) {
            return genericResponse;
        }
        const now = new Date();
        const lastSentAt = user.confirmEmailOTPSentAt;
        if (lastSentAt &&
            now.getTime() - lastSentAt.getTime() <
                OTP_RESEND_COOLDOWN_SECONDS * 1000) {
            return genericResponse;
        }
        const previousWindowStartedAt = user.confirmEmailOTPResendWindowStartedAt;
        const windowExpired = !previousWindowStartedAt ||
            now.getTime() - previousWindowStartedAt.getTime() >=
                OTP_RESEND_WINDOW_HOURS * 60 * 60 * 1000;
        const previousResendCount = user.confirmEmailOTPResendCount ?? 0;
        if (!windowExpired &&
            previousResendCount >= MAX_OTP_RESENDS_PER_WINDOW) {
            return genericResponse;
        }
        const otp = (0, generateOTP_1.generateOTP)();
        const otpHash = await (0, hash_1.generateHash)(otp);
        const windowStartedAt = windowExpired
            ? now
            : previousWindowStartedAt;
        const resendCount = windowExpired
            ? 1
            : previousResendCount + 1;
        const expiresAt = new Date(now.getTime() + OTP_EXPIRATION_MINUTES * 60 * 1000);
        const isUpdated = await user_repository_1.userRepository.issueNewConfirmEmailOTP({
            userId: user._id,
            previousSentAt: lastSentAt,
            previousWindowStartedAt,
            previousResendCount,
            otpHash,
            expiresAt,
            sentAt: now,
            windowStartedAt,
            resendCount,
        });
        if (!isUpdated) {
            return genericResponse;
        }
        email_events_1.emailEvent.emit("confirmEmail", {
            to: user.email,
            username: user.username,
            otp,
            expiresInMinutes: CONFIRM_EMAIL_OTP_TTL / (60 * 1000),
        });
        return genericResponse;
    }
    async login(data) {
        const { email, password } = data;
        const user = await user_repository_1.userRepository.findByEmailWithPassword(email);
        if (!user || !user.password) {
            throw new error_response_2.UnauthorizedException("Invalid email or password");
        }
        const isPasswordValid = await (0, hash_1.compareHash)(password, user.password);
        if (!isPasswordValid) {
            throw new error_response_2.UnauthorizedException("Invalid email or password");
        }
        if (!user.confirmedAt) {
            throw new error_response_2.ForbiddenException("Please verify your email before logging in");
        }
        if (user.freezedAt) {
            throw new error_response_2.ForbiddenException("Your account is currently frozen");
        }
        const credentials = await (0, token_1.createLoginCredentials)(user);
        return {
            message: "Login successful",
            user: {
                id: user._id.toString(),
                firstName: user.firstName,
                lastName: user.lastName,
                username: user.username,
                email: user.email,
                role: user.role,
            },
            tokens: {
                accessToken: credentials.accessToken,
                refreshToken: credentials.refreshToken,
                tokenType: credentials.signatureLevel,
            },
        };
    }
    async logoutCurrentDevice({ authorization, accessDecoded, refreshToken, }) {
        const [signatureLevel] = authorization.trim().split(/\s+/);
        if (!signatureLevel || !refreshToken) {
            throw new error_response_2.UnauthorizedException("Invalid logout credentials");
        }
        const { user: refreshUser, decoded: refreshDecoded, } = await (0, token_1.decodedToken)({
            authorization: `${signatureLevel} ${refreshToken}`,
            tokenType: token_1.TokenTypeEnum.REFRESH,
        });
        if (refreshUser._id.toString() !==
            String(accessDecoded._id)) {
            throw new error_response_2.UnauthorizedException("Invalid logout credentials");
        }
        await (0, token_1.createRevokeTokens)([
            accessDecoded,
            refreshDecoded,
        ]);
        return {
            message: "Logged out from current device successfully",
        };
    }
    async logoutAllDevices(userId) {
        const user = await user_repository_1.userRepository.incrementTokenVersion(userId);
        if (!user) {
            throw new error_response_2.UnauthorizedException("User not found");
        }
        return {
            message: "Logged out from all devices successfully",
        };
    }
    async refreshToken(authorization) {
        const { user, decoded, isRevoked, } = await (0, token_1.decodedToken)({
            authorization,
            tokenType: token_1.TokenTypeEnum.REFRESH,
            allowRevoked: true,
        });
        if (isRevoked) {
            await user_repository_1.userRepository.incrementTokenVersion(user._id);
            throw new error_response_2.UnauthorizedException("Refresh token reuse detected. All sessions have been revoked. Please login again.");
        }
        if (user.freezedAt) {
            throw new error_response_2.ForbiddenException("Your account is currently frozen");
        }
        try {
            await (0, token_1.createRevokeToken)(decoded);
        }
        catch (error) {
            if (isDuplicateKeyError(error)) {
                await user_repository_1.userRepository.incrementTokenVersion(user._id);
                throw new error_response_2.UnauthorizedException("Refresh token reuse detected. All sessions have been revoked. Please login again.");
            }
            throw error;
        }
        const credentials = await (0, token_1.createLoginCredentials)(user);
        return {
            message: "Tokens refreshed successfully",
            tokens: {
                accessToken: credentials.accessToken,
                refreshToken: credentials.refreshToken,
                tokenType: credentials.signatureLevel,
            },
        };
    }
    async getProfile(userId) {
        const user = await user_repository_1.userRepository.findUserById(userId);
        if (!user) {
            throw new error_response_2.UnauthorizedException("User account not found. Please login again.");
        }
        return {
            user: {
                id: user._id.toString(),
                firstName: user.firstName,
                lastName: user.lastName,
                username: user.username,
                email: user.email,
                phone: user.phone,
                address: user.address,
                gender: user.gender,
                role: user.role,
                confirmedAt: user.confirmedAt,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            },
        };
    }
    async updateProfile(userId, data) {
        const user = await user_repository_1.userRepository.findUserById(userId);
        if (!user) {
            throw new error_response_2.UnauthorizedException("User account not found. Please login again.");
        }
        if (data.firstName !== undefined) {
            user.firstName = data.firstName;
        }
        if (data.lastName !== undefined) {
            user.lastName = data.lastName;
        }
        if (data.phone !== undefined) {
            if (data.phone === null) {
                user.set("phone", undefined);
            }
            else {
                user.phone = data.phone;
            }
        }
        if (data.gender !== undefined) {
            if (data.gender === null) {
                user.set("gender", undefined);
            }
            else {
                user.gender = data.gender;
            }
        }
        if (data.address !== undefined) {
            user.address = data.address.map(({ building, apartment, ...address }) => ({
                ...address,
                ...(building !== undefined ? { building } : {}),
                ...(apartment !== undefined ? { apartment } : {}),
            }));
        }
        await user.save();
        return {
            message: "Profile updated successfully",
            user: {
                id: user._id.toString(),
                firstName: user.firstName,
                lastName: user.lastName,
                username: user.username,
                email: user.email,
                phone: user.phone,
                address: user.address,
                gender: user.gender,
                role: user.role,
                confirmedAt: user.confirmedAt,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            },
        };
    }
    async changePassword(userId, data) {
        const user = await user_repository_1.userRepository.findUserByIdWithPassword(userId);
        if (!user) {
            throw new error_response_2.UnauthorizedException("User account not found. Please login again.");
        }
        const isCurrentPasswordValid = await (0, hash_1.compareHash)(data.currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            throw new error_response_2.UnauthorizedException("Current password is incorrect");
        }
        const newPasswordHash = await (0, hash_1.generateHash)(data.newPassword);
        const isUpdated = await user_repository_1.userRepository.changePasswordAndInvalidateSessions({
            userId,
            currentPasswordHash: user.password,
            newPasswordHash,
        });
        if (!isUpdated) {
            throw new error_response_1.ConflictException("Password was changed by another request. Please login again.");
        }
        return {
            message: "Password changed successfully. Please login again.",
        };
    }
    async forgotPassword(data) {
        const user = await user_repository_1.userRepository.findUserForPasswordReset(data.email);
        if (!user) {
            return { message: FORGOT_PASSWORD_RESPONSE };
        }
        const now = new Date();
        const previousSentAt = user.resetPasswordOTPSentAt;
        const previousWindowStartedAt = user.resetPasswordOTPWindowStartedAt;
        const isNewWindow = !previousWindowStartedAt ||
            now.getTime() - previousWindowStartedAt.getTime() >=
                RESET_PASSWORD_RESEND_WINDOW;
        if (!isNewWindow &&
            previousSentAt &&
            now.getTime() - previousSentAt.getTime() <
                RESET_PASSWORD_RESEND_COOLDOWN) {
            return { message: FORGOT_PASSWORD_RESPONSE };
        }
        const previousResendCount = user.resetPasswordOTPResendCount ?? 0;
        if (!isNewWindow && previousResendCount >= RESET_PASSWORD_MAX_SENDS) {
            return { message: FORGOT_PASSWORD_RESPONSE };
        }
        const otp = (0, generateOTP_1.generateOTP)();
        const otpHash = await (0, hash_1.generateHash)(otp);
        const sentAt = now;
        const windowStartedAt = isNewWindow
            ? now
            : previousWindowStartedAt;
        const resendCount = isNewWindow ? 1 : previousResendCount + 1;
        const isIssued = await user_repository_1.userRepository.issueResetPasswordOTP({
            userId: user._id,
            expectedVersion: user.__v,
            otpHash,
            expiresAt: new Date(now.getTime() + RESET_PASSWORD_OTP_TTL),
            sentAt,
            windowStartedAt,
            resendCount,
        });
        if (!isIssued) {
            return { message: FORGOT_PASSWORD_RESPONSE };
        }
        email_events_1.emailEvent.emit("resetPassword", {
            to: user.email,
            username: user.username,
            otp,
            expiresInMinutes: RESET_PASSWORD_OTP_TTL / (60 * 1000),
        });
        return { message: FORGOT_PASSWORD_RESPONSE };
    }
    async resetPassword(data) {
        const user = await user_repository_1.userRepository.findUserForPasswordResetWithPassword(data.email);
        if (!user || !user.resetPasswordOTP || !user.resetPasswordOTPExpiresAt) {
            throw new error_response_2.UnauthorizedException("Invalid or expired OTP");
        }
        const now = new Date();
        if (user.resetPasswordOTPExpiresAt.getTime() <= now.getTime()) {
            throw new error_response_2.UnauthorizedException("Invalid or expired OTP");
        }
        const isOTPValid = await (0, hash_1.compareHash)(data.otp, user.resetPasswordOTP);
        if (!isOTPValid) {
            throw new error_response_2.UnauthorizedException("Invalid or expired OTP");
        }
        const isSamePassword = await (0, hash_1.compareHash)(data.newPassword, user.password);
        if (isSamePassword) {
            throw new error_response_1.BadRequestException("New password must be different from your current password");
        }
        const newPasswordHash = await (0, hash_1.generateHash)(data.newPassword);
        const isReset = await user_repository_1.userRepository.resetPasswordAndInvalidateSessions({
            userId: user._id,
            otpHash: user.resetPasswordOTP,
            newPasswordHash,
            now,
        });
        if (!isReset) {
            throw new error_response_2.UnauthorizedException("Invalid or expired OTP. Please request a new code.");
        }
        return {
            message: "Password reset successfully. Please login again.",
        };
    }
}
exports.authService = new AuthService();
