import type { ZodType } from 'zod';
import { BadRequestException, ConflictException } from '../../Utils/response/error.response';

export function parseAccount<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Validation Error', { cause: result.error.issues });
  return result.data;
}
export function accountFilter(query: { search?: string | undefined; role?: string | undefined; status?: string | undefined }) {
  const search = query.search?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    deletedAt: query.status === 'deleted' ? { $ne: null } : null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status === 'frozen' ? { freezedAt: { $ne: null } } : {}),
    ...(query.status === 'active' || query.status === 'pending' ? { freezedAt: null } : {}),
    ...(search ? { $or: ['firstName', 'lastName', 'email'].map(field => ({ [field]: { $regex: search, $options: 'i' } })) } : {}),
  };
}
export function accountWriteError(error: unknown): never {
  if (typeof error === 'object' && error && 'code' in error && error.code === 11000)
    throw new ConflictException('An account with this email already exists');
  throw error;
}
