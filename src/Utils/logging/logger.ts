import { randomUUID } from 'node:crypto';
import { logContext, type LogContext } from './context';
import { enqueueSystemLog } from './system-log.transport';

type Level = 'info' | 'warn' | 'error';
export interface LogInput {
  kind: 'request' | 'operational';
  action: 'http.request' | 'http.error' | 'application.started' | 'application.start_failed' | 'application.stop_failed';
  level: Level;
  outcome: 'success' | 'failure' | 'denied' | 'aborted';
  http?: { method: string; route: string; statusCode: number; durationMs: number; completed: boolean };
}
export interface Logger { write(input: LogInput, context?: LogContext): void }

// No arbitrary messages, errors, metadata, bodies, URLs, headers or payloads enter the sink.
const actions = new Set(['http.request', 'http.error', 'application.started', 'application.start_failed', 'application.stop_failed']);
const label = (value: string | undefined, fallback: string): string =>
  value && /^[a-zA-Z0-9_.-]{1,64}$/.test(value) ? value : fallback;
const limit = (): number => {
  const value = Number(process.env.LOG_MAX_EVENT_BYTES ?? 8192);
  return Number.isInteger(value) && value >= 2048 && value <= 65536 ? value : 8192;
};

/** Bounded fail-open sink. Backpressure drops diagnostics instead of queuing without limit. */
export const createLogger = (sink: { write(line: string): boolean; writableLength?: number }, persist?: (event: unknown) => void,
  outputEnabled: () => boolean = () => true): Logger & { dropped: number } => ({
  dropped: 0,
  write(input, context = logContext.getStore()) {
    try {
      if (!actions.has(input.action)) { this.dropped++; return; }
      const actor = context?.actor;
      const verified = actor && 'id' in actor && /^[a-f\d]{24}$/i.test(actor.id);
      const event = {
        schemaVersion: 1, eventId: randomUUID(), occurredAt: new Date().toISOString(),
        kind: input.kind === 'request' ? 'request' : 'operational',
        level: ['info', 'warn', 'error'].includes(input.level) ? input.level : 'error',
        service: label(process.env.LOG_SERVICE_NAME, 'ecommerce-backend'),
        environment: label(process.env.NODE_ENV ?? process.env.MODE, 'unknown'),
        action: input.action,
        outcome: ['success', 'failure', 'denied', 'aborted'].includes(input.outcome) ? input.outcome : 'failure',
        requestId: context?.requestId,
        actor: verified ? { type: actor.type, id: actor.id, identityModel: actor.identityModel,
          role: ['user', 'guest', 'admin', 'super-admin'].includes(actor.role) ? actor.role : 'unknown' }
          : { type: actor?.type === 'system' ? 'system' : 'anonymous' },
        error: context?.errorCode ? { code: label(context.errorCode, 'INTERNAL_ERROR') } : undefined,
        http: input.http ? {
          method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(input.http.method) ? input.http.method : 'OTHER',
          route: input.http.route.slice(0, 256), statusCode: input.http.statusCode,
          durationMs: Math.round(input.http.durationMs), completed: input.http.completed,
        } : undefined,
      };
      const line = JSON.stringify(event) + '\n';
      if (Buffer.byteLength(line) > limit()) { this.dropped++; return; }
      if (input.kind === 'request' && input.action === 'http.request') {
        try { persist?.(event); } catch { /* Persistence must not affect stdout or HTTP. */ }
      }
      if (!outputEnabled()) return;
      if ((sink.writableLength ?? 0) >= 65536) { this.dropped++; return; }
      sink.write(line);
    } catch { this.dropped++; }
  },
});

// Handle asynchronous pipe failures as well as synchronous write exceptions.
process.stdout.on('error', () => { logger.dropped++; });
// Read at write time because dotenv loads after this module is imported.
export const logger = createLogger(process.stdout, enqueueSystemLog, () => process.env.LOG_STDOUT_ENABLED !== 'false');
