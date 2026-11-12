import type { RequestHandler, Response } from 'express';
import { adminAuthService } from './admin.auth.service';
import { adminService, safeAdmin } from './admin.service';
import { clearAdminCookie, setAdminCookie } from './admin.cookie';

function credentials(res: Response, result: { tokens: { refreshToken: string; accessToken: string; tokenType: string }; admin?: unknown }) {
  const { refreshToken, ...tokens } = result.tokens;
  setAdminCookie(res, refreshToken);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, ...result, tokens });
}
class AdminController {
  updateProfile: RequestHandler = async (req, res) => { res.json({ success: true, admin: await adminAuthService.updateProfile(req.admin!, req.body) }); };
  login: RequestHandler = async (req, res) => { credentials(res, await adminAuthService.login(req.body)); };
  refresh: RequestHandler = async (req, res) => { credentials(res, await adminAuthService.refresh(req.cookies.adminRefreshToken)); };
  logout: RequestHandler = async (req, res) => {
    await adminAuthService.logout(req.decoded!, req.cookies.adminRefreshToken);
    clearAdminCookie(res); res.json({ success: true, message: 'Logged out successfully' });
  };
  logoutAll: RequestHandler = async (req, res) => {
    await adminAuthService.logoutAll(req.admin!); clearAdminCookie(res); res.json({ success: true });
  };
  changePassword: RequestHandler = async (req, res) => {
    await adminAuthService.changePassword(req.admin!, req.body); clearAdminCookie(res); res.json({ success: true, message: 'Password changed. Please login again.' });
  };
  profile: RequestHandler = async (req, res) => { res.json({ success: true, admin: safeAdmin(req.admin!) }); };
  list: RequestHandler = async (req, res) => { res.json({ success: true, data: await adminService.list(req.admin!, req.query) }); };
  details: RequestHandler = async (req, res) => { res.json({ success: true, data: await adminService.details(req.admin!, req.params.id) }); };
  create: RequestHandler = async (req, res) => { res.status(201).json({ success: true, data: await adminService.create(req.admin!, req.body) }); };
  update: RequestHandler = async (req, res) => { res.json({ success: true, data: await adminService.update(req.admin!, req.params.id, req.body) }); };
  remove: RequestHandler = async (req, res) => { await adminService.update(req.admin!, req.params.id, {}, true); res.sendStatus(204); };
}
export const adminController = new AdminController();
