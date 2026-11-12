import type { RequestHandler } from 'express';
import { AdminRoleEnum, type HAdminDocument } from '../../DB/models/admin/admin.interface';
import { ForbiddenException, UnauthorizedException } from '../../Utils/response/error.response';
import { decodedAdminToken } from './admin.token';

export function requireAdmin(admin: HAdminDocument | undefined, superOnly = false): asserts admin is HAdminDocument {
  if (!admin || admin.deletedAt || admin.freezedAt || !Object.values(AdminRoleEnum).includes(admin.role) ||
    (superOnly && admin.role !== AdminRoleEnum.SUPER_ADMIN)) throw new ForbiddenException('Unauthorized administrator action');
}
export const adminAuthentication = (roles = Object.values(AdminRoleEnum)): RequestHandler => async (req, _res, next) => {
  if (!req.headers.authorization) throw new UnauthorizedException('Missing Authorization Header');
  const { admin, decoded } = await decodedAdminToken(req.headers.authorization);
  // console.log("-----------------decoded token", admin, decoded);
  requireAdmin(admin);
  if (!roles.includes(admin.role)) throw new ForbiddenException('Unauthorized Access');
  req.admin = admin;
  req.decoded = decoded;
  next();
};
