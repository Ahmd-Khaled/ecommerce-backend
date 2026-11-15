# Homepage, dashboard, banners, and request language

Implemented using the existing Express routes, Zod validation, Mongoose repositories, admin authentication, and shared image storage. All paths below include `/api/v1`. Examples use sample IDs and data; replace tokens, IDs, and files with your own.

## Language and response conventions

Send `Accept-Language: ar` or `Accept-Language: en`. Regional tags (`ar-EG`, `en-US`) and weighted preferences (`ar;q=0.9,en;q=0.5`) are supported. Missing, malformed, or unsupported preferences fall back to English. No language query parameter is accepted on the public banner or homepage APIs.

The global middleware sets typed `req.language`, `Content-Language`, and appends `Accept-Language` to `Vary` without overwriting existing values such as `Origin`. New module success messages use the shared `translate(language, key)` helper, which falls back to the English dictionary for a missing Arabic entry. Existing API messages, validation errors, and product/category content retain their existing behavior; this is not a migration of catalog content or all backend messages to Arabic.

New endpoints use the existing `{ success: true, message, data }` envelope. Delete returns `{ success: true, message }`. Errors retain the existing `{ message }` shape (development mode may add `stack` and `cause`). Dashboard/admin banner endpoints require `Authorization: admin YOUR_ACCESS_TOKEN`, using the same account/session checks as existing admin routes. Both admin and super-admin accounts are allowed; customer/guest credentials are not.

The new routers return `Cache-Control: no-store`. There is no homepage application cache: existing Redis infrastructure serves the email queue and has no catalog/payment invalidation mechanism. No new infrastructure or dependencies were added.

## Banner APIs

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /api/v1/banners/list` | Public | Filter by required `view` and request language; optional pagination |
| `GET /api/v1/banners` | Admin | List all schedules/statuses; optional `language`, `view`, `isActive`, pagination |
| `GET /api/v1/banners/:bannerId` | Admin | Retrieve banner |
| `POST /api/v1/banners` | Admin | Create with an uploaded image |
| `PATCH /api/v1/banners/:bannerId` | Admin | Edit metadata or replace image |
| `DELETE /api/v1/banners/:bannerId` | Admin | Delete record; defer file removal to shared reconciliation |

### Fields and validation

| Field | Create | Rules |
| --- | --- | --- |
| `image` | Required file | One JPEG, PNG, or WebP image, max 5 MiB; normalized to static WebP |
| `language` | Required | `ar` or `en`; identifies stored banner content |
| `view` | Required | `mobile` or `desktop` |
| `title` | Optional | Trimmed string, max 150 characters |
| `altText` | Optional | Trimmed string, max 300 characters |
| `linkUrl` | Optional | HTTP(S) URL without credentials, or relative path starting with a single `/`; max 2048 characters; `null` clears it |
| `sortOrder` | Default `0` | Integer, 0–1,000,000 |
| `isActive` | Default `true` | Boolean |
| `startsAt` | Default `null` | UTC ISO datetime or `null` for no start bound |
| `endsAt` | Default `null` | UTC ISO datetime or `null` for no end bound; must be later than start |

Updates require at least one field. Validate the final effective schedule, including an existing bound when only the other bound changes. `createdBy`, timestamps, and version are server-managed. Admin request language does not override the banner's content language.

POST uses multipart. PATCH accepts JSON for metadata or multipart for an optional replacement image. Image text URLs are rejected for banners, including external URLs and existing `/media` URLs. Omit `image` to preserve it. Multipart `sortOrder` is numeric text, `isActive` must be `true` or `false`, and nullable fields accept the literal `null`.

Public visibility requires exact language/device matches, `isActive: true`, `startsAt <= now` (or no start), and `endsAt > now` (or no end). Start is inclusive; end is exclusive. Lists sort by `sortOrder` ascending, then `_id` ascending. There is no fallback to another language/device. Pagination defaults to page 1, limit 20; maximum limit is 100 and maximum page is 1,000,000. The same limits apply to the admin list. Admin `isActive` query accepts exactly `true` or `false`.

Upload validation, byte/pixel limits, authorization-before-upload, and staging behavior are inherited from [shared uploads](FILE_UPLOADS.md). Concurrent banner saves use optimistic version checks; a stale upload snapshot or save returns 409. Replaced/deleted images stop being served once no longer referenced by their owner. Physical cleanup runs through the existing retention/reconciliation process (24-hour retention by default, hourly cleanup), preserving files referenced elsewhere. Publication scheduling controls listing; a known URL for an image still referenced by its banner remains accessible, matching existing media behavior.

### Requests and responses

POSIX shell example (on PowerShell use `curl.exe` and a single line or PowerShell continuation):

```sh
curl -X POST http://localhost:4000/api/v1/banners \
  -H "Authorization: admin YOUR_ACCESS_TOKEN" \
  -H "Accept-Language: ar" \
  -F "language=ar" -F "view=mobile" \
  -F "title=عروض جديدة" -F "altText=عروض المتجر" \
  -F "sortOrder=0" -F "isActive=true" \
  -F "linkUrl=/offers" -F "image=@banner.png;type=image/png"
```

Create returns HTTP 201 with `data.banner`, including its `_id`, generated image URL, fields above, `createdBy`, timestamps, and version. Details/update return the same resource under `data.banner` with HTTP 200. Admin lists omit the internal version; public lists also omit `createdBy` and `updatedAt`.

```http
GET /api/v1/banners/list?view=mobile&limit=8
Accept-Language: ar-EG
```

An empty result returns HTTP 200:

```json
{
  "success": true,
  "message": "تم استرجاع البيانات بنجاح",
  "data": {
    "banners": [],
    "pagination": {
      "page": 1, "limit": 8, "total": 0, "totalPages": 0,
      "hasNextPage": false, "hasPreviousPage": false
    }
  }
}
```

Metadata update example:

```http
PATCH /api/v1/banners/507f1f77bcf86cd799439011
Authorization: admin YOUR_ACCESS_TOKEN
Content-Type: application/json

{"isActive":true,"sortOrder":2,"startsAt":"2026-12-01T00:00:00Z","endsAt":"2027-01-01T00:00:00Z"}
```

## Homepage APIs

### Aggregate homepage

```http
GET /api/v1/home?view=desktop&limit=8
Accept-Language: en
```

`view` is required. `limit` defaults to 8 and is bounded to 1–20, independently limiting each list. `categories` contains visible root categories using the existing category service and product-count conventions. Banner and category listings have their own endpoints for additional pages.

Response for an empty catalog:

```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": {
    "language": "en", "view": "desktop", "currency": "EGP", "currencyExponent": 2,
    "banners": [], "categories": [], "latestProducts": [],
    "bestOffers": [], "bestDeal": null, "bestSellers": []
  }
}
```

### Paginated product sections

```http
GET /api/v1/home/products?section=best-offers&page=1&limit=1
Accept-Language: en
```

Required `section`: `latest`, `best-offers`, or `best-sellers`. Pagination defaults to 1/20, limit max 100, page max 1,000,000. Unknown fields are rejected.

| Section | Rules |
| --- | --- |
| `latest` | `createdAt` descending, `_id` descending; newest and latest are the same section |
| `best-offers` | `price > 0` and `compareAtPrice > price`; percentage discount descending, then creation date and ID descending |
| `best-sellers` | Sum item quantities from version-2 paid, non-cancelled orders with a recorded payment date; all time, across currencies; descending quantity, then ID ascending |

All sections require active products with stock greater than zero and a complete active category chain to a root. Hidden ancestors, missing categories, or cycles exclude products before counting/pagination. This does not alter the pre-existing `/products` API behavior. Best Deal is exactly the first best offer or `null` if none. Free products can appear in latest/best-sellers but never in best offers or Best Deal.

Example for one discounted product:

```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": {
    "products": [{
      "_id": "507f1f77bcf86cd799439011",
      "name": "Camera", "slug": "camera",
      "price": 150, "compareAtPrice": 200, "stock": 5,
      "images": ["https://example.test/camera.webp"],
      "category": "507f1f77bcf86cd799439012",
      "createdAt": "2026-11-01T00:00:00.000Z",
      "savings": 50, "discountPercentage": 25
    }],
    "currency": "EGP", "currencyExponent": 2,
    "pagination": {
      "page": 1, "limit": 1, "total": 1, "totalPages": 1,
      "hasNextPage": false, "hasPreviousPage": false
    }
  }
}
```

Product prices and savings remain in catalog major units. Currency comes from `STORE_CURRENCY` / `STORE_CURRENCY_EXPONENT`, independently of language. Savings are rounded to currency precision and displayed percentage to two decimals; ranking uses the unrounded percentage. Best-seller cards additionally include `unitsSold`. Cards omit internal creator metadata.

## Admin dashboard

| GET endpoint | Query | Result under `data` |
| --- | --- | --- |
| `/api/v1/dashboard/overview` | `from?`, `to?` | Inventory/customer/category totals, period order statistics, recent orders, latest products, low-stock preview, paid sales |
| `/api/v1/dashboard/sales` | `from?`, `to?`, `groupBy=day\|month` | Paid order count, paid sales, average order value by UTC bucket and currency |
| `/api/v1/dashboard/top-products` | `from?`, `to?`, `currency?`, `page?`, `limit?` | Paid item quantities, distinct order count, stored item sales by product/currency |

Dates use UTC ISO strings with `Z`, consistent with existing order filters. `to` defaults to now; `from` defaults to 30 days before the effective `to`. Both bounds are inclusive; ranges must be ordered and at most 366 days. `groupBy` defaults to `day`. Missing sales buckets are omitted, not zero-filled. Top-products pagination uses the same 1/20 defaults and 100/1,000,000 limits; `currency` is an optional three-letter uppercase code. Pagination counts product/currency/exponent groups, so one product may appear in multiple currency groups.

### Metric definitions

- `totals.customers`: current non-deleted accounts with role `user` (including frozen accounts); guests excluded.
- `totals.categories`: all category records, including inactive ones.
- `totals.products`: `total`, `active`, `lowStock`, `outOfStock`; inventory totals include active and inactive products and are independent of the selected date range.
- `LOW_STOCK_THRESHOLD`: nonnegative integer, default 5; validated during startup. Low stock is `stock > 0 && stock <= threshold`; out of stock is `stock === 0`. A threshold of zero disables the low-stock category without changing out-of-stock counts.
- `periodOrders`: count of orders created within the range, grouped by fulfillment status (all payment statuses and schema versions).
- `recentOrders`: latest five orders created in the range using the existing safe order DTO.
- `latestProducts`: latest five products across all time, including inactive products.
- `lowStockProducts`: first five low-stock products ordered by stock then ID, including inactive products.
- `paidSales` / sales `series`: version-2 orders with `payment.status === 'paid'`, excluding `status === 'cancelled'`, filtered by `payment.paidAt`. The stored immutable `grandTotalMinor` is summed once per order. The payment webhook validates provider amount/currency against this total before marking paid. No current product prices are used.
- Monetary totals group by **currency and currencyExponent**. Decimal aggregation avoids intermediate binary rounding; responses retain existing safe integer minor-unit conventions. Unsafe totals fail rather than silently lose precision. `averageOrderValueMinor` is paid sales divided by paid order count, rounded to the nearest integer minor unit.
- Top products use actual paid item quantities. Repeated product lines within an order are consolidated before distinct `orderCount` is calculated. `lineSalesMinor` sums immutable item snapshots **before order-level discounts, tax, and shipping**, and is not allocated payment revenue. Names/SKUs are historical order snapshots; deleted or inactive products remain in admin historical reports.

### Limitations of the existing payment data

There are no persisted refunds, partial refunds, returns, or refunded quantities. The payment service handles checkout session events only, not refund events. Consequently, external full/partial refunds cannot be detected, excluded, or deducted from sales/rankings. No refund fields or management features were invented. Integrating a future refund ledger will require extending the shared paid-order reporting predicates and quantity calculations.

These reports are **paid sales, not net accounting revenue**. They exclude legacy orders without version-2 monetary snapshots. `payment.paidAt` is the time this backend marks the payment paid, not a separately persisted provider settlement timestamp. Reports are current reads, not an accounting snapshot across all dashboard widgets.

Every dashboard response includes:

```json
{
  "basis": "paid-sales",
  "timezone": "UTC",
  "refundsTracked": false,
  "limitation": "Refunds and returns are not recorded. External refunds cannot be excluded; these figures are not net accounting revenue."
}
```

This object is named `reporting`. Overview also includes `period`, `lowStockThreshold`, and `catalogCurrency: { currency, currencyExponent }`. Top-products additionally includes `lineSalesBasis` explaining the item total basis above.

### Sales example

```http
GET /api/v1/dashboard/sales?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&groupBy=day
Authorization: admin YOUR_ACCESS_TOKEN
Accept-Language: en
```

```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": {
    "period": { "from": "2026-01-01T00:00:00.000Z", "to": "2026-02-01T00:00:00.000Z" },
    "groupBy": "day",
    "series": [
      { "currency": "EGP", "currencyExponent": 2, "period": "2026-01-15", "paidOrders": 3, "paidSalesMinor": 2500, "averageOrderValueMinor": 833 },
      { "currency": "USD", "currencyExponent": 2, "period": "2026-01-15", "paidOrders": 1, "paidSalesMinor": 900, "averageOrderValueMinor": 900 }
    ],
    "reporting": {
      "basis": "paid-sales", "timezone": "UTC", "refundsTracked": false,
      "limitation": "Refunds and returns are not recorded. External refunds cannot be excluded; these figures are not net accounting revenue."
    }
  }
}
```

## Indexes and verification

Added banner indexes on `(language, view, isActive, sortOrder, _id)` and `(sortOrder, _id)`, product indexes on `(isActive, createdAt descending, _id descending)` and `(stock, _id)`, and order indexes on `(payment.status, payment.paidAt, status)` and `(createdAt descending, _id descending)`. Startup ensures banner/product/order indexes exist without dropping existing indexes. Category ancestry lookups use the existing category `_id` index.

Reports and rankings use MongoDB aggregation with a 15-second execution bound, not in-memory collection scans. Computed discounts and historical sales ranking still require aggregation work proportional to eligible data; pagination limits response size, not all query work. Existing catalog rate limiting covers homepage/banners; dashboard uses the existing order limiter. Upload rate limits also apply to multipart banner writes.

```powershell
npm run build
npm run test:home
# Enable database integration tests on a disposable replica set:
$env:MONGO_TEST_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0'
npm test
```

The integration suites create and drop uniquely named test databases; they do not load application database credentials. New coverage exercises real aggregation, category ancestry, stock/price boundaries, payment/date/currency handling, authorization, schedule boundaries, pagination, uploaded media serving, replacement/deletion cleanup, and concurrent banner updates. Without `MONGO_TEST_URI`, database tests are skipped explicitly.
