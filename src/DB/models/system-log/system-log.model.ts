import { Schema, type Connection } from 'mongoose';
import * as z from 'zod';

const label = z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/);
const actor = z.discriminatedUnion('type', [
  z.object({ type: z.literal('anonymous') }), z.object({ type: z.literal('system') }),
  ...(['user', 'admin'] as const).map(type => z.object({ type: z.literal(type),
    id: z.string().regex(/^[a-f\d]{24}$/i), identityModel: z.enum(['User', 'Admin']),
    role: z.enum(['user', 'guest', 'admin', 'super-admin', 'unknown']) })),
]);
// A second allowlist at ingestion also protects against future logger additions.
export const terminalEventSchema = z.object({
  schemaVersion: z.literal(1), eventId: z.uuid(), occurredAt: z.iso.datetime(),
  kind: z.literal('request'), action: z.literal('http.request'), requestId: z.uuid(),
  service: label, environment: label, level: z.enum(['info', 'warn', 'error']),
  outcome: z.enum(['success', 'failure', 'denied', 'aborted']), actor,
  error: z.object({ code: label }).optional(),
  http: z.object({ method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER']),
    route: z.string().max(256), statusCode: z.number().int().min(100).max(599),
    durationMs: z.number().int().nonnegative(), completed: z.boolean() }),
});
export type SystemLog = Omit<z.infer<typeof terminalEventSchema>, 'eventId' | 'occurredAt'> & {
  _id: string; occurredAt: Date; ingestedAt: Date; expiresAt: Date;
};
const nested = { _id: false, strict: 'throw' as const };
export const SystemLogSchema = new Schema<SystemLog>({
  _id: { type: String, required: true }, schemaVersion: { type: Number, required: true, enum: [1] },
  occurredAt: { type: Date, required: true }, ingestedAt: { type: Date, required: true }, expiresAt: { type: Date, required: true },
  kind: { type: String, required: true, enum: ['request'] }, action: { type: String, required: true, enum: ['http.request'] },
  requestId: { type: String, required: true }, service: { type: String, required: true, maxlength: 64 },
  environment: { type: String, required: true, maxlength: 64 }, level: { type: String, required: true, enum: ['info', 'warn', 'error'] },
  outcome: { type: String, required: true, enum: ['success', 'failure', 'denied', 'aborted'] },
  actor: { type: new Schema({ type: { type: String, required: true, enum: ['anonymous', 'system', 'user', 'admin'] },
    id: String, identityModel: { type: String, enum: ['User', 'Admin'] },
    role: { type: String, enum: ['user', 'guest', 'admin', 'super-admin', 'unknown'] } }, nested), required: true },
  error: { type: new Schema({ code: { type: String, maxlength: 64 } }, nested) },
  http: { type: new Schema({ method: { type: String, required: true }, route: { type: String, required: true, maxlength: 256 },
    statusCode: { type: Number, required: true, min: 100, max: 599 },
    durationMs: { type: Number, required: true, min: 0 }, completed: { type: Boolean, required: true } }, nested), required: true },
}, { strict: 'throw', versionKey: false, bufferCommands: false, autoIndex: false });
SystemLogSchema.index({ occurredAt: -1, _id: -1 });
SystemLogSchema.index({ requestId: 1, occurredAt: -1, _id: -1 });
SystemLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const systemLogModel = (connection: Connection) => connection.model<SystemLog>('SystemLog', SystemLogSchema, 'system_logs');
