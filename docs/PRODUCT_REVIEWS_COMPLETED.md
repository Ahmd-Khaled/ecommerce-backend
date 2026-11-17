# Product reviews: completed work

## Implemented

- Added a dedicated Review collection with rating validation, lifecycle states, moderation audit history, and indexes for unique customer/product reviews and cursor queries.
- Added durable review settings with `autoApproveReviews: false` by default.
- Added `ratingsSum` and `ratingsCount` to Product. Product API serialization exposes a rounded `ratingsAverage` and count, while keeping the sum internal.
- Added transaction-backed review creation, edits, withdrawal, moderation, restoration, and corresponding Product counter adjustments.
- Added delivered-order eligibility and one-review-per-customer/product enforcement.
- Added stable cursor pagination for public reviews, customer review history, and admin review lists.
- Added explicit customer/admin response projections to avoid exposing private fields.
- Added startup initialization for older Product records, review indexes, and default settings.
- Added `scripts/reviews-reconcile.cjs` and the `npm run audit:reviews` command. It reports discrepancies by default; pass `-- --apply` to repair counters.

## Review behavior

- Manual approval is the default. New reviews are pending unless automatic approval is enabled in the dashboard API.
- Public product reviews and ratings include published reviews only.
- Customers can view all their own reviews, including hidden and removed reviews. They can edit their own non-removed reviews and withdraw them.
- Admins can publish, hide, or remove reviews, but cannot edit customer ratings or text. Moderation actions record actor, state transition, timestamp, and optional reason.
- Only SUPER_ADMIN can restore a removed review. Restoration returns it to hidden; an admin must publish it separately.
- Product archival and user soft deletion retain review history and counters.

## API endpoints

Customer and public endpoints are mounted under `/api/v1/products`:

- `GET /:productId/reviews`
- `POST /:productId/reviews`
- `GET /reviews/me`
- `PATCH /reviews/me/:reviewId`
- `DELETE /reviews/me/:reviewId`

Admin endpoints are mounted under `/api/v1/admin/reviews`:

- `GET /` with product, state, and new/pending queue filters
- `PATCH /:reviewId/state`
- `PATCH /:reviewId/restore` (SUPER_ADMIN)
- `GET /settings`
- `PATCH /settings`

See [API.md](API.md) for request contracts and [PRODUCT_REVIEWS_IMPLEMENTATION_PLAN.md](PRODUCT_REVIEWS_IMPLEMENTATION_PLAN.md) for lifecycle and transaction details.

## Files added or updated

Added:

- `src/DB/models/review/review.interface.ts`
- `src/DB/models/review/review.model.ts`
- `src/DB/models/settings/review-settings.model.ts`
- `src/DB/repository/review.repository.ts`
- `src/DB/repository/review-settings.repository.ts`
- `src/Modules/review/review.validation.ts`
- `src/Modules/review/review.dto.ts`
- `src/Modules/review/review.service.ts`
- `src/Modules/review/review.controller.ts`
- `src/Modules/review/review.routes.ts`
- `scripts/reviews-reconcile.cjs`
- `tests/review.service.test.cjs`
- `docs/PRODUCT_REVIEWS_IMPLEMENTATION_PLAN.md`

Updated:

- `src/DB/models/product/product.interface.ts`
- `src/DB/models/product/product.model.ts`
- `src/Modules/product/product.routes.ts`
- `src/Modules/admin/admin.routes.ts`
- `src/app.controller.ts`
- `package.json`
- `docs/API.md`
- `docs/PRODUCT.md`
- `docs/README.md`
- `docs/SETUP.md`

## Verification

- `npm run build`: passed.
- `npm run test:review`: 2 passed; the transaction integration test was explicitly skipped because `MONGO_TEST_URI` was not set. Transaction behavior still needs verification on a disposable replica set.
- `npm test`: 132 passed, 7 skipped, 1 failed. The failure is in the existing payment test: it expects a single `pending` status while the payment service queries `pending` and `expired`.
- No lint script or lint configuration is present in the project.

## Deployment notes

- Use replica-set or sharded MongoDB with transaction support and index-creation privileges.
- Startup initializes missing Product review counters to zero, creates review indexes, and inserts the manual-approval settings record before serving requests.
- Set `MONGO_AUDIT_URI` explicitly and run `npm run audit:reviews` against the intended database. Review discrepancies before running `npm run audit:reviews -- --apply`.
- Run `npm run test:review` with `MONGO_TEST_URI` pointed at a disposable replica set to verify transactional behavior before release.
