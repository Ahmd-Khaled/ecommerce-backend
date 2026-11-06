# Email delivery

Start Redis with `docker compose up -d redis`, set `REDIS_URL` in
`config/.env.dev` (default `redis://127.0.0.1:6379`), then run `npm run dev`.
The API starts a BullMQ worker automatically. Production can run the compiled
application with `npm run build` followed by `node dist/index.js`.

Registration, confirmation resend, and password reset await Redis enqueueing.
SMTP runs in the background with five total attempts and exponential delays
of 5, 10, 20, and 40 seconds. Pending and delayed jobs survive application
restarts; interrupted jobs are recovered through BullMQ's stalled-job handling.
Expired OTPs fail permanently before SMTP delivery. Shutdown stops HTTP requests,
waits for active email work, and closes connections (30-second deadline).

The supplied Redis service uses a named volume, AOF persistence with fsync on
every write, and no eviction. Preserve that volume; `docker compose down -v`
deletes queued jobs. Configure equivalent durability on managed Redis, and use
an authenticated TLS URL (`rediss://user:password@host:port/db`) in production.
Redis contains recipient addresses and plaintext OTPs: restrict access and protect
backups. Completed jobs are removed immediately. Failed jobs are retained up to
one day or 1,000 entries; BullMQ applies age cleanup lazily as jobs finish.

Queue unavailability returns HTTP 503. MongoDB updates and Redis enqueueing are
not atomic: the account or new OTP may already be saved when enqueueing fails.
Request another code after the existing resend cooldown; for registration use
the confirmation resend endpoint. A transactional outbox would be needed to
close the crash window between database save and enqueueing.

Delivery is at least once: a crash after SMTP accepts a message but before Redis
records completion can cause a duplicate. A queued code replaced by a later
resend may still be delivered before its original expiry; only the latest code
passes authentication. For expired or exhausted jobs, request a fresh code.

Run `npm run test:email` for processor tests. To check recovery locally, stop the
app after enqueueing during an SMTP outage, restart it while preserving Redis,
and restore SMTP before the code expires. Also restart Redis to check volume
persistence. Inspect the `otp-email` queue with BullMQ tooling for attempts and
failed jobs; application logs deliberately omit OTPs and recipient data.

References: [BullMQ retries](https://docs.bullmq.io/guide/retrying-failing-jobs)
and [production persistence](https://docs.bullmq.io/guide/going-to-production).
