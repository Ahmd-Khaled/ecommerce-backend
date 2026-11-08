import path from 'node:path';

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}
export function storageConfig() {
  const base = new URL(
    process.env.STORAGE_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}/media`,
  );
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/media'
  ) {
    throw new Error('STORAGE_PUBLIC_URL must be an HTTP(S) URL ending in /media');
  }
  return {
    root: path.resolve(process.env.STORAGE_ROOT ?? 'storage'),
    publicUrl: base.href.replace(/\/$/, ''),
    maxPixels: integer('UPLOAD_MAX_PIXELS', 20000000, 1, 40000000),
    maxDimension: integer('UPLOAD_MAX_DIMENSION', 8192, 1, 16384),
    concurrency: integer('UPLOAD_CONCURRENCY', 4, 1, 16),
    timeoutMs: integer('UPLOAD_TIMEOUT_MS', 60000, 1000, 120000),
    retentionMs: integer('UPLOAD_RETENTION_HOURS', 24, 1, 720) * 3600000,
  };
}
