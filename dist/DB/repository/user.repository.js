"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRepository = void 0;
const db_repository_1 = require("./db.repository");
const user_model_1 = require("../models/user/user.model");
class UserRepository extends db_repository_1.DatabaseRepository {
    constructor() {
        super(user_model_1.UserModel);
    }
    async findByEmail(email) {
        return this.model
            .findOne({
            email: email.trim().toLowerCase(),
        })
            .exec();
    }
    async findByEmailWithPassword(email) {
        return this.model
            .findOne({
            email: email.trim().toLowerCase(),
        })
            .select("+password")
            .exec();
    }
    async findUserById(id) {
        return this.model
            .findById(id)
            .exec();
    }
    async createUser(data) {
        return this.model.create(data);
    }
    async findByEmailWithConfirmEmailOTP(email) {
        return this.model
            .findOne({
            email: email.trim().toLowerCase(),
        })
            .select([
            "+confirmEmailOTP",
            "+confirmEmailOTPExpiresAt",
            "+confirmEmailOTPAttempts",
            "+confirmEmailOTPSentAt",
            "+confirmEmailOTPResendCount",
            "+confirmEmailOTPResendWindowStartedAt",
        ].join(" "))
            .exec();
    }
    async incrementConfirmEmailOTPAttempts(userId, otpHash, maxAttempts) {
        const user = await this.model
            .findOneAndUpdate({
            _id: userId,
            confirmedAt: { $exists: false },
            confirmEmailOTP: otpHash,
            confirmEmailOTPExpiresAt: { $gt: new Date() },
            confirmEmailOTPAttempts: { $lt: maxAttempts },
        }, {
            $inc: {
                confirmEmailOTPAttempts: 1,
            },
        }, {
            new: true,
        })
            .select("+confirmEmailOTPAttempts")
            .exec();
        if (!user)
            return null;
        const attempts = user.confirmEmailOTPAttempts ?? 0;
        if (attempts >= maxAttempts) {
            await this.model.updateOne({
                _id: userId,
                confirmEmailOTP: otpHash,
                confirmEmailOTPAttempts: { $gte: maxAttempts },
            }, {
                $unset: {
                    confirmEmailOTP: 1,
                    confirmEmailOTPExpiresAt: 1,
                },
            });
        }
        return attempts;
    }
    async confirmUserEmail(userId, otpHash, maxAttempts) {
        const user = await this.model.findOneAndUpdate({
            _id: userId,
            confirmedAt: { $exists: false },
            confirmEmailOTP: otpHash,
            confirmEmailOTPExpiresAt: { $gt: new Date() },
            confirmEmailOTPAttempts: { $lt: maxAttempts },
        }, {
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
        }, {
            new: true,
        }).exec();
        return Boolean(user);
    }
    async issueNewConfirmEmailOTP(params) {
        const { userId, previousSentAt, previousWindowStartedAt, previousResendCount, otpHash, expiresAt, sentAt, windowStartedAt, resendCount, } = params;
        const user = await this.model.findOneAndUpdate({
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
        }, {
            $set: {
                confirmEmailOTP: otpHash,
                confirmEmailOTPExpiresAt: expiresAt,
                confirmEmailOTPAttempts: 0,
                confirmEmailOTPSentAt: sentAt,
                confirmEmailOTPResendWindowStartedAt: windowStartedAt,
                confirmEmailOTPResendCount: resendCount,
            },
        }, {
            new: true,
        }).exec();
        return Boolean(user);
    }
    async incrementTokenVersion(userId) {
        return this.model
            .findByIdAndUpdate(userId, {
            $inc: {
                tokenVersion: 1,
            },
        }, {
            new: true,
            runValidators: true,
        })
            .exec();
    }
    async findUserByIdWithPassword(userId) {
        return this.model
            .findById(userId)
            .select("+password")
            .exec();
    }
    async changePasswordAndInvalidateSessions(params) {
        const { userId, currentPasswordHash, newPasswordHash } = params;
        const result = await this.model
            .updateOne({
            _id: userId,
            password: currentPasswordHash,
        }, {
            $set: {
                password: newPasswordHash,
            },
            $inc: {
                tokenVersion: 1,
            },
        }, {
            runValidators: true,
        })
            .exec();
        return result.modifiedCount === 1;
    }
    async findUserForPasswordReset(email) {
        return this.model
            .findOne({
            email,
            confirmedAt: { $exists: true, $ne: null },
        })
            .select([
            "+password",
            "+resetPasswordOTP",
            "+resetPasswordOTPExpiresAt",
            "+resetPasswordOTPSentAt",
            "+resetPasswordOTPWindowStartedAt",
            "+resetPasswordOTPResendCount",
        ].join(" "))
            .exec();
    }
    async issueResetPasswordOTP(params) {
        const { userId, expectedVersion, otpHash, expiresAt, sentAt, windowStartedAt, resendCount, } = params;
        const result = await this.model
            .updateOne({
            _id: userId,
            __v: expectedVersion,
        }, {
            $set: {
                resetPasswordOTP: otpHash,
                resetPasswordOTPExpiresAt: expiresAt,
                resetPasswordOTPSentAt: sentAt,
                resetPasswordOTPWindowStartedAt: windowStartedAt,
                resetPasswordOTPResendCount: resendCount,
            },
            $inc: {
                __v: 1,
            },
        }, {
            runValidators: true,
        })
            .exec();
        return result.modifiedCount === 1;
    }
    async resetPasswordAndInvalidateSessions(params) {
        const { userId, otpHash, newPasswordHash, now } = params;
        const result = await this.model
            .updateOne({
            _id: userId,
            resetPasswordOTP: otpHash,
            resetPasswordOTPExpiresAt: { $gt: now },
        }, {
            $set: {
                password: newPasswordHash,
            },
            $unset: {
                resetPasswordOTP: 1,
                resetPasswordOTPExpiresAt: 1,
                resetPasswordOTPSentAt: 1,
                resetPasswordOTPWindowStartedAt: 1,
                resetPasswordOTPResendCount: 1,
            },
            $inc: {
                tokenVersion: 1,
                __v: 1,
            },
        }, {
            runValidators: true,
        })
            .exec();
        return result.modifiedCount === 1;
    }
    async findUserForPasswordResetWithPassword(email) {
        return this.model
            .findOne({
            email,
            confirmedAt: { $exists: true, $ne: null },
        })
            .select([
            "+password",
            "+resetPasswordOTP",
            "+resetPasswordOTPExpiresAt",
        ].join(" "))
            .exec();
    }
}
exports.userRepository = new UserRepository();
