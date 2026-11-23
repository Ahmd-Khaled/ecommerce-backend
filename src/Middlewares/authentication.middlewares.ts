import type { Request, Response, NextFunction } from 'express';
import { setVerifiedActor } from '../Utils/logging/context';

import { type HUserDocument, RoleEnum } from '../DB/models/user/user.interface';

import { decodedToken, TokenTypeEnum } from '../Utils/security/token';

import { ForbiddenException, UnauthorizedException } from '../Utils/response/error.response';

export const authentication = (
  tokenType: TokenTypeEnum = TokenTypeEnum.ACCESS,
  accessRoles: RoleEnum[] = [],
) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authorization = req.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException('Missing Authorization Header');
    }

    const { user, decoded } = await decodedToken({
      authorization,
      tokenType,
    });

    setVerifiedActor({ type: 'user', id: String(user._id), identityModel: 'User', role: user.role });
    // Apply role restrictions only when roles are provided.
    if (!Object.values(RoleEnum).includes(user.role) || (accessRoles.length > 0 && !accessRoles.includes(user.role))) {
      throw new ForbiddenException('Unauthorized Access');
    }

    req.user = user as HUserDocument;
    req.decoded = decoded;

    next();
  };
};
