# Frontend and dashboard logging integration plan

Status: proposed; documentation only. This backend repository does not contain a customer frontend or an admin dashboard, so implementation belongs in the corresponding frontend repositories.

Prepared against the backend logging foundation described in [LOGGING_IMPLEMENTATION.md](LOGGING_IMPLEMENTATION.md) and the broader [logging system plan](LOGGING_IMPLEMENTATION_PLAN.md).

## 1. Which application should implement this?

Implement shared API request correlation and safe error handling in **each frontend that calls this backend**. Add admin activity or audit log screens only to the **admin dashboard**. A customer storefront should not receive access to administrative logs, and browser-side events cannot replace backend audit records.

The current workspace contains only the ecommerce backend. Confirm the actual frontend and dashboard repository names, frameworks, API clients, and deployment origins when applying this plan there; do not assume the two UIs share code or deployment configuration.

## 2. Current backend contract and limitations

- The backend middleware generates `X-Request-Id` for each HTTP request and emits a structured request completion/abort event.
- The client must treat the response request ID as a support and diagnostic correlation value. Do not generate a replacement and claim it identifies the backend event.
- The backend does not currently expose a durable audit-log reader API. The proposed `/api/v1/admin/audit-logs` endpoints in the broader plan are future backend work, not usable endpoints today.
- The request log's current `http.route` value is a router-relative Express template and is not yet a complete operation inventory.
- No frontend change can observe a user's browser action that did not result in an API call, and a UI success/failure alone cannot establish whether a business transaction committed.

## 3. Frontend integration goals

1. Ensure API responses expose `X-Request-Id` to browser clients through CORS (`Access-Control-Expose-Headers`) for every deployed frontend origin.
2. Capture the response request ID in the shared API client and make it available to error handling and support diagnostics.
3. Keep UI telemetry separate from backend operational and audit logs, with explicit event allowlists and privacy controls.
4. If a super-admin audit viewer is later delivered, build it against the finalized backend contract and preserve backend authorization as the security boundary.

## 4. Phase A: API correlation in customer frontend and dashboard

Apply this phase to both applications independently, or to a genuinely shared API client package if one exists.

### API client behavior

- Add a response interceptor/wrapper to the single shared HTTP client, covering successful and failed responses.
- Read `X-Request-Id` from the response headers. Header names are case-insensitive; handle a missing or inaccessible header without failing the original request.
- Attach the ID to the normalized client error object as `requestId` (and optionally expose it through a request-scoped error context). Do not modify the backend's `X-Request-Id` or use a client-supplied value as trusted identity.
- On network errors with no HTTP response, mark the request ID unavailable. Do not report this automatically as a backend failure: the request may not have reached the service.
- Preserve existing response parsing, auth refresh, retry, cancellation, and upload/download behavior. Ensure interceptors do not consume or serialize response bodies.
- Avoid logging tokens or headers when reporting errors. Authentication refresh retries should retain the actual response ID associated with each attempt; do not merge IDs into a fabricated trace.

### User-facing support diagnostics

- On an error screen/toast where support follow-up is useful, display a concise message such as “Reference: <requestId>” when present.
- Provide a copy action only if it fits the existing UI. Do not show stack traces, backend exception messages, raw URLs, query values, or implementation details.
- Keep normal successful requests quiet in the UI. Request IDs support diagnostics; they are not user-visible activity history.

### Browser telemetry (optional and separate)

- First inventory existing analytics/error-reporting SDKs. Prefer extending an approved existing service rather than adding a second telemetry pipeline.
- If adding browser events, use a small allowlisted schema: event name, UI area, coarse outcome, timestamp, and backend request ID when available.
- Do not collect form values, request/response bodies, auth state, email/phone/address, payment details, raw query strings, tokens, or unredacted URLs.
- Treat browser telemetry as best-effort diagnostics only. Do not label it a security audit trail or use it as proof of a committed server-side change.
- Set access, retention, consent, and environment rules in the owning frontend product before enabling telemetry in production.

## 5. Phase B: Admin dashboard audit viewer (after backend API exists)

This phase applies to the admin dashboard only and must wait until backend audit storage, reader endpoints, policy, and response schema are implemented and documented.

### Required backend contract before UI work

Agree on the endpoint path, event schema/version, cursor pagination, maximum page size, supported filters, date boundaries, retention behavior, and error response format. Backend policy should enforce super-admin access, bounded queries, rate limits, no-store responses, and auditing of viewer access. The UI must not be the authorization control.

### Dashboard capabilities

- Add a clearly access-restricted audit log page for authorized super-admin users.
- Support only backend-allowlisted filters such as time range, action, outcome, actor, target, and request ID. Use cursor pagination; do not fetch all records or construct arbitrary database filters.
- Show event time, actor type/role, action, outcome, target, request ID, and safe metadata. Render metadata as text, never as trusted HTML.
- Make sensitive values, diagnostic stacks, credentials, and raw transport data unavailable in the UI even if accidentally returned. Ask the backend to omit them as the primary protection.
- Include loading, empty, invalid-filter, expired-cursor, forbidden, and service-error states. Show the server request ID for failed audit queries.
- Use `Cache-Control: no-store` semantics at the server and prevent client-side persistence in local storage, query caches, browser history, or analytics. Clear in-memory results on logout, identity change, or permission loss.
- Do not add edit, delete, bulk export, or cross-customer access features unless a separately approved backend policy supports them.

## 6. Authentication, deployment, and browser security

- Continue to use the existing customer/admin authentication and refresh flows. Never place secrets in telemetry, console output, URLs, or frontend storage for the purpose of logging.
- Verify that each deployed origin is explicitly permitted by backend CORS and that `X-Request-Id` is exposed. A response header not exposed by CORS will appear missing to browser JavaScript even when the browser received it.
- Do not accept a client-generated request ID as authoritative. If future distributed tracing introduces a trace header, specify validation, trust boundaries, and response behavior with the backend first.
- Restrict production telemetry configuration to public, nonsecret identifiers. Do not put logger sink credentials or HMAC keys in frontend environment variables.

## 7. Suggested delivery sequence

1. Identify the customer frontend and admin dashboard repositories and their shared API-client ownership.
2. Confirm CORS origins and response-header exposure for deployed environments with the backend owner.
3. Implement response request-ID capture and safe error normalization in each applicable API client.
4. Add the optional reference ID to existing support-facing error UI.
5. Review any existing client telemetry for PII and align or disable unsafe capture; keep this separate from audit logging.
6. Wait for the backend audit reader contract, then implement and security-review the dashboard audit page.
7. Verify staging behavior before production release, including browser CORS visibility, expired sessions, failed requests, and missing IDs.

## 8. Acceptance criteria

- For a successful API response and an HTTP error response, browser code can read the backend `X-Request-Id` when the response includes it and CORS exposes it.
- Normalized client errors carry the associated ID without changing established error handling or retry behavior.
- Network errors without a response are represented as transport/client failures with no fabricated request ID.
- Logs and telemetry contain no credentials, request/response bodies, personal form data, payment details, raw query values, or unredacted URLs.
- Customer-facing code has no route or credential path to administrative audit records.
- The dashboard audit page is not released before backend endpoints and super-admin policy are implemented and reviewed.
- Audit UI results are not cached persistently and are removed on logout or identity change.

## 9. Work that remains backend-owned

- Expose `X-Request-Id` through CORS for the exact frontend origins and environments.
- Complete stable mounted route/action classification and finish the backend request/audit coverage work.
- Implement durable audit/outbox storage and the proposed super-admin reader endpoints before dashboard integration.
- Define retention, metadata schema, authorization, rate limits, and failure behavior as an authoritative API contract.

## 10. Repository handoff checklist

When moving this plan to implementation repositories, add links to their shared API-client source, customer error UI, dashboard routing/access policy, CORS environment configuration, and telemetry settings. Record the backend API contract version used by the audit viewer. Update this plan when those repositories and integration decisions are known.
