import { z } from 'zod';
import { paginationFields } from '../../Utils/pagination';
const dates = { from: z.iso.datetime().optional(), to: z.iso.datetime().optional() };
function period<T extends { from?: string | undefined; to?: string | undefined }>(value: T) {
  const to = value.to ? new Date(value.to) : new Date();
  const from = value.from ? new Date(value.from) : new Date(to.getTime() - 30 * 86400000);
  return { ...value, from, to };
}
const validRange = (value: { from: Date; to: Date }) =>
  value.from <= value.to && value.to.getTime() - value.from.getTime() <= 366 * 86400000;
export const overviewSchema = z.strictObject(dates).transform(period)
  .refine(validRange, 'Date range must be ordered and at most 366 days');
export const salesSchema = z.strictObject({ ...dates, groupBy: z.enum(['day', 'month']).default('day') })
  .transform(period).refine(validRange, 'Date range must be ordered and at most 366 days');
export const topProductsSchema = z.strictObject({ ...dates, ...paginationFields,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
}).transform(period).refine(validRange, 'Date range must be ordered and at most 366 days');
