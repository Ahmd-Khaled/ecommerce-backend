# Admin model and module reference

This guide documents administrator persistence, authentication, authorization, management APIs, and integration with the shared token revocation collection. For endpoint contracts and examples see [Admin API guide](../ADMIN.md) and [API reference](../API.md).

## Scope and identity boundaries

Administrator accounts are stored in the separate `Admin` collection. They do not use the customer `User` model or customer sign-in endpoints. Admin requests use the authorization scheme `admin <JWT>`, admin-specific access/refresh secrets, and an `adminRefreshToken` cookie.

There are two administrator roles:

- `admin`: may use admin-authenticated APIs and customer user/review administration routes according to those modules’ policies.
- `super-admin`: may use all admin routes and manage admin accounts. Admin account list/create/update/delete operations are behind a super-admin guard.

Both admin roles use the same admin token signature level. The role is checked from the current database record for every decoded token; changing or freezing the account takes effect without waiting for token expiry.

## Request flow

```text
HTTP /api/v1/admin request
  → no-store response header
  → route-specific login limiter / validation
  → adminAuthentication (protected routes)
  → admin controller
  → adminAuthService (login/profile/password/session)
     or adminService (admin account CRUD)
  → AdminModel / adminRepository
  → admin.token.ts + shared TokenModel (JWT and revocation)
```

The admin router is mounted under `/api/v1/admin` with a shared auth limiter and JSON body limit. It sets `Cache-Control: no-store` for all responses. `adminAuthentication` verifies the header, loads the current Admin document, checks account state and token version, and attaches `req.admin` and `req.decoded`.

## File map

| File | Responsibility |
| --- | --- |
| [`admin.interface.ts`](../../src/DB/models/admin/admin.interface.ts) | Admin roles, persisted field shape, hydrated document type. |
| [`admin.model.ts`](../../src/DB/models/admin/admin.model.ts) | Admin schema, hidden password, password hashing, timestamps, optimistic concurrency, indexes, serialization. |
| [`admin.repository.ts`](../../src/DB/repository/admin.repository.ts) | Email/password lookup and token-version increment, plus generic repository base methods. |
| [`admin.routes.ts`](../../src/Modules/admin/admin.routes.ts) | Admin auth routes, nested user/review routers, and super-admin-only account CRUD. |
| [`admin.controller.ts`](../../src/Modules/admin/admin.controller.ts) | Express adapter, response shapes/status codes, cookie setting/clearing. |
| [`admin.validation.ts`](../../src/Modules/admin/admin.validation.ts) | List/create/update/profile/id/cookie schemas and shared account field schemas. |
| [`admin.dto.ts`](../../src/Modules/admin/admin.dto.ts) | DTO types inferred from the management schemas. |
| [`admin.helpers.ts`](../../src/Modules/admin/admin.helpers.ts) | Runtime Zod parser, safe account list filter, duplicate-key translation. |
| [`admin.auth.service.ts`](../../src/Modules/admin/admin.auth.service.ts) | Login, refresh rotation, logout, profile update, password change, logout-all. |
| [`admin.service.ts`](../../src/Modules/admin/admin.service.ts) | Super-admin account list/details/create/update/freeze/unfreeze/soft-delete. |
| [`admin.authorization.ts`](../../src/Modules/admin/admin.authorization.ts) | Token authentication and `requireAdmin`/super-admin guard. |
| [`admin.token.ts`](../../src/Modules/admin/admin.token.ts) | Admin JWT creation and decoding/validation. |
| [`admin.cookie.ts`](../../src/Modules/admin/admin.cookie.ts) | Admin refresh cookie options, issue and clear. |
| [`token.model.ts`](../../src/DB/models/token/token.model.ts) | Shared revocation records for admin and user JWTs. |
| [`token.repository.ts`](../../src/DB/repository/token.repository.ts) | Generic Token collection query wrapper. |
| [`token.ts`](../../src/Utils/security/token.ts) | Shared JWT signing/verifying helpers, secret selection, and revoke-record creation. |
| [`hash.ts`](../../src/Utils/security/hash.ts) | bcrypt password hash and comparison functions. |

## Admin data model

`IAdmin` stores:

| Field | Behavior |
| --- | --- |
| `firstName`, `lastName` | Required, trimmed, 2–30 characters. |
| `email` | Required, trimmed, lowercase, max 254, unique. |
| `password` | Required, hidden from default query selection, bcrypt-hashed by the document pre-save hook. Removed from JSON/object serialization. |
| `role` | Required enum: `admin` or `super-admin`; defaults to `admin`. |
| `freezedAt`, `deletedAt` | Optional status timestamps. Frozen/deleted admins cannot authenticate; admin management soft-deletes rather than physically removing. |
| `tokenVersion` | Required, defaults to zero, minimum zero. Included in tokens and checked on every decode to invalidate all sessions. |
| `createdAt`, `updatedAt` | Mongoose timestamps. |

The schema enables `optimisticConcurrency`, so document saves use Mongoose version concurrency behavior. It defines `{ role: 1, createdAt: -1, _id: -1 }` for role-scoped newest-first listing. Password hashing occurs in `pre('save')` when modified; query updates bypass this hook, so admin password change explicitly hashes the new password before its atomic update.

## Routes and authorization

The router first installs no-store headers, then registers the auth endpoints. It mounts `/users` and `/reviews` subrouters under admin authentication policies, then applies `adminAuthentication([SUPER_ADMIN])` to the remaining admin-account management routes.

| Method and path | Authorization | Behavior |
| --- | --- | --- |
| `POST /auth/login` | Public; login limiter | Parse login schema in service, verify password and state, return safe admin and credentials. |
| `POST /auth/refresh-token` | Public; login limiter and refresh-cookie validation | Rotate admin refresh token and return access token/cookie. |
| `POST /auth/logout` | Admin access token and validated refresh cookie | Revoke current access and refresh tokens, then clear cookie. |
| `POST /auth/logout-all` | Admin access token | Increment token version and clear cookie. |
| `GET /auth/profile` | Admin access token | Return the safe current-admin summary. |
| `PATCH /auth/profile` | Admin access token | Update names using a conditional version/state match. |
| `PATCH /auth/change-password` | Admin access token; login limiter | Verify current password, update hash, invalidate all sessions, clear cookie. |
| `GET /users/*` etc. | Admin authentication plus user module policy | Manage customer accounts; details are in [User reference](../user/README.md). |
| `GET/POST/PATCH/DELETE /reviews/*` | Admin authentication plus review module policy | Review administration; see [Product/review guide](../PRODUCT.md). |
| `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `PATCH /:id/status`, `DELETE /:id` | Super-admin only | Admin account management. Delete returns 204 after soft deletion. |

The `/auth/login` and `/auth/change-password` inputs use schemas from the auth module. Admin list/create/update/profile/id/cookie schemas live in `admin.validation.ts`. Management schemas are strict; list pagination defaults to page 1 and limit 20, with limit capped at 100. Search is bounded to 100 characters. IDs must be 24 hexadecimal characters.

## Admin authentication and sessions

### Login and credential creation

Login parses the shared email/password schema, fetches the admin by normalized email with `+password`, compares bcrypt hashes, then calls `requireAdmin` to reject frozen, deleted, or invalid-role identities. The returned admin object is produced through `safeAdmin`, which includes identity, role, status, and timestamps but no password.

`createAdminCredentials` rejects unavailable accounts, selects `ACCESS_ADMIN_TOKEN_SECRET` and `REFRESH_ADMIN_TOKEN_SECRET`, validates positive integer expiration values from `ACCESS_EXPIRES_IN` and `REFRESH_EXPIRES_IN`, and signs HS256 JWTs with independent UUID `jti` values. Claims include `_id`, `identity: 'admin'`, `tokenType`, and `tokenVersion`. The token type string sent to clients is `admin`.

The controller removes refreshToken from JSON and sets it as `adminRefreshToken` cookie. Cookie options are HttpOnly, SameSite=Lax, secure in production, scoped to `/api/v1/admin/auth`, and expiry-aligned to JWT `exp`. All admin router responses carry no-store.

### Token decoding and authorization

`decodedAdminToken` requires exactly `admin <JWT>`, chooses the admin access or refresh secret based on requested token type, verifies the JWT, validates identity/type/ID/jti/iat/exp/tokenVersion claims, and loads the current Admin. It rejects deleted or invalid-role records, token-version mismatch, and frozen accounts, then checks the shared Token collection for a revoked `jti`. Refresh uses `allowRevoked` to detect reuse; protected API middleware does not.

`requireAdmin` is a service-layer guard for a hydrated admin: it checks existence, deletion, freeze, valid role, and optionally requires `super-admin`. The middleware guard performs token decoding first, then calls the same state/role checks and attaches the request context.

### Logout and refresh rotation

- Current-device logout decodes the refresh cookie, checks it belongs to the same admin as the authenticated access token, writes revocation records for both token IDs, then clears the cookie.
- Logout-all increments `Admin.tokenVersion`, invalidating all extant admin JWTs, and clears the cookie.
- Refresh decodes while allowing a revoked result. A previously revoked refresh token signals reuse and increments tokenVersion. Otherwise it records the old refresh token’s `jti`, then issues a new pair. If concurrent requests race, the unique `jti` constraint allows one revocation insert; a duplicate-key error is treated as reuse and invalidates all sessions.
- Password change also increments tokenVersion atomically with the new password hash and clears the cookie.

The shared `Token` model is documented in [Auth reference](../auth/README.md). Its `identityModel` is `Admin` for admin revocation entries, and its `userId` field points to the corresponding Admin or User through `refPath`.

## Admin profile and password

Profile response uses `safeAdmin`. Profile update only accepts first/last name, and uses `findOneAndUpdate` constrained by `_id`, the token’s `tokenVersion`, `deletedAt: null`, and `freezedAt: null`. If the record changed after authentication, it returns a conflict requiring re-login. It does not increment tokenVersion, so name changes preserve current sessions.

Password change loads the current hidden password, compares it, hashes the new password in service code, and updates only if password and tokenVersion still match and the account remains active. The update increments tokenVersion; a zero modified count signals a concurrent change. The controller clears the refresh cookie.

## Super-admin account management

`adminService` directly uses `AdminModel` rather than `adminRepository`. It enforces super-admin authorization inside every operation as well as at the router boundary.

### Safe results and list filtering

`adminProjection` selects names, email, role, freeze/delete timestamps, and timestamps. `safeAdmin` exposes `id`, names, email, role, computed status, and timestamps. Status precedence is deleted, frozen, otherwise active. Search is escaped as a literal regular expression and searches first name, last name, and email. Deleted records are excluded by default; frozen/active filters are applied through shared `accountFilter`. Results sort newest-first with `_id` tie-break, and count/list queries run concurrently.

### Create

Create parses first/last name, email, password, and optional role (default `admin`), then calls `AdminModel.create`. This invokes password pre-save hashing. Duplicate email errors become a conflict response. The route is super-admin-only; schema permits assigning `super-admin`, so only a currently authorized super-admin can create another super-admin.

### Update, freeze, unfreeze, and deletion

The target must exist and not already be deleted. A super-admin cannot change or delete their own account through management endpoints; they must use profile/password routes. Existing `super-admin` targets are protected from destructive management changes. The update query only targets role `admin` and active (not deleted) records, and increments tokenVersion for each successful write.

- `status: frozen` sets `freezedAt` to now.
- `status: active` unsets `freezedAt`.
- Delete sets `deletedAt` to now, a soft deletion.
- Names and role can be updated through the strict update schema.

The target check and conditional update reduce races and protect super-admin recovery accounts. A target that changed or became unavailable yields not found/conflict behavior rather than silently applying stale intent.

## Repository and helpers

`AdminRepository` extends `DatabaseRepository<IAdmin>` and exports `adminRepository`:

- `findByEmailWithPassword` normalizes email and explicitly selects the normally hidden password for login.
- `incrementTokenVersion` increments a single admin’s token version and returns the updated document.
- Generic create/find/paginate/update/delete helpers come from `DatabaseRepository`; current admin services mostly use direct AdminModel operations for custom conditional filters.

`parseAccount` converts Zod validation failures to `BadRequestException`; `accountFilter` provides shared escaped search and status/deleted filtering for admin and user lists; `accountWriteError` maps duplicate-key writes to a conflict. `admin.dto.ts` infers types from create/update/list schemas.

## Relationship to User and Token

| Concern | Admin | User |
| --- | --- | --- |
| Collection/model | `AdminModel` / `Admin` | `UserModel` / `User` |
| Roles | `admin`, `super-admin` | `user`, `guest` |
| Authorization header scheme | `admin` | `user` |
| JWT secrets | `ACCESS_ADMIN_TOKEN_SECRET`, `REFRESH_ADMIN_TOKEN_SECRET` | `ACCESS_USER_TOKEN_SECRET`, `REFRESH_USER_TOKEN_SECRET` |
| Refresh cookie | `adminRefreshToken`, admin auth path | `refreshToken`, user auth path |
| Decoder | `decodedAdminToken` | `decodedToken` |
| Token revocation | Shared `TokenModel`, `identityModel: Admin` | Shared `TokenModel`, `identityModel: User` |
| User module | May manage customers only when authorized by its policy | Customer records themselves |

An admin is never a User record and cannot pass the customer token decoder. The shared Token collection is the intentional persistence link between both identity types for revoked `jti` values; it does not merge their credentials or roles.

## Maintenance notes

1. If adding an Admin field, decide whether it is secret, whether default selection or serialization must hide it, and whether `safeAdmin` should expose it.
2. If a query update writes a password, hash it before the update; the schema pre-save hook only runs for document saves.
3. Keep tokenVersion checks and increments aligned for changes that must revoke sessions.
4. Preserve the separate admin scheme and secrets when editing shared token helpers; user and admin JWTs must remain distinct.
5. Keep the `Token.identityModel` and reference model values (`Admin`, `User`) consistent with Mongoose model names.
6. Preserve super-admin-only route protection and service-level checks, plus self-target and super-admin-target protections.
7. Keep cookie name/path/security and expiration aligned with the admin auth prefix and JWT expiry.
8. User management and admin management are separate services with different allowed roles and status rules; do not conflate their projections or lifecycle behavior.
