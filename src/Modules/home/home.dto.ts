import type { z } from 'zod';
import type { homeProductsSchema, homeSchema } from './home.validation';
export type HomeDTO = z.infer<typeof homeSchema>;
export type HomeProductsDTO = z.infer<typeof homeProductsSchema>;
