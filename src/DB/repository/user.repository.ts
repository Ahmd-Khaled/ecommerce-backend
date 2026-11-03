
import { Types } from "mongoose";

import { DatabaseRepository } from "./db.repository";



import { UserModel } from "../models/user/user.model";
import { HUserDocument, IUser, IUserVirtuals } from "../models/user/user.interface";

// ============================================================================
// User Repository
// ============================================================================

class UserRepository extends DatabaseRepository<IUser, IUserVirtuals, HUserDocument> {
  constructor() {
    super(UserModel);
  }

  // --------------------------------------------------------------------------
  // Find user by email
  // --------------------------------------------------------------------------

  async findByEmail(
    email: string
  ): Promise<HUserDocument | null> {
    return this.model
      .findOne({
        email: email.trim().toLowerCase(),
      })
      .exec() as Promise<HUserDocument | null>;
  }

  // --------------------------------------------------------------------------
  // Find user by email including password
  // --------------------------------------------------------------------------

  async findByEmailWithPassword(
    email: string
  ): Promise<HUserDocument | null> {
    return this.model
      .findOne({
        email: email.trim().toLowerCase(),
      })
      .select("+password")
      .exec() as Promise<HUserDocument | null>;
  }

  // --------------------------------------------------------------------------
  // Find user by ID
  // --------------------------------------------------------------------------

  async findUserById(
    id: Types.ObjectId
  ): Promise<HUserDocument | null> {
    return this.model
      .findById(id)
      .exec() as Promise<HUserDocument | null>;
  }

  // --------------------------------------------------------------------------
  // Create a new user
  // --------------------------------------------------------------------------

  async createUser(
    data: Partial<IUser>
  ): Promise<HUserDocument> {
    return this.model.create(data) as Promise<HUserDocument>;
  }


  async findByEmailWithConfirmEmailOTP(
    email: string
  ): Promise<HUserDocument | null> {
    return this.model
      .findOne({
        email: email.trim().toLowerCase(),
      })
      .select(
        [
          "+confirmEmailOTP",
          "+confirmEmailOTPExpiresAt",
          "+confirmEmailOTPAttempts",
          "+confirmEmailOTPSentAt",
          "+confirmEmailOTPResendCount",
          "+confirmEmailOTPResendWindowStartedAt",
        ].join(" ")
      )
      .exec() as Promise<HUserDocument | null>;
  }

  /**
   * Increment failed attempts only if this OTP is still active.
   * The filter makes the increment atomic and caps attempts at 5.
   */
  async incrementConfirmEmailOTPAttempts(
    userId: Types.ObjectId,
    otpHash: string,
    maxAttempts: number
  ): Promise<number | null> {
    const user = await this.model
      .findOneAndUpdate(
        {
          _id: userId,
          confirmedAt: { $exists: false },
          confirmEmailOTP: otpHash,
          confirmEmailOTPExpiresAt: { $gt: new Date() },
          confirmEmailOTPAttempts: { $lt: maxAttempts },
        },
        {
          $inc: {
            confirmEmailOTPAttempts: 1,
          },
        },
        {
          returnDocument: "after",
        }
      )
      .select("+confirmEmailOTPAttempts")
      .exec();

    if (!user) return null;

    const attempts = user.confirmEmailOTPAttempts ?? 0;

    // Invalidate the OTP immediately after the final failed attempt.
    if (attempts >= maxAttempts) {
      await this.model.updateOne(
        {
          _id: userId,
          confirmEmailOTP: otpHash,
          confirmEmailOTPAttempts: { $gte: maxAttempts },
        },
        {
          $unset: {
            confirmEmailOTP: 1,
            confirmEmailOTPExpiresAt: 1,
          },
        }
      );
    }

    return attempts;
  }

  /**
   * Consume the OTP and verify the account atomically.
   */
  async confirmUserEmail(
    userId: Types.ObjectId,
    otpHash: string,
    maxAttempts: number
  ): Promise<boolean> {
    const user = await this.model.findOneAndUpdate(
      {
        _id: userId,
        confirmedAt: { $exists: false },
        confirmEmailOTP: otpHash,
        confirmEmailOTPExpiresAt: { $gt: new Date() },
        confirmEmailOTPAttempts: { $lt: maxAttempts },
      },
      {
        $set: {
          confirmedAt: new Date(),
        },
        $unset: {
          confirmEmailOTP: 1,
          confirmEmailOTPExpiresAt: 1,
          confirmEmailOTPAttempts: 1,
          confirmEmailOTPSentAt: 1,
          confirmEmailOTPResendCount: 1,
          confirmEmailOTPResendWindowStartedAt: 1,
        },
      },
      {
        returnDocument: "after",
      }
    ).exec();

    return Boolean(user);
  }

  /**
   * Replace an existing OTP with a new one.
   *
   * The $expr comparison protects against concurrent resend requests:
   * only one request can update the account using a particular snapshot
   * of its previous rate-limit fields.
   */
  async issueNewConfirmEmailOTP(params: {
    userId: Types.ObjectId;
    previousSentAt: Date | undefined;
    previousWindowStartedAt: Date | undefined;
    previousResendCount: number;
    otpHash: string;
    expiresAt: Date;
    sentAt: Date;
    windowStartedAt: Date;
    resendCount: number;
  }): Promise<boolean> {
    const {
      userId,
      previousSentAt,
      previousWindowStartedAt,
      previousResendCount,
      otpHash,
      expiresAt,
      sentAt,
      windowStartedAt,
      resendCount,
    } = params;

    const user = await this.model.findOneAndUpdate(
      {
        _id: userId,
        confirmedAt: { $exists: false },
        $expr: {
          $and: [
            {
              $eq: [
                { $ifNull: ["$confirmEmailOTPSentAt", null] },
                previousSentAt ?? null,
              ],
            },
            {
              $eq: [
                {
                  $ifNull: [
                    "$confirmEmailOTPResendWindowStartedAt",
                    null,
                  ],
                },
                previousWindowStartedAt ?? null,
              ],
            },
            {
              $eq: [
                { $ifNull: ["$confirmEmailOTPResendCount", 0] },
                previousResendCount,
              ],
            },
          ],
        },
      },
      {
        $set: {
          confirmEmailOTP: otpHash,
          confirmEmailOTPExpiresAt: expiresAt,
          confirmEmailOTPAttempts: 0,
          confirmEmailOTPSentAt: sentAt,
          confirmEmailOTPResendWindowStartedAt: windowStartedAt,
          confirmEmailOTPResendCount: resendCount,
        },
      },
      {
        returnDocument: "after",
      }
    ).exec();

    return Boolean(user);
  }



  /**
   * Increment the token version.
   */
  async incrementTokenVersion(
    userId: Types.ObjectId
  ): Promise<HUserDocument | null> {
    return this.model
      .findByIdAndUpdate(
        userId,
        {
          $inc: {
            tokenVersion: 1,
          },
        },
        {
          returnDocument: "after",
          runValidators: true,
        }
      )
      .exec() as Promise<HUserDocument | null>;
  }


  async findUserByIdWithPassword(
    userId: Types.ObjectId
  ): Promise<HUserDocument | null> {
    return this.model
      .findById(userId)
      .select("+password")
      .exec() as Promise<HUserDocument | null>;
  }

  async changePasswordAndInvalidateSessions(params: {
    userId: Types.ObjectId;
    currentPasswordHash: string;
    newPasswordHash: string;
  }): Promise<boolean> {
    const { userId, currentPasswordHash, newPasswordHash } = params;

    const result = await this.model
      .updateOne(
        {
          _id: userId,
          password: currentPasswordHash,
        },
        {
          $set: {
            password: newPasswordHash,
          },
          $inc: {
            tokenVersion: 1,
          },
        },
        {
          runValidators: true,
        }
      )
      .exec();

    return result.modifiedCount === 1;
  }

  async findUserForPasswordReset(email: string): Promise<HUserDocument | null> {
    return this.model
      .findOne({
        email,
        confirmedAt: { $exists: true, $ne: null },
      })
      .select(
        [
          "+password",
          "+resetPasswordOTP",
          "+resetPasswordOTPExpiresAt",
          "+resetPasswordOTPSentAt",
          "+resetPasswordOTPWindowStartedAt",
          "+resetPasswordOTPResendCount",
        ].join(" ")
      )
      .exec() as Promise<HUserDocument | null>;
  }

  async issueResetPasswordOTP(params: {
    userId: Types.ObjectId;
    expectedVersion: number;
    otpHash: string;
    expiresAt: Date;
    sentAt: Date;
    windowStartedAt: Date;
    resendCount: number;
  }): Promise<boolean> {
    const {
      userId,
      expectedVersion,
      otpHash,
      expiresAt,
      sentAt,
      windowStartedAt,
      resendCount,
    } = params;

    const result = await this.model
      .updateOne(
        {
          _id: userId,
          __v: expectedVersion,
        },
        {
          $set: {
            resetPasswordOTP: otpHash,
            resetPasswordOTPExpiresAt: expiresAt,
            resetPasswordOTPSentAt: sentAt,
            resetPasswordOTPWindowStartedAt: windowStartedAt,
            resetPasswordOTPResendCount: resendCount,
            resetPasswordOTPAttempts: 0,
          },
          $inc: {
            __v: 1,
          },
        },
        {
          runValidators: true,
        }
      )
      .exec();

    return result.modifiedCount === 1;
  }

  async incrementResetPasswordOTPAttempts(params: {
    userId: Types.ObjectId;
    otpHash: string;
    now: Date;
    maxAttempts: number;
  }): Promise<number | null> {
    const { userId, otpHash, now, maxAttempts } = params;

    const updatedUser = await this.model
      .findOneAndUpdate(
        {
          _id: userId,
          resetPasswordOTP: otpHash,
          resetPasswordOTPExpiresAt: { $gt: now },
          resetPasswordOTPAttempts: { $lt: maxAttempts },
        },
        {
          $inc: {
            resetPasswordOTPAttempts: 1,
            __v: 1,
          },
        },
        {
          returnDocument: "after",
          projection: {
            resetPasswordOTPAttempts: 1,
          },
        })
      .exec();

    if (!updatedUser) {
      return null;
    }

    return updatedUser.resetPasswordOTPAttempts ?? 0;
  }

  async invalidateResetPasswordOTP(params: {
    userId: Types.ObjectId;
    otpHash: string;
    maxAttempts: number;
  }): Promise<void> {
    const { userId, otpHash, maxAttempts } = params;

    await this.model
      .updateOne(
        {
          _id: userId,
          resetPasswordOTP: otpHash,
          resetPasswordOTPAttempts: { $gte: maxAttempts },
        },
        {
          $unset: {
            resetPasswordOTP: 1,
            resetPasswordOTPExpiresAt: 1,
            resetPasswordOTPSentAt: 1,
            resetPasswordOTPWindowStartedAt: 1,
            resetPasswordOTPResendCount: 1,
            resetPasswordOTPAttempts: 1,
          },
          $inc: {
            __v: 1,
          },
        }
      )
      .exec();
  }

  async resetPasswordAndInvalidateSessions(params: {
    userId: Types.ObjectId;
    otpHash: string;
    newPasswordHash: string;
    now: Date;
  }): Promise<boolean> {
    const { userId, otpHash, newPasswordHash, now } = params;

    const result = await this.model
      .updateOne(
        {
          _id: userId,
          resetPasswordOTP: otpHash,
          resetPasswordOTPExpiresAt: { $gt: now },
          resetPasswordOTPAttempts: { $lt: 5 },
        },
        {
          $set: {
            password: newPasswordHash,
          },
          $unset: {
            resetPasswordOTP: 1,
            resetPasswordOTPExpiresAt: 1,
            resetPasswordOTPSentAt: 1,
            resetPasswordOTPWindowStartedAt: 1,
            resetPasswordOTPResendCount: 1,
            resetPasswordOTPAttempts: 1,
          },
          $inc: {
            tokenVersion: 1,
            __v: 1,
          },
        },
        {
          runValidators: true,
        }
      )
      .exec();

    return result.modifiedCount === 1;
  }

  async findUserForPasswordResetWithPassword(
    email: string
  ): Promise<HUserDocument | null> {
    return this.model
      .findOne({
        email,
        confirmedAt: { $exists: true, $ne: null },
      })
      .select(
        [
          "+password",
          "+resetPasswordOTP",
          "+resetPasswordOTPExpiresAt",
          "+resetPasswordOTPAttempts",
        ].join(" ")
      )
      .exec() as Promise<HUserDocument | null>;
  }

}

// ============================================================================
// Singleton Repository Instance
// ============================================================================

export const userRepository = new UserRepository();
