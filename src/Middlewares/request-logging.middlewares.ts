import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import { logContext, type LogContext } from '../Utils/logging/context';
import { logger, type Logger } from '../Utils/logging/logger';

export const createRequestLogging = (output: Logger = logger): RequestHandler => (req, res, next) => {
  const context: LogContext = { requestId: randomUUID(), actor: { type: 'anonymous' } };
  const started = performance.now();
  let emitted = false;
  res.setHeader('X-Request-Id', context.requestId);
  const complete = (completed: boolean): void => {
    if (emitted) return;
    emitted = true;
    const statusCode = res.statusCode;
    // Express route.path is a developer-defined template; never use originalUrl or baseUrl.
    const route = typeof req.route?.path === 'string' ? req.route.path : '<unmatched>';
    try {
      output.write({ kind: 'request', action: 'http.request',
        level: !completed || statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info',
        outcome: !completed ? 'aborted' : [401, 403, 429].includes(statusCode) ? 'denied' : statusCode >= 400 ? 'failure' : 'success',
        http: { method: req.method, route, statusCode, durationMs: performance.now() - started, completed },
      }, context);
    } catch { /* A custom diagnostic sink must not alter response handling. */ }
  };
  res.once('finish', () => complete(true));
  res.once('close', () => complete(res.writableFinished));
  logContext.run(context, next);
};

export const requestLogging = createRequestLogging();
