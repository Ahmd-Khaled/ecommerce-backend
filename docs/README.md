# Project documentation: start here

This folder contains the project's own Markdown documentation. Dependency documentation in `node_modules`, generated output, and tool instructions are not relocated.

These guides describe the code as implemented, including incomplete modules and differences between similar endpoints. Commands run from the repository root, even when this document is open.

## Suggested reading order

1. [Architecture and request lifecycle](ARCHITECTURE.md): how the server starts and how the layers fit together.
2. [Setup, configuration, and tests](SETUP.md): run the application and understand its dependencies.
3. [Database and repositories](DATABASE.md): collections, relationships, hooks, and persistence methods.
4. [Authentication APIs](AUTH.md): registration, verification, sessions, profiles, and password recovery.
5. [Category APIs](CATEGORY.md): hierarchy, public visibility, administration, and product counts.
6. [Product APIs](PRODUCT.md): catalog browsing, validation, pricing, and management.
7. [Cart APIs](CART_MODULE.md): item operations, current prices, limits, and concurrency.
8. [Order APIs](ORDER.md): checkout from HTTP request to inventory transaction.
9. [User module](USER.md) and [Payment module](PAYMENT.md): what exists and what is not implemented.
10. [Shared middleware and utilities](INFRASTRUCTURE.md): authentication, errors, rate limiting, email, and security helpers.

## Existing documents

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
| `/api/v1/auth` | Implemented; also owns profile APIs | [Auth](AUTH.md) |
| `/api/v1/categories` | Implemented public and admin APIs | [Category](CATEGORY.md) |
| `/api/v1/products` | Implemented public and admin APIs | [Product](PRODUCT.md) |
| `/api/v1/cart` | Implemented; USER access required | [Cart](CART_MODULE.md) |
| `/api/v1/orders` | Checkout only | [Order](ORDER.md) |
| `/api/v1/users` | Empty mounted router | [User](USER.md) |
| `/api/v1/payments` | Empty mounted router | [Payment](PAYMENT.md) |
| `/test` | Public GET smoke-test response | [Architecture](ARCHITECTURE.md) |

API examples use fictitious IDs. Replace them with records from your database. Authorization is `user <token>` or `admin <token>` in this project; it is not the usual `Bearer` scheme.
