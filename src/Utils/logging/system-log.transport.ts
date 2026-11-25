import { createConnection, type Connection, type Model } from 'mongoose';
import { systemLogModel, type SystemLog } from '../../DB/models/system-log/system-log.model';
import { systemLogConfig } from './system-log.config';
import { SystemLogWriter } from './system-log.writer';

let connection: Connection | undefined;
let model: Model<SystemLog> | undefined;
let writer: SystemLogWriter | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let stopping = false;
export const getSystemLogModel = () => {
  if (!model || connection?.readyState !== 1) throw new Error('System Logs unavailable');
  return model;
};
export const enqueueSystemLog = (event: unknown) => { writer?.enqueue(event); };
export const systemLogHealth = () => ({ connected: connection?.readyState === 1, ...writer?.snapshot() });
export const startSystemLogs = () => {
  const config = systemLogConfig();
  if (!config.enabled || connection) return;
  stopping = false;
  const connect = () => {
    if (stopping) return;
    const candidate = createConnection(config.uri, { maxPoolSize: 3, minPoolSize: 0, serverSelectionTimeoutMS: 1000,
      connectTimeoutMS: 1000, socketTimeoutMS: 2000, waitQueueTimeoutMS: 1000, autoIndex: false, bufferCommands: false });
    connection = candidate;
    candidate.on('error', () => {}); // Independent health metrics; never recursively log failures.
    model = systemLogModel(candidate);
    void candidate.asPromise().catch(async () => {
      await candidate.close().catch(() => {});
      if (!stopping) { reconnect = setTimeout(connect, 5000); reconnect.unref(); }
    });
  };
  connect();
  writer = new SystemLogWriter(async records => {
    await getSystemLogModel().bulkWrite(records.map(record => ({ updateOne: {
      filter: { _id: record._id }, update: { $setOnInsert: { ...record, ingestedAt: new Date() } }, upsert: true,
    } })), { ordered: false, maxTimeMS: 1500 });
  }, config.retentionMs);
};
export const closeSystemLogs = async () => {
  stopping = true; if (reconnect) clearTimeout(reconnect);
  await writer?.close(); writer = undefined;
  await connection?.close(); connection = undefined; model = undefined;
};
