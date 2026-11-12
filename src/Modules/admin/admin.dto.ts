import type { z } from 'zod';
import type { createAdminSchema, updateAdminSchema, adminListSchema } from './admin.validation';
export type CreateAdminDTO = z.infer<typeof createAdminSchema>;
export type UpdateAdminDTO = z.infer<typeof updateAdminSchema>;
export type AdminListDTO = z.infer<typeof adminListSchema>;
