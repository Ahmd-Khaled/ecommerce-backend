import { z } from 'zod';

export const paginationFields = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export function pagination(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit),
    hasNextPage: page * limit < total, hasPreviousPage: page > 1 };
}
