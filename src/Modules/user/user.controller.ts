import type { RequestHandler } from 'express';
import { userService } from './user.service';
class UserController {
  list: RequestHandler = async (req, res) => { res.json({ success: true, data: await userService.list(req.admin!, req.query) }); };
  details: RequestHandler = async (req, res) => { res.json({ success: true, data: await userService.details(req.admin!, req.params.id) }); };
  create: RequestHandler = async (req, res) => { res.status(201).json({ success: true, data: await userService.create(req.admin!, req.body) }); };
  update: RequestHandler = async (req, res) => { res.json({ success: true, data: await userService.update(req.admin!, req.params.id, req.body) }); };
  remove: RequestHandler = async (req, res) => { await userService.update(req.admin!, req.params.id, {}, true); res.sendStatus(204); };
}
export const userController = new UserController();
