import type { JwtPayload } from 'jsonwebtoken';
import { AdminModel } from '../../DB/models/admin/admin.model';
import { adminRepository } from '../../DB/repository/admin.repository';
import type { HAdminDocument } from '../../DB/models/admin/admin.interface';
import { compareHash, generateHash } from '../../Utils/security/hash';
import { createRevokeToken, createRevokeTokens, TokenTypeEnum } from '../../Utils/security/token';
import { UnauthorizedException, ConflictException } from '../../Utils/response/error.response';
import { createAdminCredentials, decodedAdminToken } from './admin.token';
import { requireAdmin } from './admin.authorization';
import { safeAdmin } from './admin.service';
import { parseAccount } from './admin.helpers';
import { loginSchema, changePasswordSchema } from '../auth/auth.validation';
import { adminProfileSchema } from './admin.validation';

class AdminAuthService {
  async updateProfile(admin: HAdminDocument, input: unknown) {
    requireAdmin(admin);
    const data = parseAccount(adminProfileSchema, input);
    const updated = await AdminModel.findOneAndUpdate({
      _id: admin._id, tokenVersion: admin.tokenVersion,
      deletedAt: null, freezedAt: null
    }, { $set: data }, { returnDocument: 'after', runValidators: true }).exec();
    if (!updated) throw new ConflictException('Account changed. Please login again.');
    return safeAdmin(updated);
  }
  async login(input: unknown) {
    const data = parseAccount(loginSchema.body, input);
    const admin = await adminRepository.findByEmailWithPassword(data.email);
    if (!admin || !await compareHash(data.password, admin.password)) throw new UnauthorizedException('Invalid email or password');
    requireAdmin(admin);
    return { admin: safeAdmin(admin), tokens: await createAdminCredentials(admin) };
  }
  async refresh(authorization: string) {
    const { admin, decoded, isRevoked } = await decodedAdminToken(authorization, TokenTypeEnum.REFRESH, true);
    const reuse = async () => {
      await adminRepository.incrementTokenVersion(admin._id);
      throw new UnauthorizedException('Refresh token reuse detected. Please login again.');
    };
    if (isRevoked) return reuse();
    try { await createRevokeToken(decoded); } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 11000) return reuse();
      throw error;
    }
    return { tokens: await createAdminCredentials(admin) };
  }
  async logout(access: JwtPayload, refresh: string) {
    const { decoded } = await decodedAdminToken(refresh, TokenTypeEnum.REFRESH);
    if (access.identity !== 'admin' || access._id !== decoded._id) throw new UnauthorizedException('Invalid logout credentials');
    await createRevokeTokens([access, decoded]);
  }
  async logoutAll(admin: HAdminDocument) {
    requireAdmin(admin);
    await adminRepository.incrementTokenVersion(admin._id);
  }
  async changePassword(admin: HAdminDocument, input: unknown) {
    requireAdmin(admin);
    const data = parseAccount(changePasswordSchema.body, input);
    const current = await AdminModel.findById(admin._id).select('+password').exec();
    if (!current || !await compareHash(data.currentPassword, current.password)) throw new UnauthorizedException('Current password is incorrect');
    const result = await AdminModel.updateOne({ _id: admin._id, password: current.password, tokenVersion: admin.tokenVersion, deletedAt: null, freezedAt: null },
      { $set: { password: await generateHash(data.newPassword) }, $inc: { tokenVersion: 1 } }).exec();
    if (result.modifiedCount !== 1) throw new ConflictException('Account changed. Please login again.');
  }
}
export const adminAuthService = new AdminAuthService();
