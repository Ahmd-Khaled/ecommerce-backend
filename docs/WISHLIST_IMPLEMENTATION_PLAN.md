# Wishlist / Favorites implementation plan

Status: approved; implementation in progress.

## Goal and approved decisions

Give an authenticated customer a durable, private list of products to revisit. A customer can add or remove favorites, view the list in stable pages with current catalog details, and check favorite state from product views. Favorites are personal organization, not inventory reservations, price locks, or purchase commitments.

- `WISHLIST_MAX_ITEMS=500` per user.
- Authenticated Product List and Detail APIs include `isFavorited`; anonymous API responses remain unchanged. Membership lookup is batched (one set query per response), never one query per product.
- Guest persistence/merge and all alert, sharing, count, and recommendation behavior are out of scope.

## Technical risk review and decisions

- **Concurrency and atomic capacity:** a single wishlist array is vulnerable to concurrent version conflicts and difficult counter-free capacity guards. Use one owner counter document and separate item documents. Atomically reserve capacity with a conditional counter update, and enforce unique `(user, product)` item identity. Duplicate insertion rolls back its reservation; removal deletes once and decrements only when the row was deleted. Counter creation races are handled by the unique owner index and retry. These operations do not require a transaction.
- **Cursor pagination:** use indexed descending `(addedAt, _id)` item-row ordering and a strict tuple cursor predicate. Fetch `limit + 1`; the `(user, addedAt, _id)` index supports owner-scoped traversal. Filtering inactive/missing products can otherwise make a page short or stall, so scan item rows in bounded batches, advancing from the last scanned row until the page fills or the owner rows end. Cursor encodes timestamp and item ID and is validated before querying.
- **Archived products:** add checks active product before reserving; archive races may leave a harmless reference. List joins only active products and skips dangling/archived references while advancing the cursor. Remove/state remain possible by ID. Product details in responses are whitelisted current catalog fields.
- **MongoDB document size:** separate item rows avoid a growing per-user BSON array and its 16 MiB ceiling. Each item is a small bounded document; the owner count remains a single small counter document.
- **Counter drift:** no multi-document transaction is used. Duplicate add and concurrent remove are safe through unique insert and delete-result-guarded decrement. Operational reconciliation can compare owner counts with item counts; document this residual risk.

## API contract

Mount `/api/v1/wishlist` with USER authentication and a small JSON body limit.

| Method/path | Behavior |
| --- | --- |
| `GET /api/v1/wishlist?limit=20&after=<cursor>` | List active products, newest favorite first, with page metadata and current whitelisted fields |
| `POST /api/v1/wishlist/items` | `{ productId }`; 201 when inserted, 200 when already present |
| `DELETE /api/v1/wishlist/items/:productId` | Remove if present; repeated removal succeeds |
| `GET /api/v1/wishlist/items/:productId` | Return `{ isFavorited: boolean }` |

Product list and detail APIs include `isFavorited` only for authenticated USER callers. Anonymous response shape is preserved. The product page membership check is one batched query scoped to the authenticated user.

## Validation and data handling

- Strictly validate IDs and request fields; only add accepts exactly `productId`.
- `WISHLIST_MAX_ITEMS` defaults to 500 and must be a positive safe integer at startup. Enforce it in the atomic counter reservation; duplicate adds do not consume capacity.
- List `limit` defaults to 20 and is bounded to 100. Cursor is opaque base64url containing a valid timestamp and item ObjectId; reject malformed values.
- Product fields are selected explicitly. No user IDs, item records, internal counter values, or raw Mongoose documents are returned.
- Product price, stock, availability, and descriptive fields are current at read time. Favorites have no effect on cart, inventory, checkout, pricing, or order snapshots.

## Exact file map

- Add wishlist owner/item models and interfaces, repository, config, validation, DTO, service, controller, and routes.
- Mount route and initialize both indexes before listening.
- Add batched favorite-state repository method and authenticated enrichment in product list/detail handlers.
- Update `docs/API.md`, `docs/PRODUCT.md`, `docs/README.md`, `docs/Folder_Structure.md`, and create `docs/WISHLIST.md`.
- Add focused service, route, and database integration coverage in `tests/wishlist.*.test.cjs`.

## Acceptance criteria

- A customer can add, list, inspect state, and remove favorites; owners cannot read or mutate another customer's list.
- Duplicate add/repeated remove are idempotent under concurrent calls, and capacity cannot exceed 500 under concurrent unique adds.
- IDs, payloads, cursors, page size, and configured capacity are bounded and validated; malformed/unknown fields are rejected.
- Ordering and pagination are stable for a static dataset; deleted/archived product references do not stall cursors or leak.
- Authenticated product list/detail membership is batched; anonymous product contracts remain unchanged.
- Startup ensures unique and query indexes before requests.
- Regression suite protects auth, product, cart, and order behavior.

## Verification

Add focused tests, then run `npm test` and `npm run build`. Database integration tests use only an isolated test database and report clearly when unavailable.
