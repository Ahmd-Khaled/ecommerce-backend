# Wishlist / Favorites

Source: [routes](../src/Modules/wishlist/wishlist.routes.ts), [validation](../src/Modules/wishlist/wishlist.validation.ts), [service](../src/Modules/wishlist/wishlist.service.ts), [repository](../src/DB/repository/wishlist.repository.ts), [models](../src/DB/models/wishlist/wishlist.model.ts).

Prefix: `/api/v1/wishlist`. All routes require a customer access token with role `USER`. Each customer has a private list. `WISHLIST_MAX_ITEMS` defaults to 500 and accepts positive safe integers up to 500.

## Routes

| Method and path | Request | Success |
| --- | --- | --- |
| `GET /` | `limit` (default 20, max 100), optional opaque `after` cursor | Active product rows and `{ limit, hasNextPage, nextCursor }` |
| `POST /items` | Strict JSON `{ "productId": "..." }` | 201 when newly added, 200 if already present |
| `GET /items/:productId` | Product ID | `{ isFavorited: boolean }` |
| `DELETE /items/:productId` | Product ID | Success whether present or absent |

Each list row contains current whitelisted product fields only. Archived or missing products are skipped and can still be removed by ID.

## Product view integration

Authenticated `USER` callers receive `isFavorited` on product list and detail APIs, including category and slug views. This uses one owner-scoped membership query per list response. Anonymous responses keep their existing shape. A supplied invalid access token is rejected.

## Persistence and consistency

The implementation stores a per-user counter document and separate favorite item documents. Unique indexes protect one counter per user and one `(user, product)` row; an owner/time/ID index supports stable newest-first pagination. An atomic conditional counter update reserves a slot before insert. Duplicate races release the reserved slot; a successful delete decrements only when a row was actually deleted. This keeps capacity enforcement safe under concurrent unique additions without a transaction.

Items are not catalog snapshots. Product changes appear on the next read. Favorites do not reserve stock, alter prices, change cart/checkout behavior, or affect order snapshots. A product archive can race an add and leave a reference; reads omit it. Counter drift is possible after process/database failure between separate writes, so operational reconciliation comparing item counts to counters is a future maintenance need.

The list uses an opaque base64url timestamp/item-ID cursor. Pages are ordered by favorite addition time and stable item ID. Archived rows are scanned past to advance pagination. `npm test` runs database-free wishlist service cases as part of the suite; live MongoDB integration depends on an explicitly isolated test database.
