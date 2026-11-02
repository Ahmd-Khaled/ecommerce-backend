"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPasswordSchema = exports.forgotPasswordSchema = exports.changePasswordSchema = exports.updateProfileSchema = exports.logoutCurrentDeviceSchema = exports.resendConfirmEmailSchema = exports.confirmEmailSchema = exports.signupSchema = exports.loginSchema = void 0;
const z = __importStar(require("zod"));
const validation_fields_1 = require("../../Middlewares/validation.fields");
const user_interface_1 = require("../../DB/models/user/user.interface");
const phoneSchema = z
    .string()
    .trim()
    .min(7, "Phone number must contain at least 7 characters")
    .max(20, "Phone number cannot exceed 20 characters")
    .regex(/^\+?[0-9\s\-()]+$/, "Invalid phone number format");
exports.loginSchema = {
    body: z.strictObject({
        email: validation_fields_1.generalFields.email,
        password: validation_fields_1.generalFields.password,
    }),
};
exports.signupSchema = {
    body: z
        .strictObject({
        firstName: validation_fields_1.generalFields.firstName,
        lastName: validation_fields_1.generalFields.lastName,
        email: validation_fields_1.generalFields.email,
        password: validation_fields_1.generalFields.password,
        confirmPassword: validation_fields_1.generalFields.confirmPassword,
    })
        .superRefine((data, ctx) => {
        if (data.password !== data.confirmPassword) {
            ctx.addIssue({
                code: "custom",
                message: "Passwords do not match",
                path: ["confirmPassword"],
            });
        }
    }),
};
exports.confirmEmailSchema = {
    body: z.strictObject({
        email: validation_fields_1.generalFields.email,
        otp: validation_fields_1.generalFields.otp,
    }),
};
exports.resendConfirmEmailSchema = {
    body: z.strictObject({
        email: validation_fields_1.generalFields.email,
    }),
};
exports.logoutCurrentDeviceSchema = {
    body: z.strictObject({
        refreshToken: z.string().trim().min(1).max(8192),
    }),
};
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
    const defaultAddressIndexes = addresses.reduce((indexes, address, currentIndex) => {
        if (address.isDefault) {
            indexes.push(currentIndex);
        }
        return indexes;
    }, []);
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
exports.updateProfileSchema = {
    body: z
        .strictObject({
        firstName: z.string().trim().min(2).max(30).optional(),
        lastName: z.string().trim().min(2).max(30).optional(),
        phone: phoneSchema.nullable().optional(),
        gender: z.nativeEnum(user_interface_1.GenderEnum).nullable().optional(),
        address: updateProfileAddressArraySchema.optional(),
    })
        .refine((data) => Object.keys(data).length > 0, {
        message: "At least one profile field must be provided",
    }),
};
exports.changePasswordSchema = {
    body: z.strictObject({
        currentPassword: validation_fields_1.generalFields.password,
        newPassword: validation_fields_1.generalFields.password,
    }).refine((data) => data.currentPassword !== data.newPassword, {
        message: "New password must be different from current password",
        path: ["newPassword"],
    }),
};
exports.forgotPasswordSchema = {
    body: z.strictObject({
        email: validation_fields_1.generalFields.email,
    }),
};
exports.resetPasswordSchema = {
    body: z
        .strictObject({
        email: validation_fields_1.generalFields.email,
        otp: z.string().trim().pipe(validation_fields_1.generalFields.otp),
        newPassword: validation_fields_1.generalFields.password,
        confirmPassword: validation_fields_1.generalFields.confirmPassword,
    })
        .refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    }),
};
