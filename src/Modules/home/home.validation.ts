import { z } from 'zod';
import { bannerView } from '../banner/banner.validation';
import { paginationFields } from '../../Utils/pagination';
export const homeSchema = z.strictObject({
  view: bannerView, limit: z.coerce.number().int().min(1).max(20).default(8),
});
export const homeProductsSchema = z.strictObject({
  section: z.enum(['latest', 'best-offers', 'best-sellers']), ...paginationFields,
});
