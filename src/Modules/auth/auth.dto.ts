
import * as z from "zod";

import {
  changePasswordSchema,
  confirmEmailSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutCurrentDeviceSchema,
  refreshTokenSchema,
  resendConfirmEmailSchema,
  resetPasswordSchema,
  signupSchema,
  updateProfileSchema,
} from "./auth.validation";

// ============================================================================
// Signup DTO
// ============================================================================

export type ISignupDTO = z.infer<
  typeof signupSchema.body
>;

// ============================================================================
// Login DTO
// ============================================================================

export type ILoginDTO = z.infer<
  typeof loginSchema.body
>;

// ============================================================================
// Confirm Email DTO
// ============================================================================

export type IConfirmEmailDTO = z.infer<
  typeof confirmEmailSchema.body
>;

// ============================================================================
// Resend Confirm Email DTO
// ============================================================================

export type IResendConfirmEmailDTO = z.infer<
  typeof resendConfirmEmailSchema.body
>;


// ============================================================================
// Logout Current Device DTO
// ============================================================================

export type ILogoutCurrentDeviceDTO = z.infer<
  typeof logoutCurrentDeviceSchema.cookies
>;
export type IRefreshTokenDTO = z.infer<typeof refreshTokenSchema.cookies>;


// ============================================================================
// Update Profile DTO
// ============================================================================

export type IUpdateProfileDTO = z.infer<
  typeof updateProfileSchema.body
>;

// ============================================================================
// Change Password DTO
// ============================================================================

export type IChangePasswordDTO = z.infer<
  typeof changePasswordSchema.body
>;


// ============================================================================
// Forgot Password DTO
// ============================================================================
export type IForgotPasswordDTO = z.infer<
  typeof forgotPasswordSchema.body
>;

// ============================================================================
// Reset Password DTO
// ============================================================================
export type IResetPasswordDTO = z.infer<
  typeof resetPasswordSchema.body
>;
