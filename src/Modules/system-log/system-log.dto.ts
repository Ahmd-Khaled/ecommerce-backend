import type { SystemLog } from '../../DB/models/system-log/system-log.model';
// Explicit nested projection: even historical records cannot add response fields.
export const systemLogDto = (row: Omit<SystemLog, 'ingestedAt' | 'expiresAt'>) => ({
  logId: row._id, schemaVersion: row.schemaVersion, occurredAt: row.occurredAt.toISOString(),
  requestId: row.requestId, service: row.service, environment: row.environment,
  kind: row.kind, action: row.action, level: row.level, outcome: row.outcome,
  actor: 'id' in row.actor ? { type: row.actor.type, id: row.actor.id, identityModel: row.actor.identityModel, role: row.actor.role }
    : { type: row.actor.type },
  ...(row.error ? { error: { code: row.error.code } } : {}),
  http: { method: row.http.method, route: row.http.route, statusCode: row.http.statusCode,
    durationMs: row.http.durationMs, completed: row.http.completed },
});
