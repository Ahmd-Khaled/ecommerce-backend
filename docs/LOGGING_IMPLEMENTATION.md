# Logging implementation

Implementation started on 2026-11-23 on `feat/logging-implementation`.

This is the initial request-logging foundation of [the implementation plan](LOGGING_IMPLEMENTATION_PLAN.md), not completion of the audit rollout. There is no durable mutation auditing yet. Existing authorization and business transaction behavior remain in place.

## Implemented behavior

- Request middleware runs before CORS, security middleware, body parsers, limiters, media and API routers. Every incoming HTTP request emits one JSON completion event on `finish`, or an abort event on early `close`.
- `X-Request-Id` contains a server-generated UUID. Client-supplied IDs are not trusted or copied. AsyncLocalStorage isolates concurrent requests; completion callbacks retain their own context explicitly.
- Existing customer/admin guards attach verified identity, model and role before route-specific role checks. Invalid credentials stay anonymous. Identical User and Admin IDs remain distinguishable. Login handlers and other authentication paths outside those guards are not yet instrumented.
- HTTP 401/403/429 outcomes are `denied`; other errors are `failure`. An abort describes transport completion only and does not imply business rollback.
- The global error handler adds a stable HTTP error code and one diagnostic event without recording exception messages, stacks or causes. Existing API error response formatting is preserved.
- Server startup and startup/shutdown failure messages use structured operational events.

## Privacy and output

The logger projects explicitly permitted fields rather than serializing arbitrary objects. It does not capture request/response bodies, headers, cookies, tokens, query strings, IP addresses, emails, provider payloads, or raw URLs. Webhook bytes and uploads are untouched.

The `http.route` field currently contains the **router-relative Express route template**, not a complete mounted route. Requests rejected before route matching, unknown routes and middleware-only handlers use `<unmatched>`. Full mounted route classification, stable per-operation action names and alias reconciliation remain part of the route inventory phase. Do not use this initial route field as a complete operation coverage inventory.

All events use action names from a closed set and include schema version, event UUID, UTC occurrence time, deployment identity, level and outcome. Request records include method, status, elapsed milliseconds and completion state. Arbitrary metadata is not accepted yet.

The initial implementation uses Node's stdout stream behind a typed logger interface and adds no package dependency. A maintained logging library evaluation remains pending before operational rollout. Stdout can block depending on deployment/OS; this implementation does not claim the plan's fully asynchronous transport guarantee. Sink errors are swallowed, stream errors increment a dropped-event counter, and writes are dropped when stdout's buffered bytes reach 64 KiB. There is no remote request in the logging path or unbounded application queue. Oversized events are dropped, never truncated into invalid JSON. `logger.dropped` exposes an in-process counter; external monitoring/export is pending.

## Configuration

| Setting | Default | Behavior |
| --- | --- | --- |
| `LOG_SERVICE_NAME` | `ecommerce-backend` | Up to 64 letters, digits, underscores, dots or hyphens; invalid values use default |
| `NODE_ENV`, falling back to `MODE` | `unknown` | Same safe label rules |
| `LOG_MAX_EVENT_BYTES` | `8192` | Integer from 2048 to 65536; invalid values use default |

No sampling or level filtering is enabled. Audit retention, HMAC configuration, retry settings and `LOG_LEVEL` are not implemented. Collect stdout with deployment infrastructure and restrict access there. Existing console logging outside application startup/shutdown remains to be migrated and is not covered by this logger's privacy guarantees.

## Verification

Run `npm run build` and `node --test tests/logging.test.cjs` (also included by `npm test`). Tests cover concurrent identity isolation, server request IDs, one completion/abort record, parser failures, unknown paths, unchanged raw webhook bytes, sensitive-data omission, sink exceptions and backpressure drops.

Initial validation: TypeScript build passed; all 3 logging tests passed. The full suite reported 139 passing, 7 skipped and 1 failing test. The unchanged `tests/payment.test.cjs:63` expects a `pending` payment status predicate, while the unchanged payment service uses `{ $in: ['pending', 'expired'] }`. That unrelated mismatch remains unresolved. Database integration tests were skipped; no replica-set transaction guarantee has been verified in this phase.

## System Logs statistics API

```http
GET /api/v1/admin/system-logs/statistics
Authorization: admin <access-token>
```

Returns aggregate HTTP metrics from the persisted System Logs collection. Requires an active **Super Admin** and `SYSTEM_LOGS_ENABLED=true`. It shares the existing System Logs authentication, rate limits (60/minute per IP and 30/minute per administrator), sanitized errors, `Cache-Control: no-store`, and server-generated `X-Request-Id`. The static `/statistics` route is registered before `/:logId`.

### Query parameters

| Parameter | Default | Validation / meaning |
| --- | --- | --- |
| `from` | 24 hours before `to`, bounded by configured retention | ISO timestamp with timezone; inclusive |
| `to` | Current server time | ISO timestamp with timezone; exclusive; must not be in the future |
| `method` | All | `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `OTHER` |
| `route` | All | Exact router-relative template, 1–256 characters, e.g. `/:id`; no regex |
| `slowThresholdMs` | `1000` | Integer 1–2147483647; requests at or above this duration are slow |

If only `from` is supplied, `to` defaults to now. If only `to` is supplied, use the preceding 24 hours. Reject reversed/empty ranges and spans exceeding configured retention. Unknown parameters, repeated values, arrays and objects are rejected. No pagination, arbitrary database expressions, actor IDs or free-text search are accepted.

Example: `/api/v1/admin/system-logs/statistics?method=POST&slowThresholdMs=1000`.

### Response and metric definitions

```json
{
  "success": true,
  "data": {
    "from": "2026-11-24T10:00:00.000Z",
    "to": "2026-11-25T10:00:00.000Z",
    "slowThresholdMs": 1000,
    "totalRequests": 6,
    "successfulRequests": 2,
    "failedRequests": 4,
    "completedRequests": 5,
    "abortedRequests": 1,
    "deniedRequests": 1,
    "slowRequests": 3,
    "clientErrorRequests": 2,
    "serverErrorRequests": 1,
    "averageDurationMs": 808.33,
    "maxDurationMs": 2000,
    "p50DurationMs": 200,
    "p95DurationMs": 2000,
    "p99DurationMs": 2000
  }
}
```

| Metric | Definition within the selected records |
| --- | --- |
| `totalRequests` | All matching unexpired persisted terminal HTTP events |
| `successfulRequests` | Completed requests with `outcome=success`; includes redirects under the existing logger's classification |
| `failedRequests` | All other requests, including denied and aborted requests; total equals successful plus failed |
| `completedRequests` | `http.completed=true` |
| `abortedRequests` | `http.completed=false`, regardless of the recorded HTTP status |
| `deniedRequests` | `outcome=denied` (normally completed 401/403/429 responses) |
| `slowRequests` | `http.durationMs >= slowThresholdMs`, including aborted requests |
| `clientErrorRequests` | Completed responses with status 400–499 |
| `serverErrorRequests` | Completed responses with status 500–599 |
| `averageDurationMs` | Average duration of all selected records, rounded to two decimal places |
| `maxDurationMs` | Maximum duration of all selected records |
| `p50DurationMs` | Approximate 50th percentile (median) duration, rounded to two decimal places |
| `p95DurationMs` | Approximate 95th percentile duration, rounded to two decimal places |
| `p99DurationMs` | Approximate 99th percentile duration, rounded to two decimal places |

Percentiles use MongoDB's [`$percentile` accumulator](https://www.mongodb.com/docs/manual/reference/operator/aggregation/percentile/) with `p: [0.5, 0.95, 0.99]` and `method: 'approximate'` (t-digest). This requires **MongoDB 7.0 or newer**; the local integration server was verified as **8.0.4**. The deployed server version has not been independently verified: check it before deployment. Older servers return the existing sanitized 503 rather than silently changing calculation methods.

All three values are calculated in the same `$group` as average and maximum, over the identical filtered population, including aborted requests. No durations are collected into application memory or unbounded MongoDB arrays. Approximation can vary slightly across executions or server versions; it is not an exact nearest-rank or interpolated percentile contract. Example percentile values are illustrative. Tests use exact expectations for constant datasets and an independent nearest-rank reference with a 1% rank tolerance for a 10,000-record uniform dataset; this test tolerance is not a universal accuracy guarantee. Empty datasets return zero for all five duration metrics. Existing query deadlines, filters, retention checks, authorization and indexes are unchanged.

These categories overlap: slow requests can also be successful, failed, or aborted; denied requests are included in failed requests and usually client errors. An aborted request with recorded status 200 is never counted as successful. Empty results return zero for all metrics, including durations.

### Storage, errors and verification

The repository performs one MongoDB aggregation with a leading date/expiry/filter match and a single group, with a two-second execution limit and disk spilling disabled. It never fetches all logs into application memory or returns raw log records. Expired records are excluded immediately even before TTL deletion. Records ingested after the query's server timestamp are excluded.

Counts describe retained, asynchronously persisted events, not guaranteed lifetime traffic totals. Writer drops, ingestion delay, retention, and concurrent ingestion can affect results. Viewer/statistics requests themselves generate ordinary terminal request logs and may appear in later queries. Full mounted API route identity is not available in the current logger.

Errors: 400 invalid filters/date range; 401 invalid or missing credentials; 403 insufficient role; 429 shared rate budget exceeded; 503 disabled/unavailable storage, aggregation timeout, or rate-store failure. Failures never become successful zero counts. Error responses omit stack traces and database messages in every environment.

Run `npm run test:system-logs`. Set `MONGO_TEST_URI` to a disposable test server to exercise real aggregation across successful, redirected, denied, failed, aborted, slow, expired and out-of-range records. Unit/HTTP tests cover validation, authorization, static route precedence, empty results, cache prevention, rate limits and storage failures. Large retained windows require staging load validation; aggregation must inspect matching records and is not constant-time despite the chronological index. No additional index is introduced solely for this endpoint.

See [System Logs configuration and operations](SYSTEM_LOGS.md) for storage enablement, retention, index provisioning and Redis setup. Structured terminal output can independently be muted with `LOG_STDOUT_ENABLED=false`.

## Remaining audit implementation

1. Complete mounted route/job/script inventory and per-action schemas; instrument security decisions, semantic outcomes and authenticated reads.
2. Add audit and outbox collections, indexes, repositories, transactional writers and MongoDB polling with leases, retry, deduplication and recovery. Prove rollback behavior with a disposable replica set before enforcement.
3. Integrate mandatory outbox persistence into each business transaction, including explicit credential/session consistency boundaries. Completion logging must never substitute for a committed business event.
4. Add the super-admin-only audit reader, bounded pagination and nonrecursive access auditing.
5. Propagate initiating context through email, payments, uploads and operator scripts; migrate remaining console calls.
6. Add independent health/metrics, retention, capacity/backpressure, operator replay, shutdown draining, alert ownership and recovery runbooks. Evaluate the production transport and measure staging load/failure budgets.

There are no audit collections to recover or replay in this initial phase. Do not enable or advertise mandatory audit enforcement until transaction integration and the plan's failure-injection acceptance tests pass.
