import type {
  ISignupDTO,
  IConfirmEmailDTO,
  ILoginDTO,
  IUpdateProfileDTO,
  IChangePasswordDTO,
  IForgotPasswordDTO,
  IResetPasswordDTO,
} from "./auth.dto";

import type { JwtPayload } from "jsonwebtoken";
import type { Types } from "mongoose";

import {
  createLoginCredentials,
  createRevokeToken,
  createRevokeTokens,
  decodedToken,
  TokenTypeEnum,
} from "../../Utils/security/token";

import { userRepository } from "../../DB/repository/user.repository";
import {
  BadRequestException,
  ConflictException,
} from "../../Utils/response/error.response";

import { compareHash, generateHash } from "../../Utils/security/hash";
import { generateOTP } from "../../Utils/generateOTP";
import { monitorOTPFailure } from "../../Utils/security/otp-monitor";
import { enqueueEmail } from "../../Utils/email/email.queue";

import {
  UnauthorizedException,
  ForbiddenException,
} from "../../Utils/response/error.response";


const OTP_EXPIRATION_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_RESEND_WINDOW_HOURS = 1;
const MAX_OTP_RESENDS_PER_WINDOW = 5;

const RESET_PASSWORD_OTP_TTL = 10 * 60 * 1000; // 10 minutes
const RESET_PASSWORD_RESEND_COOLDOWN = 60 * 1000; // 60 seconds
const RESET_PASSWORD_RESEND_WINDOW = 10 * 60 * 1000; // 10 minutes
const RESET_PASSWORD_MAX_SENDS = 5;
const RESET_PASSWORD_MAX_ATTEMPTS = 5;
const FORGOT_PASSWORD_RESPONSE =
  "If an eligible account exists, a password reset code has been sent to its email address.";



const isDuplicateEmailError = (error: unknown): boolean => {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== 11000
  ) {
    return false;
  }

  if (!("keyPattern" in error)) return true;

  const keyPattern = error.keyPattern;

  return (
    typeof keyPattern === "object" &&
    keyPattern !== null &&
    "email" in keyPattern
  );
};

const isDuplicateKeyError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
};

class AuthService {
  private readonly MAX_OTP_ATTEMPTS = 5;

  async register(data: ISignupDTO) {
    const { firstName, lastName, email, password } = data;

    const normalizedData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
    };

    const existingUser = await userRepository.findByEmail(
      normalizedData.email
    );

    if (existingUser) {
      throw new ConflictException(
        "An account with this email already exists"
      );
    }

    const now = new Date();

    const otp = generateOTP();

    const confirmEmailOTPExpiresAt = new Date(
      now.getTime() + OTP_EXPIRATION_MINUTES * 60 * 1000
    );

    try {
      await userRepository.createUser({
        ...normalizedData,
        password,
        confirmEmailOTP: otp,
        confirmEmailOTPExpiresAt,

        // OTP security initialization
        confirmEmailOTPAttempts: 0,
        confirmEmailOTPSentAt: now,
        confirmEmailOTPResendCount: 0,
        confirmEmailOTPResendWindowStartedAt: now,
      });
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new ConflictException(
          "An account with this email already exists"
        );
      }

      throw error;
    }

    return {
      message:
        "Registration successful. Please check your email to verify your account.",
    };
  }

  async confirmEmail(data: IConfirmEmailDTO, ip?: string) {
    const { email, otp } = data;

    const user = await userRepository.findByEmailWithConfirmEmailOTP(
      email
    );

    const invalidOTP = () =>
      new BadRequestException("Invalid or expired verification code");

    if (
      !user ||
      user.confirmedAt ||
      !user.confirmEmailOTP ||
      !user.confirmEmailOTPExpiresAt
    ) {
      throw invalidOTP();
    }

    if (
      user.confirmEmailOTPExpiresAt.getTime() <= Date.now() ||
      (user.confirmEmailOTPAttempts ?? 0) >= this.MAX_OTP_ATTEMPTS
    ) {
      throw invalidOTP();
    }

    const isOTPValid = await compareHash(
      otp,
      user.confirmEmailOTP
    );

    if (!isOTPValid) {
      const attempts = await userRepository.incrementConfirmEmailOTPAttempts(
        user._id,
        user.confirmEmailOTP,
        this.MAX_OTP_ATTEMPTS
      );

      monitorOTPFailure({
        flow: "confirm-email",
        userId: user._id.toString(),
        ip,
        attempts,
        maxAttempts: this.MAX_OTP_ATTEMPTS,
      });

      throw invalidOTP();
    }

    const isUpdated = await userRepository.confirmUserEmail(
      user._id,
      user.confirmEmailOTP,
      this.MAX_OTP_ATTEMPTS
    );

    if (!isUpdated) {
      throw invalidOTP();
    }

    return {
      message: "Email verified successfully",
    };
  }

  async resendConfirmEmail(email: string) {
    const genericResponse = {
      message:
        "If an unverified account exists for this email, a verification code will be sent.",
    };

    const user = await userRepository.findByEmailWithConfirmEmailOTP(
      email
    );

    // Do not reveal whether the email exists or is already verified.
    if (!user || user.confirmedAt) {
      return genericResponse;
    }

    const now = new Date();

    // Enforce 60-second cooldown.
    const lastSentAt = user.confirmEmailOTPSentAt;

    if (
      lastSentAt &&
      now.getTime() - lastSentAt.getTime() <
      OTP_RESEND_COOLDOWN_SECONDS * 1000
    ) {
      return genericResponse;
    }

    // Enforce the maximum number of sends per hour.
    const previousWindowStartedAt =
      user.confirmEmailOTPResendWindowStartedAt;

    const windowExpired =
      !previousWindowStartedAt ||
      now.getTime() - previousWindowStartedAt.getTime() >=
      OTP_RESEND_WINDOW_HOURS * 60 * 60 * 1000;

    const previousResendCount =
      user.confirmEmailOTPResendCount ?? 0;

    if (
      !windowExpired &&
      previousResendCount >= MAX_OTP_RESENDS_PER_WINDOW
    ) {
      return genericResponse;
    }

    const otp = generateOTP();
    const otpHash = await generateHash(otp);

    const windowStartedAt = windowExpired
      ? now
      : previousWindowStartedAt;

    const resendCount = windowExpired
      ? 1
      : previousResendCount + 1;

    const expiresAt = new Date(
      now.getTime() + OTP_EXPIRATION_MINUTES * 60 * 1000
    );

    // Atomically replace the previous OTP and update rate-limit state.
    const isUpdated =
      await userRepository.issueNewConfirmEmailOTP({
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
      // Another request may have changed the account's OTP state.
      return genericResponse;
    }

    // Trigger the verification email after the database update.
    await enqueueEmail("confirmEmail", {
      to: user.email,
      username: user.username,
      otp,
      expiresAt: expiresAt.getTime(),
    });

    return genericResponse;
  }

  async login(data: ILoginDTO) {
    const { email, password } = data;

    // 1. Retrieve user including hidden password hash.
    const user = await userRepository.findByEmailWithPassword(email);

    // Use the same response for unknown email and incorrect password.
    if (!user || !user.password) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // 2. Compare submitted password with stored hash.
    const isPasswordValid = await compareHash(
      password,
      user.password
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // 3. Require email verification.
    if (!user.confirmedAt) {
      throw new ForbiddenException(
        "Please verify your email before logging in"
      );
    }

    // 4. Reject frozen accounts.
    if (user.freezedAt) {
      throw new ForbiddenException(
        "Your account is currently frozen"
      );
    }

    // 5. Generate access and refresh tokens.
    const credentials = await createLoginCredentials(user);

    // 6. Return only safe user information.
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

  async logoutCurrentDevice({
    accessDecoded,
    refreshToken,
  }: {
    accessDecoded: JwtPayload;
    refreshToken: string;
  }) {
    if (!refreshToken) {
      throw new UnauthorizedException("Invalid logout credentials");
    }

    // Verify the refresh token using the refresh secret.
    const {
      user: refreshUser,
      decoded: refreshDecoded,
    } = await decodedToken({
      authorization: refreshToken,
      tokenType: TokenTypeEnum.REFRESH,
    });

    // Both tokens must belong to the same account.
    if (
      refreshUser._id.toString() !==
      String(accessDecoded._id)
    ) {
      throw new UnauthorizedException("Invalid logout credentials");
    }

    // Revoke both access and refresh tokens.
    await createRevokeTokens([
      accessDecoded,
      refreshDecoded,
    ]);

    return {
      message: "Logged out from current device successfully",
    };
  }

  async logoutAllDevices(userId: Types.ObjectId) {
    // Incrementing the version invalidates all previously issued tokens.
    const user = await userRepository.incrementTokenVersion(userId);

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return {
      message: "Logged out from all devices successfully",
    };
  }

  // ============================================================================
  // Refresh Access & Refresh Tokens with Reuse Detection
  // ============================================================================

  async refreshToken(authorization: string) {
    // --------------------------------------------------------------------------
    // 1. Verify Refresh Token
    // --------------------------------------------------------------------------

    const {
      user,
      decoded,
      isRevoked,
    } = await decodedToken({
      authorization,
      tokenType: TokenTypeEnum.REFRESH,
      allowRevoked: true,
    });

    // --------------------------------------------------------------------------
    // 2. Detect Refresh Token Reuse
    // --------------------------------------------------------------------------

    if (isRevoked) {
      // The refresh token was already used or revoked.
      // Invalidate every session belonging to this account.
      await userRepository.incrementTokenVersion(user._id);

      throw new UnauthorizedException(
        "Refresh token reuse detected. All sessions have been revoked. Please login again."
      );
    }

    // --------------------------------------------------------------------------
    // 3. Check Account Status
    // --------------------------------------------------------------------------

    if (user.freezedAt) {
      throw new ForbiddenException(
        "Your account is currently frozen"
      );
    }

    // --------------------------------------------------------------------------
    // 4. Revoke Previous Refresh Token
    // --------------------------------------------------------------------------

    try {
      await createRevokeToken(decoded);
    } catch (error) {
      // Two simultaneous refresh requests might both pass the
      // initial revocation check. The unique jti index allows
      // only one request to revoke the token successfully.

      if (isDuplicateKeyError(error)) {
        await userRepository.incrementTokenVersion(user._id);

        throw new UnauthorizedException(
          "Refresh token reuse detected. All sessions have been revoked. Please login again."
        );
      }

      throw error;
    }

    // --------------------------------------------------------------------------
    // 5. Generate New Access & Refresh Tokens
    // --------------------------------------------------------------------------

    const credentials = await createLoginCredentials(user);

    // --------------------------------------------------------------------------
    // 6. Return New Credentials
    // --------------------------------------------------------------------------

    return {
      message: "Tokens refreshed successfully",

      tokens: {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        tokenType: credentials.signatureLevel,
      },
    };
  }


  // ============================================================================
  // Get Current User Profile
  // ============================================================================

  async getProfile(userId: Types.ObjectId) {
    // 1. Retrieve the latest user data from the database.
    const user = await userRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedException(
        "User account not found. Please login again."
      );
    }

    // 2. Return only safe, public profile information.
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

  // ============================================================================
  // Update Current User Profile
  // ============================================================================

  async updateProfile(
    userId: Types.ObjectId,
    data: IUpdateProfileDTO
  ) {
    // 1. Find the authenticated user's document.
    const user = await userRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedException(
        "User account not found. Please login again."
      );
    }

    // 2. Explicitly update only permitted profile fields.
    if (data.firstName !== undefined) {
      user.firstName = data.firstName;
    }

    if (data.lastName !== undefined) {
      user.lastName = data.lastName;
    }

    if (data.phone !== undefined) {
      if (data.phone === null) {
        user.set("phone", undefined);
      } else {
        user.phone = data.phone;
      }
    }

    if (data.gender !== undefined) {
      if (data.gender === null) {
        user.set("gender", undefined);
      } else {
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

    // 3. Save the document.
    // This triggers Mongoose validation and your existing pre-validate
    // slug generation hook when firstName or lastName changes.
    await user.save();

    // 4. Return only safe profile information.
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


  // ============================================================================
  // Change Current User Password
  // ============================================================================
  async changePassword(
    userId: Types.ObjectId,
    data: IChangePasswordDTO
  ) {
    const user = await userRepository.findUserByIdWithPassword(userId);

    if (!user) {
      throw new UnauthorizedException(
        "User account not found. Please login again."
      );
    }

    // 1. Verify the current password.
    const isCurrentPasswordValid = await compareHash(
      data.currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    // 2. Hash the new password.
    const newPasswordHash = await generateHash(data.newPassword);

    // 3. Update password and invalidate every existing session atomically.
    const isUpdated =
      await userRepository.changePasswordAndInvalidateSessions({
        userId,
        currentPasswordHash: user.password,
        newPasswordHash,
      });

    if (!isUpdated) {
      throw new ConflictException(
        "Password was changed by another request. Please login again."
      );
    }

    return {
      message: "Password changed successfully. Please login again.",
    };
  }


  // ============================================================================
  // Forgot Password
  // ============================================================================
  async forgotPassword(data: IForgotPasswordDTO) {
    const user = await userRepository.findUserForPasswordReset(data.email);

    // Always return the same response for unknown or unconfirmed accounts.
    if (!user) {
      return { message: FORGOT_PASSWORD_RESPONSE };
    }

    const now = new Date();

    const previousSentAt = user.resetPasswordOTPSentAt;
    const previousWindowStartedAt = user.resetPasswordOTPWindowStartedAt;

    const isNewWindow =
      !previousWindowStartedAt ||
      now.getTime() - previousWindowStartedAt.getTime() >=
      RESET_PASSWORD_RESEND_WINDOW;

    // Enforce cooldown within the current resend window.
    if (
      !isNewWindow &&
      previousSentAt &&
      now.getTime() - previousSentAt.getTime() <
      RESET_PASSWORD_RESEND_COOLDOWN
    ) {
      return { message: FORGOT_PASSWORD_RESPONSE };
    }

    const previousResendCount = user.resetPasswordOTPResendCount ?? 0;

    if (!isNewWindow && previousResendCount >= RESET_PASSWORD_MAX_SENDS) {
      return { message: FORGOT_PASSWORD_RESPONSE };
    }

    const otp = generateOTP();

    const otpHash = await generateHash(otp);

    const sentAt = now;

    const windowStartedAt = isNewWindow
      ? now
      : previousWindowStartedAt!;

    const resendCount = isNewWindow ? 1 : previousResendCount + 1;

    const isIssued = await userRepository.issueResetPasswordOTP({
      userId: user._id,
      expectedVersion: user.__v,
      otpHash,
      expiresAt: new Date(now.getTime() + RESET_PASSWORD_OTP_TTL),
      sentAt,
      windowStartedAt,
      resendCount,
    });

    // Another request may have changed the user document concurrently.
    if (!isIssued) {
      return { message: FORGOT_PASSWORD_RESPONSE };
    }

    // Persist delivery before acknowledging the request.
    await enqueueEmail("resetPassword", {
      to: user.email,
      username: user.username,
      otp,
      expiresAt: now.getTime() + RESET_PASSWORD_OTP_TTL,
    });

    return { message: FORGOT_PASSWORD_RESPONSE };
  }


  // ============================================================================
  // Reset Password
  // ============================================================================
  async resetPassword(data: IResetPasswordDTO, ip?: string) {
    const user =
      await userRepository.findUserForPasswordResetWithPassword(data.email);

    if (
      !user ||
      !user.resetPasswordOTP ||
      !user.resetPasswordOTPExpiresAt
    ) {
      throw new UnauthorizedException("Invalid or expired OTP");
    }

    const now = new Date();

    // 1. Check OTP expiration.
    if (user.resetPasswordOTPExpiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedException("Invalid or expired OTP");
    }

    // 2. Check whether the maximum number of attempts has been reached.
    if (
      (user.resetPasswordOTPAttempts ?? 0) >=
      RESET_PASSWORD_MAX_ATTEMPTS
    ) {
      throw new UnauthorizedException(
        "Invalid or expired OTP. Please request a new code."
      );
    }

    // 3. Verify the submitted OTP.
    const isOTPValid = await compareHash(
      data.otp,
      user.resetPasswordOTP
    );

    if (!isOTPValid) {
      const attempts =
        await userRepository.incrementResetPasswordOTPAttempts({
          userId: user._id,
          otpHash: user.resetPasswordOTP,
          now,
          maxAttempts: RESET_PASSWORD_MAX_ATTEMPTS,
        });

      // The OTP may have expired, been replaced, or reached its limit
      // while this request was being processed.
      if (attempts === null) {
        throw new UnauthorizedException("Invalid or expired OTP");
      }

      monitorOTPFailure({
        flow: "reset-password",
        userId: user._id.toString(),
        ip,
        attempts,
        maxAttempts: RESET_PASSWORD_MAX_ATTEMPTS,
      });

      if (attempts >= RESET_PASSWORD_MAX_ATTEMPTS) {
        await userRepository.invalidateResetPasswordOTP({
          userId: user._id,
          otpHash: user.resetPasswordOTP,
          maxAttempts: RESET_PASSWORD_MAX_ATTEMPTS,
        });

        throw new UnauthorizedException(
          "Maximum OTP attempts reached. Please request a new code."
        );
      }

      throw new UnauthorizedException(
        `Invalid OTP. ${RESET_PASSWORD_MAX_ATTEMPTS - attempts} attempts remaining.`
      );
    }

    // 4. Prevent reusing the current password.
    const isSamePassword = await compareHash(
      data.newPassword,
      user.password
    );

    if (isSamePassword) {
      throw new BadRequestException(
        "New password must be different from your current password"
      );
    }

    // 5. Hash the new password.
    const newPasswordHash = await generateHash(data.newPassword);

    // 6. Atomically reset the password, consume OTP, and invalidate sessions.
    const isReset =
      await userRepository.resetPasswordAndInvalidateSessions({
        userId: user._id,
        otpHash: user.resetPasswordOTP,
        newPasswordHash,
        now,
      });

    if (!isReset) {
      throw new UnauthorizedException(
        "Invalid or expired OTP. Please request a new code."
      );
    }

    return {
      message: "Password reset successfully. Please login again.",
    };
  }

}

export const authService = new AuthService();
