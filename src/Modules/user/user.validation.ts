import * as z from 'zod';
import { RoleEnum } from '../../DB/models/user/user.interface';
import { generalFields } from '../../Middlewares/validation.fields';
import { accountNames, accountPagination } from '../admin/admin.validation';
export const userListSchema = z.strictObject({ ...accountPagination,
  role: z.enum(RoleEnum).optional(), status: z.enum(['active', 'pending', 'frozen', 'deleted']).optional() });
export const createUserSchema = z.strictObject({ ...accountNames, email: generalFields.email,
  password: generalFields.password, role: z.enum(RoleEnum).default(RoleEnum.USER) });
export const updateUserSchema = z.strictObject({
  firstName: accountNames.firstName.optional(), lastName: accountNames.lastName.optional(),
  role: z.enum(RoleEnum).optional(), status: z.enum(['active', 'frozen']).optional(),
}).refine(data => Object.keys(data).length > 0, 'Provide at least one field');
