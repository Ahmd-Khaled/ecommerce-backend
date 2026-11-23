# Logging system implementation plan

Status: proposed; documentation only. No logging code, dependencies, database collections, endpoints, or configuration are implemented by this document.

Prepared against the current backend routes on 2026-11-22.

## 1. Goal and scope

Provide traceable records of all customer, admin, and super-admin operations: who acted, what operation they attempted, which resource was affected, when it happened, and whether it succeeded, failed, was denied, or changed nothing. Include reads, authentication, validation failures, authorization failures, and automated work triggered by these operations.

Preserve existing authorization and API behavior except where the durable audit policy below deliberately requires a mutation to fail before committing. Public requests remain anonymous unless an existing authentication middleware verifies an identity; logging must not introduce authentication requirements on public routes.

This plan covers backend-observable activity. Browser clicks that never call the API, direct database edits, and external provider actions outside this backend require separate instrumentation and cannot be claimed as covered.

## 2. Current baseline

- Express/TypeScript, Mongoose/MongoDB, and Redis/BullMQ email jobs are already present.
- `src/app.controller.ts` mounts API routers, media serving, body parsers, rate limiters, and the global error handler. Payment webhooks use a raw body before JSON parsing.
- `src/Utils/response/error.response.ts` formats errors but does not currently provide structured request logging.
- Startup, database, email, OTP monitoring, payments, and upload cleanup contain scattered console logging.
- Customers belong to `User`; administrators belong to `Admin`. Their IDs and credentials must never be treated as interchangeable. Admin roles are `admin` and `super-admin`; customer roles include `user` and `guest`.
- Customer management is mounted at both `/api/v1/users` and `/api/v1/admin/users`; both aliases require coverage without creating duplicate business events.
- Customer reviews are mounted under `/api/v1/products`; administrative reviews are mounted under `/api/v1/admin/reviews`.

Source references: [administrator policy](ADMIN.md), [authentication lifecycle](auth/authentication-lifecycle.md), [architecture](ARCHITECTURE.md), and [application composition](../src/app.controller.ts). Route and service behavior remains the source of truth where older documentation differs.

## 3. Logging architecture

Use three complementary record types with shared correlation identifiers:

| Record      | Purpose                                                                                            | Proposed destination                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Request     | One completion/abort record for every incoming HTTP request, including reads and rejected requests | Structured JSON on stdout, collected by deployment infrastructure                       |
| Audit       | Business actions, authenticated sensitive reads, security decisions, and state transitions         | Dedicated MongoDB audit collection; durable mutation events delivered through an outbox |
| Operational | Startup/shutdown, dependencies, worker execution, retries, cleanup, and unexpected exceptions      | Structured JSON on stdout, collected by deployment infrastructure                       |

Introduce a small typed logger interface and structured JSON implementation. Evaluate a maintained logging library during implementation against redaction, bounded serialization, asynchronous output, and existing CommonJS/TypeScript compatibility; this plan does not prescribe an unverified package version. Business services depend on the interface, not a particular transport.

Proposed flow:

1. Install request context and response lifecycle listeners before CORS, parsers, limiters, media, and routers.
2. Generate a server request ID and return it as `X-Request-Id`; keep bounded, validated upstream trace IDs separately. Use request-local context, such as AsyncLocalStorage, to avoid cross-request identity leakage.
3. Authentication attaches a verified identity and role to context. Never decode an unverified token merely to identify the actor.
4. Route metadata supplies a stable operation key. Guards record denial reasons; services record committed business outcomes.
5. The error handler produces a sanitized diagnostic once and attaches its stable error code to context.
6. The response listener emits exactly one request record on `finish`, or on `close` if completion never occurred. A disconnected client does not imply a business rollback.
7. Workers and operator scripts create their own execution context and retain the initiating request/event ID when available.

Preserve webhook raw bytes: logging must neither read nor reserialize the raw body before signature verification. Do not intercept response bodies or buffer uploads for logging.

## 4. Event contract

| Field                                       | Meaning and constraints                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`, `eventId`                  | Explicit schema version and server-generated unique event ID                                                                |
| `occurredAt`, `recordedAt`                  | UTC event time and persistence time; distinguish delayed delivery                                                           |
| `kind`, `level`, `service`, `environment`   | Request/audit/operational classification and deployment identity                                                            |
| `action`                                    | Stable name such as `user.password.change`, `admin.user.freeze`, or `review.restore`                                        |
| `outcome`, `reasonCode`                     | `success`, `failure`, `denied`, `noop`, or `aborted`; bounded internal reason code                                          |
| `actor`                                     | Type `user`, `admin`, `anonymous`, `system`, or `operator`; verified ID, identity model, and role snapshot where applicable |
| `target`                                    | Resource type and validated resource ID, distinct from the actor                                                            |
| `requestId`, `correlationId`, `causationId` | Request, workflow, and triggering-event linkage                                                                             |
| `http`                                      | Method, route template, status code, duration, response completion state                                                    |
| `changes`                                   | Allowlisted field names; before/after values only for approved nonsensitive fields                                          |
| `metadata`                                  | Per-action typed and size-bounded safe values, such as item count or job attempt number                                     |
| `error`                                     | Stable code/class; sanitized stack only in restricted operational output                                                    |
| `expiresAt`                                 | Retention deadline for stored audit records                                                                                 |

Use the normalized route template rather than a raw URL. For unknown routes, use an unmatched-route marker; never retain arbitrary attacker-controlled paths or query strings. A malformed target ID stays absent rather than entering metadata as raw input.

Record the actor's role at event time, so later role changes do not rewrite history. A super-admin performing a normal catalog operation uses the same action name with a `super-admin` role snapshot. A system job retains an optional initiating actor reference without pretending that the customer directly executed the job.

Login failure records remain anonymous unless identity verification has completed. If account-based failure correlation is needed, use a keyed HMAC of a normalized submitted identifier, with restricted access and key rotation; do not log raw email or use an unkeyed email hash.

## 5. Complete operation coverage

All prefixes below are relative to `/api/v1`, except `/media` and `/test`. Every route receives a request record. The following operation families also receive semantic audit records for authenticated reads, security events, and mutations. Public reads use request records without adding a second audit entry unless a security event occurs.

### Customer and public operations

| Module / routes                                                                                              | Events to cover                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/register`                                                                                             | Registration attempt/result and account creation; confirmation delivery recorded separately                                                          |
| `/auth/confirm-email`, `/auth/resend-confirm-email`                                                          | Confirmation, invalid/expired OTP, exhausted attempts, resend cooldown/window denial, delivery enqueue result                                        |
| `/auth/login`, `/auth/google`, `/auth/google/link`                                                           | Password/Google login, Google account creation, explicit provider link, duplicate/conflicting link, inactive/unconfirmed account denial              |
| `/auth/refresh-token`                                                                                        | Rotation, expiry/revocation rejection, replay detection and resulting session invalidation                                                           |
| `/auth/logout`, `/auth/logout-all`, `/auth/change-password`, `/auth/forgot-password`, `/auth/reset-password` | Current/all-session logout, password change, reset request, reset consumption, OTP failures; distinguish request acceptance from actual state change |
| `/auth/profile` GET/PATCH                                                                                    | Profile read/update, avatar replacement, changed field names without profile values                                                                  |
| `/auth/test-revoke`                                                                                          | Development-only revocation and denial outside development; logging must not enable the endpoint                                                     |
| `/addresses` and `/:addressId`, `/:addressId/default`                                                        | List, create, edit, delete, default selection; record IDs and field names, never address contents                                                    |
| `/cart`, `/cart/items`, item quantity/increase/decrease/remove routes, `/cart/clear`                         | Read, add, set/increase/decrease quantity, remove, clear; stock/limit conflicts and actual quantity changes                                          |
| `/wishlist`, `/wishlist/items`, `/wishlist/items/:productId`                                                 | List, item-state lookup, add/remove; duplicate add or missing-item removal classified according to actual no-op behavior                             |
| `/orders/checkout`, `/orders`, `/:orderId`, `/:orderId/cancel`                                               | Checkout, order list/detail, cancellation, eligibility/stock conflicts, idempotent replay; correlate cart and stock consequences                     |
| `/payments/checkout`, `/payments/orders/:orderId`                                                            | Checkout initiation and payment-state read; provider attempt/result, ownership denial, retry/no-op                                                   |
| `/products/reviews/me`, `/products/reviews/me/:reviewId`, `/products/:productId/reviews`                     | Own-review list, create/edit/withdraw, public review list, eligibility/rate/duplicate denial                                                         |
| Public product list/detail/slug/category routes                                                              | Catalog browsing, optional verified customer identity where the existing router supports it                                                          |
| Public category list/active/root/tree/slug/children/subtree routes                                           | Category browsing and validation failures                                                                                                            |
| `/home`, `/home/products`, `/banners/list`, `/media`, `/test`                                                | Public reads, media misses/denials, aborted transfers, health/test requests                                                                          |

Respect the existing customer role guards, including any guest access they allow. Logging cannot promote a guest or grant an administrator access to customer-only APIs.

### Admin and super-admin operations

| Module / routes                                                 | Events to cover                                                                                                                           | Existing actor policy              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `/admin/auth/login`, `/refresh-token`, `/logout`, `/logout-all` | Authentication, refresh rotation/replay, current/all-session invalidation                                                                 | Admin identity after verification  |
| `/admin/auth/profile`, `/change-password`                       | Self-profile read/edit, password change, session invalidation                                                                             | Admin and super-admin              |
| `/users` and `/admin/users`, including `/:id` and `/:id/status` | Customer list/detail/create/update/freeze/unfreeze/delete, role/status changes if allowed by the service, associated session invalidation | Existing customer-management guard |
| `/products` administrative GET/POST/PATCH/DELETE                | List, create, edit, delete, stock/price/visibility changes, media changes                                                                 | Admin and super-admin              |
| `/categories` administrative GET/POST/PATCH/DELETE              | List/detail, create/edit/delete, hierarchy/visibility/media changes                                                                       | Admin and super-admin              |
| `/banners` administrative GET/POST/PATCH/DELETE                 | List/detail/create/edit/delete, schedule/order/visibility/media changes                                                                   | Admin and super-admin              |
| `/orders/admin`, `/orders/admin/:orderId`, `/:orderId/status`   | Order list/detail, fulfillment transition, invalid transition denial, stock/payment consequences                                          | Admin and super-admin              |
| `/dashboard/overview`, `/sales`, `/top-products`                | Sensitive business-report access; retain filter field names and result count, not report contents                                         | Admin and super-admin              |
| `/admin/reviews`, `/settings`, `/:reviewId/state`               | Moderation list, settings read/change, review moderation, aggregate-rating consequences                                                   | Admin and super-admin              |
| `/admin/reviews/:reviewId/restore`                              | Restoration attempt/result and rating consequences                                                                                        | Super-admin only                   |
| `/admin` and `/:id`, `/:id/status`                              | Administrator list/detail/create/edit, role grant/change, freeze/unfreeze, soft deletion, session invalidation                            | Super-admin only                   |

Explicitly record attempts blocked by self-management restrictions, protected super-admin rules, wrong identity type, insufficient role, frozen/deleted account state, and resource ownership. Logs describe current authorization policy; they do not relax it.

### Automated and operator operations

- Payment webhook: receipt, signature rejection, verified provider event ID, duplicate/out-of-order delivery, processing outcome, order/payment transition. Treat the provider as a system actor, never as an authenticated customer.
- Email queue: enqueue success/failure, execution attempt, retry, sent, expired OTP/unrecoverable job, final failure. Link to the initiating event without copying job payloads or recipient addresses.
- Upload lifecycle: validation rejection, staging, finalization, replacement/deletion, compensation and orphan cleanup, using safe internal asset references.
- Database/Redis/SMTP/payment/storage dependencies: availability changes, timeouts, recovery, bounded retry counts.
- Startup/shutdown and upload reconciliation: execution ID, start/completion/failure, duration, counts.
- Admin bootstrap/migration, order audit, and review reconciliation scripts: operator context, dry-run/apply mode, run ID, per-resource committed effects and totals. Operator attribution must come from trusted execution identity, not a claimed admin ID supplied by input.
- Direct database maintenance requires a separate restricted operational audit trail; application logs alone cannot observe it.

## 6. Accuracy, durability, and failure policy

Request completion and business success are separate facts. A 2xx response is insufficient proof of a committed mutation; a 500 or disconnected client can occur after a commit. Emit domain success only from the service's confirmed commit boundary.

For persisted mutations, write a sanitized audit outbox event in the same MongoDB transaction as the business change. Reuse existing transaction sessions and extend nontransactional mutation paths during implementation. Do not wrap external provider calls or email sends inside a MongoDB transaction. Persist intent/results around external side effects and reconcile ambiguous timeouts using existing business idempotency rules.

The outbox dispatcher upserts the final audit record by unique `eventId`, then marks delivery complete. A crash between those steps must safely retry. Delivery is at least once; uniqueness provides one stored event, not a claim of exactly-once processing. Generate stable operation/event IDs outside transaction retry callbacks and distinguish a repeated HTTP attempt from a repeated business effect.

| Failure                                                      | Required behavior                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Outbox write fails before a business mutation commits        | Roll back the transaction and return a controlled unavailable error; never commit an unaudited mutation                |
| Audit destination/dispatcher unavailable after outbox commit | Preserve committed result, retain pending event, alert and retry with bounded backoff                                  |
| Redis unavailable                                            | Audit durability must still rely on MongoDB outbox; Redis may wake workers but is not the only copy                    |
| Read/security-attempt audit write fails                      | Preserve intended read or denial response; emit sanitized fallback to operational sink and increment loss metric       |
| Operational/request sink unavailable                         | Do not crash request handlers; bounded buffers, dropped-record counters and alerts; no unbounded memory or disk growth |
| External effect succeeds but local finalization fails        | Record/reconcile the uncertain operation; do not mislabel it as rolled back or retry an unsafe effect blindly          |

No-op mutations produce a no-op event without fabricating a state change. Login/session issuance and token invalidation need explicit service boundaries: persist required audit state before returning credentials; never store credentials in that event. Failed login attempts and reads cannot be guaranteed lossless during a total sink outage; document and monitor this limitation.

Preserve mandatory audit writes when disabling verbose diagnostics or rolling back an audit reader. Require a replica-set-capable MongoDB deployment before enabling transaction-dependent audit enforcement. Stop accepting enforced mutations if deployment prerequisites are missing.

## 7. Privacy and safe serialization

- Never log passwords/hashes, OTPs/hashes, JWTs, refresh cookies, authorization/cookie headers, reset state, Google ID tokens or subject, webhook signatures/secrets, API keys, connection strings, or environment dumps.
- Never log request/response bodies wholesale, payment tokens/card data, email job payloads, uploaded bytes, original filenames, personal addresses, phone numbers, or free-text review/profile content.
- Use allowlisted metadata per event. Field-name changes are usually sufficient; permit before/after values only for nonsensitive status, role, quantity, price/currency, or configuration fields.
- Omit raw query values and full referer URLs. Store approved filter names, pagination limits, or bounded date ranges only when useful.
- Default to truncated or keyed-pseudonymous IP data. Derive client IP only with an explicitly configured trusted proxy policy; arbitrary forwarded headers are not authoritative. Bound and sanitize user-agent data if retained.
- Sanitize nested errors, causes, driver/provider messages, arrays, circular objects, control characters, and oversized fields before serialization. Set a proposed maximum encoded event size of 16 KiB; reject unsafe metadata, not the underlying operation, before entering the durable write step.
- Separate restricted operational stack traces from audit API responses. Redaction applies in development and tests too.
- IDs and pseudonymous identifiers still require restricted access and retention. Preserve an explicit deletion/anonymization procedure for customer-related records without silently rewriting security history.

## 8. Storage, querying, and access

Proposed MongoDB collections: `audit_events` and `audit_outbox`. The normal application audit writer can insert events but cannot update/delete audit history; dispatcher and retention responsibilities use separate narrowly scoped credentials where deployment permits. An application-level append-only convention is not tamper-proof against database operators. Export to independently controlled immutable storage only if that assurance is required.

Proposed audit indexes:

- Unique `eventId`.
- `{ occurredAt: -1, _id: -1 }` for stable cursor pagination.
- `{ 'actor.identityModel': 1, 'actor.id': 1, occurredAt: -1 }`.
- `{ 'target.type': 1, 'target.id': 1, occurredAt: -1 }`.
- `{ action: 1, outcome: 1, occurredAt: -1 }` and `{ requestId: 1 }`.
- TTL on `expiresAt`, with retention exclusions handled explicitly; TTL expiry is asynchronous.

Outbox indexes support unique event IDs and pending retry scheduling. Never expire undelivered outbox records; expire delivered entries only after a recovery buffer. Validate index/storage cost with representative volume before rollout.

Proposed reader endpoints, to be implemented later:

| Endpoint                                | Policy                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/audit-logs`          | Super-admin only; bounded date range, cursor pagination, maximum 100 records, allowlisted actor/target/action/outcome/request filters |
| `GET /api/v1/admin/audit-logs/:eventId` | Super-admin only; sanitized detail, no stack traces or private transport metadata                                                     |

Place the literal audit route before `/admin/:id`. Ordinary admins and customers have no audit browsing access by default. Log successful audit reads and denied attempts; persist these through the writer without recursively auditing the writer itself. Rate-limit queries, set `Cache-Control: no-store`, and avoid unbounded regex or arbitrary database filters. No edit/delete endpoints and no bulk export in the initial scope.

## 9. Retention and operation

Proposed starting values, subject to product/security and storage review before implementation:

| Data                                                         | Proposed retention                              |
| ------------------------------------------------------------ | ----------------------------------------------- |
| Request/operational logs                                     | 30 days                                         |
| Customer activity audit                                      | 90 days                                         |
| Admin, super-admin, security, and payment state-change audit | 365 days                                        |
| Successfully delivered outbox events                         | 7 days after delivery                           |
| Undelivered outbox events                                    | Until resolved; alert on age and storage growth |

Use the longest applicable class when an event belongs to multiple classes. These are operational defaults, not legal retention claims. Include backups and any exports in deletion/retention policy. Estimate daily events, average bytes, indexes, replication and backup overhead before enabling unsampled traffic capture.

Proposed configuration: `LOG_LEVEL`, `LOG_SERVICE_NAME`, `LOG_MAX_EVENT_BYTES`, audit retention settings, outbox retry/batch settings, and a separately managed IP/identifier HMAC key. Never print configuration secrets. Authenticated activity and security/audit events must not be sampled. Any future sampling of anonymous reads must be an explicit scope change because this plan calls for all request operations.

Monitor request error rate/latency, authentication failures, authorization denials, refresh replay, privilege changes, audit write failures, pending outbox count/oldest age, delivery retries, dropped logs, and disk/storage growth. Use bounded labels rather than user IDs, request IDs, or raw paths as metric labels. Aggregate attack alerts to avoid notification floods while preserving individual event records.

Graceful shutdown stops new work and drains bounded log buffers within the existing shutdown deadline. Persisted outbox entries remain recoverable after restart; do not depend on shutdown flushing for mutation audit durability.

## 10. Proposed implementation files and phases

All paths below are future work, not files created by this plan.

1. **Define contracts and route inventory.** Add `src/Utils/logging/` for typed events, config, redaction, context and logger interfaces. Define a manifest mapping every mounted method/template to an action and coverage class, including aliases and nested routers. Establish per-action metadata schemas and failure policy.
2. **Add request and operational logging.** Add `src/Middlewares/request-logging.middlewares.ts`; wire it early in `src/app.controller.ts`, integrate sanitized errors, and replace scattered console calls in startup, database, email, payment, OTP and storage paths.
3. **Add durable audit infrastructure.** Add audit/outbox models under `src/DB/models/`, repositories under `src/DB/repository/`, and writer/dispatcher modules under `src/Utils/logging/`. Initialize indexes and lifecycle hooks; prove retry and rollback behavior before instrumentation relies on them.
4. **Instrument identity/security.** Cover customer/admin authentication, authorization and validation, account management, token revocation, Google linking, OTP and rate-limit outcomes. Keep authentication identity boundaries intact.
5. **Instrument commerce and reads.** Cover every operation in section 5 across addresses, cart, wishlist, catalog, banners, reviews, orders, payment and dashboard. Add transaction-compatible audit events and retain original initiator context through asynchronous work.
6. **Add restricted reader API.** Add `src/Modules/audit/` routes/controller/service/validation, mount before admin parameter routes, and audit its own access without recursion.
7. **Operational rollout.** Configure collection/retention, dashboards, alerts and runbooks; verify performance and failure injection in staging, then enable durable enforcement module by module. Do not claim full coverage until the route inventory is complete.
8. **Documentation handoff.** Update API, infrastructure, setup, and authentication/admin documentation with implemented behavior and actual configuration. Document outage recovery, pending-event replay, redaction incidents, and retention changes.

Do not backfill invented events for historical activity. Record the coverage start time and any migration/import provenance explicitly. If rollback is necessary, preserve outbox records and durable mutation auditing; roll back optional readers/diagnostics independently.

## 11. Validation and acceptance criteria

Use the existing Node test setup and disposable replica-set integration database for transactional checks.

- Route coverage checks compare the manifest with all mounted methods/templates; new routes without a classification fail the check. Include aliases, nested reviews, media, 404s, malformed JSON, limiter rejection and CORS failure paths.
- Identity tests distinguish a User and Admin with the same ID/email, invalid tokens, guests, ordinary admins, super-admins, revoked sessions, and anonymous requests. Concurrent requests must never share actor context.
- Privacy tests inject secrets in nested bodies, headers, errors, provider responses, filenames and job payloads and assert their absence from every output sink and reader response.
- Request lifecycle tests verify one final record for success, exception, early denial and abort. Committed mutations followed by response failure retain a successful domain event and a separate failed/aborted request record.
- Transaction tests prove business changes roll back when outbox insertion fails, emit no success for rolled-back work, survive dispatcher crashes, and deduplicate delivery after transaction/provider/job retries.
- Integration tests cover every customer/admin operation family, denied privilege changes, protected super-admin management, restore permissions, payment webhook signatures/replays and asynchronous email/upload outcomes.
- Reader tests verify super-admin-only access, bounded filters/cursors, stable pagination, no mutation endpoints, no secret exposure, and nonrecursive self-auditing.
- Retention/recovery tests verify pending events survive expiry/rollbacks, delivered expiry works, and outages generate metrics without unbounded queues or recursive errors.
- Load tests compare baseline and enabled logging for request latency, event loss, outbox lag, storage growth and redaction CPU cost. Agree on numeric capacity/latency budgets from staging measurements before production enablement.

Completion requires every current route and relevant job/script to have explicit coverage, every committed mutation to have a durable sanitized event, all authenticated reads and security decisions to be recorded under the stated outage policy, and documented operational ownership of alerts, retention and recovery. No implementation work is authorized by this document alone.

# New Added Section

# Reliability, Failure Handling & Operational Resilience

**Status:** Recommended architectural requirements  
**Purpose:** Define how the application behaves when request logging, operational logging, audit persistence, or audit delivery becomes unavailable.

## 1. Core Reliability Principles

The logging and audit infrastructure must never become an uncontrolled single point of failure for the application.

The implementation must follow these principles:

1. Request and operational logging must be non-blocking and fail-open.
2. Mandatory audit events must be durably persisted before committing the associated business operation.
3. Failure to deliver an already committed outbox event must never reverse a successful business transaction.
4. MongoDB Outbox must remain the source of truth for pending audit events.
5. Redis and BullMQ must not be the only mechanism responsible for audit event durability or recovery.
6. Audit failures must be observable through independent monitoring and alerting mechanisms.
7. Every failure path must have an explicit, predictable API response and recovery strategy.

## 2. Failure Policy Matrix

| Component                    | Failure Policy   | Expected Behavior                                          |
| ---------------------------- | ---------------- | ---------------------------------------------------------- |
| Request Logging              | Fail-Open        | Business requests continue                                 |
| Operational Logging          | Fail-Open        | Application continues operating                            |
| Mandatory Audit Outbox Write | Fail-Closed      | Abort the associated transaction                           |
| Optional Audit Write         | Fail-Open        | Preserve the original application response                 |
| Outbox Dispatcher            | Retry            | Keep events pending and retry delivery                     |
| Audit Read API               | Isolated Failure | Return a controlled error without affecting unrelated APIs |
| Security Attempt Logging     | Fail-Open        | Preserve the original security response                    |
| Redis / BullMQ               | Degraded Mode    | Continue durable recovery through MongoDB                  |

## 3. Mandatory Audit Transaction Boundary

For business operations requiring mandatory audit records, the business mutation and outbox event must be committed atomically.

Example:

```text
BEGIN TRANSACTION
       |
       v
Update Business Resource
       |
       v
Insert Mandatory Outbox Event
       |
       v
Both operations successful?
       |
   +---+---+
   |       |
  YES      NO
   |       |
   v       v
 COMMIT   ROLLBACK
   |       |
   v       v
 Return   Return
 Success  Controlled Error
```

Requirements:

- Both writes must participate in the same MongoDB transaction.
- The application must not commit a mandatory audited mutation if its corresponding outbox event cannot be persisted.
- The API must return a controlled service error, such as HTTP 503, when audit persistence is unavailable.
- The error response must not expose internal database details.
- Transactions require a MongoDB deployment supporting transactions, such as a replica set or appropriately configured sharded cluster.
- Transaction retries must respect MongoDB's transaction error labels and must not create duplicate business side effects.

## 4. Outbox Dispatcher Resilience

The dispatcher is responsible for delivering committed outbox events into the final audit collection.

Its failure must not affect an already committed business operation.

Requirements:

1. MongoDB Outbox remains the durable source of truth.
2. Failed events must remain available for retry.
3. Delivery must use bounded exponential backoff with jitter.
4. Delivery must be idempotent using a stable eventId.
5. The final audit collection must enforce a unique index on eventId.
6. A successful delivery must update the outbox event's delivery state.
7. A crash after writing the final event but before marking the outbox event as delivered must not create duplicate final audit records.
8. A scheduled polling/recovery mechanism must be available independently of Redis.
9. Redis/BullMQ may accelerate delivery but must not be the sole recovery mechanism.

Recommended event delivery states:

- pending
- processing
- delivered
- retry
- dead-letter

The implementation must include a recovery strategy for events left in processing after a worker crash.

## 5. Retry, Backoff and Dead-Letter Handling

The dispatcher must implement:

- Exponential backoff.
- Random jitter to prevent synchronized retries.
- Configurable maximum retry attempts or maximum retry age.
- A dead-letter state for events that repeatedly fail.
- Administrative visibility into failed and delayed events.
- A controlled replay mechanism for authorized operators.
- Alerting when pending event counts or event age exceed configured thresholds.

Dead-letter events must not be silently deleted.

Moving an event to dead-letter must preserve its original eventId and payload integrity.

## 6. Failure Isolation

Logging failures must be isolated from unrelated business functionality.

Requirements:

- Request logging must never delay or block the response waiting for a remote logging service.
- Operational logging must not throw unhandled exceptions into business request execution.
- Logging sink failures must be caught and handled safely.
- Audit read failures must remain isolated from unrelated APIs.
- Security-attempt logging failures must not change the original denial or authentication response.
- Optional logging failures must not cause a business transaction rollback.

The application must avoid recursive logging failures, where a logging failure triggers another failing logging attempt indefinitely.

## 7. Login and Session Security Boundaries

Authentication flows require explicit audit boundaries.

For operations requiring mandatory audit:

- Required audit persistence must complete before credentials are returned to the client.
- Token issuance, token invalidation, and session changes must follow an explicitly documented consistency strategy.
- Refresh tokens, access tokens, passwords, OTP values, and other secrets must never be stored in audit events.
- Failed login and denied authentication attempts should preserve their original security responses even if optional audit persistence fails.

The implementation must explicitly document which authentication events are mandatory and which are best-effort.

## 8. Health Checks and Monitoring

The application must expose separate health information for:

- Application process.
- MongoDB connectivity.
- Mandatory audit persistence capability.
- Outbox dispatcher.
- Outbox backlog.
- Redis/BullMQ availability, where applicable.

Readiness must reflect whether the application can safely perform its required operations.

A dispatcher outage should not automatically make the entire application unready if mandatory audit writes remain available and events can be durably queued.

Monitoring must include:

- Pending outbox event count.
- Oldest pending event age.
- Retry count.
- Dead-letter event count.
- Dispatcher processing rate.
- Audit persistence failures.
- Transaction aborts caused by mandatory audit failures.

Alerts must use an independent monitoring path rather than depending exclusively on the logging system being monitored.

## 9. Capacity, Backpressure and Retention

The implementation must define:

- Maximum outbox backlog thresholds.
- Maximum event payload size.
- Maximum dispatcher concurrency.
- Database connection and transaction timeouts.
- Retention policies for delivered and dead-letter events.
- Safe cleanup procedures.
- Backpressure behavior when the outbox approaches its capacity threshold.

Outbox cleanup must never remove pending, processing, retry, or undelivered events.

Retention periods must be configurable and aligned with business, security, and legal requirements.

## 10. Failure Scenario Acceptance Tests

The implementation is not considered complete until the following scenarios are tested:

| Scenario                                            | Expected Result                            |
| --------------------------------------------------- | ------------------------------------------ |
| Request log sink unavailable                        | API continues                              |
| Operational log sink unavailable                    | API continues                              |
| Mandatory outbox insert fails                       | Business transaction rolls back            |
| Dispatcher stops after business commit              | Business operation remains successful      |
| Redis unavailable                                   | MongoDB-based recovery continues           |
| Worker crashes during delivery                      | Event is recovered                         |
| Final audit insert succeeds but outbox update fails | Retry does not duplicate final event       |
| Duplicate event delivery                            | One final audit record                     |
| Audit collection unavailable                        | Pending outbox events remain recoverable   |
| Security-attempt logging fails                      | Original denial response is preserved      |
| Outbox backlog increases                            | Alert and recovery mechanisms activate     |
| Logging system itself fails                         | Independent monitoring reports the failure |

## 11. Implementation Acceptance Criteria

The implementation must satisfy all of the following:

- No mandatory audited business mutation can commit without its corresponding durable outbox event.
- No dispatcher failure can reverse an already committed business operation.
- No pending outbox event can be silently discarded.
- Duplicate delivery cannot create duplicate final audit records.
- Request and operational logging failures cannot crash or block business requests.
- Redis is not a single point of failure for audit durability.
- Recovery works after application and worker restarts.
- Failure scenarios are covered by automated integration tests.
- Health checks and alerts can identify audit persistence and delivery degradation.

**Final Reliability Rule:**

The application must protect business consistency without making the logging infrastructure a single point of failure.

Mandatory audit persistence protects critical business operations. Asynchronous delivery protects application availability. Independent monitoring protects observability.
