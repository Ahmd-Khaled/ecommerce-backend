import Redis from 'ioredis';
import type { Store, Options } from 'express-rate-limit';

// Dedicated Redis is optional for single-process development, required in production.
let redis: Redis | undefined;
class LogRateStore implements Store {
  localKeys = false;
  private windowMs = 60000;
  constructor(readonly prefix: string, private client: Redis) {}
  init(options: Options) { this.windowMs = options.windowMs; }
  async increment(key: string) {
    const result = await this.client.eval(`
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      return {count, redis.call('PTTL', KEYS[1])}
    `, 1, this.prefix + key, this.windowMs) as [number, number];
    return { totalHits: result[0], resetTime: new Date(Date.now() + result[1]) };
  }
  async decrement(key: string) { await this.client.decr(this.prefix + key); }
  async resetKey(key: string) { await this.client.del(this.prefix + key); }
}
export const systemLogRateStores = () => {
  const url = process.env.SYSTEM_LOGS_REDIS_URL;
  if (!url) {
    if (process.env.SYSTEM_LOGS_ENABLED === 'true' && process.env.NODE_ENV === 'production')
      throw new Error('SYSTEM_LOGS_REDIS_URL is required in production');
    return {};
  }
  redis ??= new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1000, commandTimeout: 1500 });
  redis.on('error', () => {});
  return { ipStore: new LogRateStore('system-logs:ip:', redis), adminStore: new LogRateStore('system-logs:admin:', redis) };
};
export const closeSystemLogRateStores = () => { redis?.disconnect(); redis = undefined; };
