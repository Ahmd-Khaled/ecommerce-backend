import * as z from 'zod';
import { generalFields } from '../../Middlewares/validation.fields';
import { AdminRoleEnum } from '../../DB/models/admin/admin.interface';

export const accountNames = {
  firstName: z.string().trim().min(2).max(30),
  lastName: z.string().trim().min(2).max(30),
};
export const accountPagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
};
export const accountIdSchema = z.strictObject({ id: z.string().regex(/^[a-fA-F0-9]{24}$/) });
export const adminListSchema = z.strictObject({ ...accountPagination,
  role: z.enum(AdminRoleEnum).optional(), status: z.enum(['active', 'frozen', 'deleted']).optional() });
export const createAdminSchema = z.strictObject({ ...accountNames,
  email: generalFields.email, password: generalFields.password,
  role: z.enum(AdminRoleEnum).default(AdminRoleEnum.ADMIN) });
export const updateAdminSchema = z.strictObject({
  firstName: accountNames.firstName.optional(), lastName: accountNames.lastName.optional(),
  role: z.enum(AdminRoleEnum).optional(), status: z.enum(['active', 'frozen']).optional(),
}).refine(data => Object.keys(data).length > 0, 'Provide at least one field');
export const adminProfileSchema = z.strictObject({
  firstName: accountNames.firstName.optional(), lastName: accountNames.lastName.optional(),
}).refine(data => Object.keys(data).length > 0, 'Provide at least one field');
export const adminRefreshSchema = {
  cookies: z.object({ adminRefreshToken: z.string().max(8192).regex(/^admin [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) }),
  body: z.strictObject({}).default({}),
};
