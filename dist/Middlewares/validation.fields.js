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
exports.generalFields = void 0;
const z = __importStar(require("zod"));
const logout_1 = require("../Utils/security/logout");
const mongoose_1 = require("mongoose");
const passwordSchema = z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password cannot exceed 128 characters")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number");
exports.generalFields = {
    firstName: z.string({ error: "First name is required" })
        .min(2, { error: "First name must be at least 2 characters long" })
        .max(50, { error: "First name must be at most 50 characters long" }),
    lastName: z.string({ error: "Last name is required" })
        .min(2, { error: "Last name must be at least 2 characters long" })
        .max(50, { error: "Last name must be at most 50 characters long" }),
    email: z
        .string({ error: "Email is required" })
        .trim()
        .toLowerCase()
        .max(254, {
        error: "Email must not exceed 254 characters",
    })
        .pipe(z.email({
        error: "Please provide a valid email address",
    })),
    password: passwordSchema,
    confirmPassword: passwordSchema,
    otp: z.string().regex(/^\d{6}$/).min(6, { error: "OTP must be 6 characters long" }).max(6, { error: "OTP must be 6 characters long" }),
    flag: z.enum(logout_1.LogoutEnum).default(logout_1.LogoutEnum.ONLY),
    file: function (mimetype) {
        return z
            .strictObject({
            fieldname: z.string(),
            originalname: z.string(),
            encoding: z.string(),
            mimetype: z.enum(mimetype),
            buffer: z.any().optional(),
            path: z.string().optional(),
            size: z.number(),
        })
            .refine((data) => {
            return data.path || data.buffer;
        }, { error: "Please provide a file" });
    },
    id: z.string().refine((data) => {
        return mongoose_1.Types.ObjectId.isValid(data);
    }, { error: "Invalid ID" })
};
