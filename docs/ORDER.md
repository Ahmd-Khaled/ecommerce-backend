# Order module and checkout

Source: [route](../src/Modules/order/order.routes.ts), [schema](../src/Modules/order/order.validation.ts), [DTO](../src/Modules/order/order.dto.ts), [controller](../src/Modules/order/order.controller.ts), [service](../src/Modules/order/order.service.ts), [repository](../src/DB/repository/order.repository.ts), [model](../src/DB/models/order/order.model.ts).

There is one implemented endpoint: **POST `/api/v1/orders/checkout`**. Order listing, details, cancellation, refunds, shipping, and payment collection are not implemented routes.

## Request from route to database

1. `app.controller.ts` mounts `orderRouter` at `/api/v1/orders`, with an IP limiter and 100 KB JSON parser.
2. Router middleware requires an access token with role USER.
3. `validations({ body: checkoutSchema })` parses a strict JSON body.
4. `orderController.checkout` passes `req.user._id` and `req.body` to `orderService.checkout`.
5. The service validates again for callers outside HTTP, then calls `orderRepository.checkout`.
6. The repository runs all purchase writes inside `mongoose.connection.transaction` and returns the saved order.
7. The controller returns 201 with `{ success: true, message: 'Order placed successfully', data: order }`.

## Request contract

```json
{
  "version": 3,
  "items": [{ "productId": "507f1f77bcf86cd799439011", "unitPrice": 500 }]
}
```

`version` is the nonnegative safe integer returned by the last cart response. Each item supplies a valid product ID and finite nonnegative unitPrice. At least one item is required, and item count cannot exceed the configured line limit. Extra keys are rejected. There is no client-supplied quantity, user ID, or trusted grand total: quantities come from the stored cart and price confirmation is matched against the product record.

The item array must identify exactly the stored product set with no duplicates. It is the customer's confirmation of reviewed prices, not an instruction to purchase an arbitrary subset. Remove unwanted/unavailable items from the cart first.

## Transaction in detail

1. Load the user's cart using the transaction session. Missing/empty carts return 400.
2. Compare stored `__v` with requested version; a mismatch returns 409 before stock writes.
3. Check stored line count and all quantities against configured limits, including old carts created before the limits changed.
4. Normalize supplied product IDs and build a map of reviewed prices. Reject duplicates or a different product set.
5. For each cart line, execute a product `findOneAndUpdate` matching `_id`, `isActive: true`, exact `price`, and `stock >= quantity`. Apply `$inc: { stock: -quantity }` and return the updated product.
6. If any guarded update finds no product, throw 409. A deletion, deactivation, price change, or stock shortage can cause this. All earlier deductions roll back.
7. Save an order containing user, product references, quantities, unitPrice snapshots, total, timestamps, and default status `placed`.
8. Clear cart items with a predicate matching cart ID and reviewed version; increment `__v`. If no cart changed, throw 409 and roll back.
9. Commit inventory, order, and cart changes together.

Queries inside a transaction are sequential. The MongoDB driver can retry transient transaction conflicts. The service translates a remaining transient transaction error to 409 unless it also carries an unknown-commit-result label. Unknown commit outcomes propagate; they must not be described as a definitely failed purchase.

## Why this prevents overselling

Suppose stock is one and two users each have one unit in a cart. Both carts are valid because adding reserves nothing. Checkout requires the product update to see stock at least one and deduct it within a transaction. After one purchase commits, the other cannot commit a second purchase of the same last unit. It retries/conflicts and eventually sees insufficient stock. No partial order is left behind.

Two checkouts of the same cart version also cannot both complete: a successful checkout clears the cart and advances its version. This is duplicate-purchase prevention for that cart state, not a general idempotency-key API returning the same original response after a network retry.

## Response and limitations

`data` is the created order document. Each line has product ID, quantity, and unitPrice. `total` is the sum of unitPrice times quantity. There is no tax, shipping, discount, currency field, or payment status calculation. Prices use JavaScript/Mongoose numbers, not a dedicated decimal-money model. The order snapshots price and quantity but does not snapshot every product description/name.

Checkout requires MongoDB transaction support (replica set or sharded cluster). It never falls back to independent writes on a standalone server. Creating a placed order does not charge a card: the Payment module is a placeholder.

Tests: `tests/order.checkout.test.cjs` verifies predicates and shared-session behavior; the cart integration suite verifies rollback, duplicate checkout, stale versions, and overselling with a real replica set.
