import { decode } from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
export const adminCookieOptions = (): CookieOptions => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax', path: '/api/v1/admin/auth' });
export function setAdminCookie(res: Response, token: string) {
  const payload = decode(token);
  if (!payload || typeof payload === 'string' || !payload.exp) throw new Error('Invalid issued admin token');
  res.cookie('adminRefreshToken', `admin ${token}`, { ...adminCookieOptions(), expires: new Date(payload.exp * 1000) });
}
export function clearAdminCookie(res: Response) { res.clearCookie('adminRefreshToken', adminCookieOptions()); }
