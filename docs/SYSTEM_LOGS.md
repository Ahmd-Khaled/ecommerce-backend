# System Logs API and operations

The backend stores sanitized terminal HTTP request events when explicitly enabled. This is best-effort diagnostic storage, separate from Audit Logs. It does not capture bodies, headers, raw URLs, query strings, payment details, stack traces, or arbitrary error messages. Existing stdout logging remains active independently.

## Configuration

| Variable | Purpose |
| --- | --- |
| `LOG_STDOUT_ENABLED` | Set `false` to mute structured JSON terminal output without disabling request IDs or enabled System Logs persistence. Default enabled. |
| `SYSTEM_LOGS_ENABLED` | `true` enables ingestion and reader service; default disabled. Disabled readers return a sanitized 503 after authentication. |
| `SYSTEM_LOGS_MONGO_URI` | Dedicated log database URI; required when enabled. Uses a separate pool of at most three connections. |
| `SYSTEM_LOGS_CURSOR_SECRET` | At least 32 bytes of cryptographically random secret material; required when enabled. Keep identical across replicas. Rotation invalidates existing cursors. |
| `SYSTEM_LOGS_RETENTION_DAYS` | Integer 1–90; default 14. Applies to newly ingested events. |
| `SYSTEM_LOGS_REDIS_URL` | Shared rate-limit store, required when enabled in `NODE_ENV=production`. Configure for every multi-process deployment, including staging. Use an isolated service from OTP delivery. |
| `CORS_ORIGINS` | Existing exact authorized Dashboard origin allowlist. Request ID exposure is preserved. |

Use deployment environment variables; do not commit credentials. The application still loads its existing development dotenv file, without overriding already supplied environment variables.

Before enabling ingestion, use provisioning credentials to run `npm run system-logs:indexes`. This creates the collection's chronological, request-ID, and expiry indexes without dropping indexes. Runtime credentials need find/update/insert access to `system_logs`; they do not need index-administration privileges. Configure network/TLS restrictions for the deployment. Multiple environments should use separate databases and rate-limit Redis instances/databases.

The reader is mounted before the general admin router so it does not consume the existing authentication endpoint budget. Limits are 60 requests/minute per IP and 30/minute per verified administrator. Redis failures fail closed with a sanitized 503. Single-process development can use memory counters. Express retains its default untrusted-proxy behavior; behind a proxy, configure a precisely trusted proxy topology before deployment, not an unrestricted trust setting. Otherwise users share the proxy's IP budget.

## Endpoints

```http
GET /api/v1/admin/system-logs
GET /api/v1/admin/system-logs/:logId
Authorization: admin <access-token>
```

Both endpoints require a currently active Super Admin. User credentials, refresh tokens, revoked sessions, frozen/deleted accounts, and ordinary Admin access are rejected. Responses including errors carry `Cache-Control: no-store` and the existing backend-generated `X-Request-Id`.

List filters: `from`, `to` (ISO timestamps with timezone), `requestId` (UUID), `method`, `statusCode`, `statusGroup` (`1xx`–`5xx`), `route` (exact local Express template), `outcome`, and `minDurationMs` (integer 0–2147483647). `statusCode` and `statusGroup` cannot be combined. Unknown keys, arrays, objects, and invalid values are rejected. No userId or free-text search is provided.

`limit` defaults to 25 and must be 1–100. `after` is a signed cursor. Repeat the original filters and limit when following `nextCursor`; omit relative dates as before or use identical resolved dates. Cursors expire after 15 minutes. Results are sorted by `occurredAt DESC, logId DESC`. A fixed time range and ingestion cutoff are carried across pages; this is not a database snapshot. Concurrent ingestion and expiry can affect visibility.

The default range is the preceding 24 hours (or retention if shorter). Only `to` means the preceding day; only `from` means through now. The range is `[from, to)`, cannot be reversed or exceed retention, and cannot end in the future.

List response:

```json
{ "success": true, "data": { "items": [], "pageInfo": { "hasNextPage": false, "nextCursor": null } } }
```

Detail response is `{ "success": true, "data": <log> }`. Log fields are `logId`, `schemaVersion`, `occurredAt`, `requestId`, `service`, `environment`, `kind`, `action`, `level`, `outcome`, `actor`, optional `error.code`, and `http` (`method`, `route`, `statusCode`, `durationMs`, `completed`). No actor population or private database fields are exposed.

Errors contain `{ success: false, code, message }`: 400 invalid query/ID/cursor, 401 missing/invalid session, 403 forbidden, 404 missing/expired record, 429 rate limited, 503 unavailable storage or query timeout. Storage failure is never represented as an empty successful result. Error messages are fixed and omit internal errors even in development mode.

## Lifecycle, storage and retention

The writer stores only `request/http.request` terminal events. `finish` and early `close` retain their existing once-only behavior. Standalone operational events remain stdout-only. Aborted requests may have status 200 despite an incomplete response; inspect `completed` and `outcome`.

Route values are local templates such as `/:id`, not full mounted API paths. Multiple modules can share a route value. `<unmatched>` covers requests with no resolved template.

The queue holds at most 2,000 records or 8 MiB of serialized event data, including in-flight records. It flushes up to 100 records per one-second tick with one batch in flight, and retries at most three attempts. MongoDB operations and connection waits have deadlines. Upserts use event UUID identity and `$setOnInsert`, so retries cannot duplicate or overwrite an existing event. `ingestedAt` is assigned on the insertion attempt and preserved once inserted. A partial batch failure may cause acknowledged records to be retried; drop counters conservatively count uncertain records, not proof of absence in storage.

Business requests never wait for persistence. Overflow, outages, process crashes, and shutdown deadlines can lose diagnostics. Shutdown allows five seconds for queue drain. Existing stdout remains available. Disable the feature and restart to turn off ingestion without disabling stdout.

Expiry is based on event time. Both reader endpoints exclude expired records immediately; MongoDB TTL removes them asynchronously. Provision and verify the TTL index before rollout. Changing retention affects new records only: shortening existing retention requires a separately reviewed bounded migration. Coordinate backups and external stdout retention separately.

`systemLogHealth()` in the transport module returns connection state and process-local accepted/persisted/dropped/failure counters, pending count/bytes, and oldest pending age. Connect this function to the deployment's independent monitoring collector; no public health/metrics endpoint is introduced. Never feed persistence failures back into the System Logs writer.

## Verification and deployment gate

- Run `npm run test:system-logs` for unit and HTTP tests.
- Set `MONGO_TEST_URI` to a disposable test server to enable real MongoDB tests. Tests use a uniquely named database and drop only that database after completion. TTL verification may take up to 150 seconds.
- Run `npm run system-logs:explain` against a representative staging dataset. It prints query statistics only, without record contents or secrets.
- Measure first/deep-page queries, request-ID lookup, errors, routes, slow requests, empty results, expiry load, and ingestion overhead at expected retained volume. The proposed p95 target of 500 ms is not a demonstrated production capacity claim.
- Provision indexes, secrets, restricted database credentials, shared rate counters, and monitoring before enabling in production. Alert on drops, failure count, pending age, storage growth and TTL backlog.

No historical stdout backfill or Dashboard frontend is included.

### Implementation verification (2026-11-25)

TypeScript build and 26 focused tests passed, including isolated MongoDB and Redis tests, existing admin-security tests, logging regressions, and CORS checks. Real MongoDB verified expiry exclusion, eventual TTL deletion, equal-timestamp pagination, request-ID lookup, duplicate ingestion, and late-ingestion cutoff handling. Redis verified shared counters, separate budgets, expiry, and failure behavior.

On the small integration fixture, request-ID/recent/route queries examined 26 documents for 26 results; a deep cursor examined 27 for 26 results; missing request-ID lookup examined zero. Slow-request and error filters scanned 153 documents in the time window for zero results. These are functional query-plan checks, not production-volume benchmarks. No additional filter indexes were added without representative evidence.

The broader `npm test` run reported 151 passing tests, 8 environment-gated skips, and one unrelated existing payment assertion failure: `tests/payment.test.cjs:63` expects `payment.status` to equal `pending`, while the unchanged payment service uses `$in: ['pending', 'expired']`. Payment implementation and tests were not changed by this feature.
