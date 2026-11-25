import { Router, type ErrorRequestHandler } from 'express';
import rateLimit, { type Store } from 'express-rate-limit';
import { AdminRoleEnum } from '../../DB/models/admin/admin.interface';
import { adminAuthentication } from '../admin/admin.authorization';
import { systemLogController } from './system-log.controller';
import { logContext } from '../../Utils/logging/context';
import { ApplicationException } from '../../Utils/response/error.response';

export const systemLogErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) { next(error); return; }
  const status = error instanceof ApplicationException && [400, 401, 403, 404, 429, 503].includes(error.statusCode) ? error.statusCode : 503;
  const codes: Record<number, string> = { 400: 'INVALID_SYSTEM_LOG_QUERY', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
    404: 'SYSTEM_LOG_NOT_FOUND', 429: 'RATE_LIMITED', 503: 'SYSTEM_LOGS_UNAVAILABLE' };
  const messages: Record<number, string> = { 400: 'Invalid System Logs request', 401: 'Authentication required',
    403: 'Access denied', 404: 'System log not found', 429: 'Too many requests', 503: 'System Logs temporarily unavailable' };
  const context = logContext.getStore();
  if (context) context.errorCode = codes[status]!;
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ success: false, code: codes[status], message: messages[status] });
};
export const createSystemLogRouter = (options: { ipStore?: Store; adminStore?: Store; ipLimit?: number; adminLimit?: number } = {}) => {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const common = { windowMs: 60000, standardHeaders: 'draft-8' as const, legacyHeaders: false,
    handler: (_req: unknown, _res: unknown, next: (error: Error) => void) => next(new ApplicationException('Rate limited', 429)) };
  router.use(rateLimit({ ...common, limit: options.ipLimit ?? 60, ...(options.ipStore ? { store: options.ipStore } : {}) }));
  router.use(adminAuthentication([AdminRoleEnum.SUPER_ADMIN]));
  router.use(rateLimit({ ...common, limit: options.adminLimit ?? 30, keyGenerator: req => String(req.admin!._id),
    ...(options.adminStore ? { store: options.adminStore } : {}) }));
  router.get('/', systemLogController.list);
  router.get('/statistics', systemLogController.statistics);
  router.get('/:logId', systemLogController.details);
  router.use((_req, _res, next) => next(new ApplicationException('Not found', 404)));
  router.use(systemLogErrors);
  return router;
};
