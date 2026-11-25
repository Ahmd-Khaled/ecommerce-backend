import type { QueryFilter } from 'mongoose';
import type { SystemLog } from '../models/system-log/system-log.model';
import { getSystemLogModel } from '../../Utils/logging/system-log.transport';
const projection = { _id: 1, schemaVersion: 1, occurredAt: 1, requestId: 1, service: 1, environment: 1,
  kind: 1, action: 1, level: 1, outcome: 1, actor: 1, error: 1, http: 1 };
export const emptySystemLogStatistics = () => ({ totalRequests: 0, successfulRequests: 0, failedRequests: 0,
  completedRequests: 0, abortedRequests: 0, deniedRequests: 0, slowRequests: 0,
  clientErrorRequests: 0, serverErrorRequests: 0, averageDurationMs: 0, maxDurationMs: 0,
  p50DurationMs: 0, p95DurationMs: 0, p99DurationMs: 0 });
type Statistics = ReturnType<typeof emptySystemLogStatistics>;
export const systemLogRepository = {
  async statistics(filter: QueryFilter<SystemLog>, slowThresholdMs: number): Promise<Statistics> {
    const successful = { $and: [{ $eq: ['$http.completed', true] }, { $eq: ['$outcome', 'success'] }] };
    const count = (condition: object) => ({ $sum: { $cond: [condition, 1, 0] } });
    const statusGroup = (min: number, max: number) => ({ $and: [{ $eq: ['$http.completed', true] },
      { $gte: ['$http.statusCode', min] }, { $lt: ['$http.statusCode', max] }] });
    const rows = await getSystemLogModel().aggregate<Statistics>([
      { $match: filter },
      { $group: { _id: null, totalRequests: { $sum: 1 }, successfulRequests: count(successful),
        failedRequests: count({ $not: [successful] }), completedRequests: count({ $eq: ['$http.completed', true] }),
        abortedRequests: count({ $eq: ['$http.completed', false] }), deniedRequests: count({ $eq: ['$outcome', 'denied'] }),
        slowRequests: count({ $gte: ['$http.durationMs', slowThresholdMs] }),
        clientErrorRequests: count(statusGroup(400, 500)), serverErrorRequests: count(statusGroup(500, 600)),
        averageDurationMs: { $avg: '$http.durationMs' }, maxDurationMs: { $max: '$http.durationMs' },
        // MongoDB 7.0+: bounded approximate t-digest accumulator over the same matched durations.
        durationPercentiles: { $percentile: { input: '$http.durationMs', p: [0.5, 0.95, 0.99], method: 'approximate' } } } },
      { $project: { _id: 0, totalRequests: 1, successfulRequests: 1, failedRequests: 1, completedRequests: 1,
        abortedRequests: 1, deniedRequests: 1, slowRequests: 1, clientErrorRequests: 1, serverErrorRequests: 1,
        averageDurationMs: { $round: ['$averageDurationMs', 2] }, maxDurationMs: 1,
        p50DurationMs: { $round: [{ $ifNull: [{ $arrayElemAt: ['$durationPercentiles', 0] }, 0] }, 2] },
        p95DurationMs: { $round: [{ $ifNull: [{ $arrayElemAt: ['$durationPercentiles', 1] }, 0] }, 2] },
        p99DurationMs: { $round: [{ $ifNull: [{ $arrayElemAt: ['$durationPercentiles', 2] }, 0] }, 2] } } },
    ]).option({ maxTimeMS: 2000, allowDiskUse: false }).exec();
    return rows[0] ?? emptySystemLogStatistics();
  },
  list(filter: QueryFilter<SystemLog>, limit: number) {
    return getSystemLogModel().find(filter, projection).sort({ occurredAt: -1, _id: -1 }).limit(limit + 1).lean().maxTimeMS(2000).exec();
  },
  details(id: string, now: Date) {
    return getSystemLogModel().findOne({ _id: id, expiresAt: { $gt: now } }, projection).lean().maxTimeMS(2000).exec();
  },
};
