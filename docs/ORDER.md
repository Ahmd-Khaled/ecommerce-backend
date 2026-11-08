# Order module and checkout

Implemented contract: schema version 2. This is a breaking checkout request change: clients must provide a saved address, integer minor-unit price confirmations, and an idempotency key. It does not collect payments.

## Endpoints

All routes are under `/api/v1/orders` and require an access token.

| Method/path | Role | Contract |
| --- | --- | --- |
| POST /checkout | USER | Place or replay an order |
| GET / | USER | Own orders; page defaults to 1, limit to 20 (maximum 100) |
| GET /:orderId | USER | Own order detail; missing/foreign orders both return 404 |
| PATCH /:orderId/cancel | USER | Cancel an owned placed order; optional reason |
| GET /admin | ADMIN | List orders; page, limit, status, user, from, to |
| GET /admin/:orderId | ADMIN | Order detail |
| PATCH /admin/:orderId/status | ADMIN | Body: expectedStatus, status, optional reason |

Admin date filters use ISO UTC timestamps and inclusive bounds. Ordering is createdAt descending, then _id descending. List responses omit new-order shipping addresses and history. Detail responses include snapshots and lifecycle history. Responses use `{ success: true, data: ... }`; list data contains orders and pagination.

## Checkout contract

Required header: `Idempotency-Key: <16–128 letters, digits, underscores or hyphens>`. A UUID is suitable. Keep the same key and original request when retrying; use a new key for a genuinely new purchase.

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

Use the cart response's version, product IDs, and unitPriceMinor. The complete product set must match the cart; duplicates and unknown fields are rejected. Quantities come from the stored cart. The authenticated user's saved address is selected within the checkout transaction; a foreign or missing address returns the same 404.

New checkout returns 201; replay returns 200. Both return the same order identity, with `replayed` at the response root. Replay returns current order status, including cancellation. Client totals, currency overrides, status, user IDs, and address snapshots are not accepted.

## Money and snapshots

Store currency defaults to EGP and exponent to 2 through STORE_CURRENCY and STORE_CURRENCY_EXPONENT. These must match the catalog's actual pricing denomination. Validate the business meaning before rollout; existing numeric prices cannot prove currency.

Catalog prices remain major-unit numbers. A shared decimal-string conversion rejects excess fractional precision and unsafe amounts. Cart exposes currency, currencyExponent, unitPriceMinor per available line, subtotalMinor per line, and subtotalMinor for the cart. Existing cart price/subtotal fields remain major units for compatibility.

New orders store currency/exponent, product name/SKU, quantity, unitPriceMinor, lineTotalMinor, and shipping-address snapshots. Monetary fields are subtotalMinor, shippingMinor, discountMinor, taxMinor, and grandTotalMinor. Every arithmetic step is checked for safe integer bounds. Shipping, discount, and tax are explicitly zero for this milestone; there is no fee, coupon, or tax calculation engine.

Changing products or saved addresses does not change historical order snapshots. The API exposes explicit DTOs and never returns internal idempotency keys or fingerprints.

## Transaction and replay guarantees

Checkout preserves guarded inventory deduction, cart version checks, and atomic cart clearing. It reads authoritative product prices and snapshots, verifies reviewed minor units, conditionally deducts stock, inserts the order, and clears the cart within one MongoDB transaction.

A unique partial index on user + idempotencyKey enforces replay identity while allowing legacy records without keys. The fingerprint normalizes IDs and sorts items; item ordering is irrelevant. Reusing a key with different validated request data returns 409. Lookup happens before reading the cart/address, so later removal or changes do not invalidate a successful replay.

Concurrent losers reconcile the committed winning order outside their aborted transaction. Unresolved duplicate/transient conflicts return 409 with instructions to reuse the key. An unresolved unknown commit result returns 503 with an explicitly uncertain outcome; retry the exact original request and key. Keys live as long as their orders.

MongoDB must support transactions. Startup creates the required order indexes before serving traffic. No nontransactional fallback is used.

## Fulfillment and cancellation

| Current status | Admin target | Customer |
| --- | --- | --- |
| placed | processing, cancelled | cancel |
| processing | shipped, cancelled | none |
| shipped | delivered | none |
| delivered | none | none |
| cancelled | none | repeat cancel safely |

Admin updates require expectedStatus. Stale and invalid transitions return 409. Repeating an ordinary transition does not append another event; it returns 409 when the expected status is stale.

Cancellation atomically changes status/history and restores each original quantity, even for inactive products. Conditional state updates and transaction retries ensure repeated/concurrent cancellation restores stock once. Completed cancellation replays return the cancelled result. The cart is not repopulated.

Product DELETE now archives by setting isActive=false, preserving records for restoration. Existing product editing may reactivate an archived product. Missing products, fractional/unsafe stock, or unsafe historical quantities abort cancellation entirely with 409. Operators must investigate and repair missing inventory using trusted records before retrying; never set stockRestoredAt manually to bypass a failure.

These are fulfillment states, not payment states. Refunds, returns, carrier tracking, notifications, and payment collection remain deferred.

## Legacy records and rollout

Legacy reads return schemaVersion=1, legacy=true, original total/unitPrice in their old units, null currency/address/name/SKU, and original product references. No current address/product data is invented as historical evidence. Legacy orders require manual review before any lifecycle transition, including cancellation.

Before deployment:

1. Set STORE_CURRENCY and STORE_CURRENCY_EXPONENT to the catalog's confirmed denomination.
2. Run `npm run audit:orders` with explicit MONGO_AUDIT_URI, including the intended database. The audit is read-only, disables automatic index/collection creation, reports invalid product prices/stock, legacy order count, and duplicate key groups. It exits nonzero on data incompatibility.
3. Correct invalid catalog amounts using business records. Review legacy records separately; this release performs no automatic migration.
4. Update clients to the new checkout request and use the minor-unit cart fields. Preserve the original key/body on retries.
5. Deploy with transaction-capable MongoDB and permission to create indexes.

The audit cannot establish a historical currency or verify historical inventory provenance. Production audit and business confirmation are deployment responsibilities; development tests use a disposable database only.

## Validation

`npm run test:order` builds and runs order unit/HTTP tests plus order/cart transaction tests. `npm test` runs the full suite. Set MONGO_TEST_URI explicitly to a disposable replica set to run integration suites; each suite uses and drops a uniquely named test database. Without that variable, integration suites report skipped.

Coverage includes replay and key conflicts, ownership/roles, address ownership, money precision/overflow, historical snapshots, legacy reads/index compatibility, concurrent checkout/cancellation, lifecycle races, missing-product rollback, archive races, and existing cart overselling guarantees.
