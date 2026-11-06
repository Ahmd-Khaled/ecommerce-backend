# Product module

Source: [routes](../src/Modules/product/product.routes.ts), [validation](../src/Modules/product/product.validation.ts), [DTOs](../src/Modules/product/product.dto.ts), [controller](../src/Modules/product/product.controller.ts), [service](../src/Modules/product/product.service.ts), [repository](../src/DB/repository/product.repository.ts), [model](../src/DB/models/product/product.model.ts).

Prefix: `/api/v1/products`. Products hold catalog data, current selling price, stock, category reference, and active status. Cart lines store references and quantities; they do not duplicate catalog prices.

## Every route

| Method and suffix | Access/input | Controller -> service -> repository | Success response |
| --- | --- | --- | --- |
| GET `/list` | Public; `publicProductListSchema` | `getPublicProducts` -> `getProducts` -> `listProducts(query, true)` -> `findProducts` and `countProducts` | 200, `data.products` and `data.pagination` |
| GET `/slug/:slug` | Public; `productSlugSchema` | `getProductBySlug` -> same -> `findProductBySlug`; reject inactive | 200, `data.product` |
| GET `/category/:categoryId` | Public; category ID and list query validation | `getProductsByCategory` -> same -> `getProducts` with category -> list queries | 200, products/pagination |
| GET `/:productId` | Public; `productIdSchema` | `getProductById` -> `getActiveProductById` -> `getProductOrThrow` -> `findProductById` | 200, `data.product` |
| GET `/` | ADMIN; list query validation | `getAdminProducts` -> same -> `listProducts(query, false)` -> find/count | 200, active and inactive products/pagination |
| POST `/` | ADMIN; `createProductSchema` | `createProduct` -> same with authenticated creator -> validate category -> `createProduct` | 201, `data.product` |
| PATCH `/:productId` | ADMIN; ID + `updateProductSchema` | `updateProduct` -> same -> read existing, validate merged prices/category -> `updateProduct` | 200, `data.product` |
| DELETE `/:productId` | ADMIN; ID validation | `deleteProduct` -> same -> read existing -> `deleteProduct` | 200, success/message |

All names refer to the product controller/service/repository. Authentication is installed after public routes and before admin routes. Service helpers `getProductBySKU()` and management `getProductById()` do not have separate HTTP endpoints in this router. Do not invent `/sku/:sku` from the presence of a helper.

## Public and admin listing

Allowed query keys are `page`, `limit`, `search`, `minPrice`, `maxPrice`, `sortBy`, and `sortOrder`. Defaults: page 1, limit 20, sortBy `createdAt`, sortOrder `desc`. Limit is at most 100. SortBy allows `createdAt`, `price`, and `name`. Query numeric strings are converted to numbers. Prices must be nonnegative and minPrice cannot exceed maxPrice.

`GET /api/v1/products/list?search=phone&minPrice=100&maxPrice=1000&sortBy=price&sortOrder=asc`.

The service escapes regex metacharacters and searches name or description. It builds one matching filter for both document retrieval and count. Pagination includes page, limit, total, totalPages, hasNextPage, and hasPreviousPage. Public listing forces `isActive: true`; admin listing does not.

The HTTP query schema does not accept a `category` query key even though the service DTO supports category filtering. Use `/category/:categoryId`. That endpoint validates the referenced category as active and matches products assigned directly to it, not all descendant categories.

Product visibility differs from category visibility: product detail/list generally checks the product's own `isActive`. Category-filtered listing checks the direct category; it does not walk the complete category ancestry. Do not assume category tree rules are automatically applied to every product endpoint.

## Create request

```json
{
  "name": "Example Phone",
  "slug": "example-phone",
  "description": "A sample phone for the catalog.",
  "sku": "PHONE-001",
  "price": 500,
  "compareAtPrice": 600,
  "stock": 10,
  "images": ["https://example.com/phone.jpg"],
  "category": "507f1f77bcf86cd799439011"
}
```

Name is 2-150 characters, description 10-5000, slug 2-180 and normalized lowercase, SKU 3-100 and normalized uppercase. Slug/SKU use alphanumeric segments separated by hyphens. Images must contain 1-10 URLs. Stock is a nonnegative integer and defaults to zero. Price is nonnegative; an optional compare-at price must be strictly greater than selling price. The service validates the active category, converts its string ID to ObjectId, and adds `createdBy` from the admin token.

Creation does not accept `isActive` in its strict HTTP body; the model defaults it to true. Updates can change it. Slug and SKU unique indexes enforce uniqueness; the service maps duplicate errors to specific 409 messages.

## Update request and effective prices

All allowed update fields are optional, but the body cannot be empty. It accepts catalog fields plus `isActive`. `compareAtPrice: null` removes the optional comparison price using `$unset`. Omission leaves it unchanged.

The service first loads the existing document, then computes the effective selling price and comparison price from old and supplied values. It rejects a comparison price less than or equal to the resulting selling price. This matters for `{ "price": 650 }`: an existing compare-at price of 600 would become invalid even if the request did not mention it.

The repository uses `findByIdAndUpdate` with validators and returns the updated document. The model also has comparison-price validation and a pre-validation hook for documents. These checks do not make an admin read/validate/write sequence a multi-document transaction.

## Deletion, inventory, and errors

Deletion is permanent and currently does not check historical order references. The source contains a future-work comment about that. Deactivation via PATCH preserves the record. Existing cart responses flag deleted/inactive products; checkout rejects them. An order keeps its quantity/price snapshot even if the catalog changes.

Cart additions never reduce `stock`. Transactional checkout deducts stock only with an active-product, exact-price, and sufficient-stock predicate. See [Order](ORDER.md).

Invalid inputs return 400; missing/inactive public products return 404; duplicate slug/SKU returns 409; admin authentication/role failures return 401/403. Product tests are in `tests/product.service.test.cjs`. The last full run recorded an existing test mismatch between expected `$set` update shape and the service's top-level fields plus `$unset`; documentation does not change that implementation.
