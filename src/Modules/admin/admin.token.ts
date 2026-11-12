import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AdminRoleEnum, type HAdminDocument } from '../../DB/models/admin/admin.interface';
import { adminRepository } from '../../DB/repository/admin.repository';
import { TokenRepository } from '../../DB/repository/token.repository';
import { TokenModel } from '../../DB/models/token/token.model';
import { generateToken, getSignatures, SignatureLevelEnum, TokenTypeEnum, verifyToken } from '../../Utils/security/token';
import { ForbiddenException, UnauthorizedException } from '../../Utils/response/error.response';

export async function createAdminCredentials(admin: HAdminDocument) {
  if (!Object.values(AdminRoleEnum).includes(admin.role) || admin.deletedAt || admin.freezedAt)
    throw new ForbiddenException('Administrator account is unavailable');
  const secrets = await getSignatures(SignatureLevelEnum.ADMIN);
  const issue = async (tokenType: TokenTypeEnum, secret: string, expiration: string | undefined) => {
    const expiresIn = Number(expiration);
    if (!secret || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) throw new Error('Invalid admin JWT configuration');
    return generateToken({ payload: { _id: String(admin._id), identity: 'admin', tokenType, tokenVersion: admin.tokenVersion },
      secret, options: { algorithm: 'HS256', expiresIn, jwtid: randomUUID() } });
  };
  return { accessToken: await issue(TokenTypeEnum.ACCESS, secrets.access_token, process.env.ACCESS_EXPIRES_IN),
    refreshToken: await issue(TokenTypeEnum.REFRESH, secrets.refresh_token, process.env.REFRESH_EXPIRES_IN), tokenType: 'admin' };
}

export async function decodedAdminToken(authorization: string, tokenType = TokenTypeEnum.ACCESS, allowRevoked = false) {
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme !== 'admin' || !token || extra) throw new UnauthorizedException('Invalid administrator authorization');
  const secrets = await getSignatures(SignatureLevelEnum.ADMIN);
  let decoded;
  try {
    decoded = await verifyToken({ token, secret: tokenType === TokenTypeEnum.ACCESS ? secrets.access_token : secrets.refresh_token });
  } catch { throw new UnauthorizedException('Invalid administrator credentials'); }
  if (decoded.identity !== 'admin' || decoded.tokenType !== tokenType || typeof decoded._id !== 'string' ||
      !Types.ObjectId.isValid(decoded._id) || typeof decoded.jti !== 'string' || !decoded.jti ||
      typeof decoded.exp !== 'number' || typeof decoded.iat !== 'number' ||
      !Number.isSafeInteger(decoded.tokenVersion) || decoded.tokenVersion < 0)
    throw new UnauthorizedException('Invalid administrator token');
  const admin = await adminRepository.findOne({ filter: { _id: decoded._id } });
  if (!admin || admin.deletedAt || !Object.values(AdminRoleEnum).includes(admin.role) || admin.tokenVersion !== decoded.tokenVersion)
    throw new UnauthorizedException('Administrator session expired');
  if (admin.freezedAt) throw new ForbiddenException('Administrator account is frozen');
  const revoked = await new TokenRepository(TokenModel).findOne({ filter: { jti: decoded.jti } });
  if (revoked && !allowRevoked) throw new UnauthorizedException('Administrator session expired');
  return { admin, decoded, isRevoked: Boolean(revoked) };
}
