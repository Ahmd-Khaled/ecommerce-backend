# Implemented source structure

Reviewed 2026-11-08 against source code and mounted routers. This tree starts at `/src` and includes implemented modules and their supporting files. Empty files, empty directories, and the user/payment scaffolds are omitted. Implemented means behavior exists in source; it does not imply every feature is complete or production-verified.

```text
/src/
|-- DB/
|   |-- models/
|   |   |-- cart/
|   |   |   |-- cart.interface.ts
|   |   |   \-- cart.model.ts
|   |   |-- category/
|   |   |   |-- category.interface.ts
|   |   |   \-- category.model.ts
|   |   |-- order/
|   |   |   \-- order.model.ts
|   |   |-- product/
|   |   |   |-- product.interface.ts
|   |   |   \-- product.model.ts
|   |   |-- token/
|   |   |   |-- token.interface.ts
|   |   |   \-- token.model.ts
|   |   \-- user/
|   |       |-- user.interface.ts
|   |       \-- user.model.ts
|   |-- repository/
|   |   |-- address.repository.ts
|   |   |-- cart.repository.ts
|   |   |-- category.repository.ts
|   |   |-- category.transaction.ts
|   |   |-- db.repository.ts
|   |   |-- order.repository.ts
|   |   |-- product.repository.ts
|   |   |-- token.repository.ts
|   |   \-- user.repository.ts
|   \-- connection.ts
|-- Middlewares/
|   |-- authentication.middlewares.ts
|   |-- development.middlewares.ts
|   |-- multipart.validation.ts
|   |-- upload.middlewares.ts
|   |-- validation.fields.ts
|   \-- validation.middlewares.ts
|-- Modules/
|   |-- address/
|   |   |-- address.controller.ts
|   |   |-- address.dto.ts
|   |   |-- address.routes.ts
|   |   |-- address.service.ts
|   |   \-- address.validation.ts
|   |-- auth/
|   |   |-- auth.controller.ts
|   |   |-- auth.cookie.ts
|   |   |-- auth.dto.ts
|   |   |-- auth.routes.ts
|   |   |-- auth.service.ts
|   |   \-- auth.validation.ts
|   |-- cart/
|   |   |-- cart.config.ts
|   |   |-- cart.controller.ts
|   |   |-- cart.dto.ts
|   |   |-- cart.routes.ts
|   |   |-- cart.service.ts
|   |   \-- cart.validation.ts
|   |-- category/
|   |   |-- category.controller.ts
|   |   |-- category.dto.ts
|   |   |-- category.routes.ts
|   |   |-- category.service.ts
|   |   \-- category.validation.ts
|   |-- order/
|   |   |-- order.controller.ts
|   |   |-- order.dto.ts
|   |   |-- order.routes.ts
|   |   |-- order.service.ts
|   |   \-- order.validation.ts
|   \-- product/
|       |-- product.controller.ts
|       |-- product.dto.ts
|       |-- product.routes.ts
|       |-- product.service.ts
|       \-- product.validation.ts
|-- Utils/
|   |-- email/
|   |   |-- email.queue.ts
|   |   |-- send.email.ts
|   |   \-- verify.email.template.ts
|   |-- middleware/
|   |   |-- cors.ts
|   |   \-- rate-limit.ts
|   |-- response/
|   |   \-- error.response.ts
|   |-- security/
|   |   |-- hash.ts
|   |   |-- logout.ts
|   |   |-- otp-monitor.ts
|   |   \-- token.ts
|   |-- storage/
|   |   |-- file.inspection.ts
|   |   |-- local.storage.ts
|   |   |-- storage.config.ts
|   |   |-- storage.service.ts
|   |   |-- storage.types.ts
|   |   |-- upload.cleanup.ts
|   |   \-- upload.policies.ts
|   |-- types/
|   |   \-- authenticated-request.d.ts
|   |-- generateOTP.ts
|   \-- money.ts
|-- app.controller.ts
\-- index.ts
```

## Implemented modules

| Module | API prefix | Existing behavior |
| --- | --- | --- |
| auth | `/api/v1/auth` | Registration, email verification, login, token refresh, logout, profile and password management |
| address | `/api/v1/addresses` | List, create, update, delete, and set default saved addresses |
| category | `/api/v1/categories` | Public browsing and category trees; admin category management |
| product | `/api/v1/products` | Public catalog browsing and admin product management |
| cart | `/api/v1/cart` | Cart retrieval and item management |
| order | `/api/v1/orders` | Checkout, customer order retrieval/cancellation, admin listing/details/status transitions |

Addresses are embedded in the user model, so there is no separate address model. The user model and repository support implemented auth/address behavior even though `Modules/user` is a scaffold. Empty `.authorization.ts` files are omitted; access controls currently live in routers and authentication middleware.

## What to do next

Suggested order based on the existing scaffolds:

1. [ ] Implement **payment**: define the provider and payment lifecycle, persistence, checkout/payment initiation, verified webhooks, idempotent confirmation, and the relationship to order status. Add refunds/status endpoints as required. `/api/v1/payments` currently mounts an empty router and returns 404 for unmatched requests. See [PAYMENT.md](PAYMENT.md).
2. [ ] Define and implement **user management**: decide which additional admin/account endpoints are needed, then implement validation, service, controller, and routes. `/api/v1/users` currently mounts an empty router. Profile/password APIs already exist under auth, and address CRUD already exists under addresses.
3. [ ] Verify each new feature with route/service tests covering permissions, invalid inputs, failures, and retries where relevant; update its module documentation when shipped.

This is a source inventory, not a complete product backlog. The older [TODO.md](TODO.md) is category-specific and contains stale pending-work notes; use current source and module documentation when choosing further work.

Shared upload infrastructure is implemented under `Utils/storage` and `Middlewares`; see [FILE_UPLOADS.md](FILE_UPLOADS.md). Runtime files live outside `/src`.
