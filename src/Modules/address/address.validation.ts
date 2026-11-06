import { z } from "zod";
import { generalFields } from "../../Middlewares/validation.fields";

const text = (max: number) => z.string().trim().min(1).max(max);
const fields = {
  label: text(50),
  fullName: text(100),
  phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{5,24}$/, "Invalid phone number"),
  country: text(100),
  city: text(100),
  street: text(300),
  building: z.string().trim().max(100).optional(),
  apartment: z.string().trim().max(100).optional(),
  isDefault: z.boolean().optional(),
};

export const createAddressSchema = z.strictObject(fields);
export const updateAddressSchema = z.strictObject(fields).partial()
  .refine(value => Object.values(value).some(field => field !== undefined), "Provide at least one address field");
export const addressIdSchema = z.strictObject({ addressId: generalFields.id });
export const setDefaultAddressSchema = z.strictObject({}).default({});
