# Whole-project review plan

Status: proposed review roadmap. This document organizes a systematic code and behavior review; it does not claim that the project has already passed that review.

The repository is a TypeScript Express 5 and Mongoose ecommerce backend. The review should follow real request paths and persisted relationships, not infer behavior from filenames or older documents. Existing module guides and implementation plans remain the detailed references for their subjects.

## 1. Review outcome

Produce a verified picture of correctness, security, data integrity, and operational readiness across the API. For each finding, record the file/line, a reproducible scenario, impact, severity, and a proposed fix. Track confirmed defects separately from missing tests, documentation drift, and questions requiring product or deployment decisions.

The review is not a rewrite. Preserve established API contracts and business policy unless a demonstrated defect requires a deliberate change. Do not expose credentials from local environment files or perform destructive tests against a non-disposable database.

## 2. Start here

Start with the **Category model and module**, then follow one complete path through its route, validation, controller, service, repository, and tests.

Recommended entry points:

1. `src/DB/models/category/category.model.ts` and `category.interface.ts`
2. `src/Modules/category/category.routes.ts` and `category.validation.ts`
3. `src/Modules/category/category.controller.ts` and `category.service.ts`
4. `src/DB/repository/category.repository.ts` and `category.transaction.ts`
5. `tests/category.public.test.cjs`, `category.management.test.cjs`, `category.counts.test.cjs`, and `category.integration.test.cjs`
6. Compare findings with [Category API behavior](CATEGORY.md) and [Category implementation reference](category/README.md).

Category is a useful first module because it includes a model, public and admin routes, validation, parent/child relationships, visibility ancestry, deletion rules, aggregation, and guarded transactions. It is broad enough to establish a repeatable review method without beginning with checkout's cross-module transaction and payment complexity. Validate current source against its docs; do not assume those docs are always current.

## 3. Review method for every module

Use the same checklist for each module and record evidence as you go.

### A. Data model and relationships

- Compare interface, Mongoose schema, defaults, required fields, enums, validators, indexes, hooks, and serialization.
- Identify owners, references, cardinality, uniqueness, soft deletion, and lifecycle rules.
- Check whether database constraints match service assumptions and migration/bootstrap behavior.
- Trace updates through document saves and query updates; determine which hooks/version checks each path actually runs.

### B. HTTP boundary and authorization

- Trace the mounted prefix in `src/app.controller.ts`, then method/path and middleware order in the router.
- Confirm every input path (body, params, query, headers, files) has the intended schema, coercion, bounds, and unknown-field policy.
- Verify identity type, roles, ownership, inactive/frozen state, and authorization on every route, including aliases and nested routes.
- Check object-ID parsing, error mapping, response shape/status, cache behavior, and whether hidden resources leak existence.

### C. Business behavior and persistence

- Follow controller to service to repository/model and identify the actual commit boundary.
- Check missing, duplicate, stale, concurrent, repeated, and partially completed operations.
- Verify transaction session propagation and rollback behavior where multiple records or inventory are involved.
- Inspect external effects (email, payment, filesystem, queues) for idempotency, compensation, and ambiguous timeout handling.
- Verify calculations, currency units, rounding, pagination order, and aggregation filters against stored data semantics.

### D. Privacy and security

- Check secret handling, token/session lifecycle, credentialed CORS, rate limits, upload validation, and injection risks.
- Confirm logs and errors do not reveal credentials, PII, raw bodies, stack traces outside intended development use, or attacker-controlled values.
- Check public/admin response projections for internal fields and ensure sensitive routes are not cached.

### E. Tests and operational behavior

- Map each route and invariant to unit, route, and database integration coverage.
- Identify mocks that bypass important model or transaction behavior.
- Confirm integration tests use explicitly configured disposable infrastructure and report skips accurately.
- Inspect startup/index creation, shutdown, queues, retries, storage reconciliation, and failure reporting.
- Record known failing or skipped tests without silently treating them as passing evidence.

## 4. Project review order

Review in dependency order. This sequence is a reading and risk-review order, not an instruction to implement features in this order.

| Order | Area | Why here / key dependencies | Existing starting references |
| --- | --- | --- | --- |
| 0 | Application composition and shared infrastructure | Establish middleware ordering, response/error contracts, config, DB/Redis/filesystem lifecycle, and test environment before interpreting features | `src/app.controller.ts`, `src/index.ts`, `src/Middlewares`, `src/Utils`; [Architecture](ARCHITECTURE.md), [Infrastructure](INFRASTRUCTURE.md), [Setup](SETUP.md) |
| 1 | Category | First model/module; hierarchy, ancestry, visibility, aggregation, deletion, and transaction guard | [Category guide](category/README.md), `tests/category.*.test.cjs` |
| 2 | Product and uploads | Category references, stock/price, image lifecycle, catalog visibility and review aggregation | [Product guide](product/README.md), [Uploads](FILE_UPLOADS.md), `tests/product.service.test.cjs`, `tests/upload*.test.cjs` |
| 3 | User, Admin, Auth, token/session | Identity boundaries underpin every private route; inspect password, OTP, Google, cookies, refresh/revocation and admin policy | [Auth lifecycle](auth/authentication-lifecycle.md), [User](user/README.md), [Admin](admin/README.md), `tests/auth*.test.cjs`, `tests/admin*.test.cjs` |
| 4 | Address, Cart, Wishlist | Customer ownership and mutable state; cart feeds checkout and wishlist adds product response behavior | [Address](ADDRESS.md), [Cart](cart/README.md), [Wishlist](WISHLIST.md), related service/integration tests |
| 5 | Order and Payment | Highest data-integrity risk: pricing snapshots, inventory, idempotency, transaction/session rules, external gateway/webhooks and recovery | [Order](ORDER.md), [Order plan](ORDER_IMPLEMENTATION_PLAN.md), [Payment](PAYMENT.md), `tests/order*.test.cjs`, `tests/payment.test.cjs` |
| 6 | Review and settings | User/product ownership, moderation, rating counters, admin/super-admin boundaries and reconciliation | [Review plan](PRODUCT_REVIEWS_IMPLEMENTATION_PLAN.md), [Review implementation](PRODUCT_REVIEWS_COMPLETED.md), `tests/review*.test.cjs` |
| 7 | Banner, Home, Dashboard, reporting | Public scheduling and projections plus admin aggregation/filtering and low-stock/currency correctness | [Home/dashboard guide](HOME_DASHBOARD_BANNERS.md), `tests/home*.test.cjs` |
| 8 | Email queue and background work | Cross-cutting delivery, retry/expiry semantics, PII exposure, initiating context and shutdown | [Email queue](EMAIL_QUEUE.md), `tests/email.queue.test.cjs` |
| 9 | Logging and audit readiness | Verify current request logging claims and gaps; durable audit remains a separate unfinished backend phase | [Logging status](LOGGING_IMPLEMENTATION.md), [Logging plan](LOGGING_IMPLEMENTATION_PLAN.md) |
| 10 | Scripts, deployment and documentation consistency | Bootstrap/migration/reconciliation safety, least privilege, environment drift, runbooks and docs-to-source accuracy | `scripts/`, [Setup](SETUP.md), [Database](DATABASE.md), all module docs |

Move an area earlier if the initial architecture or threat review finds a critical shared defect. Record the reason so the sequence remains explainable.

## 5. First review session: Category

Keep the first pass bounded to one representative read path and one mutation path.

1. Trace `GET /api/v1/categories/list` from mount to response. Check schema defaults, visibility ancestry, sorting/pagination, product counts, projection, and anonymous access.
2. Trace category creation and parent assignment. Check active parent requirement, full ancestor walk, slug uniqueness, validation, transaction guard, and created-by identity.
3. Trace update/move and deletion. Check cycle prevention, `parent: null`, concurrent moves, child/product dependency checks, and rollback.
4. Compare each observed rule with the category implementation guide and public API docs; list drift instead of silently editing docs during discovery.
5. Map each invariant to existing tests. Record which claims need an integration test against a disposable replica set.
6. Write findings with severity and evidence. Fix only after the finding and intended behavior are clear; keep fixes narrowly scoped and add focused verification requested by the project owner.

## 6. Risk and severity rubric

- **Critical:** credible unauthenticated or broad privilege compromise, irreversible widespread data loss, or systemic transaction/currency corruption.
- **High:** unauthorized access or mutation, credential/session compromise, payment/inventory/order corruption, or exposure of sensitive personal/financial information.
- **Medium:** meaningful incorrect business behavior, data inconsistency with bounded scope, denial of an important flow, or incomplete protection with practical impact.
- **Low:** limited edge-case defect, operational friction, or documentation/test gap without demonstrated user data or security impact.
- **Informational:** improvement or open question without a confirmed defect.

Severity should include likelihood and reach, not just the sensitive-sounding name of a subsystem. Mark confidence separately as confirmed, likely, or unverified.

## 7. Evidence and reporting template

For each finding, capture:

```text
ID / title:
Severity and confidence:
Area and affected route/job:
Evidence (file, symbol, line, test):
Reproduction or triggering condition:
Expected behavior:
Observed behavior:
Impact and affected data/users:
Recommended change:
Verification needed:
Related documentation or decision:
```

For each completed module, also record routes reviewed, model invariants, transaction boundaries, covered tests, skipped checks, unresolved questions, and documentation drift. Do not call the entire project reviewed while any major area or external dependency remains unexamined.

## 8. Verification strategy

Use the narrowest existing suite while exploring, then run broader checks at explicit milestones:

1. Establish a baseline from `npm run build` and the relevant existing tests; preserve the output and distinguish pre-existing failures.
2. Run a module's focused unit/route tests after changes to that module.
3. Run its database integration suite only with an explicitly configured disposable transaction-capable MongoDB deployment. Verify the database name is isolated before allowing tests that drop it.
4. Run cross-module tests after changes affecting auth, errors, persistence helpers, uploads, orders, or startup.
5. Run the complete `npm test` near review completion and report every failure and skip accurately.

Do not use real payment credentials, production databases, user mailboxes, or persistent production storage for review tests. Do not run destructive reconciliation or migration with apply flags as part of read-only discovery.

## 9. Suggested review milestones

- **Milestone 1 — Baseline and Category:** architecture map, clean baseline, Category findings and test map.
- **Milestone 2 — Catalog and identity:** Product/uploads plus User/Admin/Auth/session review.
- **Milestone 3 — Customer commerce:** Address/Cart/Wishlist and end-to-end checkout preparation.
- **Milestone 4 — Transactions and external effects:** Order/Payment, reviews/counters, email and workers.
- **Milestone 5 — Operations and closure:** Dashboard/reporting, logging gaps, scripts, deployment, documentation, full verification, prioritized remediation backlog.

Each milestone should end with a concise findings summary, unresolved decisions, tests run/skipped, and a recommendation for the next review slice.

## 10. Related documentation

- [Documentation index](README.md)
- [Architecture and request lifecycle](ARCHITECTURE.md)
- [Setup and test workflow](SETUP.md)
- [Database and repositories](DATABASE.md)
- [Logging implementation status](LOGGING_IMPLEMENTATION.md)
- [Logging system implementation plan](LOGGING_IMPLEMENTATION_PLAN.md)
- [Frontend logging integration plan](FRONTEND_LOGGING_IMPLEMENTATION_PLAN.md)
