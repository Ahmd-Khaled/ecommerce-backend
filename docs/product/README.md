# Product model and module reference

This guide explains product persistence, the product API, its repository, and the relationships with categories, media uploads, cart/wishlist, orders, reviews, and storefront queries. For endpoint contracts and examples see [Product API guide](../PRODUCT.md), [Category](../CATEGORY.md), [Cart](../CART_MODULE.md), [Wishlist](../WISHLIST.md), [Order](../ORDER.md), and [Reviews](../PRODUCT_REVIEWS_COMPLETED.md).

## Scope and request flow

The Product model is the catalog and current-inventory source. It stores descriptions, current price, stock, category, image URLs, active state, and review-summary counters. The product module provides public storefront reads and admin catalog management. It does not own order history or review documents.

```text
HTTP /api/v1/products request
  ├─ customer review router (registered first)
  ├─ public list/detail/category/slug routes
  │    optional USER access token → controller → productService
  │       → productRepository → ProductModel
  │       └─ wishlistRepository adds isFavorited for signed-in USERs
  └─ admin routes
       adminAuthentication → upload/validation (write routes)
          → productController → productService
             → categoryRepository transaction + productRepository
```

Order checkout and review workflows also update Product directly in transactions. Other features such as home sections, dashboard reports, cart, and wishlist read product data through repositories.

## File map

| File | Responsibility |
| --- | --- |
| [`product.interface.ts`](../../src/DB/models/product/product.interface.ts) | Product fields and hydrated document type. |
| [`product.model.ts`](../../src/DB/models/product/product.model.ts) | Product schema, validation, refs, indexes, `ratingsAverage`, JSON transform. |
| [`product.repository.ts`](../../src/DB/repository/product.repository.ts) | Product CRUD/query/count helpers, active/category filters, stock-related lookup support. |
| [`db.repository.ts`](../../src/DB/repository/db.repository.ts) | Generic repository base class inherited by ProductRepository. |
| [`product.routes.ts`](../../src/Modules/product/product.routes.ts) | Review router, public storefront routes, then admin catalog routes. |
| [`product.validation.ts`](../../src/Modules/product/product.validation.ts) | Create/update/ID/slug/list/filter Zod schemas. |
| [`product.dto.ts`](../../src/Modules/product/product.dto.ts) | Request types inferred from schemas plus list-query type. |
| [`product.controller.ts`](../../src/Modules/product/product.controller.ts) | Express adapter, response envelopes, authenticated favorite enrichment, upload context. |
| [`product.service.ts`](../../src/Modules/product/product.service.ts) | Product rules, query construction, active-category checks, price/stock validation, create/update/archive. |
| [`product.authorization.ts`](../../src/Modules/product/product.authorization.ts) | Present but empty; route authorization is applied directly in `product.routes.ts`. |
| [`upload.policies.ts`](../../src/Utils/storage/upload.policies.ts) | Product image multipart policy: field, folder, max count and file size. |
| [`category.repository.ts`](../../src/DB/repository/category.repository.ts) | Category lookup and hierarchy transaction wrapper used by product writes. |
| [`order.repository.ts`](../../src/DB/repository/order.repository.ts) | Checkout snapshotting and atomic stock decrement. |
| [`review.service.ts`](../../src/Modules/review/review.service.ts) | Published-review lifecycle and transactional Product rating counters. |

## Product data model

| Field | Meaning and constraints |
| --- | --- |
| `name` | Required, trimmed, 2–150 characters. |
| `slug` | Required unique URL key, trimmed/lowercase, 2–180 chars, lowercase letters/numbers/hyphens in separated segments. |
| `description` | Required, trimmed, 10–5000 characters. |
| `sku` | Required unique inventory identifier, trimmed/uppercase, 3–100 characters, uppercase letters/numbers/hyphens. |
| `price` | Required nonnegative selling price, represented in major currency units in the product document. Money utilities validate/convert to minor units at transactional boundaries. |
| `compareAtPrice` | Optional nonnegative original/reference price. When present, must be strictly greater than current `price`. |
| `stock` | Required nonnegative integer, default zero. Checkout decrements it transactionally. |
| `images` | Required array of URLs, at least one. API create/update permits at most ten. The upload policy accepts up to ten image files, each up to 5 MB. |
| `category` | Required ObjectId reference to `Category`, indexed. Product service permits only an active category for create/reassignment. |
| `isActive` | Visibility and purchase availability flag; defaults to true. Delete/archive sets it false instead of removing the document. |
| `createdBy` | Required ObjectId reference to the Admin who created the product. |
| `ratingsSum`, `ratingsCount` | Nonnegative safe-integer counters over published reviews. `ratingsSum` is removed from JSON output; it is an internal counter used with count to derive average. |
| `createdAt`, `updatedAt` | Automatic Mongoose timestamps. |

The schema sets `versionKey: false`. It defines a `ratingsAverage` virtual: rounded to two decimals, or zero when there are no published ratings. The JSON transform includes virtuals and removes `ratingsSum`; ordinary hydrated documents still have the internal counter for service logic.

### Indexes

- Unique indexes on `slug` and `sku` support public slug and inventory lookup and reject duplicates.
- `{ category: 1, isActive: 1 }` supports category catalog filtering.
- `{ isActive: 1, price: 1 }` supports visible price filtering.
- `{ createdAt: -1 }` and `{ isActive: 1, createdAt: -1, _id: -1 }` support newest-first listings.
- `{ stock: 1, _id: 1 }` supports stock-oriented queries/reporting.

## Routes and access

The app mounts this router under `/api/v1/products`. `customerReviewRouter` is mounted first, so review-specific nested paths are resolved before the product-ID route and before admin authentication. Public product routes are followed by `adminAuthentication()`; every route registered after that point requires a valid admin.

`optionalCustomer` allows anonymous public browsing. If an Authorization header is present, it must validate as a USER access token; the middleware restricts `RoleEnum.USER`, so guests are not accepted on those personalized storefront routes. An invalid supplied token fails the request rather than falling back to anonymous access.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /list` | Public; optional USER token | Active catalog listing with pagination, search, price and sort filters. |
| `GET /slug/:slug` | Public; optional USER token | Active product by slug. |
| `GET /category/:categoryId` | Public; optional USER token | Active products in an active category. |
| `GET /:productId` | Public; optional USER token | Active product by ID. |
| `GET /` | Admin | Management list, including active and inactive products. |
| `POST /` | Admin; upload limit and multipart upload policy | Create product and store image references. |
| `PATCH /:productId` | Admin; upload limit and multipart upload policy | Update supplied product fields and optionally replace images. |
| `DELETE /:productId` | Admin | Archive product by setting inactive. |

The route order matters: `/list`, `/slug/...`, and `/category/...` are deliberately defined before `/:productId` so static paths are not consumed as IDs.

## Validation and DTOs

Product create/update schemas are strict objects: unrecognized fields fail validation. Create requires name, slug, description, SKU, price, images, and category; stock defaults to zero and compare-at price is optional. Update requires at least one allowed field. `compareAtPrice: null` means clear the field. `images` is an array of 1–10 URLs. The API validates category and product IDs using shared ID validation.

List query accepts:

- `page` default 1 and `limit` default 20, maximum 100.
- `search` trimmed and max 150 characters.
- `minPrice` / `maxPrice`, coerced to finite nonnegative numbers; minimum may not exceed maximum.
- `sortBy`: `createdAt`, `price`, or `name`; default `createdAt`.
- `sortOrder`: `asc` or `desc`; default `desc`.

The DTO types for create, update, ID, and slug are inferred from Zod schemas. `GetProductsDTO` also includes `category`, which is applied by the service for internal category filtering even though the public list query schema itself does not accept a `category` query key.

Multipart upload middleware converts declared numeric, boolean, JSON, and nullable fields according to `productUpload` before the same body schema is checked. Thus create/update can accept uploaded image files plus other parsed form fields.

## Service and repository behavior

### Create

`createProduct` enters `categoryRepository.withHierarchyTransaction`, checks the referenced category is active within the same transaction, validates compare-at price, maps only the editable fields, converts the category string to ObjectId, and records the creating admin ID. Duplicate slug/SKU errors become `ConflictException` with field-specific messages.

Product creation is coordinated with category hierarchy writes so a concurrent category deletion/deactivation cannot race with a new assignment. The category repository wraps the shared category transaction coordinator.

### Reads and listing

Product service distinguishes management reads from storefront reads. Public ID/slug lookups reject inactive products. Management list includes active and inactive records. Public list adds `isActive: true`; an optional category filter is validated against active category state before querying.

Search is escaped as a literal regular expression and matches name or description case-insensitively. Price bounds construct a price range. Sort field/direction are restricted by validation. Product and count queries run together. Pagination includes total pages and next/previous flags.

The repository methods are:

| Method | Purpose |
| --- | --- |
| `countProductsByCategory(activeOnly, session?)` | Aggregate product counts grouped by category, optionally only active products. |
| `createProduct(data, session?)` | Create a product, optionally inside a transaction. |
| `findProductById(id, session?)` | Find by Mongo ID with optional transaction session. |
| `findProductBySlug(slug)` / `findProductBySKU(sku)` | Resolve unique slug or SKU. |
| `findProducts(filter, options)` | Query with skip, limit, sort. |
| `findActiveProducts(filter, options)` | Add `isActive: true` to a query. |
| `findProductsByCategory(categoryId, options)` | Active product query for one category. |
| `countProducts(filter)` / `countActiveProducts(filter)` | Count filtered/all-active documents. |
| `updateProduct(id, update, session?, expected?)` | Conditional validated update; supports image-array compare-and-set and transaction session. |
| `deleteProduct(id)` | Archive by setting `isActive: false`; retains inventory/history. |
| `existsProduct(filter, session?)` | Existence check, used by related feature modules. |

It inherits generic repository methods from `DatabaseRepository`, though product-specific service logic mostly uses the named methods.

### Update

If `category` changes, update runs in a category hierarchy transaction and validates the new category is active. Other changes do not need that transaction. The service computes effective next price and compare-at price, including `null` clearing, and rejects a reference price less than or equal to the selling price. It validates price with money utilities and stock as a safe nonnegative integer, then updates only supplied fields with Mongoose query validators.

Image updates can include an expected prior image array supplied by upload middleware. The repository includes that prior value in the update filter. If another upload changed images after the file operation began, the update fails with a conflict so the caller can retry rather than overwriting newer images.

### Archive

The delete endpoint does not physically remove Product documents. It sets `isActive: false`, retaining the record for old orders, cancellation/restock, reporting, and review history. Inactive products are excluded from storefront, cart availability, wishlist add, and checkout paths.

## Image uploads

The `productUpload` policy accepts up to ten files under multipart field `images`, stores them in the products module’s `images` folder, and caps each at 5 MB. Upload route middleware handles inspection, persistence, conversion of body fields, and cleanup/compensation according to the shared storage utilities. See [File uploads](../FILE_UPLOADS.md) for storage drivers and failure handling.

On create, the controller passes the upload ID into the service so upload lifecycle handling can associate the uploaded files with the created product. On update, upload middleware records the expected existing images; the service/repository uses that value for compare-and-set concurrency protection.

## Relationships with other features

### Category

Product stores one `category` ObjectId ref. Product create and category reassignment require an active Category and coordinate through category hierarchy transactions. Category logic can count products by category through `countProductsByCategory`; category deletion/deactivation rules and transaction behavior are documented in [Category guide](../CATEGORY.md).

### Cart and wishlist

Cart items store a product reference and quantity, not a trusted catalog price. Cart operations verify the product exists, is active, and has stock. Checkout re-reads current product price and availability. Wishlist add likewise requires an active product; wishlist listing resolves only active products. For signed-in USERs, product list and detail responses attach an `isFavorited` boolean, with one batched wishlist query for a page.

### Orders and inventory

Checkout uses a Mongo transaction. For every cart item it loads the active Product, converts the current price to minor currency units, compares it with the client-confirmed price, then conditionally decrements stock only if the product remains active, price unchanged, and stock is sufficient. The order stores a snapshot of product name, SKU, quantity, unit price, and line total. Later product edits therefore do not rewrite the purchase description or price in order history.

Order cancellation/restock uses product references and guarded stock updates, while archival preserves products needed by historical orders. See [Order guide](../ORDER.md) for lifecycle and stock restoration details.

### Reviews and rating aggregates

Reviews refer to Product by ID and require an active product for public listing and review creation. Only published reviews contribute to `ratingsSum` and `ratingsCount`. Review create/edit/withdraw/moderation updates the counters in Mongo transactions alongside review state transitions. `ratingsAverage` derives from those counters; `ratingsSum` is hidden in JSON. See [Review implementation documentation](../PRODUCT_REVIEWS_IMPLEMENTATION_PLAN.md) for review state and moderation details.

### Home and reporting

Home sections and dashboards query products for latest products, featured/catalog summaries, and top-product reporting. Product creation time, category, active state, price, stock, and order snapshots feed those read models. Their behavior is covered in [Home/Dashboard/Banners](../HOME_DASHBOARD_BANNERS.md).

## Maintenance notes

1. Keep price arithmetic in the money utilities and preserve the documented currency unit at each boundary; checkout/order snapshots use minor units.
2. Keep stock changes conditional and transactional with order writes. A read-then-unconditional decrement can oversell inventory.
3. Keep the category transaction coordination for create/reassignment so category state cannot race with product assignment.
4. Archive instead of physically deleting products while orders, cancellations, reviews, or reports reference them.
5. Update published-review counters in the same transaction as review-state changes; do not calculate average from all submitted reviews.
6. Keep `ratingsSum` internal and `ratingsAverage` derived so API output does not expose a mutable internal sum.
7. Preserve expected-image compare-and-set behavior for upload updates to avoid stale uploads replacing newer images.
8. When adding a product field, update model constraints, create/update validation, DTOs, service allowlists, order snapshots where relevant, and explicit API behavior.
9. Keep public reads filtered to active products, while management reads may include inactive products.
