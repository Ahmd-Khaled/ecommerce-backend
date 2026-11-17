# Product reviews implementation plan

Status: implementation completed. Build and unit checks pass; replica-set transaction verification remains pending because no transaction-capable test URI is configured.

## Goal and settled policy

Customers with a delivered order may publish one review per product. Reviews carry a required 1–5 integer rating and optional trimmed text (maximum 2,000 characters). Approval defaults to manual (`autoApproveReviews: false`) and is a durable dashboard setting. Admins can approve, hide, or remove reviews, but cannot edit customer rating/text. Removed records remain tombstones; only SUPER_ADMIN can restore a removed review. Customers may withdraw their own review. Hidden reviews remain hidden after customer edits. Published edits return to pending in manual mode and remain published in auto mode. Product archival and user soft deletion retain review history and state.

Every review lifecycle change and its rating counter delta occur in one MongoDB transaction. Store `ratingsSum` (integer) and `ratingsCount` on Product; public average is derived as rounded `sum/count` and only published reviews contribute. Review lists use stable cursor pagination ordered by `(createdAt, _id)` descending.

## Verified project conventions and paths

- Product model/service/routes: `src/DB/models/product/product.model.ts`, `src/DB/models/product/product.interface.ts`, `src/DB/repository/product.repository.ts`, `src/Modules/product/*`.
- Orders: `src/DB/models/order/order.model.ts`; `src/DB/repository/order.repository.ts` uses `mongoose.connection.transaction`, sequential session operations, and transaction-capable MongoDB.
- Customer identity/auth: `src/Middlewares/authentication.middlewares.ts`, `req.user._id`, `RoleEnum.USER`.
- Admin identity/auth: `src/Modules/admin/admin.authorization.ts`, `req.admin._id`, `adminAuthentication()`. SUPER_ADMIN restriction uses `adminAuthentication([AdminRoleEnum.SUPER_ADMIN])`.
- Admin routes mount in `src/Modules/admin/admin.routes.ts`; dashboard reads use `src/Modules/dashboard/*`.
- Bootstrap connects MongoDB and initializes indexes before listening in `src/app.controller.ts`.
- Existing user removal is soft (`deletedAt`); product DELETE archives (`isActive=false`). No general settings model exists, so create a review settings singleton model/collection.
- Existing transaction support is already required by checkout. Production and integration-test MongoDB must be replica set or sharded deployments. Integration tests use `MONGO_TEST_URI`; there is no lint script/configuration in `package.json`.

## Review lifecycle and transitions

States: `pending`, `published`, `hidden`, `removed`.

| Current | Customer action | Admin action | Public/count effect |
| --- | --- | --- | --- |
| none | create -> pending (manual) or published (auto) | n/a | published adds rating/count |
| pending | edit stays pending; withdraw -> removed | approve -> published; hide -> hidden; remove -> removed | only approval adds rating/count |
| published | edit -> pending (manual) or stays published (auto); withdraw -> removed | hide -> hidden; remove -> removed | leaving published subtracts old rating/count; published edit applies sum delta |
| hidden | edit stays hidden; withdraw -> removed | approve -> published; remove -> removed | hidden excluded; publish adds rating/count |
| removed | no customer edits/restoration | ordinary admin cannot restore; SUPER_ADMIN may restore to hidden (never directly publish) | excluded; restore-to-hidden does not affect counters |

Admin transitions append audit entries containing actor ID/role, from/to state, timestamp, and optional internal reason. History is append-only and never contains edits to rating/text. Customer edits are tracked by normal updatedAt but do not create moderation audit entries. A SUPER_ADMIN restore returns the tombstone to hidden, requiring ordinary approval before publication. Repeated requests with no state change are idempotent and do not double-adjust counters.

## Exact implementation file map

- Add `src/DB/models/review/review.interface.ts`, `review.model.ts`.
- Add durable singleton settings `src/DB/models/settings/review-settings.model.ts` and interface if needed.
- Add `src/DB/repository/review.repository.ts` and `review-settings.repository.ts`.
- Extend Product model/interface with `ratingsSum` and `ratingsCount` defaults and validators.
- Add `src/Modules/review/review.validation.ts`, `review.dto.ts`, `review.service.ts`, `review.controller.ts`, `review.routes.ts`.
- Mount customer/public review routes under `/api/v1/products` in `src/Modules/product/product.routes.ts`; mount admin review routes under `/api/v1/admin/reviews` in `src/Modules/admin/admin.routes.ts`, before the SUPER_ADMIN-only catch-all middleware.
- Initialize review/settings indexes before listen in `src/app.controller.ts`.
- Update `docs/PRODUCT.md`, `docs/API.md`, `docs/README.md`, `docs/SETUP.md`; add unit and replica-set integration tests in `tests/review.*.test.cjs` and a focused package script.

## Database design and indexes

Review fields: `product`, `user`, `order` ObjectId references; `rating` integer 1–5; optional `text`; `state`; `moderationHistory[]`; timestamps. Do not store private user fields in review documents.

Indexes:

- Unique `{ user: 1, product: 1 }` prevents duplicate reviews under concurrency.
- `{ product: 1, state: 1, createdAt: -1, _id: -1 }` serves public/admin per-product cursor reads.
- `{ user: 1, createdAt: -1, _id: -1 }` serves customer history.
- `{ state: 1, createdAt: -1, _id: -1 }` serves the pending/new and moderation queues.

Review settings document has stable `_id: 'product-reviews'`, `autoApproveReviews: false`, and timestamps. Initialize with idempotent `$setOnInsert` before requests; update it only through authenticated dashboard settings API. Product counters default to zero. Average in responses is `ratingsCount ? round(ratingsSum / ratingsCount, 2) : 0`.

## APIs, authorization, validation, pagination, responses

Customer/public APIs:

- `GET /api/v1/products/:productId/reviews?limit=20&after=<cursor>`: public published reviews for active product; response contains whitelisted reviewer display (`firstName` and optional avatar only), rating, text, createdAt, average/count, and next cursor. No email, order ID, moderation metadata, or internal user record.
- `POST /api/v1/products/:productId/reviews`: USER access; body `{ rating, text? }`; never accepts user/order/state/moderation fields. Delivered-order eligibility is checked server-side.
- `GET /api/v1/products/reviews/me?limit=20&after=<cursor>`: USER access; includes every state, including hidden/removed, and only the caller's records.
- `PATCH /api/v1/products/reviews/me/:reviewId`: USER access; body permits rating/text only; owner-scoped; removed is immutable; hidden stays hidden.
- `DELETE /api/v1/products/reviews/me/:reviewId`: USER access; owner-scoped withdrawal to removed tombstone.

Admin APIs:

- `GET /api/v1/admin/reviews?productId=&state=&queue=new&limit=&after=`: ADMIN list; filters by product, state, and pending/new queue; newest-first cursor order.
- `PATCH /api/v1/admin/reviews/:reviewId/state`: ADMIN can approve/publish pending or hidden, hide published/pending, and remove any nonremoved review. Payload contains target state and optional reason only.
- `PATCH /api/v1/admin/reviews/:reviewId/restore`: SUPER_ADMIN only; removed -> hidden.
- `GET /api/v1/admin/reviews/settings` and `PATCH /api/v1/admin/reviews/settings`: ADMIN read/change `{ autoApproveReviews: boolean }`.

Cursor is an opaque base64url encoding of validated ISO timestamp plus ObjectId. Query uses descending tuple semantics (`createdAt < cursorDate` OR same timestamp and `_id < cursorId`); fetch `limit+1` to produce `nextCursor` and avoid count scans. Limit defaults to 20, maximum 100. Reject malformed cursor, IDs, filters, empty patch, unknown body keys, invalid states/reasons.

Use existing Zod validation middleware, customer authentication and admin authentication. Controllers only extract identity/input and format status/envelopes; services own business rules. Sanitize every response with explicit fields. Admin list may display safe user name/email for moderation, but public/customer responses never expose email or order identifiers.

## Transaction and concurrency design

Centralize all review mutations in `ReviewService` and repository transaction helpers using `mongoose.connection.transaction` with snapshot read concern, majority write concern, and primary read preference. Never parallelize operations on the same session.

Within one transaction:

1. Read relevant review/product/order/current durable auto-approval setting.
2. Verify delivered eligibility, ownership, admin role, allowed transition, product state, and expected old review state/rating.
3. Conditionally write the review or tombstone; append admin audit event in the same document update.
4. Compute contribution delta based on published status: entering published = `sum += rating`, `count += 1`; leaving published = `sum -= oldRating`, `count -= 1`; published edit = `sum += newRating-oldRating`; otherwise zero.
5. Apply counter update to Product in the same session with guards preventing negative count/sum. Missing product or failed conditional update aborts the transaction.
6. Commit; any failure rolls back review, audit, and counters together.

The unique index handles duplicate create races and maps duplicate key to 409. Conditional old-state/rating filters and transactional write conflicts prevent stale concurrent moderation or double counting. Transaction retry behavior follows Mongoose driver's transaction API; do not implement a nontransactional fallback.

## Product/user lifecycle and deployment

Product archive remains `isActive=false`; it retains reviews, publication state, and counters. Public product/review reads hide archived products; reactivation restores prior published review visibility. User soft delete retains reviews and rating contribution; deleted users cannot authenticate to customer history, while admin review history remains available. There is no current hard-delete path. Any future hard delete must transactionally tombstone/delete dependent reviews and adjust published counters; hard user deletion requires privacy-approved anonymization semantics.

Bootstrap initializes settings singleton and calls `ReviewModel.init()/createIndexes()` before listening. Deploy only to transaction-capable MongoDB. No legacy reviews exist, so no review data migration is required; new product counter fields default to zero. Provide a reconciliation script that aggregates published reviews per product and reports/fixes mismatched `ratingsSum`/`ratingsCount` only with an explicit write flag; dry-run is default. Run it before/after rollout and after any manual database repair. Ensure database account can create indexes.

## Implementation and verification sequence

1. Add schemas/interfaces/repositories/settings, Product counters, indexes, bootstrap initialization.
2. Implement centralized transactional lifecycle and counter-delta service.
3. Add customer eligibility, own-history, create/edit/withdraw APIs.
4. Add admin queue, moderation/audit, SUPER_ADMIN restore, and setting APIs.
5. Integrate summaries into product list/detail and public review reads.
6. Add validation/auth/routes, docs, reconciliation/deployment instructions, focused package script.
7. Add tests for eligibility/ownership, duplicates, all transitions, auto/manual setting, authorization, audit history, pagination/cursors, response sanitization, summary deltas, rollback, concurrent writes, archive/soft delete, and product/cart/order regression.
8. Run review suite, full `npm test`, `npm run build` (already included by test scripts), and lint only if a project lint script/config exists. Integration transaction tests must connect to a disposable replica set via `MONGO_TEST_URI`; do not report them as verified if no URI is available. No standalone MongoDB fallback.

## Acceptance criteria

- Manual mode is the persisted default; new reviews are pending and do not affect public summaries. Auto mode publishes new eligible reviews immediately.
- Only delivered-order customers can review; one review per user/product even under concurrency.
- Customer history contains all states; public reads expose only published reviews for active products.
- Hidden edits stay hidden; published edits requeue in manual mode; removed records are immutable to customers.
- Admin moderation cannot alter rating/text. Every admin state change is auditable; only SUPER_ADMIN can restore removed to hidden.
- Counter sum/count exactly match published review records after create/edit/withdraw/moderation/restoration; transaction rollback and concurrency tests prove atomic behavior.
- Product archive and user soft-delete preserve history and counters; no unrelated product/cart/checkout/order contract changes.
- Cursors are stable, validated, and bounded; response fields are explicitly whitelisted.

## Out of scope

Admin editing customer review content, replies, helpful votes, media, notifications, automatic delivery inference, and changes to cart/checkout/order snapshots.


## Deployment checklist

1. Confirm production MongoDB runs as a replica set or sharded cluster with transaction support and index-creation privileges.
2. Back up the database and deploy the application; startup initializes missing legacy Product counters to zero, creates Review indexes, and inserts the manual-approval settings document before serving requests.
3. Run `MONGO_AUDIT_URI=<explicit target> npm run audit:reviews` in dry-run mode. Review all mismatches. Apply only after approval with `npm run audit:reviews -- --apply`.
4. Keep `autoApproveReviews` false until the dashboard setting is intentionally changed. Existing reviews are not bulk-republished when the setting changes.
5. Run transaction integration tests against a disposable replica set with `MONGO_TEST_URI`; standalone MongoDB cannot verify this feature.
6. After rollout, monitor transaction errors and periodically run counter reconciliation. Reconciliation write mode is explicit and not part of normal application startup.

## Verification record

- `npm run build`: passed.
- `npm run test:review`: 2 passed; replica-set integration test explicitly skipped because `MONGO_TEST_URI` is unset, so transactional runtime guarantees remain unverified in this environment.
- `npm test`: build passed; 132 passed, 7 skipped, 1 failed. Existing unrelated failure: `tests/payment.test.cjs` expects a single `pending` payment status, while implementation queries `pending` and `expired`.
- No lint script or lint configuration exists in `package.json`.
