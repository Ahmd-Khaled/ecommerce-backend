# Cart model and module reference

This guide documents cart persistence, the cart API layers, concurrency behavior, and how carts interact with User, Product, money configuration, and order checkout. The existing [Cart module walkthrough](../CART_MODULE.md) remains the route-by-route API reference; deployment and checkout notes are in [Cart and checkout](../CART.md).

## Scope and lifecycle

A cart is one mutable shopping list per customer User. It stores Product references and quantities only; it does not reserve stock or store a trusted price. Responses hydrate current Product information and calculate current totals. Checkout later revalidates product state and price, reserves stock atomically, creates an order snapshot, and empties the cart in one transaction.

```text
HTTP /api/v1/cart
  → USER-only access authentication
  → validation (mutations)
  → cartController
  → cartService
      ├─ cartRepository → CartModel
      └─ productRepository → ProductModel (availability/current display price)

POST /api/v1/orders/checkout
  → orderService → orderRepository transaction
      ├─ reads Cart and its version
      ├─ validates saved User address
      ├─ rechecks Products and current prices
      ├─ decrements Product stock
      ├─ creates Order snapshots
      └─ clears Cart and increments its version
```

## File map

| File | Responsibility |
| --- | --- |
| [`cart.interface.ts`](../../src/DB/models/cart/cart.interface.ts) | Cart and embedded item TypeScript shapes. |
| [`cart.model.ts`](../../src/DB/models/cart/cart.model.ts) | Cart schema, Product/User references, quantity constraints, optimistic concurrency, unique user index. |
| [`cart.repository.ts`](../../src/DB/repository/cart.repository.ts) | Read/create/delete cart persistence, including race-safe upsert. |
| [`db.repository.ts`](../../src/DB/repository/db.repository.ts) | Generic repository base inherited by CartRepository. |
| [`cart.routes.ts`](../../src/Modules/cart/cart.routes.ts) | USER-only router and operation-specific validation. |
| [`cart.validation.ts`](../../src/Modules/cart/cart.validation.ts) | Product ID and quantity Zod schemas. |
| [`cart.dto.ts`](../../src/Modules/cart/cart.dto.ts) | Request DTOs inferred from validation schemas. |
| [`cart.controller.ts`](../../src/Modules/cart/cart.controller.ts) | Express adapters and response envelopes. |
| [`cart.service.ts`](../../src/Modules/cart/cart.service.ts) | Add/update/adjust/remove/clear rules, concurrency retry loop, product enrichment and totals. |
| [`cart.config.ts`](../../src/Modules/cart/cart.config.ts) | Lazy cart item/quantity limits from environment variables. |
| [`cart.authorization.ts`](../../src/Modules/cart/cart.authorization.ts) | Present but empty; the router directly applies shared `authentication()` with USER role. |
| [`product.repository.ts`](../../src/DB/repository/product.repository.ts) | Product lookup used for availability, price, and stock checks. |
| [`order.service.ts`](../../src/Modules/order/order.service.ts) | Checkout request parsing and delegation. |
| [`order.repository.ts`](../../src/DB/repository/order.repository.ts) | Transactional checkout, idempotency, price confirmation, stock decrement, order snapshot, cart clear. |
| [`money.ts`](../../src/Utils/money.ts) | Currency exponent and safe major/minor unit conversions. |

## Data model and relationships

### Cart document

`ICart` has:

- `user`: required ObjectId reference to `User`.
- `items`: array of `{ product, quantity }` entries.
- Mongoose `_id`, `createdAt`, `updatedAt`, and `__v` version key.

Each item’s `product` is a required ObjectId reference to `Product`; `quantity` is a required integer with minimum one. Item subdocuments disable their own `_id`, since each Product can appear only once in the cart array. The schema defaults `items` to an empty array.

The cart schema enables `optimisticConcurrency`, and a unique index on `{ user: 1 }` enforces at most one cart per User. There is no automatic cascade from User deletion to Cart deletion in this model; authenticated access and User lifecycle are controlled by the auth layer. `deleteCartByUser` exists for explicit cleanup but normal clear-cart behavior preserves the document.

### No stored price or stock reservation

Cart items intentionally contain no name, SKU, unit price, image, or stock snapshot. These values can change after an item is added. The cart response looks up current product details and computes a display subtotal. Adding an item checks available stock, but does not decrement/reserve it. Checkout is the authoritative purchase boundary.

## Access, routes, and validation

The router requires `authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER])` for every route. The authenticated user ID comes from `req.user`; clients cannot choose or submit a different cart owner. Guest customer tokens and admin tokens do not satisfy the USER role requirement.

Routes are mounted under `/api/v1/cart`:

| Method and path | Input | Service operation |
| --- | --- | --- |
| `GET /` | None | Read cart; absent cart returns a synthesized empty response and does not create a row. |
| `POST /items` | Product ID, quantity default 1 | Add quantity to existing line or append a line; creates cart if needed. |
| `PATCH /items/:productId` | Positive quantity | Replace line quantity. |
| `PATCH /items/:productId/increase` | Positive quantity default 1 | Add requested amount to the line. |
| `PATCH /items/:productId/decrease` | Positive quantity default 1 | Subtract amount, or remove the line when current quantity is one. |
| `DELETE /items/:productId` | Product ID | Remove that line. |
| `DELETE /clear` | None | Empty the items array while retaining the Cart document. |

Product IDs are validated through the shared ID schema. Quantity must be an integer of at least one and no more than configured `CART_MAX_QUANTITY`. Add, update, and adjustment bodies are strict objects. The decrease route treats quantity as a positive decrement amount, not a resulting target quantity.

All successful operations return HTTP 200 and `{ success, message, data }`.

## Cart limits and configuration

`cartLimits()` reads configuration lazily so dotenv can load before values are used:

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `CART_MAX_ITEMS` | 50 | Maximum number of distinct product lines in one cart. |
| `CART_MAX_QUANTITY` | 100 | Maximum cumulative quantity for a product line. |

Both must be positive safe integers. The quantity schema and service use this limit, including after additions and increases. The service also checks `CART_MAX_ITEMS` when adding a new distinct item. Existing carts are not silently truncated if an operator lowers limits; reducing/removing items remains possible.

## Service behavior

### Mutation and optimistic concurrency

All cart writes go through `CartService.mutate`:

1. Read the current cart. For add only, create it if missing.
2. Apply the requested change to that freshly loaded document, performing product and limit checks as needed.
3. Save the document. Mongoose optimistic concurrency conditions the write on its version (`__v`) and advances it.
4. If Mongoose raises `VersionError`, discard the stale in-memory document, re-read and revalidate, and retry up to three attempts.
5. After three conflicts, return a conflict response. Other errors are propagated and are not blindly retried because the write outcome may be ambiguous.

The retry always recalculates against current state. It never replays a stale object over a concurrent change.

### Race-safe cart creation

`createCart` uses `findOneAndUpdate` with `upsert` and `$setOnInsert`, so parallel first add requests converge on one cart. The unique user index selects one winner. If another request wins the index race and the upsert reports duplicate key, the repository reads and returns the winning cart. `GET /` does not call this method; only a mutation that needs a cart creates one.

### Add and quantity changes

- Add first resolves an active Product and validates the current price can be represented by money utilities.
- If a line already exists, the request quantity is added to it. The cumulative result must stay within max quantity and current stock.
- For a new line, the distinct-item limit is checked and requested quantity must fit stock.
- Increase validates the resulting quantity and product availability/stock.
- Decrease removes the line when the existing quantity is exactly one, regardless of requested decrement size. If current quantity is above one but the result would be less than one, it returns a bad request.
- Absolute quantity update checks availability/stock when the new quantity is greater than or equal to the old quantity. A reduction is allowed even if the product is now inactive or out of stock.
- Remove and clear do not require products to remain active.

### Product availability and stock

An add/increase operation requires a valid Product ObjectId, an existing active Product, and enough stock at the time of the check. These are advisory checks, not a reservation. Stock may change before checkout, so checkout repeats the checks and atomically decrements stock.

Reducing or removing lines remains possible for inactive/deleted products so a customer can clean up an old cart. Such lines count toward distinct-line and total quantity limits until changed or removed.

## Cart response construction

`buildCartResponse` loads current products for all lines and returns:

- `items`, with `product`, stored `quantity`, `available`, `subtotal`, and `subtotalMinor`.
- For active products, current `_id`, name, slug, price, images, stock, and active flag; current unit price in minor units; and computed subtotals.
- For missing/inactive products, only a minimal product ID, `available: false`, and zero subtotals.
- `currency` and `currencyExponent` from `storeMoney()`.
- `subtotal` in major currency units and `subtotalMinor` in minor units.
- `totalItems`, which sums quantities across lines (not distinct line count).
- `version`, taken from `cart.__v` and used by checkout to detect stale review state.

An active Product whose stock is now below the cart quantity is still returned with its current subtotal, but `available` is false. Therefore a displayed subtotal does not imply all items can be checked out.

If no cart document exists, the response has empty items, zero totals, the configured store currency, and version zero without persisting anything.

## Checkout handoff

The cart response gives the client a version and current price values to review. Checkout requires an Idempotency-Key, saved address ID, reviewed cart version, and a minor-unit price confirmation for each product. Quantities are read from the stored cart and are not accepted from the client.

Within a MongoDB transaction, the order repository:

1. Checks whether the idempotency key already has an order and verifies the request fingerprint.
2. Reads Cart and requires nonempty items, expected `__v`, and configured line/quantity limits.
3. Verifies the submitted product set and reviewed prices match the cart request.
4. Loads the chosen address from the owning User document and snapshots shipping details.
5. Re-reads each active Product, compares current price with the client-confirmed minor-unit value, and conditionally decrements stock only if product active state, price, and sufficient stock still match.
6. Creates an Order containing immutable name, SKU, quantity, price, and line total snapshots.
7. Clears cart items and increments cart `__v` using a version condition.

Any failure rolls back the transaction. A changed cart, price, unavailable product, insufficient stock, or lost version race prevents checkout. On successful checkout the same Cart document remains but is empty with a newer version. See [Order guide](../ORDER.md) and [Cart deployment notes](../CART.md) for exact request behavior and transaction requirements.

## Money handling

Product `price` is represented in major units in the catalog. Cart responses expose both major and minor units using configured currency exponent. `toMinor` validates and converts a price; `safeMoney` guards arithmetic totals against unsafe integer results. Checkout confirms and stores `unitPriceMinor` values, so rounding and currency precision are handled at the purchase boundary rather than trusting a client’s major-unit float.

## Error behavior overview

| Condition | Typical result |
| --- | --- |
| Invalid product ID or quantity | 400 validation/business error. |
| Product not found/inactive for add or increase | 404. |
| Missing cart for update/remove/clear | 404. |
| Product line missing for item operation | 404. |
| Quantity exceeds configured cap, cart line cap reached, or insufficient stock | 400. |
| Repeated optimistic concurrency conflicts | 409; refresh and retry. |
| Checkout sees changed cart/price/stock/availability | 409; refresh cart and review again. |

## Maintenance notes

1. Keep cart ownership derived from authenticated `req.user`; never accept an arbitrary owner ID from the client.
2. Preserve the unique User index and upsert duplicate-race recovery so one User cannot acquire two carts.
3. Keep optimistic concurrency and revalidation on retry; do not retry ambiguous database errors as if they were version conflicts.
4. Do not add a trusted price snapshot to Cart without defining how it is refreshed and how checkout reconciles it.
5. Treat cart stock validation as advisory. Only transactional checkout reserves/decrements inventory.
6. Keep reductions/removals possible for unavailable products so customers can recover stale carts.
7. Keep the response `version` synchronized with checkout's expected version check and increment when checkout clears the cart.
8. Preserve checkout idempotency and transactional rollback across stock changes, order creation, and cart clearing.
9. If changing limits, update both Zod schema and service validation; the runtime configuration is intentionally read lazily.

