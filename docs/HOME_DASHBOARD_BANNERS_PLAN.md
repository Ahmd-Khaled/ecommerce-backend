# Homepage, Dashboard, Banners, and Language Middleware Plan

Status: Implemented. See [API and implementation guide](HOME_DASHBOARD_BANNERS.md) for the final contracts, tests, and limitations.

This approved plan was implemented using the existing Express, TypeScript, MongoDB/Mongoose, admin authentication, and shared image upload architecture. The sections below preserve the approved scope.

## 1. Global language middleware

Register middleware before the API routes to resolve language from the standard request header:

```http
Accept-Language: ar
```

- Support `ar` and `en`, including regional values such as `ar-EG` and weighted language preferences.
- Default to `en` when the header is missing or unsupported.
- Expose the resolved language as typed `req.language`.
- Set `Content-Language`, and use `Vary: Accept-Language` for language-dependent responses.
- Add a reusable translation helper with English fallback for future backend messages.

Public APIs will use this request context instead of requiring language query parameters. Product names and descriptions currently contain a single string; translating existing catalog content requires a separate data-model migration. This phase establishes the foundation.

## 2. Banner module

Create the model, repository, validation, DTOs, service, controller, and routes.

Each banner represents one language/device combination:

| Field | Purpose |
| --- | --- |
| `image` | Uploaded banner image |
| `language` | `ar` or `en` |
| `view` | `mobile` or `desktop` |
| `title`, `altText` | Optional localized text |
| `linkUrl` | Optional destination |
| `sortOrder` | Display order |
| `isActive` | Publication toggle |
| `startsAt`, `endsAt` | Optional publication schedule |
| `createdBy`, timestamps | Administration metadata |

A campaign supporting both languages and both device sizes would have four banner records.

### Endpoints

| Method / endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/banners/list?view=mobile` | Public | Active banners matching view and header language |
| `GET /api/v1/banners` | Admin | Paginated list with management filters |
| `GET /api/v1/banners/:bannerId` | Admin | Banner details |
| `POST /api/v1/banners` | Admin | Create with multipart image upload |
| `PATCH /api/v1/banners/:bannerId` | Admin | Edit metadata or replace image |
| `DELETE /api/v1/banners/:bannerId` | Admin | Delete banner and clean up its image |

Public results respect schedules and sort order. No matching banner returns an empty list rather than an image in the wrong language or device size.

Admin writes must still specify the banner's `language`: this describes stored content, independently of the admin's preferred response language.

Extend the existing upload system, including file validation, media serving, ownership checks, replacement handling, and orphan cleanup.

## 3. Public homepage APIs

Provide one aggregate endpoint for initial page loading:

```http
GET /api/v1/home?view=desktop&limit=8
Accept-Language: en
```

The response contains matching banners, public categories, latest products, best offers, the best deal, and best-selling products.

### Section definitions

| Section | Selection rule |
| --- | --- |
| Latest / newest products | One section, ordered by creation date descending |
| Best offers | Products with `compareAtPrice > price`, ranked by discount percentage |
| Best deal | First product from the best-offers ranking |
| Best sellers | Products ranked by units in paid, non-cancelled orders |

Product cards include calculated savings and discount percentage. Promotional sections include only active, in-stock products and follow existing public category visibility rules. Empty sections remain empty.

Also provide a paginated endpoint for "View all":

```http
GET /api/v1/home/products?section=best-offers&page=1&limit=20
```

Supported sections: `latest`, `best-offers`, and `best-sellers`. Both endpoints share the same selection logic.

## 4. Admin dashboard APIs

Add admin-protected endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/dashboard/overview` | Summary cards, recent orders, latest products, low-stock preview |
| `GET /api/v1/dashboard/sales` | Revenue and order-count chart |
| `GET /api/v1/dashboard/top-products` | Best-selling products with quantities and sales totals |

The overview includes:

- Total customers, products, active products, and categories.
- Low-stock and out-of-stock counts.
- Orders grouped by status.
- Paid sales revenue and average paid order value.
- Recent orders and newly added products.

Sales endpoints support validated date ranges and daily/monthly grouping. Responses distinguish all-time totals from period-based statistics.

Revenue uses the existing integer monetary fields, groups currencies separately, and excludes unpaid and cancelled orders. It represents paid sales, not net accounting revenue; refund accounting is outside this scope.

## 5. Validation, performance, and documentation

- Reuse existing admin authentication, response conventions, and rate limiting.
- Bound pagination, homepage section sizes, and chart date ranges.
- Add indexes appropriate to banner filtering and reporting queries.
- Use database aggregations instead of loading entire collections into memory.
- Test language resolution, banner filtering/scheduling, upload cleanup, authorization, discount ranking, and dashboard calculations.
- Run the TypeScript build and relevant regression tests.
- Update API documentation with frontend request/response examples.

## Implementation order

1. Language middleware.
2. Banners and upload integration.
3. Homepage APIs.
4. Dashboard APIs.
5. Tests and documentation.

## Implemented defaults

- English fallback for missing or unsupported request languages.
- Percentage-based offer ranking.
- Paid, non-cancelled orders for sales metrics.

Additional requirements implemented: configurable `LOW_STOCK_THRESHOLD` (default 5), positive-price best offers/deal, stored paid order totals grouped by currency/exponent, quantity-based rankings, bounded UTC reporting periods, and no new cache infrastructure. Refund/return data does not exist in the current backend, so external full or partial refunds cannot be detected or subtracted. Reporting explicitly identifies paid sales rather than net accounting revenue; no refund management features or invented refund fields were added.
