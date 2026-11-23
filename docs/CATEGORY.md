# Category module

For a file-by-file explanation of the Category model, hierarchy transaction guard, routes, repository and service rules, product counts, visibility ancestry, and product relationships, see the [Category implementation reference](category/README.md).

Source: [routes](../src/Modules/category/category.routes.ts), [validation](../src/Modules/category/category.validation.ts), [controller](../src/Modules/category/category.controller.ts), [service](../src/Modules/category/category.service.ts), [repository](../src/DB/repository/category.repository.ts), [model](../src/DB/models/category/category.model.ts).

Prefix: `/api/v1/categories`. Categories are a hierarchy: a root has no `parent`, and a child stores another category's ObjectId. The public storefront only shows active categories connected through active ancestors to a root. Admin reads can include inactive categories.

## Every route

Names are methods on `categoryController` and `categoryService`. All successful reads/updates/deletes use 200; creation uses 201.

| Method and suffix | Access and validation | Controller -> service | Database work / response data |
| --- | --- | --- | --- |
| GET `/list` | Public; `publicCategoryListSchema` | `getPublicCategories` -> same | Visible IDs, filtered/paged repository lookup, product counts; `{ categories, pagination }` |
| GET `/active` | Public; same list schema | `getActiveCategories` -> same -> `getPublicCategories` | Alias of public listing |
| GET `/root` | Public; `publicRootCategoriesSchema` | `getRootCategories` -> same -> public listing with `parent: 'root'` | Visible roots only |
| GET `/tree` | Public; no input schema | `getCategoryTree` -> same | All active categories assembled into visible roots; `{ categories }` |
| GET `/slug/:slug` | Public; `categorySlugSchema` | `getCategoryBySlug` -> same | Slug lookup, full ancestry check, counts; `{ category }` |
| GET `/:categoryId/children` | Public; `publicChildCategoriesSchema` | `getChildCategories` -> same -> public listing with parent ID | Direct visible children and pagination |
| GET `/:categoryId/tree` | Public; `categoryIdSchema` | `getCategoryTreeById` -> same | Searches visible tree; requested node and descendants in `{ category }` |
| GET `/` | ADMIN access token | `getCategories` -> same | All categories with counts, no pagination; `{ categories }` |
| GET `/:categoryId` | ADMIN; `categoryIdSchema` | `getCategoryById` -> `getCategoryById(id, true)` | ID lookup with admin counts; `{ category }` |
| POST `/` | ADMIN; `createCategorySchema` | `createCategory` -> `createCategory(body, req.user._id)` | Validate ancestry, insert; `{ category }` |
| PATCH `/:categoryId` | ADMIN; `updateCategorySchema` | `updateCategory` -> same | Validate proposed parent chain, update fields; `{ category }` |
| DELETE `/:categoryId` | ADMIN; `categoryIdSchema` | `deleteCategory` -> same | Block children/products, delete; success/message without data |

Public routes are registered before `router.use(authentication(...ADMIN...))`. Therefore the plain ID-detail route is admin-only, while the ID-tree route is public. Literal paths such as `/tree` and `/slug/:slug` appear before generic ID paths.

## Listing and visibility

Supported list query parameters: `search`, `slug`, `parent`, `page`, `limit`, `sortBy`, `sortOrder`. Parent may be `root` or an ObjectId. The root/children variants do not accept an extra parent override. Defaults are page 1, limit 20, sortBy `sortOrder`, sortOrder `asc`. Maximum page is 100000 and maximum limit is 100. Sorting allows `name`, `sortOrder`, or `createdAt`. Unknown filters, including an attempted visibility override, are rejected.

Example: `GET /api/v1/categories/list?parent=root&search=phone&page=1&limit=10`.

`getPublicCategories()` builds the public tree, collects reachable IDs, and restricts the database filter before pagination and counting. Name search escapes regular-expression characters, so input is literal text. A category whose own flag is true is still hidden if an ancestor is inactive or missing. Slug and parent lookups also walk ancestors and reject cycles using a visited set. Hidden and missing categories share a 404 response.

## Creating and updating

```json
{
  "name": "Phones",
  "slug": "phones",
  "description": "Mobile phones and accessories",
  "parent": "507f1f77bcf86cd799439011",
  "isActive": true,
  "sortOrder": 2
}
```

Name and slug are required for creation. Name is 2-100 characters; slug is normalized lowercase, 2-120 characters, and uses letters/numbers separated by hyphens. Description is optional up to 1000 characters; image is an optional URL. `sortOrder` is a nonnegative integer. The controller takes `createdBy` from the authenticated admin, not from JSON.

The service checks that a parent exists and is active, then walks its entire ancestor chain. On update it additionally prevents making the category its own ancestor. Duplicate slug database errors become 409. Updates must provide at least one allowed field. Omitting parent keeps its current value; `parent: null` uses `$unset` to move a category to the root. Setting `isActive: false` hides the branch publicly but does not change descendant flags.

## Tree building and counts

`getCategoryTree()` first creates a map of active category IDs to nodes with empty `children`. A second pass attaches children to parents. Only nodes with no parent become roots, so disconnected branches never appear in the returned root array. Leaves have `children: []`. Tree endpoints are not paginated.

`productCount` is the number of products assigned directly to a category. `totalProductCount` includes products in descendants. The service uses `productRepository.countProductsByCategory()` to aggregate direct counts, then adds each count up its ancestor chain. Public counts include active products in visible categories; admin counts include both statuses. Counts are computed response fields, not counters stored on each category.

## Deletion and failure behavior

Deletion loads the category, checks for any child category (including inactive ones), checks for any assigned product (including inactive ones), and then deletes. Child/product dependency failures return 400, missing records 404, invalid request schema 400, and unauthorized admin access 401/403.

## Transactions and concurrency

Category creation, updates (including active-status changes), and deletion run in MongoDB transactions with snapshot read concern, majority write concern, and primary read preference. Every hierarchy check, dependency check, and write receives the same explicit session. A failed validation or database operation rolls back the entire write. The driver retries transient transaction conflicts, rerunning validation on the new snapshot. Duplicate slugs still return 409; other application errors retain their existing status and message.

Snapshot isolation alone cannot prevent write skew: two requests could update different nodes into a cycle. `category.transaction.ts` therefore increments a shared guard document as the first operation in each write transaction, before any validation reads. Conflicting transactions must retry after the preceding transaction commits. This orders hierarchy mutations across application processes and protects against opposing moves, longer cycles, parent deletion, and ancestor deactivation during validation. The guard lives in `category_hierarchy_guards`, separate from category documents, and is initialized idempotently with majority acknowledgement. It is not a process mutex or an expiring lock.

Product creation and updates that assign a category participate in the same guard and transaction. This closes the assigned-product check/delete race. Other product operations retain their existing behavior. Deactivating a parent remains allowed and hides its descendants; it does not rewrite their active flags. An assignment committed before deactivation may therefore legitimately become hidden afterward.

Public list, slug, tree, and subtree responses use a single snapshot transaction per request. Visibility, ancestry, pagination rows/totals, hierarchy, and product aggregation observe the same database snapshot. Tree assembly reuses the loaded category rows for ancestor count propagation. Operations sharing a session run sequentially; no parallel database operations run within these transactions. Admin reads retain their existing behavior.

### Deployment and operational scope

MongoDB must run as a replica set (including a single-node development replica set) or a transaction-capable sharded cluster. There is no unsafe fallback for standalone MongoDB. All application instances must use this write protocol; direct database writes, imports, and older application versions that bypass the guard are outside its guarantees. Roll out participating category and product writers together. Keep the guard collection intact and permit the application to create/update it.

The shared guard deliberately serializes category writes and product category assignments. This favors correctness for catalog management at the cost of write contention. It does not lock public readers or unrelated product updates. Monitor transaction retries and latency if catalog write volume grows. The design follows MongoDB's [transaction production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

### Tests

`npm run test:category` builds TypeScript and runs category unit, HTTP, and integration tests. Without `MONGO_TEST_URI`, the real-database suite is explicitly skipped. To exercise concurrency and rollback, supply a disposable replica-set test connection:

```powershell
$env:MONGO_TEST_URI = 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true'
npm run test:category
```

The integration suite creates a unique `category_test_*` database and drops only that database afterward; it never uses the application's database URI. It covers concurrent guard initialization, opposing and multi-node cycle attempts, deletion versus child creation/reparenting, ancestor deactivation, deletion versus product creation/reassignment, rollback after successful create/update/delete writes, and snapshot consistency during concurrent hierarchy/product changes. Existing unit and HTTP suites retain validation, visibility, counts, error, and authorization coverage. `npm test` runs the full project suite.

## Local image uploads

Admin create/update routes accept a multipart `image` (one JPEG/PNG/WebP file, 5 MiB), alongside validated form fields. Omission preserves the current image on update. See [FILE_UPLOADS.md](FILE_UPLOADS.md) for examples and lifecycle behavior.
