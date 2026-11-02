
import * as z from "zod";
import { LogoutEnum } from "../Utils/security/logout";
import { Types } from "mongoose";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password cannot exceed 128 characters")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");



export const generalFields = {
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
    .pipe(
      z.email({
        error: "Please provide a valid email address",
      })
    ),
  password: passwordSchema,
  confirmPassword: passwordSchema,
  otp: z.string().regex(/^\d{6}$/).min(6, { error: "OTP must be 6 characters long" }).max(6, { error: "OTP must be 6 characters long" }),
  flag: z.enum(LogoutEnum).default(LogoutEnum.ONLY),
  file: function (mimetype: string[]) {
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
      .refine(
        (data) => {
          return data.path || data.buffer;
        },
        { error: "Please provide a file" }
      );
  },
  id: z.string().refine(
    (data) => {
      return Types.ObjectId.isValid(data);
    },
    { error: "Invalid ID" }
  )
}
