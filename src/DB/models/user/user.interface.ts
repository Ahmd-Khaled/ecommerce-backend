import {
  HydratedDocument,
  Model,
} from "mongoose";

// ============================================================================
// 1. Enums
// ============================================================================

export enum GenderEnum {
  MALE = "male",
  FEMALE = "female",
}

export enum RoleEnum {
  USER = "user",
  ADMIN = "admin",
  GUEST = "guest",
}

// ============================================================================
// 2. Address Interface
// ============================================================================

export interface IUserAddress {
  label: string;
  fullName: string;
  phone: string;
  country: string;
  city: string;
  street: string;
  building?: string;
  apartment?: string;
  isDefault: boolean;
}

// ============================================================================
// 3. User Interface
// ============================================================================

export interface IUser {
  // Personal information
  firstName: string;
  lastName: string;
  slug: string;

  // Authentication
  email: string;
  password: string;

  // Contact information
  phone?: string;
  address?: IUserAddress[];
  gender?: GenderEnum;

  // Authorization
  role: RoleEnum;

  // Email verification
  confirmEmailOTP?: string;
  confirmEmailOTPExpiresAt?: Date;
  confirmedAt?: Date;

  // OTP security
  confirmEmailOTPAttempts?: number;
  confirmEmailOTPSentAt?: Date;
  confirmEmailOTPResendCount?: number;
  confirmEmailOTPResendWindowStartedAt?: Date;

  // Password recovery
  resetPasswordOTP?: string;
  resetPasswordOTPExpiresAt?: Date;
  resetPasswordOTPSentAt?: Date;
  resetPasswordOTPWindowStartedAt?: Date;
  resetPasswordOTPResendCount?: number;

  // Account security
  changeCredentialsTime?: Date;
  freezedAt?: Date;

  // Token versioning
  tokenVersion: number;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

// ============================================================================
// 4. Virtual Properties
// ============================================================================

export interface IUserVirtuals {
  username: string;
}

// ============================================================================
// 5. Document Locals
// ============================================================================

export interface IUserDocumentLocals {
  wasNew?: boolean;
  confirmEmailPlainOTP?: string;
}

// ============================================================================
// 6. Mongoose Document & Model Types
// ============================================================================

export type HUserDocument = HydratedDocument<
  IUser,
  IUserVirtuals
> & {
  $locals: IUserDocumentLocals;
};

export type UserModelType = Model<
  IUser,
  {},
  {},
  IUserVirtuals,
  HUserDocument
>;