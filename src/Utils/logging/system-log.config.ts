export const systemLogConfig = () => {
  const enabled = process.env.SYSTEM_LOGS_ENABLED === 'true';
  const retentionDays = Number(process.env.SYSTEM_LOGS_RETENTION_DAYS ?? 14);
  const secret = process.env.SYSTEM_LOGS_CURSOR_SECRET ?? '';
  const uri = process.env.SYSTEM_LOGS_MONGO_URI ?? '';
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90)
    throw new Error('Invalid SYSTEM_LOGS_RETENTION_DAYS');
  if (enabled && (!uri || Buffer.byteLength(secret) < 32))
    throw new Error('System Logs require a MongoDB URI and a cursor secret of at least 32 bytes');
  return { enabled, retentionMs: retentionDays * 86400000, secret, uri };
};
