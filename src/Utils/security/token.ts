
import {
  JwtPayload,
  Secret,
  sign,
  SignOptions,
  verify,
} from "jsonwebtoken";

import { Types } from "mongoose";
import { v4 as uuid } from "uuid";

import {
  HUserDocument,
  RoleEnum,
} from "../../DB/models/user/user.interface";

import { TokenModel } from "../../DB/models/token/token.model";
import { TokenRepository } from "../../DB/repository/token.repository";
import { userRepository } from "../../DB/repository/user.repository";

import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "../response/error.response";

// ============================================================================
// 1. Enums
// ============================================================================

export enum SignatureLevelEnum {
  USER = "user",
  ADMIN = "admin",
}

export enum TokenTypeEnum {
  ACCESS = "access",
  REFRESH = "refresh",
}

export enum LogoutEnum {
  ONLY = "only",
  ALL = "all",
}

// ============================================================================
// 2. Generate JWT
// ============================================================================

export const generateToken = async ({
  payload,
  secret,
  options,
}: {
  payload: object;
  secret: Secret;
  options?: SignOptions;
}): Promise<string> => {
  return sign(payload, secret, options);
};

// ============================================================================
// 3. Verify JWT
// ============================================================================

export const verifyToken = async ({
  token,
  secret,
}: {
  token: string;
  secret: Secret;
}): Promise<JwtPayload> => {
  const decoded = await verify(token, secret);

  if (typeof decoded === "string" || !decoded) {
    throw new UnauthorizedException("Invalid Token Payload");
  }

  return decoded;
};

// ============================================================================
// 4. Get Signature Level Based on User Role
// ============================================================================

export const getSignatureLevel = (
  role: RoleEnum = RoleEnum.USER
): SignatureLevelEnum => {
  switch (role) {
    case RoleEnum.USER:
      return SignatureLevelEnum.USER;

    case RoleEnum.ADMIN:
      return SignatureLevelEnum.ADMIN;

    default:
      throw new ForbiddenException(
        "This account is not allowed to generate login credentials"
      );
  }
};

// ============================================================================
// 5. Get JWT Secrets
// ============================================================================

export const getSignatures = async (
  signatureLevel: SignatureLevelEnum = SignatureLevelEnum.USER
): Promise<{
  access_token: string;
  refresh_token: string;
}> => {
  let access_token = "";
  let refresh_token = "";

  switch (signatureLevel) {
    case SignatureLevelEnum.USER:
      access_token = process.env.ACCESS_USER_TOKEN_SECRET ?? "";
      refresh_token = process.env.REFRESH_USER_TOKEN_SECRET ?? "";
      break;

    case SignatureLevelEnum.ADMIN:
      access_token = process.env.ACCESS_ADMIN_TOKEN_SECRET ?? "";
      refresh_token = process.env.REFRESH_ADMIN_TOKEN_SECRET ?? "";
      break;
  }

  return {
    access_token,
    refresh_token,
  };
};

// ============================================================================
// 6. Validate JWT Configuration
// ============================================================================

const getTokenExpiration = (
  value: string | undefined,
  envName: string
): number => {
  const expiration = Number(value);

  if (
    !value ||
    !Number.isSafeInteger(expiration) ||
    expiration <= 0
  ) {
    throw new Error(
      `Invalid JWT expiration configuration: ${envName}`
    );
  }

  return expiration;
};

// ============================================================================
// 7. Create Login Credentials
// ============================================================================

export const createLoginCredentials = async (
  user: HUserDocument
): Promise<{
  accessToken: string;
  refreshToken: string;
  signatureLevel: SignatureLevelEnum;
}> => {
  const signatureLevel = getSignatureLevel(user.role);

  const signatures = await getSignatures(signatureLevel);

  if (!signatures.access_token || !signatures.refresh_token) {
    throw new Error("JWT signing secrets are not configured");
  }

  const accessExpiresIn = getTokenExpiration(
    process.env.ACCESS_EXPIRES_IN,
    "ACCESS_EXPIRES_IN"
  );

  const refreshExpiresIn = getTokenExpiration(
    process.env.REFRESH_EXPIRES_IN,
    "REFRESH_EXPIRES_IN"
  );

  // Each token has its own unique identifier.
  const accessJti = uuid();
  const refreshJti = uuid();

  // Both tokens share the current account token version.
  const tokenVersion = user.tokenVersion ?? 0;

  const accessToken = await generateToken({
    payload: {
      _id: user._id.toString(),
      tokenVersion,
    },
    secret: signatures.access_token,
    options: {
      expiresIn: accessExpiresIn,
      jwtid: accessJti,
    },
  });

  const refreshToken = await generateToken({
    payload: {
      _id: user._id.toString(),
      tokenVersion,
    },
    secret: signatures.refresh_token,
    options: {
      expiresIn: refreshExpiresIn,
      jwtid: refreshJti,
    },
  });

  return {
    accessToken,
    refreshToken,
    signatureLevel,
  };
};

// ============================================================================
// 8. Decode & Validate Token
// ============================================================================

export const decodedToken = async ({
  authorization,
  tokenType = TokenTypeEnum.ACCESS,
  allowRevoked = false,
}: {
  authorization: string;
  tokenType?: TokenTypeEnum;
  allowRevoked?: boolean;
}) => {
  const tokenModel = new TokenRepository(TokenModel);

  // --------------------------------------------------------------------------
  // 1. Validate Authorization Header
  // Expected format: user <token> OR admin <token>
  // --------------------------------------------------------------------------

  const parts = authorization.trim().split(/\s+/);

  if (parts.length !== 2) {
    throw new UnauthorizedException("Invalid Authorization Header");
  }

  const [signatureLevel, token] = parts;

  if (
    !token ||
    !Object.values(SignatureLevelEnum).includes(
      signatureLevel as SignatureLevelEnum
    )
  ) {
    throw new UnauthorizedException("Invalid Authorization Scheme");
  }

  // --------------------------------------------------------------------------
  // 2. Get Correct Secret
  // --------------------------------------------------------------------------

  const signatures = await getSignatures(
    signatureLevel as SignatureLevelEnum
  );

  const secret =
    tokenType === TokenTypeEnum.REFRESH
      ? signatures.refresh_token
      : signatures.access_token;

  if (!secret) {
    throw new UnauthorizedException("Invalid Token Configuration");
  }

  // --------------------------------------------------------------------------
  // 3. Verify JWT Signature & Expiration
  // --------------------------------------------------------------------------

  const decoded = await verifyToken({
    token,
    secret,
  });

  // --------------------------------------------------------------------------
  // 4. Validate Required JWT Claims
  // --------------------------------------------------------------------------

  if (
    typeof decoded._id !== "string" ||
    typeof decoded.jti !== "string" ||
    typeof decoded.iat !== "number" ||
    typeof decoded.exp !== "number" ||
    typeof decoded.tokenVersion !== "number" ||
    !Number.isSafeInteger(decoded.tokenVersion) ||
    decoded.tokenVersion < 0
  ) {
    throw new UnauthorizedException("Invalid Token Payload");
  }

  // --------------------------------------------------------------------------
  // 5. Find User
  // --------------------------------------------------------------------------

  const user = await userRepository.findOne({
    filter: {
      _id: decoded._id,
    },
  });

  if (!user) {
    throw new UnauthorizedException(
      "Invalid or old login credentials"
    );
  }

  // --------------------------------------------------------------------------
  // 6. Check Token Version
  // --------------------------------------------------------------------------

  if (decoded.tokenVersion !== user.tokenVersion) {
    throw new UnauthorizedException(
      "Your session has expired. Please login again."
    );
  }

  // --------------------------------------------------------------------------
  // 7. Check Credential Change Timestamp
  // --------------------------------------------------------------------------

  if (
    (user.changeCredentialsTime?.getTime() ?? 0) >
    decoded.iat * 1000
  ) {
    throw new UnauthorizedException(
      "Invalid or old login credentials, you need to login again"
    );
  }

  // --------------------------------------------------------------------------
  // 8. Check Revoked Token
  // --------------------------------------------------------------------------

  const tokenCheck = await tokenModel.findOne({
    filter: {
      jti: decoded.jti,
    },
  });

  const isRevoked = Boolean(tokenCheck);

  if (isRevoked && !allowRevoked) {
    throw new UnauthorizedException(
      "Invalid or old login credentials"
    );
  }

  // --------------------------------------------------------------------------
  // 9. Return Validation Result
  // --------------------------------------------------------------------------

  return {
    user,
    decoded,
    isRevoked,
  };
};

// ============================================================================
// 9. Revoke Multiple Tokens
// ============================================================================

export const createRevokeTokens = async (
  decodedTokens: JwtPayload[]
) => {
  if (!decodedTokens.length) {
    throw new BadRequestException(
      "No tokens provided for revocation"
    );
  }

  // --------------------------------------------------------------------------
  // Validate & Prepare Token Records
  // --------------------------------------------------------------------------

  const records = decodedTokens.map((decoded) => {
    if (
      typeof decoded.jti !== "string" ||
      typeof decoded.exp !== "number" ||
      typeof decoded._id !== "string" ||
      !Types.ObjectId.isValid(decoded._id)
    ) {
      throw new BadRequestException("Invalid token payload");
    }

    const expiresAt = new Date(decoded.exp * 1000);

    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException("Invalid token expiration");
    }

    return {
      jti: decoded.jti,
      expiresAt,
      userId: new Types.ObjectId(decoded._id),
    };
  });

  // --------------------------------------------------------------------------
  // Prevent Duplicate Token IDs
  // --------------------------------------------------------------------------

  const uniqueRecords = [
    ...new Map(
      records.map((record) => [record.jti, record])
    ).values(),
  ];

  // --------------------------------------------------------------------------
  // Save Revoked Tokens
  // --------------------------------------------------------------------------

  const tokenModel = new TokenRepository(TokenModel);

  const results = await tokenModel.create({
    data: uniqueRecords,
  });

  if (!results || results.length !== uniqueRecords.length) {
    throw new BadRequestException("Failed to revoke tokens");
  }

  return results;
};

// ============================================================================
// 10. Revoke Single Token
// ============================================================================

export const createRevokeToken = async (
  decoded: JwtPayload
) => {
  const [result] = await createRevokeTokens([decoded]);

  return result;
};
