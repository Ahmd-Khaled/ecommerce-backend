import type { RequestHandler } from 'express';
import { systemLogService } from './system-log.service';

class SystemLogController {
  statistics: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await systemLogService.statistics(req.admin, req.query) });
  };
  list: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await systemLogService.list(req.admin, req.query) });
  };
  details: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await systemLogService.details(req.admin, req.params.logId) });
  };
}
export const systemLogController = new SystemLogController();
