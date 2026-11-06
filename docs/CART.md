# Cart and checkout

Cart writes use Mongoose optimistic concurrency (`__v`). Conflicting writes reload
and revalidate up to three times, then return HTTP 409. Uncertain write failures
are not automatically replayed. Cart responses expose `version` for checkout.
The shared base repository is unchanged by this implementation.

`CART_MAX_ITEMS` limits distinct stored product lines (default 50).
`CART_MAX_QUANTITY` limits cumulative quantity per product (default 100).
Both must be positive safe integers. Validation reads configuration after dotenv
loads, and startup validates it. Lowering limits does not prevent removals or
quantity reductions from existing carts. Unavailable lines count toward the line
limit and remain visible with `available: false`; deleted/inactive product details
are omitted, and these lines contribute zero to subtotal. Stock checks on cart
adds/increases are advisory: no inventory is reserved or deducted.

## Checkout

`POST /api/v1/orders/checkout` uses the same authenticated USER role as the cart.
Send the last reviewed cart version and a price confirmation for every line:

```json
{
  "version": 3,
  "items": [{ "productId": "507f1f77bcf86cd799439011", "unitPrice": 25 }]
}
```

Quantities come from the stored cart. The transaction verifies the version and
exact product set, checks active products and current prices, deducts stock with
`stock >= quantity` guards, persists an order with price snapshots, and clears
and increments the cart version. Any failure rolls back all writes. A stale
cart, changed price, or unavailable item returns 409. Duplicate checkout of the
same cart version cannot purchase twice. An empty cart returns 400. This creates
a placed order; it does not charge a payment provider.

MongoDB must run as a replica set or sharded cluster supporting transactions.
There is no non-transactional fallback. Startup ensures the unique cart user
index exists before accepting traffic; existing duplicate carts must be resolved
before deployment. Unknown transaction commit errors propagate; clients should
reconcile order state rather than assume a failed purchase.

## Tests

`npm run test:cart` runs cart and checkout unit tests. Set `MONGO_TEST_URI` to an
isolated replica-set MongoDB URI to also run actual concurrency and rollback
tests. These create and delete a uniquely named test database, never using the
application's `MONGO_URI`. `npm test` builds and runs all test files.

The project has no lint script or lint configuration.
