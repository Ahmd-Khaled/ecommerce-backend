# System Logs Viewer — Backend Assessment and Implementation Plan

Date: 2026-11-25

Status: backend implementation completed following authorization on 2026-11-25. The sections below preserve the approved design and original assessment. See [System Logs API and operations](SYSTEM_LOGS.md) for implemented configuration, validation results, and behavior. Production enablement remains subject to capacity validation and deployment setup.

## 1. Objective and scope

Allow authorized Dashboard Super Admins to browse and search HTTP System Logs through a secure backend API. Preserve existing request logging and follow the TypeScript Express 5, Mongoose, and module/repository architecture.

System Logs describe HTTP request lifecycle, response status, errors, and duration. Audit Logs describe business or administrative actions. This feature does not implement Audit Logs, Dashboard frontend code, response-body capture, or unrelated business changes.

## 2. Existing implementation findings

| Area | Verified implementation |
| --- | --- |
| Lifecycle | [Request middleware](../src/Middlewares/request-logging.middlewares.ts) runs before CORS, parsers, authentication, and routes. Duration uses `performance.now()`. |
| Completion and abort | `finish` and `close` listeners emit exactly one terminal request event. Early close produces `outcome: aborted` and `completed: false`. No separate request-start event exists. |
| Request IDs | A fresh backend UUID is placed in `X-Request-Id` and `AsyncLocalStorage`. Client-provided IDs are ignored. Verified authentication enriches actor context. |
| Storage | [Logger](../src/Utils/logging/logger.ts) writes newline-delimited JSON to stdout. No application-managed log files, persistent System Logs transport, retention worker, or reader API was found. External stdout collection is not established by this repository. |
| Write failures | Serialization and sink failures are caught. Oversized events and events encountering output-buffer pressure are dropped. The process-local `dropped` counter is not durable monitoring. |
| Errors | [Global error handler](../src/Utils/response/error.response.ts) records a safe context error code and a separate `operational/http.error` event. The terminal request event inherits that code. Directly returned HTTP errors can lack an error code. |
| CORS | [CORS configuration](../src/Utils/middleware/cors.ts) uses exact `CORS_ORIGINS`, enables credentials, and exposes `X-Request-Id`. Requests without Origin remain permitted. |
| Tests | Logging tests cover safe projection, actor isolation, generated IDs, completion/abort deduplication, and sink failures. CORS tests cover header exposure on successful and HTTP-error responses. |

Current event fields:

```text
schemaVersion, eventId, occurredAt
kind, level, service, environment, action, outcome
requestId?
actor: type, id?, identityModel?, role?
error?: { code }
http?: { method, route, statusCode, durationMs, completed }
```

Important interpretation limits:

- `route` is the local Express route template, without its mount prefix. Different modules can share values such as `/:id`. Middleware failures and unmatched requests can use `<unmatched>`.
- An aborted request can retain status `200` without delivering a successful response. Consumers must inspect `completed` and `outcome`.
- HTTP response logging means status and lifecycle metadata; payloads are deliberately excluded.
- Historical statements in the existing logging plan are not authoritative where implementation has subsequently changed.

### Authentication and permissions

[Admin authentication](../src/Modules/admin/admin.authorization.ts) and [token handling](../src/Modules/admin/admin.token.ts) already provide:

- Separate Admin and User identities.
- `admin` and `super-admin` roles.
- Admin access-token validation, revocation checks, token-version checks, and frozen/deleted account checks.
- Authorization using the account's current role.

The existing authorization header is `Authorization: admin <access-token>`.

### Data and API conventions

- Modules use controller, service, validation, and repository layers.
- Mongoose interfaces/models define explicit compound indexes.
- Zod middleware preserves parsed query values despite Express 5's query getter.
- Reviews and wishlists provide cursor-pagination precedents.
- Revoked tokens provide an `expiresAt` TTL precedent.
- Generic repository pagination uses offsets and counts; it is unsuitable for this reader.
- Admin success responses generally use `{ success: true, data: ... }`; global error responses use a message and optionally development stack/cause fields.
- The admin router sets `Cache-Control: no-store`, but its parent limiter runs before that router.
- The entire existing admin mount shares a 30-request-per-IP, 15-minute auth limit. Existing limiter counters are process-local.
- The existing email queue uses BullMQ and Redis. It is not a logging queue.

## 3. Missing capabilities

The feature requires persistent storage, bounded asynchronous ingestion, retention enforcement, storage health monitoring, safe query construction, cursor pagination, protected reader endpoints, scoped error sanitization, and integration/performance tests.

Actual request volume, peak traffic, retained dataset size, and acceptable diagnostic event loss are undocumented. MongoDB suitability remains conditional on measurements.

## 4. Proposed architecture

```text
Existing request lifecycle
  -> shared allowlisted event projection
       -> existing stdout output
       -> bounded asynchronous buffer
            -> batched System Logs writes

Protected reader API
  -> validated filter DTO
  -> dedicated repository
  -> explicit safe response projection
```

Initially persist one terminal `http.request` record per request, containing completion/abort state and the existing safe error code. Keep standalone `http.error` and application startup/shutdown events on their existing stdout path. This avoids duplicate viewer records for failed requests. Expanding the viewer to standalone operational events requires a separate contract decision.

Preserve existing stdout fields and behavior. Persistence receives the same sanitized projection, never raw requests, responses, or errors. Failure of either output must not prevent the other output from being attempted.

### Writer behavior

- Perform synchronous enqueue only; never await MongoDB in request handling.
- Bound pending records by both count and bytes.
- Use bounded batch size, concurrency, deadlines, retries, and retry backoff.
- Assign event identity once and make retries idempotent.
- Drop events at the documented overflow/retry limit and increment independent monitoring counters.
- Disable unbounded Mongoose buffering for this transport.
- Drain within a bounded shutdown deadline before closing the transport connection.
- Monitor queue depth, oldest pending age, drops, write failures, and ingestion delay independently of this writer.

This is best-effort diagnostic storage. Process crashes can lose buffered events. If crash-surviving delivery is required, use an isolated durable collector or queue. Do not reuse the OTP queue or make logging contend with authentication email delivery.

### Storage suitability

A normal MongoDB collection is the initial recommendation for structured, time-bounded browsing. Use a separate connection pool and narrowly scoped credentials. A separate database on the same cluster still shares CPU and storage resources.

Illustrative capacity, assuming 1 KB per persisted event:

| Average traffic | Events/day | Raw data over 14 days |
| --- | ---: | ---: |
| 10 requests/second | 864,000 | Approximately 12 GB |
| 100 requests/second | 8.64 million | Approximately 121 GB |

These estimates exclude indexes, replication, backups, and storage overhead. Measure actual event size and peak traffic before enabling collection. If capacity or query targets cannot be met without affecting business traffic, isolate the storage workload or evaluate a dedicated log platform before production rollout.

## 5. Proposed log schema

Collection: `system_logs`. Use strict validation and no arbitrary metadata field.

| Field | Requirement |
| --- | --- |
| `_id` | Required UUID; reuse existing `eventId` for idempotency; expose as `logId` |
| `schemaVersion` | Required integer |
| `occurredAt` | Required BSON Date; terminal event timestamp |
| `ingestedAt` | Required BSON Date; first successful ingestion timestamp |
| `expiresAt` | Required BSON Date, derived from event time and retention |
| `requestId` | Required backend UUID |
| `kind`, `action` | Fixed to `request`, `http.request` |
| `service`, `environment` | Required bounded labels |
| `level` | Required: `info`, `warn`, `error` |
| `outcome` | Required: `success`, `failure`, `denied`, `aborted` |
| `http.method` | Required existing method enum, including `OTHER` |
| `http.route` | Required bounded template or `<unmatched>` |
| `http.statusCode` | Required integer; preserve existing meaning for aborted requests |
| `http.durationMs` | Required finite, nonnegative integer |
| `http.completed` | Required boolean |
| `actor.type` | Required existing actor type |
| `actor.id`, `actor.identityModel`, `actor.role` | Optional; verified identities only |
| `error.code` | Optional bounded safe code |

Never store or return passwords, tokens, cookies, authorization headers, OTPs, payment details, request or response bodies, raw URLs, query strings, stack traces, names, email addresses, or raw database errors. Do not populate actor records from other collections.

Actor IDs are pseudonymous identifiers and require restricted access and retention. Initially omit the `userId` filter because request-ID troubleshooting does not require customer activity searches. Any later addition requires a defined support purpose and an explicit `identityModel: User` constraint.

## 6. Proposed API contract

```http
GET /api/v1/admin/system-logs
GET /api/v1/admin/system-logs/:logId
Authorization: admin <access-token>
```

This is a proposed backend contract, not an assertion about an existing frontend contract.

### List filters

| Parameter | Validation and meaning |
| --- | --- |
| `from`, `to` | ISO timestamps with timezone; inclusive lower bound, exclusive upper bound |
| `requestId` | Exact UUID match |
| `method` | Existing allowlisted method enum |
| `statusCode` | Integer 100–599 |
| `statusGroup` | `1xx` through `5xx`; mutually exclusive with `statusCode` |
| `route` | Exact template match, maximum 256 characters; no regex |
| `outcome` | `success`, `failure`, `denied`, `aborted` |
| `minDurationMs` | Nonnegative bounded integer |
| `limit` | Default 25; maximum 100 |
| `after` | Length-bounded opaque cursor |

Default to the last 24 hours. With only `to`, use the preceding 24 hours. With only `from`, resolve `to` to the current time. Reject reversed ranges, future upper bounds, and spans exceeding the configured retention window.

Reject unknown keys, repeated values, arrays, objects, and MongoDB operator-shaped inputs. Construct database filters explicitly from parsed fields; never spread raw query input into a MongoDB filter. Do not accept arbitrary sort, projection, regex, database, collection, path, or log-source parameters.

### Pagination

- Order by `occurredAt DESC, _id DESC` using strict tuple comparisons.
- Fetch `limit + 1` records to determine whether another page exists.
- Return no total count and use no offset pagination.
- Sign cursors and bind them to normalized filters, resolved dates, ordering, expiry, and an ingestion cutoff.
- Preserve resolved bounds on subsequent pages; do not recalculate relative defaults.
- Validate decoded cursor structure and signature before constructing a query.

This provides deterministic ordering for immutable records, not a transaction snapshot. Late ingestion and retention can affect visibility. Define and test these semantics explicitly rather than promising a frozen dataset.

### Response examples

List:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "logId": "8f81e8ec-27ca-47c1-a446-bdb090a9dd26",
        "occurredAt": "2026-11-25T10:00:00.000Z",
        "requestId": "25909296-af1e-45f2-a451-5ec177f46485",
        "level": "warn",
        "outcome": "denied",
        "http": {
          "method": "GET",
          "route": "/:id",
          "statusCode": 403,
          "durationMs": 12,
          "completed": true
        },
        "actor": { "type": "anonymous" },
        "error": { "code": "HTTP_403" }
      }
    ],
    "pageInfo": {
      "hasNextPage": false,
      "nextCursor": null
    }
  }
}
```

Detail returns `{ "success": true, "data": <safe log DTO> }`. Use an explicit field allowlist for both endpoints. Do not return raw document serialization or additional sensitive detail fields.

| HTTP status | Meaning |
| --- | --- |
| 400 | Invalid filters, cursor, or log ID |
| 401 / 403 | Existing authentication and authorization semantics |
| 404 | Missing or expired record |
| 429 | Rate limit exceeded |
| 503 | Storage unavailable or query deadline exceeded |

Return fixed safe messages and machine-readable error codes. Do not present storage failures as successful empty results. Every viewer response must include `Cache-Control: no-store`.

## 7. Index and query strategy

Initial indexes:

```text
_id                                      unique, automatic
{ occurredAt: -1, _id: -1 }               chronological browsing
{ requestId: 1, occurredAt: -1, _id: -1 }  request-ID lookup
{ expiresAt: 1 }                         TTL, expireAfterSeconds: 0
```

Do not index every filter. Consider status or route compound indexes only after representative query measurements establish a need.

Use explicit projections, `.lean()`, bounded date ranges, and an initial `maxTimeMS` budget of 2 seconds. Residual filters such as minimum duration can scan many index entries despite small page sizes.

Before rollout, run `explain("executionStats")` for first and deep pages, request-ID lookup, error searches, route searches, slow-request searches, and empty results. Record examined keys/documents, returned rows, sort stages, and execution time. See [MongoDB explain results](https://www.mongodb.com/docs/manual/reference/explain-results/).

Suggested staging target: p95 below 500 ms for agreed common queries at projected retained volume. This is an acceptance target, not a measured result. Capacity tests must include concurrent ingestion and expiry deletion.

## 8. Authorization and security

- Use `adminAuthentication([AdminRoleEnum.SUPER_ADMIN])`.
- Recheck Super Admin access at the service boundary with the existing helper.
- Retain token revocation, current-role, token-version, frozen-account, and deleted-account checks.
- Do not rely on frontend route protection or introduce an unrelated permissions framework.
- Keep credentials and CORS origin restrictions unchanged.

### Router placement and rate limits

The viewer must not fall through to the existing admin `/:id` route. Mount its dedicated router before the existing parent admin mount, using its own authentication and limits. Preserve limits on existing admin endpoints.

Set `Cache-Control: no-store` before viewer authentication and rate limiting, including denial and storage-error paths.

Proposed initial limits:

- 60 requests/minute per IP before authentication.
- 30 requests/minute per verified administrator.

Use shared counters for multiple application replicas and explicitly configure trusted proxies. Final thresholds require staging traffic measurements.

### Error handling

The existing global handler can expose raw `err.message` and development stack/cause fields. Add a viewer-scoped error handler covering authentication, validation, and repository failures. Return safe responses in every environment without changing unrelated business error handling.

### Recursive logging prevention

Viewer requests may each generate one normal terminal HTTP event. Persistence workers must not call HTTP endpoints or feed persistence failures back through the persistence writer. Use independent bounded failure metrics. Do not log returned records, query payloads, or database errors as new System Logs.

No endpoint may accept arbitrary filesystem paths or selectable log sources.

## 9. Retention strategy

Proposed initial retention: 14 days, configurable within a documented deployment bound.

- Derive `expiresAt` from `occurredAt`, not ingestion time.
- Discard already-expired queued events.
- Enforce `expiresAt > now` in both list and detail queries.
- Use a single-field TTL index with `expireAfterSeconds: 0`.
- Monitor deletion backlog and storage growth.

TTL deletion is asynchronous, so expired documents may remain physically present temporarily. Application-side filtering prevents them remaining readable. See [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/).

Shortening retention requires controlled updates to existing expiry values and deletion-load monitoring. Backups, stdout collectors, and durable queues need separately configured retention. Changes must not silently renew old records or recreate expired data through retries.

## 10. Testing plan

| Area | Required coverage |
| --- | --- |
| Authentication | Absent, malformed, expired, revoked, wrong-identity, and refresh tokens |
| Authorization | Ordinary Admin denied; Super Admin allowed; role changes and frozen/deleted accounts enforced |
| Validation | Invalid dates, ranges, limits, conflicting filters, unknown fields, injection-shaped input, malformed/tampered cursors |
| Pagination | Identical timestamps, multiple pages, filter binding, concurrent inserts, late ingestion, and expiry between pages |
| Request IDs | Exact lookup, fresh backend IDs, and client ID spoofing resistance |
| Lifecycle | Exactly one completion/abort event and unchanged stdout behavior |
| Redaction | Secrets seeded in headers, bodies, URLs, parser errors, and database errors never reach storage or responses |
| Retention | Immediate API exclusion and eventual actual MongoDB TTL deletion without assuming precise deletion timing |
| Record availability | Invalid ID, missing record, expired record, and unavailable storage |
| Writer failures | Timeouts, partial batch failures, duplicate retries, queue overflow, connection loss, and bounded shutdown |
| HTTP controls | Rate limits, no-store on every viewer response path, and request-ID CORS exposure |
| Performance | Realistic retained datasets, concurrent ingestion, execution statistics, and business-request latency impact |
| Recursion | Reader requests produce only normal lifecycle events; writer failures do not recursively enqueue logs |

Use the repository's `node:test` conventions. Use real isolated MongoDB integration tests for TTL, indexes, ordering, and query execution statistics; mocked tests alone are insufficient.

No feature tests, capacity experiments, or database execution statistics were run during this assessment.

## 11. Expected files to add or change

| Area | Expected paths |
| --- | --- |
| Feature module | New `src/Modules/system-log/` routes, controller, service, validation, DTO, and scoped error handler |
| Persistence | New `src/DB/models/system-log/` interface/model and `src/DB/repository/system-log.repository.ts` |
| Logging transport | New projection, configuration, buffer/writer modules under `src/Utils/logging/`; targeted change to `logger.ts` |
| Lifecycle wiring | `src/app.controller.ts`, `src/index.ts` |
| Rate limiting | `src/Utils/middleware/rate-limit.ts`; shared-store configuration if required |
| Tests | New System Logs unit, HTTP, and integration tests; logging regression extensions |
| Operations | Index-provisioning/query-analysis script, setup and API documentation |

Preserve current request middleware semantics, authentication policy, CORS behavior, and unrelated business services. Exact new filenames and configuration names will be finalized during approved implementation.

## 12. Risks and migration considerations

- Traffic volume, available database capacity, acceptable event loss, and operational ownership remain unknown.
- Shared MongoDB infrastructure can let logging traffic affect business workloads despite separate connection pools.
- In-memory buffering is best effort and cannot guarantee delivery across crashes.
- Route templates are locally scoped today; full API route identity must not be inferred from raw URLs. Improving route identity would need a separately defined safe mapping.
- Existing stdout history will not automatically populate the collection. Historical import requires separate scope and sanitation review.
- Signed cursor secrets require deployment configuration and rotation semantics. Rotation may invalidate existing cursors; clients should restart browsing after a safe validation error.
- Retention, late ingestion, and missing events mean this viewer is not an immutable or complete historical ledger.
- Logging must remain operationally independent from Audit Logs and authentication-email delivery.

## 13. Proposed implementation and rollout sequence

1. Obtain explicit implementation approval and confirm retention, acceptable event loss, expected traffic, and deployment topology.
2. Finalize strict event/response DTOs, filters, cursor semantics, and scoped error contracts.
3. Add collection, indexes, repository, and bounded ingestion transport without changing stdout behavior.
4. Add Super Admin endpoints, scoped rate limiting, no-store, validation, and sanitized errors.
5. Complete unit/HTTP tests, real MongoDB integration tests, failure injection, and capacity/query validation.
6. Provision indexes and restricted credentials with ingestion disabled; validate in staging.
7. Enable ingestion and reader access gradually while monitoring latency, drops, ingestion delay, query cost, and TTL backlog.
8. Maintain an ingestion-off switch that leaves existing stdout logging active.

Production readiness requires measured capacity and verified error/privacy behavior. Implementation was subsequently authorized; production enablement still requires deployment configuration and capacity validation.
