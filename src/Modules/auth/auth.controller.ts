
import type { RequestHandler } from "express";
import type { IChangePasswordDTO, IConfirmEmailDTO, IForgotPasswordDTO, ILoginDTO, IResendConfirmEmailDTO, IResetPasswordDTO, ISignupDTO, IUpdateProfileDTO } from "./auth.dto";
import { authService } from "./auth.service";
import { createRevokeToken } from "../../Utils/security/token";
import { BadRequestException, UnauthorizedException } from "../../Utils/response/error.response";

// ============================================================================
// Auth Controller
// ============================================================================

class AuthController {

  testRevoke: RequestHandler = async (req, res): Promise<void> => {
    if (!req.decoded) {
      throw new UnauthorizedException("Missing authenticated token");
    }

    const result = await createRevokeToken(req.decoded);

    if (!result) {
      throw new BadRequestException("Failed to revoke token");
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

  // --------------------------------------------------------------------------
  // Register
  // --------------------------------------------------------------------------

  register: RequestHandler = async (req, res): Promise<void> => {

    // 1. Extract validated request body.
    const data = req.body as ISignupDTO;

    // 2. Call registration business logic.
    const result = await authService.register(data);

    // 3. Send HTTP response.
    res.status(201).json({
      success: true,
      message: result.message,
    });
  };

  // --------------------------------------------------------------------------
  // Confirm Email
  // --------------------------------------------------------------------------
  confirmEmail: RequestHandler = async (
    req,
    res
  ): Promise<void> => {
    const data = req.body as IConfirmEmailDTO;

    const result = await authService.confirmEmail(data, req.ip);

    res.status(200).json({
      success: true,
      message: result.message,
    });
  };


  // --------------------------------------------------------------------------
  // Resend Confirm Email
  // --------------------------------------------------------------------------

  resendConfirmEmail: RequestHandler = async (
    req,
    res
  ): Promise<void> => {
    const data = req.body as IResendConfirmEmailDTO;

    const result = await authService.resendConfirmEmail(
      data.email
    );

    res.status(200).json({
      success: true,
      message: result.message,
    });
  };


  // --------------------------------------------------------------------------
  // Login
  // --------------------------------------------------------------------------


  login: RequestHandler = async (req, res): Promise<void> => {
    const data = req.body as ILoginDTO;

    const result = await authService.login(data);

    res.status(200).json({
      success: true,
      ...result,
    });
  };

  // ============================================================================
  // Logout Current Device
  // ============================================================================

  logoutCurrentDevice: RequestHandler = async (req, res): Promise<void> => {
    const result = await authService.logoutCurrentDevice({
      authorization: req.headers.authorization!,
      accessDecoded: req.decoded!,
      refreshToken: req.body.refreshToken,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  };

  // ============================================================================
  // Logout All Devices
  // ============================================================================

  logoutAllDevices: RequestHandler = async (req, res): Promise<void> => {
    const result = await authService.logoutAllDevices(
      req.user!._id
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  };

  // ============================================================================
  // Refresh Token
  // ============================================================================

  refreshToken: RequestHandler = async (
    req,
    res
  ): Promise<void> => {
    const result = await authService.refreshToken(
      req.headers.authorization ?? ""
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  };

  // ============================================================================
  // Get Profile
  // ============================================================================

  getProfile: RequestHandler = async (
    req,
    res
  ): Promise<void> => {
    const result = await authService.getProfile(
      req.user!._id
    );

    res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      ...result,
    });
  };


  // ============================================================================
  // Update Profile
  // ============================================================================
  updateProfile: RequestHandler = async (
    req,
    res
  ): Promise<void> => {
    const result = await authService.updateProfile(
      req.user!._id,
      req.body as IUpdateProfileDTO
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  };


  // ============================================================================
  // Change Password
  // ============================================================================

  changePassword: RequestHandler = async (req, res): Promise<void> => {
    const result = await authService.changePassword(
      req.user!._id,
      req.body as IChangePasswordDTO
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  };


  // ============================================================================
  // Forgot Password
  // ============================================================================
  forgotPassword: RequestHandler = async (req, res): Promise<void> => {
    const result = await authService.forgotPassword(
      req.body as IForgotPasswordDTO
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  };


  // ============================================================================
  // Reset Password
  // ============================================================================
  resetPassword: RequestHandler = async (req, res): Promise<void> => {
    const result = await authService.resetPassword(
      req.body as IResetPasswordDTO,
      req.ip
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  };

}

// ============================================================================
// Export Controller Instance
// ============================================================================

export const authController = new AuthController();
