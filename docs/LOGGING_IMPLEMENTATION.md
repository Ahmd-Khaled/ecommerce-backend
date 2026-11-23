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

## Remaining implementation

1. Complete mounted route/job/script inventory and per-action schemas; instrument security decisions, semantic outcomes and authenticated reads.
2. Add audit and outbox collections, indexes, repositories, transactional writers and MongoDB polling with leases, retry, deduplication and recovery. Prove rollback behavior with a disposable replica set before enforcement.
3. Integrate mandatory outbox persistence into each business transaction, including explicit credential/session consistency boundaries. Completion logging must never substitute for a committed business event.
4. Add the super-admin-only audit reader, bounded pagination and nonrecursive access auditing.
5. Propagate initiating context through email, payments, uploads and operator scripts; migrate remaining console calls.
6. Add independent health/metrics, retention, capacity/backpressure, operator replay, shutdown draining, alert ownership and recovery runbooks. Evaluate the production transport and measure staging load/failure budgets.

There are no audit collections to recover or replay in this initial phase. Do not enable or advertise mandatory audit enforcement until transaction integration and the plan's failure-injection acceptance tests pass.
