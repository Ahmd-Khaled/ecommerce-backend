# Category module

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

Hierarchy checks and writes use separate database operations. They are not protected by the cart checkout transaction and do not promise serializable hierarchy changes. Public list building also performs several reads rather than one snapshot. Existing tests cover visibility, cycle checks, product counts, deletion protection, and HTTP authorization; see `tests/category.*.test.cjs`.
