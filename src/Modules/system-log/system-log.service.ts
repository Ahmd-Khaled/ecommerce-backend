import { createHash } from 'node:crypto';
import type { QueryFilter } from 'mongoose';
import type { HAdminDocument } from '../../DB/models/admin/admin.interface';
import type { SystemLog } from '../../DB/models/system-log/system-log.model';
import { systemLogRepository } from '../../DB/repository/system-log.repository';
import { systemLogConfig } from '../../Utils/logging/system-log.config';
import { ApplicationException, BadRequestException, NotFoundException } from '../../Utils/response/error.response';
import { requireAdmin } from '../admin/admin.authorization';
import { readCursor, signCursor } from './system-log.cursor';
import { systemLogDto } from './system-log.dto';
import { systemLogQuerySchema, systemLogIdSchema, systemLogStatisticsSchema } from './system-log.validation';

const unavailable = () => new ApplicationException('System Logs unavailable', 503);
export const systemLogService = {
  async statistics(admin: HAdminDocument | undefined, raw: unknown) {
    requireAdmin(admin, true);
    const parsed = systemLogStatisticsSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid statistics filters');
    const query = parsed.data;
    const config = systemLogConfig();
    if (!config.enabled) throw unavailable();
    const now = new Date();
    const to = new Date(query.to ?? now);
    const from = new Date(query.from ?? (to.getTime() - Math.min(86400000, config.retentionMs)));
    if (from >= to || to > now || to.getTime() - from.getTime() > config.retentionMs)
      throw new BadRequestException('Invalid date range');
    const filter: QueryFilter<SystemLog> = { occurredAt: { $gte: from, $lt: to }, expiresAt: { $gt: now }, ingestedAt: { $lte: now } };
    if (query.method) filter['http.method'] = query.method;
    if (query.route) filter['http.route'] = query.route;
    try {
      const metrics = await systemLogRepository.statistics(filter, query.slowThresholdMs);
      return { from: from.toISOString(), to: to.toISOString(), slowThresholdMs: query.slowThresholdMs, ...metrics };
    } catch { throw unavailable(); }
  },
  async list(admin: HAdminDocument | undefined, raw: unknown) {
    requireAdmin(admin, true);
    const parsed = systemLogQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid filters');
    const query = parsed.data;
    const config = systemLogConfig();
    if (!config.enabled) throw unavailable();
    const now = Date.now();
    const cursor = query.after ? readCursor(query.after, config.secret, now) : undefined;
    const to = new Date(query.to ?? cursor?.to ?? now);
    const from = new Date(query.from ?? cursor?.from ?? (to.getTime() - Math.min(86400000, config.retentionMs)));
    if (from >= to || to.getTime() > now || to.getTime() - from.getTime() > config.retentionMs)
      throw new BadRequestException('Invalid date range');
    const filters = { from: from.toISOString(), to: to.toISOString(), requestId: query.requestId, method: query.method,
      statusCode: query.statusCode, statusGroup: query.statusGroup, route: query.route, outcome: query.outcome,
      minDurationMs: query.minDurationMs, limit: query.limit };
    const fingerprint = createHash('sha256').update(JSON.stringify(filters)).digest('hex');
    if (cursor && fingerprint !== cursor.fingerprint) throw new BadRequestException('Cursor filters changed');
    const cutoff = cursor?.cutoff ?? new Date(now).toISOString();
    const filter: QueryFilter<SystemLog> = { occurredAt: { $gte: from, $lt: to }, expiresAt: { $gt: new Date(now) },
      ingestedAt: { $lte: new Date(cutoff) } };
    if (query.requestId) filter.requestId = query.requestId;
    if (query.method) filter['http.method'] = query.method;
    if (query.route) filter['http.route'] = query.route;
    if (query.outcome) filter.outcome = query.outcome;
    if (query.statusCode) filter['http.statusCode'] = query.statusCode;
    if (query.statusGroup) { const lower = Number(query.statusGroup[0]) * 100; filter['http.statusCode'] = { $gte: lower, $lt: lower + 100 }; }
    if (query.minDurationMs !== undefined) filter['http.durationMs'] = { $gte: query.minDurationMs };
    if (cursor) filter.$or = [{ occurredAt: { $lt: new Date(cursor.date) } }, { occurredAt: new Date(cursor.date), _id: { $lt: cursor.id } }];
    let rows;
    try { rows = await systemLogRepository.list(filter, query.limit); } catch { throw unavailable(); }
    const hasNextPage = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map(systemLogDto);
    const last = items.at(-1);
    return { items, pageInfo: { hasNextPage, nextCursor: hasNextPage && last ? signCursor({ v: 1,
      from: from.toISOString(), to: to.toISOString(), cutoff, fingerprint, expires: cursor?.expires ?? now + 900000,
      date: last.occurredAt, id: last.logId }, config.secret) : null } };
  },
  async details(admin: HAdminDocument | undefined, raw: unknown) {
    requireAdmin(admin, true);
    const parsed = systemLogIdSchema.safeParse({ logId: raw });
    if (!parsed.success) throw new BadRequestException('Invalid log ID');
    if (!systemLogConfig().enabled) throw unavailable();
    let row;
    try { row = await systemLogRepository.details(parsed.data.logId, new Date()); } catch { throw unavailable(); }
    if (!row) throw new NotFoundException('Log not found');
    return systemLogDto(row);
  },
};
