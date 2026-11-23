# Category model and module reference

This guide explains category persistence, routes, hierarchy validation, transactions, product-count calculations, uploads, and relationships with Product and storefront reads. For endpoint contracts and examples see [Category API guide](../CATEGORY.md), [Product](../PRODUCT.md), and the deeper [Product implementation reference](../product/README.md).

## Scope and request flow

Categories form a parent/child tree used to organize products. Public APIs expose active categories and visible subtrees. Admin-authenticated APIs expose all categories and allow create, update, move, deactivate, and delete operations. Category creation and hierarchy changes share a transaction guard with product assignments so category state cannot race against product writes.

```text
HTTP /api/v1/categories request
  ├─ public list/tree/root/children/slug routes
  │    validation → controller → categoryService
  │       → snapshot transaction → categoryRepository
  │       └─ productRepository aggregate supplies product counts
  └─ admin routes
       adminAuthentication → upload/validation → controller/service
          → hierarchy write transaction + shared guard
             → categoryRepository and productRepository checks
```

## File map

| File | Responsibility |
| --- | --- |
| [`category.interface.ts`](../../src/DB/models/category/category.interface.ts) | Category data shape and hydrated document type. |
| [`category.model.ts`](../../src/DB/models/category/category.model.ts) | Category schema, defaults/constraints, refs, and indexes. |
| [`category.repository.ts`](../../src/DB/repository/category.repository.ts) | Category queries/writes, active/tree helpers, and transaction entry points. |
| [`category.transaction.ts`](../../src/DB/repository/category.transaction.ts) | Snapshot reads and serialized hierarchy write transactions using a database guard record. |
| [`db.repository.ts`](../../src/DB/repository/db.repository.ts) | Generic persistence base inherited by CategoryRepository. |
| [`category.routes.ts`](../../src/Modules/category/category.routes.ts) | Public routes first, then admin-authenticated routes. |
| [`category.validation.ts`](../../src/Modules/category/category.validation.ts) | Zod schemas for public queries, create/update bodies, IDs, and slugs. |
| [`category.dto.ts`](../../src/Modules/category/category.dto.ts) | DTOs inferred from validation schemas. |
| [`category.controller.ts`](../../src/Modules/category/category.controller.ts) | Express request/response adapter and upload context passing. |
| [`category.service.ts`](../../src/Modules/category/category.service.ts) | Hierarchy rules, public visibility, trees, product counts, CRUD and deletion constraints. |
| [`category.authorization.ts`](../../src/Modules/category/category.authorization.ts) | Present but empty; route authorization is applied directly by `category.routes.ts`. |
| [`upload.policies.ts`](../../src/Utils/storage/upload.policies.ts) | Category image field, size/count, and multipart body conversion policy. |
| [`product.repository.ts`](../../src/DB/repository/product.repository.ts) | Product existence checks and per-category count aggregation used by category logic. |

## Category data model

| Field | Meaning and constraints |
| --- | --- |
| `name` | Required, trimmed, 2–100 characters. |
| `slug` | Required unique URL key, trimmed/lowercase, 2–120 characters; lowercase letters, numbers and single hyphen separators. |
| `description` | Optional, trimmed, maximum 1000 characters. |
| `image` | Optional trimmed URL/string; API validation requires a valid URL. |
| `parent` | Optional ObjectId reference to another Category. Missing means root category. |
| `isActive` | Boolean, defaults true. Inactive categories and descendants beneath inactive ancestors are hidden publicly. |
| `sortOrder` | Nonnegative number, defaults zero. API requires an integer. |
| `createdBy` | Required ObjectId reference to Admin who created the category. |
| `createdAt`, `updatedAt` | Automatic Mongoose timestamps. |

The schema uses `versionKey: false`. Indexes `{ parent: 1, sortOrder: 1 }` support child ordering and `{ isActive: 1, sortOrder: 1 }` support active category ordering. Slugs are unique.

## Routes and access

The router is mounted at `/api/v1/categories`. Public routes are registered before `router.use(adminAuthentication())`; routes afterward require a valid admin access token. The route ordering keeps literal paths such as `/list`, `/tree`, `/root`, and `/slug/:slug` ahead of `/:categoryId`.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /list` | Public | Paginated active categories; optional parent/search/slug filters. |
| `GET /active` | Public | Alias-style active category listing with the same query rules. |
| `GET /root` | Public | Paginated active root categories. |
| `GET /tree` | Public | Complete visible active category tree. |
| `GET /slug/:slug` | Public | Active category by slug, with visibility and product counts. |
| `GET /:categoryId/children` | Public | Paginated direct active children of a publicly visible parent. |
| `GET /:categoryId/tree` | Public | One category and its visible subtree, if its entire ancestry is active. |
| `GET /` | Admin | All categories, including inactive, with direct and subtree counts. |
| `GET /:categoryId` | Admin | One category with counts. |
| `POST /` | Admin; upload limiter and category upload policy | Create category, optionally with image. |
| `PATCH /:categoryId` | Admin; upload limiter and category upload policy | Update fields or move/re-root a category. |
| `DELETE /:categoryId` | Admin | Physically delete only when it has no children or assigned products. |

Unlike Product, category delete is physical after reference checks. Category deactivation is an update using `isActive: false`.

## Validation and DTOs

Create requires name and slug. Description, image URL, parent ObjectId, active state, and sort order are optional. Update requires at least one field; all editable fields are optional. `parent: null` means remove the parent and make the category a root. Unknown keys are rejected by strict objects.

Public query schemas accept:

- `search`, trimmed, 1–100 characters.
- `slug`, using the category slug format.
- `parent`: literal `root` or a 24-character ObjectId where applicable.
- `page`, default 1 and bounded to 100000.
- `limit`, default 20 and maximum 100.
- `sortBy`: `name`, `sortOrder`, or `createdAt`; default `sortOrder`.
- `sortOrder`: `asc` or `desc`; default `asc`.

DTOs are inferred from the Zod body/params/query schemas. Multipart category uploads accept one `image` file up to 5 MB. The upload middleware converts `sortOrder` to a number, `isActive` to boolean, and nullable `parent` values before schema validation.

## Hierarchy transaction design

`categoryTransactions.write` bootstraps a `category_hierarchy_guards` record with ID `category-hierarchy`, then starts a MongoDB transaction using snapshot read concern, majority write concern, and primary read preference. Its first transactional operation increments the guard revision. Every hierarchy-affecting write goes through this shared record, establishing a database-level contention point across application instances and preventing write skew where concurrent operations each validate against stale hierarchy snapshots.

`categoryTransactions.read` wraps a snapshot transaction for consistent public tree/count reads. `CategoryRepository.withHierarchyTransaction` and `withSnapshot` expose these entry points to services.

Product creation and product category reassignment also use `withHierarchyTransaction`; this serializes assignments with category delete/move/deactivation checks. Keep this shared transaction boundary for operations that change category hierarchy or category-product references.

## Service behavior

### Create and move

Create enters the write transaction. If a parent is supplied, it must exist and be active, and walking from the proposed parent to its ancestors must not encounter the category being moved or a preexisting cycle. The service maps only allowed fields, stores parent as ObjectId when present, and stores the admin creator. Duplicate slug errors are translated into a conflict.

Update also enters the write transaction. It loads the category, checks image concurrency if an upload provided an expected prior image, validates a new parent and acyclic ancestry, then performs a validated `findOneAndUpdate`. Passing `parent: null` unsets `parent`; passing an ObjectId moves it under that category. Other supplied fields are mapped explicitly.

The service prevents self-parenting and indirect cycles by walking the proposed ancestor chain. A visited set also detects corrupted cycles defensively. Parent categories must be active. Deactivation does not cascade to children in storage; public visibility hides descendants beneath an inactive ancestor.

### Delete

Delete enters the hierarchy write transaction and checks:

1. The category exists.
2. It has no child categories (the check includes children regardless of active state).
3. No Product document is assigned to it (the product existence query includes inactive products too).

Only then is the category physically removed. This preserves valid product category references and avoids orphaning a subtree.

### Public visibility and ancestry

Public queries are evaluated inside a snapshot. The service builds the active tree, collects visible category IDs, and filters the requested listing to those IDs before pagination and count computation. This matters because a child can be marked active while an ancestor is inactive; that child must still be hidden and must not leak through listing totals.

Slug and ID tree lookups verify the selected category and every ancestor are active. Missing, inactive, broken ancestry, and cycles return the same not-found behavior for public access. Public child listing first confirms the parent is publicly visible.

### Trees and product counts

The active tree is assembled in two passes: create nodes for every active category, then attach each node to its active parent or add it to roots. A child whose parent is not present in the active map is not attached as a root; this prevents children of inactive parents from appearing publicly.

Tree nodes carry `productCount` and `totalProductCount`:

- `productCount` is the number of products assigned directly to the category.
- `totalProductCount` includes direct products and products in all descendant categories.

The service asks `productRepository.countProductsByCategory` for grouped direct counts. It walks each category’s ancestors to add totals. Public counts aggregate only active products and exclude categories with hidden/broken ancestry. Admin category results include inactive categories and count all assigned products. These counts are computed when serving requests, not stored in Category.

## Repository methods

`CategoryRepository` extends `DatabaseRepository<ICategory>` and exports singleton `categoryRepository`.

| Method | Purpose |
| --- | --- |
| `withHierarchyTransaction(work)` | Run a hierarchy write under the shared guard transaction. |
| `withSnapshot(work)` | Run consistent snapshot read work. |
| `findPublicCategories(filter, options, session?)` | Active filtered/paginated listing, sorted by selected field with `_id` tie-break; returns total and pages. |
| `createCategory(data, session?)` | Create inside optional transaction. |
| `findCategoryById(id, session?)` | Find category by ObjectId. |
| `findCategoryBySlug(slug, session?)` | Find active category by slug. |
| `findCategories(filter, session?)` | Generic category list. |
| `findChildCategories(parentId, session?)` | Active direct children ordered by sortOrder/name. |
| `findRootCategories(session?)` | Active roots ordered by sortOrder/name. |
| `findActiveCategories(session?)` / `findAllActiveCategories(session?)` | Active category reads; used to build trees. |
| `updateCategory(filter, update, session?)` | Validated conditional update returning the updated document. |
| `deleteCategory(id, session?)` | Physical delete inside optional transaction. |
| `hasChildCategories(parentId, session?)` | Check whether any direct children exist. |
| `findActiveCategoryById` / `findActiveCategoryBySlug` | Strict active lookup helpers used by Product and category validation. |
| `findActiveRootCategories` / `findActiveChildCategories` | Active hierarchy traversal helpers. |

`DatabaseRepository` also supplies generic create/find/paginate/update/delete helpers, but hierarchy service code uses the specialized methods so it can pass sessions and apply active-state rules.

## Relationships with Product and other features

### Product assignment

Each Product has one required `category` reference. Product creation and reassignment require the target category to be active and execute within the same hierarchy write transaction used by category mutations. Category delete is blocked while any product (active or inactive) references it. Category `productCount` values come from grouping Product documents by this reference.

### Storefront catalog and home

Product public category filtering validates that the category is active. Category visibility additionally depends on every ancestor being active. Public category trees and lists provide the hierarchy for browsing; home modules may combine category lists with latest products and other sections. See [Home and dashboard guide](../HOME_DASHBOARD_BANNERS.md).

### Category image storage

Category image uploads are handled by shared upload middleware. The policy stores one image under the categories module’s image folder, max 5 MB. Update passes an expected old image value into service logic to avoid overwriting a newer image if concurrent uploads complete out of order. See [File uploads](../FILE_UPLOADS.md).

## Maintenance notes

1. Keep hierarchy-affecting writes in `withHierarchyTransaction`; a normal transaction without the guard can allow conflicting cross-request hierarchy decisions.
2. Keep public visibility ancestry-aware. Filtering only on a category’s own `isActive` flag can expose a child under an inactive parent.
3. Preserve cycle checks when moving a category and validate the complete ancestor chain.
4. Do not physically delete categories while any Product references them or children remain; update Product/category rules together if changing this policy.
5. Keep product counts computed from current Product references and distinguish direct counts from descendant-inclusive totals.
6. Keep category assignment and deletion serialized through the shared hierarchy guard.
7. When adding category input fields, update model constraints, Zod schemas, DTOs, service field allowlists, upload conversion rules, and public output behavior.
8. Category images and product images have separate upload policies and storage paths.
