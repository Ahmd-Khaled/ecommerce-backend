# Home, Banner, and Dashboard Modules

This guide describes what each module does and which database models it reads or writes. For endpoint details, request examples, and validation rules, see [HOME_DASHBOARD_BANNERS.md](HOME_DASHBOARD_BANNERS.md).

## Home module

### Purpose

The home module builds storefront homepage responses. It combines public banners, root categories, and product collections into one overview, and also exposes each product collection separately. It does not store a separate homepage document; the response is assembled from current catalog and order data.

### Module flow

- `home.routes.ts` validates the overview and product-list query parameters and disables response caching.
- `home.controller.ts` passes the parsed request and request language to the service and returns the standard success envelope.
- `home.service.ts` fetches banners, root categories, latest products, best offers, and best sellers concurrently. The overview includes request language, device view, store currency, and currency exponent. `bestDeal` is the first best-offer product, or `null` when there are no offers.
- `home.repository.ts` builds product aggregations. Products must be active, in stock, and have an active category ancestry reaching a root. Latest products sort by creation time; offers sort by discount percentage; sellers rank products by paid units sold.

The overview accepts `view` (`mobile` or `desktop`) and a `limit` from 1 to 20 (default 8). The product endpoint accepts `section` (`latest`, `best-offers`, or `best-sellers`) and pagination fields.

### Models used

There is no dedicated Home model. The module reads:

- **Product** (`src/DB/models/product/product.model.ts`): name, slug, selling and compare-at prices, stock, images, category reference, active state, creator, and timestamps. Home projections also calculate savings and discount percentage. Best sellers may include calculated `unitsSold`; this is derived data, not a stored Product field.
- **Category** (`src/DB/models/category/category.model.ts`): category parent links and active state are used to ensure the product's category and its ancestors are active and connected to a root.
- **Order** (`src/DB/models/order/order.model.ts`): paid order item snapshots supply best-seller quantities. Ranking reflects paid item quantity, not current product price.
- **Banner** (`src/DB/models/banner/banner.model.ts`): the banner service supplies currently visible banners matching language and device view.

## Banner module

### Purpose

The banner module manages promotional banner records and uploaded images. Its public listing returns banners matching the request language, device view, active state, and schedule. Admin routes support listing, details, creation, updates, and deletion. Admin writes require admin authentication; images use the shared upload and media storage flow.

### Module flow

- `banner.routes.ts` exposes a public list route and protects management routes with admin authentication. It validates requests, applies upload handling to writes, and disables response caching.
- `banner.controller.ts` maps requests to the service and returns standard success responses.
- `banner.service.ts` applies schedule visibility rules, validates the effective start/end interval on update, handles missing records and concurrent update conflicts, and delegates persistence.
- `banner.repository.ts` creates, finds, saves, deletes, and paginates banner records. Lists sort by `sortOrder` and then `_id`.

### Banner model

`src/DB/models/banner/banner.model.ts` defines the Mongoose `Banner` model:

| Field | Meaning |
| --- | --- |
| `image` | Required stored image path/reference. |
| `language` | Required content language: `ar` or `en`. |
| `view` | Required target display: `mobile` or `desktop`. |
| `title` | Optional trimmed title, up to 150 characters. |
| `altText` | Optional trimmed image alternative text, up to 300 characters. |
| `linkUrl` | Optional destination URL or relative path. |
| `sortOrder` | Nonnegative integer ordering value; defaults to `0`. |
| `isActive` | Whether the banner is enabled; defaults to `true`. |
| `startsAt` / `endsAt` | Optional schedule bounds; when both are set, end must be after start. |
| `createdBy` | Required reference to the admin who created the record. |
| timestamps | Mongoose-managed `createdAt` and `updatedAt`. |

The schema enables optimistic concurrency. Public visibility treats the start time as inclusive and the end time as exclusive. The model indexes public filtering/sorting fields and sort order.

## Dashboard module

### Purpose

The dashboard module provides admin-facing catalog, order, and paid-sales summaries. Its endpoints return an overview, a sales time series, and top products for a date range. It computes these results from existing records rather than persisting dashboard snapshots.

### Module flow

- `dashboard.routes.ts` requires admin authentication, validates query parameters, and disables response caching.
- `dashboard.controller.ts` forwards parsed input to the service and formats the standard success response.
- `dashboard.service.ts` combines overview metrics with reporting data, reads the configured low-stock threshold, and includes currency/reporting-basis metadata.
- `dashboard.repository.ts` aggregates product counts and order statuses, counts non-deleted customer accounts and categories, and returns recent orders, latest products, and low-stock products.
- `reporting.repository.ts` supplies paid sales and top-product aggregations used by the service.

Date ranges default to the previous 30 days through the current time and are limited to 366 days. Sales can be grouped by day or month. The low-stock threshold comes from `LOW_STOCK_THRESHOLD` and defaults to 5.

### Models used

There is no dedicated Dashboard model. The module reads:

- **Product**: total, active, low-stock, and out-of-stock counts, latest products, and inventory details.
- **Category**: category count.
- **User**: count of non-deleted customer accounts (`role: USER`).
- **Order**: order counts by status and recent orders. Reporting uses payment status/time and immutable order/item monetary snapshots to calculate paid sales and product rankings.
- **Admin**: indirectly referenced by order status history and banner ownership, but dashboard summaries do not use an Admin collection as a metric source.

Dashboard reporting describes paid sales, not net accounting revenue. The data model does not track refunds or returns, so external refunds cannot be deducted. Overview and sales figures are grouped by currency and currency exponent where applicable; top-product item totals are based on stored line totals before order-level discounts, tax, and shipping.
