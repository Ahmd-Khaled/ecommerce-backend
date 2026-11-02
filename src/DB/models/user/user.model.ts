import {
  model,
  models,
  Schema,
} from "mongoose";

import type {
  IUser,
  IUserAddress,
  IUserDocumentLocals,
  IUserVirtuals,
  UserModelType,
  HUserDocument,
} from "./user.interface";

import {
  GenderEnum,
  RoleEnum,
} from "./user.interface";

import { generateHash } from "../../../Utils/security/hash";
import { emailEvent } from "../../../Utils/events/email.events";

// ============================================================================
// 1. Helper Functions
// ============================================================================

/**
 * Generates a URL-friendly slug from a string.
 *
 * Supports Unicode characters, including Arabic.
 */
const generateSlug = (value: string): string => {
  return value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
};

/**
 * Returns the full username from first and last names.
 */
const generateUsername = (
  firstName: string,
  lastName: string
): string => {
  return `${firstName} ${lastName}`.trim();
};

/**
 * Removes sensitive fields before serialization.
 */
const removeSensitiveFields = (
  ret: Record<string, unknown>
): Record<string, unknown> => {
  delete ret.password;
  delete ret.confirmEmailOTP;
  delete ret.resetPasswordOTP;
  delete ret.changeCredentialsTime;

  return ret;
};

// ============================================================================
// 2. Address Schema
// ============================================================================

const UserAddressSchema = new Schema<IUserAddress>(
  {
    label: {
      type: String,
      required: true,
      trim: true,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    country: {
      type: String,
      required: true,
      trim: true,
    },

    city: {
      type: String,
      required: true,
      trim: true,
    },

    street: {
      type: String,
      required: true,
      trim: true,
    },

    building: {
      type: String,
      trim: true,
    },

    apartment: {
      type: String,
      trim: true,
    },

    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  }
);

// ============================================================================
// 3. User Schema
// ============================================================================

export const UserSchema = new Schema<
  IUser,
  UserModelType,
  {},
  IUserVirtuals
>(
  {
    // ------------------------------------------------------------------------
    // Personal Information
    // ------------------------------------------------------------------------

    firstName: {
      type: String,
      required: true,
      minlength: 2,
      maxlength: 30,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      minlength: 2,
      maxlength: 30,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
    },

    // ------------------------------------------------------------------------
    // Authentication
    // ------------------------------------------------------------------------

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    // ------------------------------------------------------------------------
    // Contact Information
    // ------------------------------------------------------------------------

    phone: {
      type: String,
      trim: true,
    },

    address: {
      type: [UserAddressSchema],
      default: undefined,
    },

    gender: {
      type: String,
      enum: Object.values(GenderEnum),
    },

    // ------------------------------------------------------------------------
    // Authorization
    // ------------------------------------------------------------------------

    role: {
      type: String,
      enum: Object.values(RoleEnum),
      default: RoleEnum.USER,
      required: true,
    },

    // ------------------------------------------------------------------------
    // Email Verification
    // ------------------------------------------------------------------------

    confirmEmailOTP: {
      type: String,
      select: false,
    },

    confirmEmailOTPExpiresAt: {
      type: Date,
      select: false,
    },

    confirmedAt: {
      type: Date,
    },

    // ------------------------------------------------------------------------
    // OTP Security
    // ------------------------------------------------------------------------
    confirmEmailOTPAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    confirmEmailOTPSentAt: {
      type: Date,
      select: false,
    },

    confirmEmailOTPResendCount: {
      type: Number,
      default: 0,
      select: false,
    },

    confirmEmailOTPResendWindowStartedAt: {
      type: Date,
      select: false,
    },

    // ------------------------------------------------------------------------
    // Password Recovery
    // ------------------------------------------------------------------------

    resetPasswordOTP: {
      type: String,
      select: false,
    },

    resetPasswordOTPExpiresAt: {
      type: Date,
      select: false,
    },

    resetPasswordOTPSentAt: {
      type: Date,
      select: false,
    },

    resetPasswordOTPWindowStartedAt: {
      type: Date,
      select: false,
    },

    resetPasswordOTPResendCount: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },

    // ------------------------------------------------------------------------
    // Account Security
    // ------------------------------------------------------------------------

    changeCredentialsTime: {
      type: Date,
      select: false,
    },

    freezedAt: {
      type: Date,
    },

    // ------------------------------------------------------------------------
    // Token Versioning
    // ------------------------------------------------------------------------
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: true,
    },
  },
  {
    // Automatically manages createdAt and updatedAt.
    timestamps: true,

    // ------------------------------------------------------------------------
    // JSON Serialization
    // ------------------------------------------------------------------------

    toJSON: {
      virtuals: true,

      transform: (_doc, ret) => {
        return removeSensitiveFields(
          ret as Record<string, unknown>
        );
      },
    },

    // ------------------------------------------------------------------------
    // Object Serialization
    // ------------------------------------------------------------------------

    toObject: {
      virtuals: true,

      transform: (_doc, ret) => {
        return removeSensitiveFields(
          ret as Record<string, unknown>
        );
      },
    },
  }
);

// ============================================================================
// 4. Virtual Properties
// ============================================================================

/**
 * username is a virtual property.
 *
 * It is not stored in MongoDB.
 *
 * Getter:
 * firstName + lastName
 *
 * Setter:
 * username -> firstName + lastName + slug
 */

UserSchema.virtual("username")
  .get(function () {
    return generateUsername(
      this.firstName,
      this.lastName
    );
  })
  .set(function (value: string) {
    const normalizedValue = value
      .trim()
      .replace(/\s+/g, " ");

    const [firstName = "", ...lastNameParts] =
      normalizedValue.split(" ");

    const lastName = lastNameParts.join(" ");

    this.set({
      firstName,
      lastName,
      slug: generateSlug(normalizedValue),
    });
  });

// ============================================================================
// 5. Pre-Validation Middleware
// ============================================================================

/**
 * Generates the slug automatically whenever the user's
 * firstName or lastName changes.
 *
 * Runs before Mongoose validation.
 */

UserSchema.pre("validate", function () {
  if (
    this.isNew ||
    this.isModified("firstName") ||
    this.isModified("lastName")
  ) {
    this.slug = generateSlug(
      generateUsername(
        this.firstName,
        this.lastName
      )
    );
  }
});

// ============================================================================
// 6. Pre-Save Middleware
// ============================================================================

/**
 * Runs before saving a user document.
 *
 * Responsibilities:
 * 1. Tracks whether this is a new user.
 * 2. Hashes the password when modified.
 * 3. Hashes email confirmation OTP when modified.
 * 4. Hashes password reset OTP when modified.
 */

UserSchema.pre("save", async function () {
  const locals = this.$locals as IUserDocumentLocals;

  // Track whether this is a newly created user.
  locals.wasNew = this.isNew;

  // --------------------------------------------------------------------------
  // Password Hashing
  // --------------------------------------------------------------------------

  if (this.isModified("password")) {
    this.password = await generateHash(this.password);
  }

  // --------------------------------------------------------------------------
  // Email Confirmation OTP Hashing
  // --------------------------------------------------------------------------

  if (this.isModified("confirmEmailOTP")) {
    const plainOTP = this.confirmEmailOTP;

    if (plainOTP) {
      // Temporarily preserve the original OTP for the email event.
      locals.confirmEmailPlainOTP = plainOTP;

      this.confirmEmailOTP = await generateHash(plainOTP);
    }
  }

  // --------------------------------------------------------------------------
  // Password Reset OTP Hashing
  // --------------------------------------------------------------------------

  if (
    this.isModified("resetPasswordOTP") &&
    this.resetPasswordOTP
  ) {
    this.resetPasswordOTP = await generateHash(
      this.resetPasswordOTP
    );
  }
});

// ============================================================================
// 7. Post-Save Middleware
// ============================================================================

/**
 * Runs after a successful document save.
 *
 * Sends the email confirmation OTP only when:
 * 1. The user is newly created.
 * 2. An email confirmation OTP was provided.
 */

UserSchema.post("save", async function (doc: HUserDocument) {
  const locals = doc.$locals as IUserDocumentLocals;

  try {
    const wasNew = locals.wasNew;
    const plainOTP = locals.confirmEmailPlainOTP;

    if (wasNew && plainOTP) {
      await emailEvent.emit("confirmEmail", {
        to: doc.email,
        username: doc.username,
        otp: plainOTP,
      });
    }
  } finally {
    // Always remove temporary sensitive information.
    delete locals.wasNew;
    delete locals.confirmEmailPlainOTP;
  }
});

// ============================================================================
// 8. User Model
// ============================================================================

/**
 * Prevents OverwriteModelError during development
 * when the application reloads modules.
 */

export const UserModel: UserModelType =
  (models.User as UserModelType | undefined) ??
  model<IUser, UserModelType>(
    "User",
    UserSchema
  );