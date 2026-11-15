import type { z } from 'zod';
import type { createBannerSchema, updateBannerSchema, adminBannerSchema, publicBannerSchema } from './banner.validation';
export type CreateBannerDTO = z.infer<typeof createBannerSchema>;
export type UpdateBannerDTO = z.infer<typeof updateBannerSchema>;
export type AdminBannerDTO = z.infer<typeof adminBannerSchema>;
export type PublicBannerDTO = z.infer<typeof publicBannerSchema>;
