import type { z } from 'zod';
import type { overviewSchema, salesSchema, topProductsSchema } from './dashboard.validation';
export type OverviewDTO = z.infer<typeof overviewSchema>;
export type SalesDTO = z.infer<typeof salesSchema>;
export type TopProductsDTO = z.infer<typeof topProductsSchema>;
