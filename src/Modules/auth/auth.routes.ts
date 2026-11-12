import { Router } from 'express';
import { uploadRoute, uploadLimiter } from '../../Middlewares/upload.middlewares';
import { avatarUpload } from '../../Utils/storage/upload.policies';

import { authController } from './auth.controller';
import {
  googleLoginSchema,
  googleLinkSchema,
  signupSchema,
  confirmEmailSchema,
  resendConfirmEmailSchema,
  loginSchema,
  logoutCurrentDeviceSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} from './auth.validation';

import { validations } from '../../Middlewares/validation.middlewares';
import {
  registerLimiter,
  loginLimiter,
  otpLimiter,
  resendEmailOTPLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from '../../Utils/middleware/rate-limit';
import { authentication } from '../../Middlewares/authentication.middlewares';
import { developmentOnly } from '../../Middlewares/development.middlewares';

const router = Router();

router.post('/google', loginLimiter, validations(googleLoginSchema), authController.googleLogin);
router.post('/google/link', loginLimiter, authentication(), validations(googleLinkSchema), authController.linkGoogle);

// POST /api/v1/auth/register
router.post('/register', registerLimiter, validations(signupSchema), authController.register);

// POST /api/v1/auth/confirm-email
router.post(
  '/confirm-email',
  otpLimiter,
  validations(confirmEmailSchema),
  authController.confirmEmail,
);

// POST /api/v1/auth/resend-confirm-email
router.post(
  '/resend-confirm-email',
  resendEmailOTPLimiter,
  validations(resendConfirmEmailSchema),
  authController.resendConfirmEmail,
);

// POST /api/v1/auth/login
router.post('/login', loginLimiter, validations(loginSchema), authController.login);

// POST /api/v1/auth/test-revoke
router.post('/test-revoke', developmentOnly, authentication(), authController.testRevoke);

// Logout from current device
router.post(
  '/logout',
  authentication(),
  validations(logoutCurrentDeviceSchema),
  authController.logoutCurrentDevice,
);

// Logout from all devices
router.post('/logout-all', authentication(), authController.logoutAllDevices);

// Refresh Token
router.post('/refresh-token', validations(refreshTokenSchema), authController.refreshToken);

// Get Profile
router.get('/profile', authentication(), authController.getProfile);

// Update Profile
router.patch(
  '/profile',
  authentication(),
  uploadLimiter,
  uploadRoute(avatarUpload, updateProfileSchema, authController.updateProfile),
);

// Change Password
router.patch(
  '/change-password',
  authentication(),
  validations(changePasswordSchema),
  authController.changePassword,
);

// Forgot Password
router.patch(
  '/forgot-password',
  forgotPasswordLimiter,
  validations(forgotPasswordSchema),
  authController.forgotPassword,
);

// Reset Password
router.patch(
  '/reset-password',
  resetPasswordLimiter,
  validations(resetPasswordSchema),
  authController.resetPassword,
);

export const authRouter = router;
