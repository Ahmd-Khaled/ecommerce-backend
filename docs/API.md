# API Reference

This document describes the HTTP API currently registered by the application. Unless stated otherwise, request and response bodies use JSON. The API prefix is `/api/v1`; the server port is configured by `PORT` (defaults to `4000`).

## Conventions

- **Authentication:** customer routes use a bearer access token (`Authorization: Bearer <accessToken>`); admin routes use the admin access token. Login and refresh responses also set an HttpOnly refresh-token cookie. Refresh and logout endpoints that use refresh cookies require the cookie to be sent by the client. Cookie names are `refreshToken` for customers and `adminRefreshToken` for admins.
- **Roles:** “Admin” means an authenticated admin account. Admin account management is additionally restricted to super-admins. Customer cart, order, address, and customer profile routes require the `USER` role.
- **IDs:** MongoDB IDs are 24-character hexadecimal strings.
- **Success:** most JSON responses use `{ "success": true, ... }`. Resource endpoints usually put results under `data`; auth endpoints sometimes use `user`, `admin`, or top-level `tokens`. `204` responses have no body.
- **Errors:** `{ "message": "...", "stack": ..., "cause": ... }`; `stack` and `cause` are included only in development mode. Validation failures use HTTP 400 and include `cause` entries with the request section and field issues. Common statuses are 400 validation/business input error, 401 unauthenticated, 403 forbidden, 404 missing resource, 409 conflict, 413 upload too large, 429 rate limited, and 500 unexpected error.
- Strictly validated JSON objects reject unknown fields. Query values that are numeric are commonly passed as strings and coerced by validation.

## Health and media

## Homepage, banners, and dashboard

See [Homepage, dashboard, banners, and request language](HOME_DASHBOARD_BANNERS.md) for fields, metric definitions, examples, pagination, and refund limitations. New module messages and banner selection use `Accept-Language` (`ar`/`en`, default `en`), with `Content-Language` and `Vary: Accept-Language` response headers. Admin routes below use `Authorization: admin <accessToken>`.

| Method and path (under `/api/v1`) | Access | Purpose |
| --- | --- | --- |
| `GET /home?view=desktop&limit=8` | Public | Banners, categories, latest products, best offers/deal, best sellers |
| `GET /home/products?section=latest&page=1&limit=20` | Public | Paginated `latest`, `best-offers`, or `best-sellers` |
| `GET /banners/list?view=mobile` | Public | Scheduled active banners for header language and view |
| `GET /banners` | Admin | Paginated management list with language/view/status filters |
| `GET /banners/:bannerId` | Admin | Banner details |
| `POST /banners` | Admin | Multipart image and metadata creation |
| `PATCH /banners/:bannerId` | Admin | JSON metadata or multipart replacement |
| `DELETE /banners/:bannerId` | Admin | Delete banner and defer image cleanup |
| `GET /dashboard/overview` | Admin | Current totals and period order/paid-sales metrics |
| `GET /dashboard/sales` | Admin | UTC daily/monthly paid sales grouped by currency/exponent |
| `GET /dashboard/top-products` | Admin | Paginated paid quantities and historical item totals |

### Health and media endpoints

| Method and path | Access | Parameters/body | Success |
|---|---|---|---|
| `GET /test` | Public | None | `200 { "status": true, "message": "Hello World" }` |
| `GET /media/:module/:ownerId/:folder/:filename` | Public, only while the image remains referenced by its owner | Path segments form a generated media key. | `200` image bytes (`image/webp`); missing or unreferenced images return 404. |

Media URLs are returned in resource image/avatar fields. Upload endpoints generate WebP URLs; clients may also provide external HTTP(S) image URLs where allowed.

## Authentication — `/auth`

| Method and path | Access | Request | Success response |
|---|---|---|---|
| `POST /auth/register` | Public | `{ firstName, lastName, email, password, confirmPassword }`. Names 2–30 chars; email valid; confirmation must match. | `201 { success, message }`; sends email verification as a side effect. |
| `POST /auth/confirm-email` | Public | `{ email, otp }` | `200 { success, message }` |
| `POST /auth/resend-confirm-email` | Public | `{ email }` | `200 { success, message }` |
| `POST /auth/login` | Public | `{ email, password }` | `200 { success, user, tokens }`; sets refresh cookie. `tokens` contains access token and token type, not the refresh token. |
| `POST /auth/google` | Public | `{ idToken }` (Google ID token) | `200 { success, user, tokens }`; sets refresh cookie. |
| `POST /auth/google/link` | Customer access token | `{ idToken, currentPassword }` | `200 { success, ...result }` |
| `POST /auth/refresh-token` | Refresh cookie | Empty JSON object `{}` | `200 { success, user?, tokens }`; rotates refresh cookie. |
| `POST /auth/logout` | Customer access token and refresh cookie | Empty JSON object `{}` | `200 { success, ...result }`; clears refresh cookie. |
| `POST /auth/logout-all` | Customer access token | No body | `200 { success, ...result }`; revokes all sessions and clears cookie. |
| `GET /auth/profile` | Customer access token | None | `200 { success, message, ...profile }` |
| `PATCH /auth/profile` | Customer access token | JSON or multipart. JSON fields: `firstName?`, `lastName?`, `phone?` (string or null), `gender?` (valid gender enum or null), `avatar?` (URL in JSON mode), `address?` (array, max 20). Address entries: `{ label, fullName, phone, country, city, street, building?, apartment?, isDefault }`; at most one default. Multipart supports one `avatar` image (max 2 MiB) and JSON-encoded `address`; `avatar` must be a file in multipart mode. At least one field required. | `200 { success, ...result }` |
| `PATCH /auth/change-password` | Customer access token | `{ currentPassword, newPassword }`; new password must differ. | `200 { success, ...result }`; clears refresh cookie. |
| `PATCH /auth/forgot-password` | Public | `{ email }` | `200 { success, ...result }` |
| `PATCH /auth/reset-password` | Public | `{ email, otp, newPassword, confirmPassword }`; confirmation must match. | `200 { success, ...result }`; clears refresh cookie. |
| `POST /auth/test-revoke` | Development mode and customer access token | No body | `200 { success, message, data: { jti, expiresAt } }` |

## Admin authentication and account management — `/admin`

### Admin session

| Method and path | Access | Request | Success response |
|---|---|---|---|
| `POST /admin/auth/login` | Public | `{ email, password }` | `200 { success, admin, tokens }`; sets `adminRefreshToken` cookie. |
| `POST /admin/auth/refresh-token` | Admin refresh cookie | Empty JSON object `{}` | `200 { success, tokens }`; rotates cookie. |
| `POST /admin/auth/logout` | Admin access token and refresh cookie | Empty JSON object `{}` | `200 { success, message }`; clears cookie. |
| `POST /admin/auth/logout-all` | Admin access token | No body | `200 { success }`; revokes all admin sessions and clears cookie. |
| `GET /admin/auth/profile` | Admin access token | None | `200 { success, admin }` |
| `PATCH /admin/auth/profile` | Admin access token | `{ firstName?, lastName? }`; at least one required. | `200 { success, admin }` |
| `PATCH /admin/auth/change-password` | Admin access token | `{ currentPassword, newPassword }`; must differ. | `200 { success, message }`; clears cookie. |

### Admin account management — `/admin`

Requires a super-admin access token. The same management routes are mounted under `/admin/users` and manage customer accounts (see below).

| Method and path | Query/path/body | Success |
|---|---|---|
| `GET /admin` | Query filters below | `200 { success, data }` |
| `POST /admin` | `{ firstName, lastName, email, password, role? }`; role defaults to `ADMIN`. | `201 { success, data }` |
| `GET /admin/:id` | `id` path parameter | `200 { success, data }` |
| `PATCH /admin/:id` | `{ firstName?, lastName?, role?, status? }`; at least one field. Status: `active` or `frozen`. | `200 { success, data }` |
| `PATCH /admin/:id/status` | Same body as update; status may be `active` or `frozen`. | `200 { success, data }` |
| `DELETE /admin/:id` | `id` path parameter; soft-deletes the account. | `204` no body |

List query filters: `page` (default 1), `limit` (default 20, max 100), `search` (max 100 chars), `role` (admin role enum), `status` (`active`, `frozen`, `deleted`).

### Customer account management — `/admin/users`

Requires a super-admin access token.

| Method and path | Query/path/body | Success |
|---|---|---|
| `GET /admin/users` | Same pagination/search filters, with `role` from customer role enum and `status` in `active`, `pending`, `frozen`, `deleted`. | `200 { success, data }` |
| `POST /admin/users` | `{ firstName, lastName, email, password, role? }`; role defaults to `USER`. | `201 { success, data }` |
| `GET /admin/users/:id` | `id` path parameter | `200 { success, data }` |
| `PATCH /admin/users/:id` | `{ firstName?, lastName?, role?, status? }`; status `active` or `frozen`. | `200 { success, data }` |
| `PATCH /admin/users/:id/status` | Same update body; set `status`. | `200 { success, data }` |
| `DELETE /admin/users/:id` | Soft-delete customer account. | `204` no body |

## Products — `/products`

Public list filters (also used by admin product list): `page` (default 1), `limit` (default 20, max 100), `search` (max 150 chars), `minPrice`, `maxPrice` (nonnegative, min must not exceed max), `sortBy` (`createdAt`, `price`, `name`; default `createdAt`), `sortOrder` (`asc`, `desc`; default `desc`).

| Method and path | Access | Request | Success |
|---|---|---|---|
| `GET /products/list` | Public | List filters above | `200 { success, message, data }` (paginated product collection). |
| `GET /products/slug/:slug` | Public | Slug path parameter (2–180 lowercase letters, digits, hyphens) | `200 { success, message, data: { product } }` |
| `GET /products/category/:categoryId` | Public | Category ID plus list filters | `200 { success, message, data }` |
| `GET /products/:productId` | Public | Product ID | `200 { success, message, data: { product } }` |
| `GET /products` | Admin | List filters above; includes active and inactive products. | `200 { success, message, data }` |
| `POST /products` | Admin | JSON or multipart. Required fields: `name` (2–150), `slug` (2–180), `description` (10–5000), `sku` (3–100, uppercase alphanumeric/hyphen), `price` (number ≥ 0), `images` (1–10 valid URLs), `category` (ID); optional `compareAtPrice` (> price), `stock` (integer ≥ 0; default 0). Multipart may upload up to 10 `images` files (5 MiB each); numeric fields are form strings. | `201 { success, message, data: { product } }` |
| `PATCH /products/:productId` | Admin | JSON or multipart; any nonempty subset of create fields, plus `isActive` boolean. `compareAtPrice` may be null. Multipart supports up to 10 `images` files. | `200 { success, message, data: { product } }` |
| `DELETE /products/:productId` | Admin | Product ID | `200 { success, message }` |

## Categories — `/categories`

Public category filters: `search` (1–100 chars), `slug`, `page` (default 1), `limit` (default 20, max 100), `sortBy` (`name`, `sortOrder`, `createdAt`; default `sortOrder`), `sortOrder` (`asc` or `desc`; default `asc`). Public queries reject unknown filters.

| Method and path | Access | Request | Success |
|---|---|---|---|
| `GET /categories/list` | Public | Category filters plus optional `parent=root` or parent category ID | `200 { success, message, data }` |
| `GET /categories/active` | Public | Category filters | `200 { success, message, data }` |
| `GET /categories/root` | Public | Category filters | `200 { success, message, data }` |
| `GET /categories/tree` | Public | None | `200 { success, message, data: { categories } }` |
| `GET /categories/slug/:slug` | Public | Slug path parameter | `200 { success, message, data: { category } }` |
| `GET /categories/:categoryId/children` | Public | Category ID plus category filters | `200 { success, message, data }` |
| `GET /categories/:categoryId/tree` | Public | Category ID | `200 { success, message, data: { category } }` |
| `GET /categories` | Admin | None | `200 { success, message, data: { categories } }` |
| `GET /categories/:categoryId` | Admin | Category ID | `200 { success, message, data: { category } }` |
| `POST /categories` | Admin | JSON or multipart. `{ name, slug, description?, image?, parent?, isActive?, sortOrder? }`. Multipart supports one `image` file (5 MiB); `sortOrder`/`isActive` are converted from form fields. | `201 { success, message, data: { category } }` |
| `PATCH /categories/:categoryId` | Admin | JSON or multipart; nonempty subset of create fields; `parent: null` moves to root. Multipart supports one `image` file. | `200 { success, message, data: { category } }` |
| `DELETE /categories/:categoryId` | Admin | Category ID | `200 { success, message }` |

## Addresses — `/addresses`

All routes require customer access token. Address fields: `label`, `fullName`, `phone`, `country`, `city`, `street`, `building?`, `apartment?`, `isDefault?`. Text fields are trimmed and bounded; phone must match the accepted international-ish phone pattern.

| Method and path | Request | Success |
|---|---|---|
| `GET /addresses` | None | `200 { success, message, data }` |
| `POST /addresses` | All address fields except `isDefault` is optional. | `201 { success, message, data }` |
| `PATCH /addresses/:addressId` | Nonempty subset of address fields. | `200 { success, message, data }` |
| `PATCH /addresses/:addressId/default` | Empty object `{}` | `200 { success, message, data }` |
| `DELETE /addresses/:addressId` | Address ID path parameter | `200 { success, message, data }` |

## Cart — `/cart`

All routes require a customer access token. Quantity is a positive integer up to the configured cart maximum.

| Method and path | Request | Success |
|---|---|---|
| `GET /cart` | None | `200 { success, message, data }` |
| `POST /cart/items` | `{ productId, quantity? }`; quantity defaults to 1. | `200 { success, message, data }` |
| `PATCH /cart/items/:productId` | `{ quantity }` | `200 { success, message, data }` |
| `PATCH /cart/items/:productId/increase` | `{ quantity? }`; defaults to 1. | `200 { success, message, data }` |
| `PATCH /cart/items/:productId/decrease` | `{ quantity? }`; defaults to 1. | `200 { success, message, data }` |
| `DELETE /cart/items/:productId` | Product ID path parameter | `200 { success, message, data }` |
| `DELETE /cart/clear` | None | `200 { success, message, data }` |

## Orders — `/orders`

### Customer routes

| Method and path | Request/filters | Success |
|---|---|---|
| `POST /orders/checkout` | Customer token. Header `Idempotency-Key` required: 16–128 letters, digits, `_` or `-`. Body `{ version, addressId, items }`, where each item is `{ productId, unitPriceMinor }`; items must be unique, nonempty, within configured cart limit. Prices are integer minor units; submitted cart version and prices are checked against current server state. | `201 { success, replayed: false, data: order }`; same idempotent retry returns `200` with `replayed: true`. |
| `GET /orders` | `page` (default 1), `limit` (default 20, max 100) | `200 { success, data }` |
| `GET /orders/:orderId` | Order ID | `200 { success, data }` |
| `PATCH /orders/:orderId/cancel` | `{ reason? }` (1–500 chars if present) | `200 { success, data }` |

### Admin routes

Requires admin authentication.

| Method and path | Request/filters | Success |
|---|---|---|
| `GET /orders/admin` | `page`, `limit`, optional `status` (order status enum), `user` (customer ID), `from`, `to` (ISO datetimes; from ≤ to). | `200 { success, data }` |
| `GET /orders/admin/:orderId` | Order ID | `200 { success, data }` |
| `PATCH /orders/admin/:orderId/status` | `{ expectedStatus, status, reason? }`; status values are the order status enum. Expected status provides optimistic concurrency control. | `200 { success, data }` |

Orders contain server-calculated line items, monetary totals, shipping snapshot, status, and timestamps. Amounts are stored in minor currency units; inspect returned `currency` and amount field names.

## Payments — `/payments`

Payment checkout uses Stripe. The `Idempotency-Key` header is required for checkout and must be 16–128 letters, digits, `_` or `-`; reuse the same key for a retry on the same order.

| Method and path | Access | Request | Success |
|---|---|---|---|
| `POST /payments/checkout` | Customer access token | `{ orderId }` and `Idempotency-Key` header | `200 { success, data: { orderId, status, amountMinor, currency, checkoutUrl, paidAt } }` |
| `GET /payments/orders/:orderId` | Customer access token, order owner only | Order ID | `200 { success, data: { orderId, status, amountMinor, currency, checkoutUrl, paidAt } }` |
| `POST /payments/webhook` | Stripe signature verification | Raw Stripe JSON body and `Stripe-Signature` header; provider endpoint, not for browser calls. | `200 { received: true }` |

## Request limits and operational behavior

JSON request size limits vary by resource (auth 10 KiB, products 1 MiB, addresses 10 KiB, users 50 KiB, categories 20 KiB, cart 50 KiB, orders 100 KiB, payment checkout 10 KiB). Login, email-code, checkout, and upload routes are rate limited. Exact rate limits are environment/application configuration details.
