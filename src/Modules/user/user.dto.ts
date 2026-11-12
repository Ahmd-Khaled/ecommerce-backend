import type { z } from 'zod';
import type { createUserSchema, updateUserSchema, userListSchema } from './user.validation';
export type CreateUserDTO = z.infer<typeof createUserSchema>;
export type UpdateUserDTO = z.infer<typeof updateUserSchema>;
export type UserListDTO = z.infer<typeof userListSchema>;
