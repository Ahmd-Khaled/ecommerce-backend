import * as z from 'zod';
const integer = (max: number) => z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(max));
export const systemLogQuerySchema = z.strictObject({
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  requestId: z.uuid().optional(), method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER']).optional(),
  statusCode: integer(599).pipe(z.number().min(100)).optional(), statusGroup: z.enum(['1xx', '2xx', '3xx', '4xx', '5xx']).optional(),
  route: z.string().min(1).max(256).optional(), outcome: z.enum(['success', 'failure', 'denied', 'aborted']).optional(),
  minDurationMs: integer(2147483647).optional(), limit: integer(100).pipe(z.number().min(1)).default(25),
  after: z.string().max(4096).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).optional(),
}).refine(value => !(value.statusCode && value.statusGroup));
export type SystemLogQuery = z.infer<typeof systemLogQuerySchema>;
export const systemLogIdSchema = z.strictObject({ logId: z.uuid() });

export const systemLogStatisticsSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER']).optional(),
  route: z.string().min(1).max(256).optional(),
  slowThresholdMs: integer(2147483647).pipe(z.number().min(1)).default(1000),
});
