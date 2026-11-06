# Category Module - Development Checklist

Reviewed 2026-11-04. No existing TODO.md was present; this checklist follows the supplied requirements.
Checked items are implemented and covered by inspection and/or the category regression tests.

## 1. Category Management
- [x] Implement category creation.
- [x] Implement category updating.
- [x] Handle duplicate category slugs.
- [x] Implement category deletion protection.
- [ ] Ensure category deletion does not break product references.
- [x] Ensure category deletion does not break parent-child relationships.

Product-reference protection is blocked by the absent product model, repository, and reference field contract. Product service, routes and validation are empty. Once products exist, add an unfiltered reference-existence check through their repository before category deletion, including inactive products, and tests for referenced/unreferenced categories. No speculative product schema was introduced.

## 2. Category Hierarchy
- [x] Implement parent and child category relationships.
- [x] Validate category hierarchy.
- [x] Prevent a category from being its own parent.
- [x] Prevent circular category relationships.
- [x] Prevent invalid parent-child relationships.
- [x] Ensure inactive ancestors cannot expose active descendants.

Creation and reparenting validate the complete ancestor chain, rejecting inactive/missing ancestors and existing cycles. Updating with parent: null preserves the existing move-to-root behavior. Deactivation does not rewrite descendant status; public visibility depends on the full ancestry.

## 3. Public Category Browsing
- [x] Implement active-only category queries.
- [x] Implement active-only root category queries.
- [x] Implement active-only child category queries.
- [x] Implement public category details retrieval by slug.
- [x] Ensure public endpoints consistently return active categories.
- [x] Prevent exposing inactive categories through public endpoints.
- [x] Avoid revealing information about hidden or inactive categories.

Lists restrict results to active nodes reachable from active roots before filtering pagination/counts. Slug and parent lookups return the same Category not found response for missing, inactive, orphaned, and cyclic ancestry. Visibility cannot be overridden through query parameters.

## 4. Category Tree
- [x] Retrieve a specific category and its complete visible subtree by ID.

`GET /api/v1/categories/:categoryId/tree` is public and returns `data.category`, including the requested node and nested `children`. Leaves have an empty children array. Invalid IDs return 400; missing or hidden nodes (including inactive, orphaned or cyclic ancestry) return the same 404. The endpoint reuses the existing visible tree and ordering, with no pagination. Regression tests cover multiple descendant levels, hidden branches, non-root nodes, invalid/missing IDs, and the `/slug/tree` route.

- [x] Implement hierarchical category tree retrieval.
- [x] Include only active categories in the public category tree.
- [x] Include only active root categories.
- [x] Include only active child categories.
- [x] Prevent inactive categories from exposing their descendants.
- [x] Ensure the category tree respects the complete ancestor hierarchy.

The existing tree builder already excludes disconnected branches; its behavior is retained and reused for list visibility.

## 5. Authorization & Security
- [x] Protect category management endpoints with admin authorization.
- [x] Restrict category creation to administrators.
- [x] Restrict category updating to administrators.
- [x] Restrict category deletion to administrators.
- [x] Ensure public endpoints do not expose hidden category information.
- [x] Handle unavailable or inactive categories consistently.

Existing access-token authentication and ADMIN role middleware remain in place for management and administrative reads.

## 6. Validation & Error Handling
- [x] Validate category names.
- [x] Validate category slugs.
- [x] Validate parent category IDs.
- [x] Handle non-existent parent categories.
- [x] Handle duplicate category slugs consistently.
- [x] Handle attempts to delete categories that cannot be deleted.
- [x] Return consistent API error responses.

Existing strict Zod validation and global error responses are preserved. Both create and update translate duplicate-key failures to the existing 409 exception. Deletion rejects categories with children regardless of child activity; product restrictions remain pending as noted above.

## 7. Testing
- [x] Test category creation.
- [x] Test category updating.
- [x] Test duplicate slug handling.
- [x] Test category deletion protection.
- [x] Test parent-child relationships.
- [x] Test circular hierarchy prevention.
- [x] Test active-only root categories.
- [x] Test active-only child categories.
- [x] Test public category details by slug.
- [x] Test public category tree retrieval.
- [x] Test inactive ancestor protection.
- [x] Test admin-only management endpoints.
- [x] Test that hidden categories are not exposed through public endpoints.

Run `npm run test:category` (TypeScript build plus Node tests). Tests exercise HTTP routes, validation, authorization and error middleware with mocked token decoding/database calls, plus service and repository behavior. They do not validate a live MongoDB deployment or cryptographic authentication.

## Changed files and reasoning
- `src/Modules/category/category.service.ts`: enforce ancestor visibility on public lists/details/child lookups; validate complete ancestry on creation and reparenting; normalize duplicate slug errors on updates. Preserve existing repository access and tree behavior.
- `tests/category.public.test.cjs`: cover hidden descendants, deep ancestry, missing parents, cycles, tree output, non-disclosing 404s and pagination totals.
- `tests/category.management.test.cjs`: cover creation, updates, hierarchy failures, duplicate slugs, child deletion protection, role restrictions and strict request validation.
- `package.json`: add a repeatable category build/test command.
- `TODO.md`: record each supplied requirement, evidence and the outstanding product dependency.

## Remaining engineering limits
- Hierarchy/deletion checks and writes are separate database operations, as in the existing design. Concurrent reparent/create/delete operations are not serialized. A future concurrency guarantee requires a coordinated write protocol across category and product mutations and database integration tests; current checks do not claim that guarantee.
- Public lists load the active hierarchy to derive visible IDs, then query/count the visible subset. This favors consistency with the existing tree rules but may need database-side traversal for very large taxonomies. Separate reads do not provide snapshot isolation during concurrent changes.
