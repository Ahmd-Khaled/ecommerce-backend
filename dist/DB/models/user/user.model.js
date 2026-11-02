"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserModel = exports.UserSchema = void 0;
const mongoose_1 = require("mongoose");
const user_interface_1 = require("./user.interface");
const hash_1 = require("../../../Utils/security/hash");
const email_events_1 = require("../../../Utils/events/email.events");
const generateSlug = (value) => {
    return value
        .trim()
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
};
const generateUsername = (firstName, lastName) => {
    return `${firstName} ${lastName}`.trim();
};
const removeSensitiveFields = (ret) => {
    delete ret.password;
    delete ret.confirmEmailOTP;
    delete ret.resetPasswordOTP;
    delete ret.changeCredentialsTime;
    return ret;
};
const UserAddressSchema = new mongoose_1.Schema({
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
}, {
    _id: false,
});
exports.UserSchema = new mongoose_1.Schema({
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
        enum: Object.values(user_interface_1.GenderEnum),
    },
    role: {
        type: String,
        enum: Object.values(user_interface_1.RoleEnum),
        default: user_interface_1.RoleEnum.USER,
        required: true,
    },
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
    changeCredentialsTime: {
        type: Date,
        select: false,
    },
    freezedAt: {
        type: Date,
    },
    tokenVersion: {
        type: Number,
        default: 0,
        min: 0,
        select: true,
    },
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: (_doc, ret) => {
            return removeSensitiveFields(ret);
        },
    },
    toObject: {
        virtuals: true,
        transform: (_doc, ret) => {
            return removeSensitiveFields(ret);
        },
    },
});
exports.UserSchema.virtual("username")
    .get(function () {
    return generateUsername(this.firstName, this.lastName);
})
    .set(function (value) {
    const normalizedValue = value
        .trim()
        .replace(/\s+/g, " ");
    const [firstName = "", ...lastNameParts] = normalizedValue.split(" ");
    const lastName = lastNameParts.join(" ");
    this.set({
        firstName,
        lastName,
        slug: generateSlug(normalizedValue),
    });
});
exports.UserSchema.pre("validate", function () {
    if (this.isNew ||
        this.isModified("firstName") ||
        this.isModified("lastName")) {
        this.slug = generateSlug(generateUsername(this.firstName, this.lastName));
    }
});
exports.UserSchema.pre("save", async function () {
    const locals = this.$locals;
    locals.wasNew = this.isNew;
    if (this.isModified("password")) {
        this.password = await (0, hash_1.generateHash)(this.password);
    }
    if (this.isModified("confirmEmailOTP")) {
        const plainOTP = this.confirmEmailOTP;
        if (plainOTP) {
            locals.confirmEmailPlainOTP = plainOTP;
            this.confirmEmailOTP = await (0, hash_1.generateHash)(plainOTP);
        }
    }
    if (this.isModified("resetPasswordOTP") &&
        this.resetPasswordOTP) {
        this.resetPasswordOTP = await (0, hash_1.generateHash)(this.resetPasswordOTP);
    }
});
exports.UserSchema.post("save", async function (doc) {
    const locals = doc.$locals;
    try {
        const wasNew = locals.wasNew;
        const plainOTP = locals.confirmEmailPlainOTP;
        if (wasNew && plainOTP) {
            await email_events_1.emailEvent.emit("confirmEmail", {
                to: doc.email,
                username: doc.username,
                otp: plainOTP,
            });
        }
    }
    finally {
        delete locals.wasNew;
        delete locals.confirmEmailPlainOTP;
    }
});
exports.UserModel = mongoose_1.models.User ??
    (0, mongoose_1.model)("User", exports.UserSchema);
