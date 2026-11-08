# Order module and checkout implementation plan

Created: 2026-11-07.

Status: implemented and verified locally on 2026-11-07. Checked items describe completed implementation or documented policy. Remaining unchecked items are deployment data/business checks; no application database was migrated. See [ORDER.md](ORDER.md) for the shipped API contract.

## 1. Current baseline

Checkout already validates cart version and reviewed prices, conditionally deducts stock, creates an order, and clears the cart in one MongoDB transaction. Preserve these guarantees.

The current Order model stores user, product references, quantities, unit prices, total, and a single `placed` status. There are no order history, details, cancellation, or admin management endpoints. Addresses are embedded in User. Payment processing is outside this milestone.

## 2. Proposed business rules

- [x] Implement configured currency/exponent, default EGP/2, and startup configuration validation.
- [ ] Before deployment, confirm EGP/2 matches the actual catalog denomination (or configure the correct values).
- [x] Store all new order monetary amounts as nonnegative safe integers in minor units. For EGP, 100 minor units equals EGP 1.00.
- [x] Initially use explicit server-side zero shipping, discount, and tax amounts. Document this as the milestone's pricing policy, not an implemented shipping, coupon, or tax engine. Replace it with approved business rules before charging those amounts.
- [x] Use fulfillment states `placed`, `processing`, `shipped`, `delivered`, and `cancelled`. These states do not indicate payment collection.
- [x] Allow customers to cancel only their own `placed` orders. Allow administrators to cancel `placed` or `processing` orders.
- [x] Keep `delivered` and `cancelled` terminal. Returns, refunds, payment integration, and tracking-provider integration remain separate work.

## 3. Extend the existing Order model

File: [order.model.ts](../src/DB/models/order/order.model.ts). Add a dedicated interface/type file if it improves shared service/repository typing.

| Field | Proposed contract |
| --- | --- |
| `user` | Required owner reference; never accepted from checkout input |
| `schemaVersion` | Explicit version distinguishing new orders from legacy records |
| `currency` | Validated store currency, immutable after checkout |
| `currencyExponent` | Snapshot of the minor-unit conversion exponent |
| `items` | Nonempty array of immutable purchase snapshots |
| `items.product` | Original product reference |
| `items.name`, `items.sku` | Required product snapshots |
| `items.quantity` | Positive safe integer within configured limits |
| `items.unitPriceMinor` | Nonnegative safe integer |
| `items.lineTotalMinor` | Checked multiplication of quantity and unit price |
| `shippingAddress` | Embedded snapshot: fullName, phone, country, city, street, optional building/apartment |
| `subtotalMinor` | Sum of line totals |
| `shippingMinor`, `discountMinor`, `taxMinor` | Server-calculated nonnegative safe integers |
| `grandTotalMinor` | subtotal + shipping + tax - discount; nonnegative safe integer |
| `status` | Controlled fulfillment enum |
| `statusHistory` | Initial placement and each transition with actor, timestamp, and optional bounded reason |
| `cancelledAt`, `cancelledBy`, `cancellationReason` | Cancellation metadata |
| `stockRestoredAt` | Recorded in the same transaction as inventory restoration |
| `idempotencyKey`, `requestFingerprint` | Internal checkout replay metadata; omit from public DTOs |
| timestamps | Preserve createdAt and updatedAt |

- [x] Validate arithmetic overflow on each multiplication and addition, not just the final result.
- [x] Add indexes for `{ user, createdAt, _id }` customer pagination and `{ status, createdAt, _id }` admin filtering.
- [x] Add a unique compound index on `{ user, idempotencyKey }`, partial for records with a valid key so legacy orders can coexist.
- [x] Ensure required indexes exist before accepting checkout traffic.
- [x] Use explicit response DTOs; do not expose raw documents or depend on live product/address population to display historical orders.

## 4. Money compatibility and migration

- [x] Keep catalog prices in their existing representation for this milestone, with one explicit, tested decimal-to-minor-unit conversion boundary shared by cart and checkout.
- [x] Convert decimal values using deterministic decimal/string arithmetic. Do not rely on unqualified floating-point multiplication and rounding.
- [x] Reject unsupported fractional precision and unsafe values; provide a read-only audit command.
- [ ] Run npm run audit:orders against the intended deployment database and resolve reported incompatibilities before rollout.
- [x] Expose `unitPriceMinor`, currency, and exponent in cart responses so clients can submit the reviewed values without doing their own conversion.
- [x] Preserve guarded checkout price matching against the actual stored catalog price while comparing customer confirmation in minor units.
- [x] Define an explicit API rollout: update checkout consumers and fixtures together; do not silently reinterpret old `unitPrice` or `total` values as minor units.
- [x] Provide legacy-order inventory counts in the audit and an explicit legacy read DTO; do not invent historical data.
- [ ] Review the actual deployment database legacy records before any future migration. Automatic migration and legacy cancellation are intentionally disabled.
- [x] Use a documented legacy read DTO or a migration with explicitly unavailable historical fields. Preserve old orders and totals; assign historical currency only when evidence supports it.
- [x] Define legacy cancellation eligibility separately. Existing checkout deducted stock, but verify provenance before enabling automatic restoration for older records.

## 5. Checkout request and transaction

Proposed endpoint: `POST /api/v1/orders/checkout`, authenticated USER.

Required header: `Idempotency-Key`, an opaque, bounded string (proposed 16Ã¢â‚¬â€œ128 characters with an allowlisted character set).

```json
{
  "version": 3,
  "addressId": "507f1f77bcf86cd799439012",
  "items": [
    {
      "productId": "507f1f77bcf86cd799439011",
      "unitPriceMinor": 50000
    }
  ]
}
```

- [x] Strictly validate body and header. Reject duplicates after normalizing product IDs.
- [x] Obtain owner from authentication. Never accept client quantities, owner, snapshots, totals, discounts, shipping costs, or fulfillment status.
- [x] Build a canonical fingerprint from validated version, address ID, and product IDs/prices sorted by ID; array order must not change replay identity.
- [x] Before inspecting the current cart/address, check for an existing order with the same owner/key. Same fingerprint returns that order; a different fingerprint returns 409.
- [x] Within one transaction, repeat the replay check, load the cart, and validate version, quantity limits, and exact product set.
- [x] Load the authenticated user's saved address using the same session. Reject missing or foreign addresses identically; copy allowed address fields into the order.
- [x] Validate current availability and reviewed prices. Copy name and SKU from the authoritative product read/update in the transaction.
- [x] Deduct inventory with conditional stock predicates, calculate all amounts on the server, insert the order including key/fingerprint and initial status history, then clear/version the cart.
- [x] Preserve sequential operations within transaction callbacks and full rollback on any failure.
- [x] Resolve concurrent duplicate-key races outside the aborted transaction by loading the winning owner/key order and comparing fingerprints. If no committed winner is visible, return a retryable outcome rather than inventing success.
- [x] On uncertain commit outcomes, reconcile by owner/key when possible; otherwise instruct retry with the same key. Never claim a definitely failed purchase when the commit result is unknown.
- [x] Return 201 for a new order and 200 for replay, with the same order identity. A replay may show the order's current fulfillment status.
- [x] Retain keys for the lifetime of orders. Replaying after cart clearing, product changes, address removal, or cancellation must not create another order or deduct stock again.

## 6. Customer and admin endpoints

All paths below are relative to `/api/v1/orders`.

| Method/path | Role | Behavior |
| --- | --- | --- |
| `POST /checkout` | USER | Checkout contract above |
| `GET /` | USER | Paginated authenticated owner's orders |
| `GET /:orderId` | USER | Owned order details |
| `PATCH /:orderId/cancel` | USER | Cancel an eligible owned order |
| `GET /admin` | ADMIN | Paginated orders with validated status, user, and date filters |
| `GET /admin/:orderId` | ADMIN | Administrative order details |
| `PATCH /admin/:orderId/status` | ADMIN | Controlled fulfillment transition, including cancellation |

- [x] Replace the current router-wide USER restriction with explicit role middleware for customer/admin route groups.
- [x] Register literal admin routes before parameterized customer routes.
- [x] Apply ownership in database predicates, not only after fetching documents. Return the same 404 for missing and foreign orders.
- [x] Validate IDs, pagination, date ranges, filters, and bounded reasons. Use stable ordering by createdAt and _id, default page size 20, maximum 100.
- [x] Return pagination metadata and explicit list/detail DTOs; customer lists should avoid unnecessary address details.

## 7. Controlled status transitions

| Current state | Allowed admin target states | Customer action |
| --- | --- | --- |
| placed | processing, cancelled | cancel |
| processing | shipped, cancelled | none |
| shipped | delivered | none |
| delivered | none | none |
| cancelled | none | repeated cancel returns existing cancelled result |

- [x] Require `expectedStatus` and target `status` for admin transition requests; reject stale or invalid transitions with 409.
- [x] Guard updates by current status so concurrent operations cannot overwrite each other.
- [x] Append history and state change atomically. Repeating an already-completed transition should not append duplicate history.
- [x] Route every transition to cancelled through the shared cancellation operation; never set cancelled through a generic update.

## 8. Cancellation and stock restored exactly once

- [x] Implement a single transaction shared by customer/admin cancellation paths.
- [x] Load the order with the appropriate ownership predicate; check eligibility for the actor.
- [x] If already cancelled with completed restoration, return its existing result without inventory writes.
- [x] Conditionally claim the eligible state transition with an absent restoration marker within the transaction; a competing state transition must conflict/retry or return 409.
- [x] Restore each stored quantity with `$inc`, including inactive products; cancellation should not depend on current selling availability.
- [x] Check every inventory update matched a product and will not overflow safe stock limits. Abort the entire transaction if restoration cannot complete.
- [x] Record cancelled status, actor, reason, history, and stockRestoredAt in the same transaction as all stock increments.
- [x] Do not repopulate the cart automatically.
- [x] Address permanent product deletion before enabling this guarantee: archive products instead of deleting stock-bearing records referenced by orders. Coordinate deletion and checkout to avoid a check-then-delete race; prefer archive-only deletion behavior for this milestone.
- [x] Define a repair path for already-missing historical products; never silently mark stock restored when an increment matched nothing.

The guarantee is one committed inventory restoration per cancellation, enforced by database predicates and transactions. An in-memory flag or a separate marker update is insufficient.

## 9. Verification checklist

- [x] Unit/service tests for monetary conversion, arithmetic overflow, totals, snapshots, validation, and transition rules.
- [x] HTTP tests for authentication, role restrictions, ownership, non-disclosing 404s, admin route ordering, pagination, and error/response contracts.
- [x] Checkout tests for owned/missing/foreign addresses, changed prices, empty/stale carts, unavailable products, limits, and transactional rollback.
- [x] Verify order snapshots remain unchanged after product edits and address edits/deletion.
- [x] Replay tests: same key/body, reordered items, changed body, different users, cleared cart, and cancelled order.
- [x] Real replica-set tests for concurrent identical keys, different keys on one cart, insufficient stock, and aborted writes without partial stock/cart/order changes.
- [x] Real replica-set tests for concurrent cancellations and cancellation racing processing/shipping transitions; assert inventory restores exactly once.
- [x] Test cancellation failure midway, inactive/missing products, and archive racing checkout.
- [x] Test legacy record reads, index creation with legacy records, and documented migration behavior.
- [x] Run TypeScript build and the complete existing regression suite. Run integration suites against an explicit isolated `MONGO_TEST_URI`; report skipped tests separately from passes.

## 10. Files and delivery sequence

1. [x] Implement documented EGP/2 and zero-fee defaults plus legacy compatibility policy; introduce schemas, interfaces, DTOs, money helpers, and indexes.
2. [x] Update cart price output and implement the new checkout transaction, snapshots, and replay handling.
3. [x] Add owner-scoped listing/details and admin listing/details.
4. [x] Implement status transitions, transactional cancellation, and the product archival policy.
5. [x] Complete regression and replica-set concurrency tests.
6. [x] Update [ORDER.md](ORDER.md), [DATABASE.md](DATABASE.md), [CART.md](CART.md), [PRODUCT.md](PRODUCT.md), configuration/setup guidance, and outdated [TODO.md](TODO.md) entries.

Primary implementation files:

- `src/DB/models/order/order.model.ts` and optional `order.interface.ts`.
- `src/DB/repository/order.repository.ts`.
- `src/Modules/order/order.routes.ts`, `order.controller.ts`, `order.service.ts`, `order.validation.ts`, `order.dto.ts`, and authorization definitions as needed.
- Cart response/service code for currency and reviewed minor-unit prices.
- Product service/repository code for archival and inventory safety.
- `src/app.controller.ts` for index/startup requirements only where necessary.
- Existing order/cart tests plus dedicated order route, lifecycle, idempotency, and integration tests.

## Acceptance criteria

- [x] A customer can checkout with their saved address, retrieve only their own orders, and cancel an eligible order.
- [x] Administrators can list orders and perform only approved transitions.
- [x] Historical order display is independent of later product/address edits.
- [x] All new order amounts have explicit currency and validated integer minor units.
- [x] Retrying checkout with the same key cannot create another order or repeat stock deductions.
- [x] Concurrent or repeated cancellation cannot restore stock more than once.
- [x] Existing checkout concurrency guarantees and unrelated module tests remain intact.
- [x] Documentation accurately separates implemented behavior, legacy limitations, and deferred payment features.

## Verification result

On 2026-11-07, npm test (including TypeScript build) passed 107 tests with 0 failures and 0 skipped. All integration suites ran against an isolated local MongoDB replica set. The audit command was also tested against incompatible fixture data. No deployment database was inspected or migrated.
