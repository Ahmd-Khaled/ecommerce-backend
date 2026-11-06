
import * as z from "zod";

import {
  generalFields,
} from "../../Middlewares/validation.fields";
import { GenderEnum } from "../../DB/models/user/user.interface";


const phoneSchema = z
  .string()
  .trim()
  .min(7, "Phone number must contain at least 7 characters")
  .max(20, "Phone number cannot exceed 20 characters")
  .regex(/^\+?[0-9\s\-()]+$/, "Invalid phone number format");

// ============================================================================
// 1. Login Schema
// ============================================================================

export const loginSchema = {
  body: z.strictObject({
    email: generalFields.email,
    password: generalFields.password,
  }),
};

// ============================================================================
// 2. Signup Schema
// ============================================================================

export const signupSchema = {
  body: z
    .strictObject({
      firstName: generalFields.firstName,
      lastName: generalFields.lastName,
      email: generalFields.email,
      password: generalFields.password,
      confirmPassword: generalFields.confirmPassword,
    })
    .superRefine((data, ctx) => {

      // ----------------------------------------------------------------------
      // Password Confirmation
      // ----------------------------------------------------------------------

      if (data.password !== data.confirmPassword) {
        ctx.addIssue({
          code: "custom",
          message: "Passwords do not match",
          path: ["confirmPassword"],
        });
      }

    }),
};

// ============================================================================
// 3. Confirm Email Schema
// ============================================================================

export const confirmEmailSchema = {
  body: z.strictObject({
    email: generalFields.email,
    otp: generalFields.otp,
  }),
};

// ============================================================================
// 4. Resend Confirm Email Schema
// ============================================================================

export const resendConfirmEmailSchema = {
  body: z.strictObject({
    email: generalFields.email,
  }),
};


// ============================================================================
// 5. Logout Current Device Schema
// ============================================================================
export const refreshTokenSchema = {
  cookies: z.object({
    refreshToken: z.string().min(1).max(8192)
      .regex(/^(user|admin) [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "Invalid refresh cookie"),
  }),
  body: z.strictObject({}).default({}),
};
export const logoutCurrentDeviceSchema = refreshTokenSchema;

// ============================================================================
// Update Profile Validation
// ============================================================================

const updateProfileAddressSchema = z.strictObject({
  label: z.string().trim().min(2).max(30),
  fullName: z.string().trim().min(2).max(60),
  phone: phoneSchema,
  country: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(60),
  street: z.string().trim().min(2).max(120),
  building: z.string().trim().max(30).optional(),
  apartment: z.string().trim().max(30).optional(),
  isDefault: z.boolean(),
});

const updateProfileAddressArraySchema = z
  .array(updateProfileAddressSchema)
  .max(20, "You cannot add more than 20 addresses")
  .superRefine((addresses, ctx) => {
    const defaultAddressIndexes = addresses.reduce<number[]>(
      (indexes, address, currentIndex) => {
        if (address.isDefault) {
          indexes.push(currentIndex);
        }

        return indexes;
      },
      []
    );

    if (defaultAddressIndexes.length > 1) {
      defaultAddressIndexes.slice(1).forEach((index) => {
        ctx.addIssue({
          code: "custom",
          message: "Only one address can be set as default",
          path: [index, "isDefault"],
        });
      });
    }
  });

// ============================================================================
// Update Profile Schema
// ============================================================================
export const updateProfileSchema = {
  body: z
    .strictObject({
      firstName: z.string().trim().min(2).max(30).optional(),

      lastName: z.string().trim().min(2).max(30).optional(),

      phone: phoneSchema.nullable().optional(),

      gender: z.nativeEnum(GenderEnum).nullable().optional(),

      address: updateProfileAddressArraySchema.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one profile field must be provided",
    }),
};

// ===========================================================================
// Change Password Schema
// ===========================================================================
export const changePasswordSchema = {
  body: z.strictObject({
    currentPassword: generalFields.password,
    newPassword: generalFields.password,
  }).refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  }),
};

// ===========================================================================
// Forgot Password Schema
// ===========================================================================
export const forgotPasswordSchema = {
  body: z.strictObject({
    email: generalFields.email,
  }),
};


// ===========================================================================
// Reset Password Schema
// ===========================================================================
export const resetPasswordSchema = {
  body: z
    .strictObject({
      email: generalFields.email,
      otp: z.string().trim().pipe(generalFields.otp),
      newPassword: generalFields.password,
      confirmPassword: generalFields.confirmPassword,
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    }),
};
