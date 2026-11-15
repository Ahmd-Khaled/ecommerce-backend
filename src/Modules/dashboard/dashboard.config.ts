export function lowStockThreshold(): number {
  const raw = process.env.LOW_STOCK_THRESHOLD ?? '5';
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 0)
    throw new Error('LOW_STOCK_THRESHOLD must be a nonnegative safe integer');
  return value;
}
