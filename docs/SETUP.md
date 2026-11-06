# Setup, configuration, testing, and learning workflow

Run commands from the repository root. [package.json](../package.json) is the source of truth for scripts; [tsconfig.json](../tsconfig.json) defines compilation.

## Dependencies and startup

1. Install Node.js/npm compatible with the installed dependency versions. The repository does not declare an engines requirement; use a version supported by its lockfile dependencies.
2. Run `npm ci` to install the lockfile versions.
3. Configure `config/.env.dev`. A sanitized example exists locally at `config/.env.dev.example`; the current .gitignore explicitly excludes that path, so a fresh clone may not contain it. Use the variable table below if it is absent. Never copy real credentials into documentation.
4. Provide MongoDB. For checkout, use a replica set or sharded deployment with transactions; standalone MongoDB is insufficient.
5. Start Redis using `docker compose up -d redis` or provide your own Redis URL. The compose file only supplies Redis, not MongoDB or the Node application.
6. Run `npm run dev`.

`predev` runs a build automatically. The dev script then runs TypeScript watch and Node's watch mode on `dist/index.js` together. For compiled execution use `npm run build` followed by `node dist/index.js`; there is no separate npm start script.

Both MongoDB and the email queue must be ready before the HTTP server starts listening. Changing NODE_ENV does not select a different dotenv file: bootstrap explicitly loads `config/.env.dev`. Environment variables can also be supplied by the process environment.

## Environment variable map

| Variable | Used for | Expected value |
| --- | --- | --- |
| CORS_ORIGINS | Credentialed browser origin allowlist | Comma-separated exact origins; see AUTH_COOKIES.md |
| PORT | HTTP listening port | Number; fallback 4000 |
| MODE | Development error detail and test endpoint | DEV enables development behavior |
| NODE_ENV | Enables Secure refresh cookies and disables development-only endpoint in production | production for production runtime |
| DEPLOYEDDOMAIN | Startup log address | Host/domain text; not a router base-path setting |
| MONGO_URI | Main database connection | MongoDB connection URI |
| SALT_ROUNDS | bcrypt hashing cost | Valid bcrypt cost number |
| ACCESS_USER_TOKEN_SECRET | User access-token signing | Secret string |
| REFRESH_USER_TOKEN_SECRET | User refresh-token signing | Separate secret string |
| ACCESS_ADMIN_TOKEN_SECRET | Admin access-token signing | Separate secret string |
| REFRESH_ADMIN_TOKEN_SECRET | Admin refresh-token signing | Separate secret string |
| ACCESS_EXPIRES_IN | JWT access lifetime | Positive safe integer seconds, not `15m` text |
| REFRESH_EXPIRES_IN | JWT refresh lifetime | Positive safe integer seconds |
| NODEMAILER_EMAIL | Gmail sender/account | Sender address |
| NODEMAILER_EMAIL_PASSWORD | Gmail SMTP credentials | Account's configured mail credential |
| REDIS_URL | Queue connection | redis:// or rediss://; default localhost:6379 |
| CART_MAX_ITEMS | Distinct stored cart lines | Positive safe integer; default 50 |
| CART_MAX_QUANTITY | Quantity per product | Positive safe integer; default 100 |
| MONGO_TEST_URI | Optional integration-test database server | Explicit isolated transaction-capable URI; never falls back to MONGO_URI |

Cart configuration is checked at startup. JWT configuration is checked when credentials are generated, and mail credentials are checked when transport is used. A successful TypeScript build does not validate credentials or infrastructure availability.

## Commands and test coverage

| Command | What happens |
| --- | --- |
| `npm run build` | TypeScript compile into dist |
| `npm test` | Build, then run all tests/*.test.cjs |
| `npm run test:cart` | Build, cart unit/integration files, checkout unit tests |
| `npm run test:category` | Build and category tests |
| `npm run test:email` | Build and email processor tests |
| `npm run dev` | Initial build plus compiler/server watchers |

There is no lint script or lint configuration in the current project. Tests use Node's built-in runner, assertions, and mocking. They import compiled dist files, which is why scripts build first.

The optional MongoDB suite creates a uniquely named test database and drops that database afterward. It skips if MONGO_TEST_URI is absent. Example in PowerShell, using a test replica set you have already initialized:

```powershell
$env:MONGO_TEST_URI = 'mongodb://127.0.0.1:27028/?replicaSet=cart-tests&directConnection=true'
npm run test:cart
Remove-Item Env:MONGO_TEST_URI
```

The example URI is not a command to start MongoDB. Its host, port, and replica-set name must match your test server.

| Test file/group | Main behaviors |
| --- | --- |
| auth.cookies | Cookie transport, CORS, rotation, reuse, versions and logout |
| auth.security | IP limiter isolation and OTP monitoring |
| category.public | Public visibility, hierarchy, filtering and routes |
| category.management | Management rules, deletion protection, authorization |
| category.counts | Direct/descendant product counts |
| product.service | Catalog filtering, create/update rules, duplicate errors |
| cart.service | Quantity operations, unavailable lines, limits, retry rules |
| order.checkout | Transaction predicates, prices, session use, conflicts |
| cart.integration | Real MongoDB creation races, increments, overselling, rollback, limits, stale/duplicate checkout |
| email.queue | Delivery behavior, expired jobs, propagated SMTP failures |

The implementation run before these docs recorded passing build, category/email suites, and 36 cart/checkout checks with real MongoDB. The full suite had one pre-existing product update-shape assertion failure. This is a historical result, not a promise that future runs are green. No runtime code was changed for this documentation task.

## A practical sequence for understanding the API

1. Read ARCHITECTURE.md, then open app.controller.ts and compare mounted prefixes.
2. Follow register -> confirm-email -> login in AUTH.md. Keep the returned access token in memory and enable credentials so the browser stores/sends the HttpOnly refresh cookie. See AUTH_COOKIES.md.
3. For existing admin credentials, create a root category and a product in it. There is no public admin-promotion API.
4. Browse public categories/products and compare their different active/ancestor rules.
5. With a normal user token, add a product, increase quantity, and GET the cart. Inspect totalItems, subtotal, available, and version.
6. Submit the reviewed version and current unit prices to checkout. Inspect the resulting order and emptied cart.
7. Repeat after changing a product price or cart quantity to see the documented 409 behavior.
8. Open the corresponding tests to see minimal examples of accepted and rejected cases without bootstrapping the whole application.

## Debugging by layer

A 404 may mean an unmatched route, an inactive/missing product, a hidden category, or an unavailable development endpoint. First check the mounted prefix and method. A 400 Validation Error points to the route schema; MODE=DEV includes structured cause details. A 401 points to header/token/session validity; a 403 usually points to role/account restrictions. A 409 asks you to resolve duplicate values or refresh changed state. A 503 email queue message points to enqueue failure, possibly after a database write.

For startup failures, check dependency availability and configuration before inspecting controllers. For unexpected data, identify the repository method actually called and whether it uses document save, query updates, or a transaction. These paths have different hooks and concurrency behavior.

