# Project documentation: start here

This folder contains the project's own Markdown documentation. Dependency documentation in `node_modules`, generated output, and tool instructions are not relocated.

These guides describe the code as implemented, including incomplete modules and differences between similar endpoints. Commands run from the repository root, even when this document is open.

## Suggested reading order

1. [Complete API reference](API.md): all registered endpoints, access requirements, parameters, filters, bodies, and responses.
2. [Architecture and request lifecycle](ARCHITECTURE.md): how the server starts and how the layers fit together.
3. [Setup, configuration, and tests](SETUP.md): run the application and understand its dependencies.
4. [Database and repositories](DATABASE.md): collections, relationships, hooks, and persistence methods.
5. [Authentication APIs](AUTH.md): registration, verification, sessions, profiles, and password recovery.
6. [Category APIs](CATEGORY.md): hierarchy, public visibility, administration, and product counts.
7. [Product APIs](PRODUCT.md): catalog browsing, validation, pricing, and management.
8. [Product reviews implementation plan](PRODUCT_REVIEWS_IMPLEMENTATION_PLAN.md): review lifecycle, moderation policy, and transaction design.
9. [Cart APIs](CART_MODULE.md): item operations, current prices, limits, and concurrency.
10. [Order APIs](ORDER.md): checkout from HTTP request to inventory transaction.
11. [Shared middleware and utilities](INFRASTRUCTURE.md): authentication, errors, rate limiting, email, and security helpers.

## Existing documents

- [Homepage, dashboard, banners, and request language](HOME_DASHBOARD_BANNERS.md): public home sections, banner uploads/scheduling, admin analytics, language headers, and reporting limitations.

- [Cart implementation and deployment notes](CART.md).
- [Email queue operations](EMAIL_QUEUE.md).
- [Earlier category checklist](TODO.md): preserved project history; some statements about pending work are outdated. Use CATEGORY.md and source code for current behavior.

## Source map

| Directory/file | Purpose |
| --- | --- |
| [src/index.ts](../src/index.ts) | Starts the server and manages shutdown |
| [src/app.controller.ts](../src/app.controller.ts) | Creates Express, connects dependencies, mounts routers |
| [src/Modules](../src/Modules) | Feature routes, validation, DTOs, controllers, services |
| [src/Middlewares](../src/Middlewares) | Shared request processing |
| [src/DB/models](../src/DB/models) | Mongoose schemas and TypeScript document interfaces |
| [src/DB/repository](../src/DB/repository) | Database queries and transactional checkout |
| [src/Utils](../src/Utils) | Tokens, hashing, OTPs, email, errors, rate limits |
| [tests](../tests) | Node test-runner tests importing compiled `dist` code |
| [package.json](../package.json) | Dependencies and commands |
| [compose.yaml](../compose.yaml) | Local Redis service; does not start MongoDB |

## API prefixes and implementation status

| Prefix | Status | Guide |
| --- | --- | --- |
| `/api/v1/admin` | Implemented admin session/account APIs and super-admin management | [API reference](API.md), [Admin](ADMIN.md) |
| `/api/v1/auth` | Implemented; also owns profile APIs | [Auth](AUTH.md) |
| `/api/v1/addresses` | Implemented; USER access required | [API reference](API.md), [Address](ADDRESS.md) |
| `/api/v1/categories` | Implemented public and admin APIs | [Category](CATEGORY.md) |
| `/api/v1/products` | Implemented public and admin APIs | [Product](PRODUCT.md) |
| `/api/v1/products/*/reviews` | Public reviews and customer review APIs | [Product](PRODUCT.md) |
| `/api/v1/admin/reviews` | Review moderation and approval settings | [Product](PRODUCT.md) |
| `/api/v1/cart` | Implemented; USER access required | [Cart](CART_MODULE.md) |
| `/api/v1/orders` | Checkout, history, details, admin fulfillment, cancellation | [Order](ORDER.md) |
| `/api/v1/users` | Admin user management mounted under `/admin/users` | [API reference](API.md), [User](USER.md) |
| `/api/v1/payments` | Stripe checkout, status, and webhook handlers | [API reference](API.md), [Payment](PAYMENT.md) |
| `/test` | Public GET smoke-test response | [Architecture](ARCHITECTURE.md) |

API examples use fictitious IDs. Replace them with records from your database. Authorization is `user <token>` or `admin <token>` in this project; it is not the usual `Bearer` scheme.

- [Shared image uploads](FILE_UPLOADS.md): multipart APIs, security checks, local storage configuration, and cleanup.
