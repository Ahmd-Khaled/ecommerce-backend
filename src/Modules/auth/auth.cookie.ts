import type { CookieOptions, Response } from "express";
import { decode } from "jsonwebtoken";

export const refreshTokenCookieName = "refreshToken";

export const refreshTokenCookieOptions = (): CookieOptions => ({
  httpOnly: true,

  secure: process.env.NODE_ENV === "production",

  sameSite: "lax",

  path: "/api/v1/auth",

});

export const setRefreshTokenCookie = (res: Response, token: string, scheme: string): void => {
  // Decode only our newly issued JWT to align cookie expiry with token expiry.
  // Incoming cookies are always verified by the existing token service.
  const payload = decode(token);
  if (!payload || typeof payload === "string" || typeof payload.exp !== "number") {
    throw new Error("Issued refresh token has no expiration");
  }
  res.cookie(refreshTokenCookieName, `${scheme} ${token}`, {
    ...refreshTokenCookieOptions(),
    expires: new Date(payload.exp * 1000),
  });
};

export const clearRefreshTokenCookie = (res: Response): void => {
  res.clearCookie(refreshTokenCookieName, refreshTokenCookieOptions());
};
