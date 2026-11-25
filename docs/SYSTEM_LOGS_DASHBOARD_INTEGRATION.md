# System Logs: dashboard implementation guide

Verified against the backend source on 2026-11-25. This document describes the implemented API and gives frontend implementation recommendations. Examples contain fictional identifiers and no credentials.

## 1. Scope and prerequisites

Build a read-only System Logs screen for active **Super Admins** (`role: "super-admin"`). It provides a paginated request table, request details, aggregate statistics, and request-ID lookup.

System Logs contain sanitized terminal HTTP request events. They are separate from business Audit Logs. Persistence is best effort: the dashboard is a diagnostic tool, not a complete accounting of traffic.

Before frontend integration, confirm:

- The backend is running; the default port is 4000 unless `PORT` overrides it.
- System Logs storage is enabled and provisioned (section 12).
- The dashboard origin is in the backend's `CORS_ORIGINS` allowlist.
- The signed-in account has an active Super Admin access token.
- The log database runs MongoDB 7.0 or later for statistics percentile aggregation.

Backend operations documentation: [SYSTEM_LOGS.md](./SYSTEM_LOGS.md). Administrator authentication documentation: [ADMIN.md](./ADMIN.md).

## 2. Endpoints and authorization

All paths below are relative to the backend origin, for example `http://localhost:4000`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/admin/system-logs` | Filtered, cursor-paginated logs |
| GET | `/api/v1/admin/system-logs/statistics` | Aggregate metrics for a time range |
| GET | `/api/v1/admin/system-logs/:logId` | One unexpired log by its UUID |

Send this exact authorization scheme on every request:

```http
Authorization: admin <access-token>
Accept: application/json
```

The scheme is case-sensitive: use `admin`, not `Bearer`. Use the access token, not the refresh token. The backend rechecks the account, role, token version, and revocation state on requests. Ordinary administrators and user accounts cannot access these endpoints. Hiding navigation is useful UX but does not replace backend authorization.

These endpoints accept no request body. There are no create, edit, delete, clear-all, export, or stream endpoints.

Responses carry `Cache-Control: no-store` and a backend-generated `X-Request-Id`. The response header identifies the current dashboard API request; a row's `requestId` identifies the historical request represented by that row. They generally differ.

## 3. List query contract

```http
GET /api/v1/admin/system-logs?limit=25&statusGroup=5xx
```

Send scalar query strings. Omit unused fields entirely. Empty strings, repeated keys that become arrays, objects, and unknown query keys are invalid. In particular, do not send `page`, `offset`, `sort`, `search`, `userId`, `level`, or `environment`.

| Parameter | Accepted value | Default / semantics |
| --- | --- | --- |
| `from` | ISO datetime with timezone, e.g. `2026-11-24T08:00:00.000Z` | Inclusive lower time bound |
| `to` | ISO datetime with timezone | Exclusive upper time bound |
| `requestId` | UUID | Exact request-ID match; still subject to the time range |
| `method` | `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `OTHER` | Exact method match |
| `statusCode` | Integer string, 100–599 | Exact status; mutually exclusive with `statusGroup` |
| `statusGroup` | `1xx`, `2xx`, `3xx`, `4xx`, `5xx` | Status range; mutually exclusive with `statusCode` |
| `route` | String, 1–256 characters | Exact local Express route template |
| `outcome` | `success`, `failure`, `denied`, `aborted` | Exact outcome |
| `minDurationMs` | Integer string, 0–2147483647 | Duration greater than or equal to this value |
| `limit` | Integer string, 1–100 | 25 |
| `after` | Opaque signed cursor returned by the API | Omit for the first page; maximum length 4096 |

Numeric fields must contain decimal digits only. Do not send decimals, signs, units, or scientific notation.

### Time range behavior

- No dates: preceding 24 hours, capped by configured retention.
- Only `to`: the preceding 24 hours ending at `to`, capped by retention.
- Only `from`: from that timestamp through the server's current time.
- Both: exactly `[from, to)`.
- `from` must be strictly earlier than `to`; `to` must not be in the future.
- Range duration cannot exceed configured retention (default 14 days, configurable 1–90).
- The API does not expose the configured retention through a settings endpoint. Coordinate the dashboard's maximum range with deployment configuration.
- An old range is not necessarily invalid, but expired records are excluded even if MongoDB has not physically deleted them yet.

Convert date-picker values to ISO strings with timezone offsets or UTC. Do not send timezone-less `datetime-local` values directly. Display timestamps in the user's chosen timezone with a visible timezone label. Prefer fixed explicit bounds when comparing the table and statistics. A client clock ahead of the server can cause a future-`to` validation error.

### Route matching

The stored value is `req.route.path`, not the full URL or mounted API path. Examples include `/`, `/:id`, and `/statistics`. Different modules can share the same route value. Requests without a resolved route use `<unmatched>`; this can include middleware rejections as well as unknown routes.

Label the input **Route template (exact)**. Encode it using `URLSearchParams`. A search for `/api/v1/products/123` will not match a stored `/:id` template. There is no module/path-prefix filter or route-options endpoint.

### List success response

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "logId": "4e5f1a62-475c-4b6f-bcc6-36a19c3d769e",
        "schemaVersion": 1,
        "occurredAt": "2026-11-24T08:30:15.123Z",
        "requestId": "e56c963d-1e12-4b53-bc02-e5792dd523e1",
        "service": "ecommerce-backend",
        "environment": "development",
        "kind": "request",
        "action": "http.request",
        "level": "warn",
        "outcome": "denied",
        "actor": { "type": "anonymous" },
        "error": { "code": "UNAUTHORIZED" },
        "http": {
          "method": "GET",
          "route": "<unmatched>",
          "statusCode": 401,
          "durationMs": 12,
          "completed": true
        }
      }
    ],
    "pageInfo": { "hasNextPage": false, "nextCursor": null }
  }
}
```

There is no total count, page number, or resolved time range in the list response. An empty result is `items: []` with `hasNextPage: false` and `nextCursor: null`.

## 4. Log fields and interpretation

| Field | Type | Meaning |
| --- | --- | --- |
| `logId` | UUID string | Stable event identifier; use as table key and detail identifier |
| `schemaVersion` | `1` | Current response event schema |
| `occurredAt` | ISO timestamp | Terminal-event emission time, not request start time |
| `requestId` | UUID string | Backend-generated correlation ID |
| `service` | string | Configured service label; default `ecommerce-backend` |
| `environment` | string | Sanitized `NODE_ENV` or `MODE`; fallback `unknown` |
| `kind` | `request` | Persisted event kind |
| `action` | `http.request` | Persisted terminal request action |
| `level` | `info`, `warn`, `error` | Severity derived from status and completion |
| `outcome` | `success`, `failure`, `denied`, `aborted` | Request outcome |
| `actor` | union object | Verified identity when known; see types below |
| `error` | optional `{ code: string }` | Sanitized error code; not guaranteed for every unsuccessful response |
| `http.method` | method enum | Unsupported methods are represented as `OTHER` |
| `http.route` | string | Local route template or `<unmatched>` |
| `http.statusCode` | integer | Status at terminal event time |
| `http.durationMs` | nonnegative integer | Rounded elapsed request time in milliseconds |
| `http.completed` | boolean | Whether the response finished |

Outcome and severity are assigned in this order:

| Condition | Outcome | Level |
| --- | --- | --- |
| Response incomplete | `aborted` | `error` |
| Completed with 401, 403, or 429 | `denied` | `warn` |
| Completed with any other 4xx | `failure` | `warn` |
| Completed with 5xx | `failure` | `error` |
| Completed with status below 400 | `success` | `info` |

An aborted request may show status 200. Always show completion/outcome alongside status; do not label every 2xx row successful. Redirects below 400 count as success. A verified actor can exist on a denied request, such as an ordinary Admin denied Super Admin access.

No names, email addresses, IP addresses, request/response bodies, headers, query strings, full URLs, stack traces, or raw error messages are returned. Actor IDs are not populated. Database fields such as `_id`, `ingestedAt`, and `expiresAt` are not returned. Do not create UI placeholders that imply these fields can be fetched from this API.

## 5. Cursor pagination

Results use fixed ordering: `occurredAt DESC`, then `logId DESC` for ties. The frontend cannot change sorting.

1. Apply filters and request the first page without `after`.
2. Store `data.pageInfo.nextCursor` without parsing or modifying it.
3. If `hasNextPage` is true, send the same filters and limit with `after=nextCursor`.
4. Stop when `hasNextPage` is false.
5. Any filter or page-size change clears cursors and loaded rows and starts from the first page.

If dates were omitted on page one, keep them omitted for later pages: the cursor retains the resolved bounds. If explicit dates were supplied, reuse them unchanged. Do not recompute a relative time range on each page request.

Cursors expire 15 minutes after the first page and do not extend their lifetime on later pages. Changing filters/limit, tampering, expiry, or backend secret rotation causes a 400. The error response does not identify which of these happened. Offer **Reload results** to clear the cursor and fetch page one.

The cursor also fixes an ingestion cutoff. This limits newly arriving records during pagination but is not a database snapshot; expiry and concurrent ingestion can still affect visibility. Deduplicate appended rows by `logId` defensively.

Recommended controls: **Load more** and **Refresh**. There is no server-side previous-page cursor or random page access. A previous-page UI must keep fetched pages or a client-side cursor history. Refresh starts a new traversal; for relative presets, recompute explicit bounds then. Do not append refreshed page-one results to old traversal state.

## 6. Detail endpoint

```http
GET /api/v1/admin/system-logs/4e5f1a62-475c-4b6f-bcc6-36a19c3d769e
```

Response: `{ "success": true, "data": <SystemLog> }`, using exactly the row schema above. The path ID is `logId`, not `requestId` and not a MongoDB ObjectId. A malformed UUID returns 400; a valid but missing or expired UUID returns 404.

Use a drawer or detail page with timestamp, request ID, method/template, status, duration, outcome, completion, actor, optional error code, service, environment, and log ID. Copy buttons are useful for request/log IDs. A row may expire between list and detail requests; show “This log is no longer available” for 404 and offer a list refresh.

## 7. Statistics endpoint

```http
GET /api/v1/admin/system-logs/statistics?slowThresholdMs=1000
```

Statistics use a separate, strict query schema:

| Parameter | Accepted value | Default |
| --- | --- | --- |
| `from`, `to` | Same datetime and range rules as list | Preceding 24 hours |
| `method` | Same method enum as list | All methods |
| `route` | Exact template, 1–256 characters | All routes |
| `slowThresholdMs` | Integer string, 1–2147483647 | 1000 |

Do not forward list-only parameters: `requestId`, `statusCode`, `statusGroup`, `outcome`, `minDurationMs`, `limit`, and `after` all cause 400 here. Statistics are computed across the matched stored records, not just the current list page.

Illustrative response:

```json
{
  "success": true,
  "data": {
    "from": "2026-11-23T12:00:00.000Z",
    "to": "2026-11-24T12:00:00.000Z",
    "slowThresholdMs": 1000,
    "totalRequests": 100,
    "successfulRequests": 80,
    "failedRequests": 20,
    "completedRequests": 95,
    "abortedRequests": 5,
    "deniedRequests": 8,
    "slowRequests": 10,
    "clientErrorRequests": 12,
    "serverErrorRequests": 3,
    "averageDurationMs": 245.37,
    "maxDurationMs": 3200,
    "p50DurationMs": 95.5,
    "p95DurationMs": 1250.25,
    "p99DurationMs": 2900.75
  }
}
```

| Metric | Exact meaning |
| --- | --- |
| `totalRequests` | All matching retained records |
| `successfulRequests` | `completed === true` and `outcome === 'success'` |
| `failedRequests` | All records that do not satisfy the success condition, including denied and aborted |
| `completedRequests` | `http.completed === true` |
| `abortedRequests` | `http.completed === false` |
| `deniedRequests` | `outcome === 'denied'` |
| `slowRequests` | Duration greater than or equal to `slowThresholdMs`, including aborted requests |
| `clientErrorRequests` | Completed requests with status 400–499 |
| `serverErrorRequests` | Completed requests with status 500–599 |
| `averageDurationMs` | Average duration of all matched records, rounded to two decimals |
| `maxDurationMs` | Maximum duration across all matched records |
| `p50DurationMs`, `p95DurationMs`, `p99DurationMs` | Approximate MongoDB percentiles across all matched durations, rounded to two decimals |

The categories overlap. Do not sum failed + denied + aborted as independent categories. `totalRequests = successfulRequests + failedRequests` and `totalRequests = completedRequests + abortedRequests`. For a success rate, divide successful by total and handle zero explicitly. With no matching records, every numeric metric is zero; show a no-data state for latency cards instead of implying measured zero latency.

There are no time-series buckets, per-route rankings, per-method groups, or historical comparison fields. Percentiles require MongoDB 7.0+. Aggregations have a two-second database execution limit; storage/query errors return 503, not zero metrics.

Label cards “Statistics for selected time range, method, and route.” When users add list-only filters, explain that those filters affect the table only. Separate requests do not share a snapshot, even with identical time bounds, so small differences during ingestion/expiry are possible.

## 8. Errors, rate limits, and CORS

All handled API errors use this shape:

```json
{
  "success": false,
  "code": "SYSTEM_LOGS_UNAVAILABLE",
  "message": "System Logs temporarily unavailable"
}
```

| HTTP | Code | Exact message | Recommended frontend action |
| --- | --- | --- | --- |
| 400 | `INVALID_SYSTEM_LOG_QUERY` | Invalid System Logs request | Validate filters; if paginating, offer restart from page one |
| 401 | `UNAUTHORIZED` | Authentication required | Use existing session recovery/login flow; avoid infinite retries |
| 403 | `FORBIDDEN` | Access denied | Show access denied and stop fetching |
| 404 | `SYSTEM_LOG_NOT_FOUND` | System log not found | Show missing/expired detail state |
| 429 | `RATE_LIMITED` | Too many requests | Pause automatic requests and show cooldown |
| 503 | `SYSTEM_LOGS_UNAVAILABLE` | System Logs temporarily unavailable | Show unavailable state and a bounded retry action |

Disabled logging, unavailable MongoDB, query timeouts, and rate-store failures can surface as 503. The API intentionally does not expose internal failure details. Error bodies do not provide per-field validation errors.

All three endpoints share limits of **60 requests/minute per IP** and **30 requests/minute per verified administrator**. Table, statistics, detail, retries, and multiple tabs consume this budget. The IP limiter runs before authentication. Rate limiting uses standard draft-8 headers, not legacy `X-RateLimit-*` headers.

For cross-origin browser requests, current CORS exposes only `X-Request-Id`. JavaScript may not be able to read `Retry-After` or rate-limit headers. Honor `Retry-After` when accessible; otherwise use a conservative 60-second cooldown after 429. Exposing additional headers requires a backend CORS change.

Suggested refresh policy: manual refresh by default; optional 30-second refresh for the first page while visible. Refreshing table plus statistics every 30 seconds uses four requests/minute before detail requests. Pause when hidden, navigating older pages, unauthorized, or rate-limited. Debounce inputs or use an Apply button. Cancel superseded requests, and bound retries with backoff.

A browser CORS/network failure may provide no readable JSON body or status. Show a connection error separately from API errors. Disallowed origins can be blocked before the browser can read the backend's error response. Use the exact dashboard origin, including scheme and port, in backend configuration.

## 9. Frontend TypeScript contracts

```ts
export type HttpMethod =
  | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'OTHER';
export type LogOutcome = 'success' | 'failure' | 'denied' | 'aborted';
export type LogActor =
  | { type: 'anonymous' | 'system' }
  | {
      type: 'user' | 'admin';
      id: string;
      identityModel: 'User' | 'Admin';
      role: 'user' | 'guest' | 'admin' | 'super-admin' | 'unknown';
    };

export interface SystemLog {
  logId: string;
  schemaVersion: 1;
  occurredAt: string;
  requestId: string;
  service: string;
  environment: string;
  kind: 'request';
  action: 'http.request';
  level: 'info' | 'warn' | 'error';
  outcome: LogOutcome;
  actor: LogActor;
  error?: { code: string };
  http: {
    method: HttpMethod;
    route: string;
    statusCode: number;
    durationMs: number;
    completed: boolean;
  };
}

export interface LogListQuery {
  from?: string;
  to?: string;
  requestId?: string;
  method?: HttpMethod;
  statusCode?: number;
  statusGroup?: '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
  route?: string;
  outcome?: LogOutcome;
  minDurationMs?: number;
  limit?: number;
  after?: string;
}

export interface LogStatisticsQuery {
  from?: string;
  to?: string;
  method?: HttpMethod;
  route?: string;
  slowThresholdMs?: number;
}

export interface LogPage {
  items: SystemLog[];
  pageInfo: { hasNextPage: boolean; nextCursor: string | null };
}

export interface LogStatistics {
  from: string;
  to: string;
  slowThresholdMs: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  completedRequests: number;
  abortedRequests: number;
  deniedRequests: number;
  slowRequests: number;
  clientErrorRequests: number;
  serverErrorRequests: number;
  averageDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string };
```

The query types use numbers for frontend convenience; serialize them as query strings. Enforce mutual exclusion of status code/group in form logic. These compile-time types do not validate untrusted runtime JSON.

## 10. Fetch client example

The following code uses the types above and browser Fetch. Supply the backend origin and current access token from the dashboard's existing session management. It deliberately leaves refresh-token handling to that existing layer.

```ts
export class SystemLogsApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId: string | null,
    public retryAfter: string | null,
  ) {
    super(message);
    this.name = 'SystemLogsApiError';
  }
}

export function createSystemLogsClient(
  origin: string,
  getAccessToken: () => string,
) {
  const base = '/api/v1/admin/system-logs';

  async function get<T>(
    path: string,
    query: LogListQuery | LogStatisticsQuery,
    signal?: AbortSignal,
  ): Promise<{ data: T; requestId: string | null }> {
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(query)) {
      // Preserve zero, which is valid for minDurationMs.
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `admin ${getAccessToken()}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal,
    });
    const requestId = response.headers.get('X-Request-Id');
    const retryAfter = response.headers.get('Retry-After');
    let body: ApiResult<T>;
    try {
      body = await response.json();
    } catch {
      throw new SystemLogsApiError(
        response.status, 'INVALID_RESPONSE',
        'The server returned an unreadable response', requestId, retryAfter,
      );
    }
    if (!response.ok || body.success !== true) {
      throw new SystemLogsApiError(
        response.status,
        body.success === false ? body.code : 'INVALID_RESPONSE',
        body.success === false ? body.message : 'Unexpected server response',
        requestId, retryAfter,
      );
    }
    return { data: body.data, requestId };
  }

  return {
    list: (query: LogListQuery = {}, signal?: AbortSignal) =>
      get<LogPage>(base, query, signal),
    statistics: (query: LogStatisticsQuery = {}, signal?: AbortSignal) =>
      get<LogStatistics>(`${base}/statistics`, query, signal),
    details: (logId: string, signal?: AbortSignal) =>
      get<SystemLog>(`${base}/${encodeURIComponent(logId)}`, {}, signal),
  };
}
```

Network failures and cancellation reject Fetch directly. Treat `AbortError` as cancellation rather than an error notification. If the project requires runtime validation, validate the decoded envelope and data before returning them.

Example first page and next page:

```ts
const client = createSystemLogsClient(apiOrigin, getCurrentAdminAccessToken);
const filters: LogListQuery = { limit: 25, statusGroup: '5xx' };
const first = await client.list(filters);
const cursor = first.data.pageInfo.nextCursor;
if (first.data.pageInfo.hasNextPage && cursor) {
  const next = await client.list({ ...filters, after: cursor });
  // Append next.data.items, deduplicating by logId.
}
```

Build statistics parameters explicitly; do not spread list filters:

```ts
const statisticsQuery: LogStatisticsQuery = {
  from: filters.from,
  to: filters.to,
  method: filters.method,
  route: filters.route,
  slowThresholdMs: 1000,
};
const stats = await client.statistics(statisticsQuery);
```

The two examples above intentionally allow server-default dates; for synchronized table/cards, use one explicit date range for both calls. They still execute independently.

## 11. Recommended dashboard behavior

### Layout

1. Title, explanatory subtitle, last successful refresh time, and Refresh button.
2. Shared time range, method, and exact route controls.
3. Statistics cards: total, success rate, failed, aborted, average latency, p95 latency; optional denied, slow, p50, p99, maximum, 4xx and 5xx cards.
4. Table-only controls: request ID, status code/group, outcome, minimum duration, page size.
5. Table columns: time, method, route template, status, outcome/completion, duration, actor, request ID, details action.
6. Load-more control and detail drawer.

Use visible text with status colors and accessible labels for copy buttons. Render route/error/actor strings as text, never injected HTML. Preserve the distinction between anonymous, system, and identified actors; show actor ID and role without inventing names.

### State management

Maintain draft filters separately from applied filters. Validate before Apply. Keep list, statistics, and detail loading/error states independent: a statistics outage should not hide a successful table response.

On filter changes, cancel outstanding requests and reset pagination. Also use a request-generation counter or equivalent stale-response guard: a slow response for old filters must not replace newer results. Disable duplicate load-more requests while one is in flight.

Show distinct states for initial loading, empty results, populated results, loading more, partial refresh failure, unavailable storage, denied access, expired detail, and rate-limit cooldown. If keeping old rows after a failed refresh, mark them stale and preserve their last successful refresh timestamp. Never convert a 503 into “No logs found.”

Keep logs in transient UI memory. Do not persist log payloads or access tokens into URLs, analytics, local storage, or service-worker caches for this screen. Clear loaded records and pending requests on logout/account change. Use the dashboard's established secure token handling.

### Request-ID troubleshooting flow

Read `X-Request-Id` from an API response that a user reports as failed. Paste that UUID into the System Logs request-ID filter, choose a range covering the incident, and apply. A request-ID lookup still uses the date filter; the default last 24 hours will not find older retained events. An absent row can also result from disabled ingestion, delayed persistence, expiry, or dropped diagnostics.

The logs reader's own requests can generate request logs. Frequent refreshing can therefore contribute records to later queries. The backend supplies no exclusion filter for the viewer itself.

## 12. Backend configuration and data availability

These are server-side settings. Never ship their values to the browser.

| Setting | Integration relevance |
| --- | --- |
| `SYSTEM_LOGS_ENABLED=true` | Enables ingestion and reads; otherwise authenticated reader requests receive 503 |
| `SYSTEM_LOGS_MONGO_URI` | Dedicated log database connection URI; required when enabled |
| `SYSTEM_LOGS_CURSOR_SECRET` | At least 32 bytes; use cryptographically random material; required when enabled |
| `SYSTEM_LOGS_RETENTION_DAYS` | Integer 1–90, default 14; affects newly ingested events |
| `SYSTEM_LOGS_REDIS_URL` | Required when enabled with `NODE_ENV=production`; shared rate store for multiple processes |
| `LOG_STDOUT_ENABLED` | `false` mutes structured stdout independently of persisted request logs |
| `CORS_ORIGINS` | Comma-separated exact allowed dashboard origins |

Provision indexes using `npm run system-logs:indexes` with appropriate backend credentials. Cursor secrets must match across replicas; rotation invalidates existing cursors. A secret shorter than 32 bytes prevents enabled System Logs startup. Generate secrets on the backend, for example with Node's `crypto.randomBytes(32).toString('hex')`; do not use a literal example as a deployed secret.

Persistence runs asynchronously, with batches of up to 100 records per one-second tick and a bounded queue of 2,000 records or 8 MiB. Requests do not wait for persistence. Outages, queue overflow, process crashes, or shutdown deadlines can lose events. There is no guaranteed ingestion-latency SLA, historical stdout backfill, or completeness indicator in the API.

Only terminal `request/http.request` events are persisted. Startup/shutdown operational events and standalone `http.error` events are not separate reader records. Optional error codes may be attached to terminal request records.

Expiry is based on event time. Readers exclude expired records immediately; MongoDB TTL deletion happens asynchronously. Retention changes affect new records, not all existing records. There is no public log-writer health endpoint: deployment monitoring must use the backend's process-local `systemLogHealth()` separately.

## 13. Frontend acceptance checklist

- Super Admin can load list, statistics, and detail; ordinary Admin sees access denied.
- Requests use `Authorization: admin <access-token>` and existing session recovery.
- Empty list and unavailable storage have different UI states.
- Every documented filter serializes correctly; zero minimum duration is preserved.
- Status code/group cannot be combined; invalid numeric/date inputs are blocked locally.
- Exact route templates, including `<unmatched>`, are URL-encoded and rendered as text.
- Detail uses `logId`; incident search uses `requestId`.
- Pagination preserves filters/limit, handles equal timestamps, and resets on filter changes.
- Expired/invalid cursor offers a fresh traversal without a retry loop.
- Aborted status-200 rows appear incomplete, not successful.
- Missing `error` and anonymous/system actors render without crashes.
- Statistics receive only their supported filters and show their scope clearly.
- Failed/denied/aborted metrics are not double-counted; zero totals do not cause division by zero.
- Detail 404, API 400/401/403/429/503, unreadable responses, and network failures have appropriate states.
- Rapid filter changes cannot show stale responses; canceled requests do not show error toasts.
- Refresh respects visibility, pagination, shared budgets, and cooldowns.
- Cross-origin requests can read `X-Request-Id`; rate-limit handling works without readable retry headers.
- Logout/account switching clears logs and cancels requests.

Backend regression commands: `npm run test:system-logs` and `npm run build`. Environment-gated database tests need a disposable `MONGO_TEST_URI`; consult the operations guide before running integration fixtures.

## 14. Source-of-truth map

| Concern | Source |
| --- | --- |
| Mount path and middleware order | [app.controller.ts](../src/app.controller.ts) |
| Routes, limits, fixed errors | [system-log.routes.ts](../src/Modules/system-log/system-log.routes.ts) |
| Response envelopes | [system-log.controller.ts](../src/Modules/system-log/system-log.controller.ts) |
| Query validation | [system-log.validation.ts](../src/Modules/system-log/system-log.validation.ts) |
| Date defaults, pagination, authorization checks | [system-log.service.ts](../src/Modules/system-log/system-log.service.ts) |
| Cursor signing and expiry | [system-log.cursor.ts](../src/Modules/system-log/system-log.cursor.ts) |
| Response projection | [system-log.dto.ts](../src/Modules/system-log/system-log.dto.ts) |
| Metric formulas and database queries | [system-log.repository.ts](../src/DB/repository/system-log.repository.ts) |
| Stored schema and indexes | [system-log.model.ts](../src/DB/models/system-log/system-log.model.ts) |
| Outcome, completion, and route capture | [request-logging.middlewares.ts](../src/Middlewares/request-logging.middlewares.ts) |
| Token scheme and verification | [admin.token.ts](../src/Modules/admin/admin.token.ts) |
| CORS exposure | [cors.ts](../src/Utils/middleware/cors.ts) |
| Server configuration | [system-log.config.ts](../src/Utils/logging/system-log.config.ts) |
| Focused behavior tests | [system-log.test.cjs](../tests/system-log.test.cjs) |
