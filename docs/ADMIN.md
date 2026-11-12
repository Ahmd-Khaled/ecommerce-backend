# Administrator identity and management

Administrators live in the `admins` collection and have `admin` or `super-admin` roles. Customers live in `users` and have `user` or `guest` roles. An email may independently exist in both collections. There is no public admin registration, Google login, or customer-to-admin promotion endpoint.

## Authentication

All paths below start with `/api/v1/admin/auth`.

| Method/path | Input | Behavior |
| --- | --- | --- |
| POST `/login` | `{email, password}` | Returns safe `admin` summary and `tokens: {accessToken, tokenType: "admin"}` |
| POST `/refresh-token` | Empty body, admin refresh cookie | Rotates refresh token; replay invalidates all admin sessions |
| POST `/logout` | Admin access header and refresh cookie | Revokes both tokens and clears cookie |
| POST `/logout-all` | Admin access header | Invalidates all sessions and clears cookie |
| GET `/profile` | Admin access header | Current administrator summary |
| PATCH `/profile` | `firstName` and/or `lastName` | Updates only your own display name |
| PATCH `/change-password` | `{currentPassword, newPassword}` | Changes password and invalidates all sessions |

Use `Authorization: admin <access JWT>`. The HttpOnly `adminRefreshToken` cookie is scoped to `/api/v1/admin/auth`, SameSite=Lax, and Secure in production. Refresh credentials never appear in response JSON. Existing CORS origin restrictions apply. Auth requests are rate limited. Admin responses are marked `Cache-Control: no-store`.

User and admin tokens carry signed `identity` and `tokenType` claims. Each decoder enforces the expected scheme, identity, token type, signature, expiry, account collection, stored role, account status, token version, and revocation. Changing the header prefix cannot convert a customer into an administrator. `req.admin` and `req.user` are distinct typed principals. Admin secrets remain `ACCESS_ADMIN_TOKEN_SECRET` and `REFRESH_ADMIN_TOKEN_SECRET`; configure independent secrets for all four user/admin access/refresh keys. Expirations use the existing `ACCESS_EXPIRES_IN` and `REFRESH_EXPIRES_IN` settings.

## Access policy

| Operation | user/guest | admin | super-admin |
| --- | --- | --- | --- |
| Customer profile/address APIs | Own account | No | No |
| Cart, checkout, payment | user only | No | No |
| Catalog administration and order fulfillment | No | Yes | Yes |
| Customer management | No | Yes | Yes |
| List/read/create/change/delete administrators | No | No | Yes |

Existing catalog and order URLs are unchanged, but now require an Admin identity. Product/category `createdBy` references point to `Admin`. Order/customer ownership remains `User`. Revocation records retain their legacy `userId` field with an `identityModel` discriminator for the correct reference.

## Administrator CRUD

Prefix: `/api/v1/admin`. Every endpoint requires a super-admin access token.

| Method/path | Input |
| --- | --- |
| GET `/` | `page`, `limit`, `search`, `role`, `status` |
| GET `/:id` | 24-character ObjectId |
| POST `/` | `{firstName, lastName, email, password, role?}`; default role `admin` |
| PATCH `/:id` | `firstName`, `lastName`, `role`, and/or `status` |
| PATCH `/:id/status` | Same update contract, typically `{status: "frozen"}` |
| DELETE `/:id` | Soft deletion, 204 response |

List responses are `{success: true, data: {admins, pagination: {page, limit, total, totalPages}}}`. Individual responses use `data` for the safe account summary. Lists sort newest first with `_id` as the tie-breaker. Page defaults to 1, limit to 20 (maximum 100); search is bounded, escaped literal text across first name, last name, and email. Role/status filters combine with search. Status filters: `active`, `frozen`, `deleted`. Deleted records are excluded by default and cannot be reactivated through this API.

All administrator management updates invalidate existing sessions. Self-management of roles/status/deletion is forbidden. Super-admin accounts are protected from management updates/deletion, including changes by other super-admins; they can update their own profile/password through auth. This conservative policy ensures the last recovery administrator cannot be removed by concurrent requests. Creating/promoting a super-admin is deliberately restricted to existing super-admins. Removing a super-admin requires a deliberate operator database maintenance procedure.

## Bootstrap and migration

These are explicit operator commands, never startup side effects. Back up the database and stop writes during migration. Migration requires a replica set, as do existing transaction-based commerce workflows.

1. Configure normal database and JWT environment variables. To create the initial super-admin, supply `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_FIRST_NAME`, and `BOOTSTRAP_ADMIN_LAST_NAME` through the process environment. Run `npm run admin:bootstrap`. It refuses to bootstrap when a nondeleted super-admin already exists and uses a fixed unique ID to prevent concurrent bootstrap. Remove the password environment variable afterward.
2. Run `npm run admin:migrate` to count legacy User records with admin/super-admin roles without changing accounts. Run `npm run admin:migrate -- --apply` to migrate. It preserves IDs and password hashes, aborts on identity/email collisions, and migrates each account transactionally. Legacy Google-only administrators must be provisioned with a password before migration.
3. Legacy User records become deleted/frozen guest tombstones with credentials removed, retaining historical order/cart references. Existing category/product creator IDs remain valid in the new Admin collection. Rerunning migration skips successfully migrated accounts; a failed batch can be resumed after resolving the reported conflict.
4. All existing JWTs lack the new required claims and are rejected. Users and administrators must log in again. Administrator clients must switch login/profile/refresh/logout to `/api/v1/admin/auth` and use the new cookie. Customer API paths and response conventions remain unchanged.

The commands are provided but are not run automatically against any database. Test with `npm test`. Database integration suites require `MONGO_TEST_URI` pointing to a disposable replica set; mocked security/management tests run without it.
