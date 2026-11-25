import { terminalEventSchema, type SystemLog } from '../../DB/models/system-log/system-log.model';

export class SystemLogWriter {
  readonly metrics = { accepted: 0, persisted: 0, dropped: 0, failures: 0 };
  private pending: Array<{ record: SystemLog; bytes: number; attempts: number }> = [];
  private bytes = 0;
  private active: Promise<void> | undefined;
  private stopped = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(private writeBatch: (records: SystemLog[]) => Promise<void>, private retentionMs: number,
    private maxCount = 2000, private maxBytes = 8 * 1024 * 1024) {
    this.timer = setInterval(() => { void this.flush(); }, 1000);
    this.timer.unref();
  }
  enqueue(event: unknown): void {
    if (this.stopped) return;
    const parsed = terminalEventSchema.safeParse(event);
    if (!parsed.success) { this.metrics.dropped++; return; }
    const { eventId, occurredAt, ...safe } = parsed.data;
    const date = new Date(occurredAt);
    const expiresAt = new Date(date.getTime() + this.retentionMs);
    const bytes = Buffer.byteLength(JSON.stringify(parsed.data));
    if (expiresAt.getTime() <= Date.now() || this.pending.length >= this.maxCount || this.bytes + bytes > this.maxBytes) {
      this.metrics.dropped++; return;
    }
    this.pending.push({ record: { ...safe, _id: eventId, occurredAt: date, expiresAt, ingestedAt: new Date() }, bytes, attempts: 0 });
    this.bytes += bytes; this.metrics.accepted++;
  }
  snapshot() {
    return { ...this.metrics, pending: this.pending.length, pendingBytes: this.bytes,
      oldestPendingMs: this.pending[0] ? Date.now() - this.pending[0].record.ingestedAt.getTime() : 0 };
  }
  flush(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.runBatch().finally(() => { this.active = undefined; });
    return this.active;
  }
  private async runBatch() {
    const batch = this.pending.slice(0, 100);
    if (!batch.length) return;
    const live = batch.filter(item => item.record.expiresAt.getTime() > Date.now());
    let success = false;
    try {
      if (live.length) await this.writeBatch(live.map(item => item.record));
      success = true; this.metrics.persisted += live.length;
    } catch { this.metrics.failures++; }
    // Keep in-flight items in the bounded queue; retries happen on later ticks.
    for (const item of batch) {
      const expired = item.record.expiresAt.getTime() <= Date.now();
      if (success || expired || ++item.attempts >= 3) {
        const index = this.pending.indexOf(item);
        if (index >= 0) { this.pending.splice(index, 1); this.bytes -= item.bytes; }
        if (!success || expired) this.metrics.dropped++;
      }
    }
  }
  async close(deadlineMs = 5000) {
    this.stopped = true; clearInterval(this.timer);
    const deadline = Date.now() + deadlineMs;
    while (this.pending.length && Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.flush(), new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(1, deadline - Date.now())); })]);
      if (timer) clearTimeout(timer);
    }
    this.metrics.dropped += this.pending.length; this.pending = []; this.bytes = 0;
  }
}
