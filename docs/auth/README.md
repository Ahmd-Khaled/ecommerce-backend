# Authentication and account module reference

This is the implementation reference for authentication, sessions, and the account APIs. The existing [Auth API guide](../AUTH.md) remains the concise endpoint and request contract. This document explains how routes, validation, services, repositories, token records, and the shared User model fit together.

For the end-to-end sequence of account creation, verification, login, authenticated use, refresh, logout, password recovery, and Google identity flows, see [Full Authentication Lifecycle](authentication-lifecycle.md).

## Scope and relationship to User

Authentication is implemented primarily in `src/Modules/auth`. It authenticates customer accounts stored in the `User` collection, whose schema is documented in [the User reference](../user/README.md). The auth module does not define a separate auth model. It uses a second collection, `Token`, to record revoked JWT IDs for per-token revocation and refresh-token reuse detection.

The `user` and `guest` roles both receive the `user` JWT scheme and use `UserModel`. Admins use a separate Admin model and admin token decoder, though the Token collection can store revocation entries for either identity type.

## Request flow

```text
HTTP /api/v1/auth request
  → shared auth IP limiter
  → route-specific limiter (where configured)
  → Zod validation (where configured)
  → authentication middleware (protected routes)
  → auth controller
  → authService
  → userRepository / UserModel
  → token utilities / TokenModel (session operations)

Registration and OTP sends also enqueue email.
JWT responses put refresh tokens in an HttpOnly cookie.
```

Authentication middleware validates the access token from `Authorization: user <JWT>`, loads the current user, and attaches `req.user` and `req.decoded`. The authorization scheme is deliberately `user`, not `Bearer`.

## File map

| File | Responsibility |
| --- | --- |
| [`auth.routes.ts`](../../src/Modules/auth/auth.routes.ts) | Route registration, limiter composition, validation, and authentication middleware. |
| [`auth.validation.ts`](../../src/Modules/auth/auth.validation.ts) | Strict Zod request schemas and profile/address input rules. |
| [`auth.dto.ts`](../../src/Modules/auth/auth.dto.ts) | Request DTO types inferred from Zod schemas. |
| [`auth.controller.ts`](../../src/Modules/auth/auth.controller.ts) | HTTP adapter; calls service, sets/clears refresh cookie, shapes status and JSON responses. |
| [`auth.service.ts`](../../src/Modules/auth/auth.service.ts) | Registration, Google login/link, email OTP, password login/recovery, session/logout, and profile logic. |
| [`auth.google.ts`](../../src/Modules/auth/auth.google.ts) | Google ID token verification, audience checking, claim validation, and normalized verified email. |
| [`auth.cookie.ts`](../../src/Modules/auth/auth.cookie.ts) | Refresh cookie name, options, expiry, setting, and clearing. |
| [`user.interface.ts`](../../src/DB/models/user/user.interface.ts) | User role/gender enums and TypeScript shape shared with auth. |
| [`user.model.ts`](../../src/DB/models/user/user.model.ts) | Account schema, hidden secret fields, password/OTP hashing hooks, and new-registration email hook. |
| [`user.repository.ts`](../../src/DB/repository/user.repository.ts) | User lookup and atomic OTP/password/session updates. |
| [`token.interface.ts`](../../src/DB/models/token/token.interface.ts) | Revocation record type. |
| [`token.model.ts`](../../src/DB/models/token/token.model.ts) | Token collection schema, unique JWT ID, expiry cleanup, identity reference. |
| [`token.repository.ts`](../../src/DB/repository/token.repository.ts) | Generic repository wrapper for TokenModel. |
| [`authentication.middlewares.ts`](../../src/Middlewares/authentication.middlewares.ts) | User access-token authentication and role checks. |
| [`token.ts`](../../src/Utils/security/token.ts) | JWT issue/verify, claims, secrets, revocation persistence, and token decoding. |
| [`hash.ts`](../../src/Utils/security/hash.ts) | bcrypt hashing and comparison. |
| [`rate-limit.ts`](../../src/Utils/middleware/rate-limit.ts) | Shared and route-specific IP rate limits. |
| [`otp-monitor.ts`](../../src/Utils/security/otp-monitor.ts) | Threshold-only OTP failure logging. |
| [`email.queue.ts`](../../src/Utils/email/email.queue.ts) | Queues confirmation and reset emails. |

## Routes and middleware

The app mounts the router at `/api/v1/auth` and applies a shared auth limiter and JSON body limit before the routes. The route-level limits are defined in `rate-limit.ts`; protected endpoints also call `authentication()`.

| Method and path | Access | Main behavior |
| --- | --- | --- |
| `POST /google` | Public; login limiter; Google token schema | Verify Google identity, find/create account, issue credentials. |
| `POST /google/link` | Access token; login limiter; Google-link schema | Confirm current password and link a verified Google identity. |
| `POST /register` | Public; register limiter; signup schema | Create unverified password account and send email confirmation OTP. |
| `POST /confirm-email` | Public; OTP limiter; confirmation schema | Verify OTP and atomically confirm email. |
| `POST /resend-confirm-email` | Public; resend-specific limiter; email schema | Resend within cooldown/window rules; response does not reveal account existence. |
| `POST /login` | Public; login limiter; login schema | Verify password and account state; issue access JWT and refresh cookie. |
| `POST /test-revoke` | Development-only plus access token | Test endpoint that revokes the presented access token. |
| `POST /logout` | Access token plus validated refresh cookie | Verify matching account, revoke both current device tokens, clear cookie. |
| `POST /logout-all` | Access token | Increment account token version, invalidating all existing sessions; clear cookie. |
| `POST /refresh-token` | Validated refresh cookie | Rotate refresh token and issue a new access token; detect reuse. |
| `GET /profile` | Access token | Return a safe profile projection. |
| `PATCH /profile` | Access token; upload middleware and profile schema | Update allowlisted profile fields; avatar may be uploaded. |
| `PATCH /change-password` | Access token; password schema | Check current password, replace password, invalidate sessions, clear cookie. |
| `PATCH /forgot-password` | Public; forgot-password limiter | Conditionally send reset OTP with a generic response. |
| `PATCH /reset-password` | Public; reset-password limiter | Verify reset OTP, replace password, consume OTP, invalidate sessions, clear cookie. |

For exact payloads, response examples, and the route-by-route call chain, see [Auth API guide](../AUTH.md) and [API reference](../API.md).

## Validation and DTOs

Every input object is strict unless noted, so unexpected keys are rejected. Shared fields such as email, password, names, and OTP come from `generalFields` in `validation.fields.ts`.

- Signup requires names, email, password, and matching `confirmPassword`; confirm password is validation-only and is not persisted.
- Login requires email and password.
- Email confirmation requires email and OTP; resend requires email only.
- Refresh/logout-cookie schemas require `refreshToken` to match the `user <JWT>` shape. The refresh body defaults to an empty strict object.
- Profile updates accept only avatar URL, names, nullable phone/gender, and an optional address array capped at 20. At most one address may be marked default. At least one field is required.
- Password change requires current and new password, and rejects identical values.
- Reset requires email, OTP, new password, matching confirmation; confirmation is not persisted.
- Google login accepts an ID token; linking also requires current password.

`auth.dto.ts` infers request types from these schemas. The controller casts validated `req.body` to these DTOs; validation middleware is the runtime guard.

## User account model relation

The `User` document is the authority for account identity and current security state:

- `_id` is embedded in JWT claims and is used to load the current user on each authenticated request.
- `role` maps both `user` and `guest` to the user signing secrets/scheme.
- Password and OTP hashes are stored on the User document, with `select: false` for secrets.
- `confirmedAt`, `freezedAt`, and `deletedAt` control whether credentials may be issued or accepted.
- `tokenVersion` is copied into both access and refresh JWTs; comparing it with the current database value provides broad session invalidation.
- `googleSub` uniquely associates an account with a Google identity.
- `changeCredentialsTime`, when set, rejects JWTs issued before that timestamp.

User schema document saves hash modified password/OTP values. Atomic repository operations do not run document save hooks, so auth service code hashes values before writing through update queries. User model details and indexes are in [User reference](../user/README.md).

## JWTs, cookies, and revocation model

### Credential creation

`createLoginCredentials` maps the role to a signature level (`user` for both customer roles), loads separate access and refresh secrets, validates configured expiration values, and signs two HS256 JWTs. Each gets a random `jti`; both contain `_id`, `tokenVersion`, `identity: 'user'`, and their respective `tokenType` (`access` or `refresh`).

Access tokens are returned in JSON and clients send them in `Authorization: user <accessToken>`. Refresh tokens are returned by the service internally but removed from controller JSON and written as `refreshToken` cookie. The cookie is HttpOnly, SameSite=Lax, secure in production, scoped to `/api/v1/auth`, and expires at the JWT’s `exp` time. Login, Google login, refresh set `Cache-Control: no-store`.

### Token validation

`decodedToken` validates the two-part authorization value and `user` scheme, selects the access or refresh secret, verifies the HS256 signature and expiry, checks required claims and ObjectId shape, and loads the current User document. It rejects missing/deleted/invalid-role users, frozen accounts, mismatched token versions, and tokens older than `changeCredentialsTime`. It then checks the Token collection for a record with the JWT’s `jti`. A record means revoked; normally this is rejected, while refresh rotation allows the decoder to return revoked state for reuse handling.

The authentication middleware uses access-token validation and stores both the hydrated user and decoded claims on the Express request. Its optional role list can narrow access, while an empty list permits either valid user role.

### Token collection

`TokenModel` stores `{ jti, expiresAt, userId, identityModel }` with timestamps. `jti` is unique; `expiresAt` has MongoDB TTL index behavior (`expires: 0`), so expired revocation records are eventually removed. `userId` references either `User` or `Admin` using `refPath: identityModel`, which defaults to `User`. There is no relationship cascade; token validation uses `jti`, and account-wide invalidation uses User.tokenVersion.

`createRevokeTokens` validates decoded claims, creates one record per unique `jti`, and stores the token expiry. `createRevokeToken` is the single-token wrapper. A duplicate `jti` is useful evidence that a concurrent refresh already won the rotation race.

### Revocation and invalidation

- Current-device logout revokes both the access token from the Authorization header and refresh token from the cookie after verifying they belong to the same account.
- Logout-all increments `User.tokenVersion`; each prior token then fails validation, without creating one revocation row per token.
- Password change and reset also increment `tokenVersion` atomically with the password update.
- Refresh first checks a refresh JWT while allowing a revoked result. An already-revoked token increments `tokenVersion` and rejects the request as reuse. Otherwise it stores the old refresh `jti`, then issues a new pair. If two requests race, the unique index allows only one insert; the duplicate path increments tokenVersion and invalidates all sessions.
- Frozen and deleted user state is checked independently of the token record, so account state changes take effect even before JWT expiry.

## Auth service flows

### Registration and email confirmation

Registration normalizes email and names, checks for an existing email, generates a ten-minute OTP, and initializes resend/attempt metadata. `createUser` performs a Mongoose document save: password and confirmation OTP are bcrypt-hashed by User hooks, then the post-save hook queues the plaintext code for email delivery. A duplicate email race is translated into a conflict response.

Confirmation loads hidden OTP fields and compares the submitted OTP to its hash. The limit is five failed attempts. On wrong OTP, the repository increments only if the same hash remains active and unexpired; threshold crossings are logged without secrets. A correct OTP is consumed in a conditional atomic update that sets `confirmedAt` and unsets confirmation state. This protects against stale or simultaneous requests.

Resend has a 60-second cooldown and a maximum of five sends per one-hour window. It issues a new hash and updates state only if the previous send/window/count snapshot still matches. It queues mail after persistence succeeds. Unknown and already-confirmed email addresses get the same generic response.

### Password login

The repository explicitly selects the hidden password. Unknown email and wrong password share an error. Deleted/invalid-role accounts and accounts without a password are rejected; then password is compared, email confirmation is required, and frozen state is rejected. On success, the service returns a deliberately limited user object plus credentials.

### Google login and linking

`verifyGoogleToken` requires `GOOGLE_CLIENT_ID`, verifies the Google signature and audience through `google-auth-library`, checks subject/email/expiry and `email_verified`, then normalizes email. Login first looks up `googleSub`. A missing provider identity may create a confirmed user (no local password) using bounded, sanitized profile names. If the email already belongs to a different/unlinked account, automatic linking is refused; the person must log in and explicitly link. Duplicate insert races are recovered only by re-reading the same `googleSub`, never by trusting an email match.

Google link requires an authenticated user and a valid current password, verifies the supplied Google token, checks email ownership, and uses a conditional repository update requiring unchanged password/tokenVersion, no existing subject, confirmed account, and not frozen. The unique partial index prevents a provider subject from being attached to two users.

### Profile

Profile reads and writes use User repository lookups. Reads return names, virtual username, email, phone, address, gender, avatar, role, confirmation timestamp, and timestamps, rather than returning the document wholesale. Updates explicitly assign permitted fields and call `user.save()`, so schema validation and slug generation run. `null` phone/gender means clear the optional value. Address is replaced as an array by this endpoint; the dedicated address module offers item-level CRUD with optimistic concurrency.

Avatar updates use upload middleware and an expected-current-value check so a stale upload cannot overwrite an avatar changed concurrently. See [File uploads](../FILE_UPLOADS.md).

### Password change and recovery

Password change loads hidden password, verifies current password, hashes the new one, then conditionally writes only if the stored old hash is unchanged and increments `tokenVersion` in the same update. The controller clears the refresh cookie.

Forgot password always returns a generic message for unknown, unconfirmed, deleted, frozen, or otherwise ineligible users. Eligible confirmed accounts may receive an OTP with ten-minute TTL, 60-second cooldown, maximum five sends per ten-minute window, and attempt count reset. Service hashes before `issueResetPasswordOTP`; repository uses expected `__v` to prevent stale concurrent issuance.

Reset loads password and hidden reset state, verifies expiry and five-attempt cap, then compares OTP. Failed attempts are atomically incremented only if the same OTP is still active; monitoring logs attempt thresholds without OTP/password/email. Reusing the current password is rejected. A successful conditional update writes the already-hashed password, consumes all reset fields, and increments `tokenVersion` and `__v` atomically. The controller clears the refresh cookie.

## Repository responsibilities

`userRepository` specializes the generic `DatabaseRepository` for `UserModel`. It has straightforward identity lookups and named atomic operations for Google linking, email OTP issue/consume/attempts, token-version updates, password changes, and reset OTP handling. The return value `false`/`null` generally means the conditional predicate no longer matched (expired/replaced state or a concurrent update), not a database outage.

`TokenRepository` is only a generic wrapper over the Token model. Revocation orchestration and claim validation live in `Utils/security/token.ts`, which constructs a repository instance where needed. Admin token decoding uses the same Token collection and repository, with `identityModel: 'Admin'` on admin revocation records.

## Rate limits and operational details

The auth router is subject to shared `authLimiter` (30 requests per IP per 15 minutes) plus route-specific limiters: register 5/15m, login/Google 10/15m, confirm OTP 5/10m, resend confirm email 3/15m, forgot 5/10m, and reset 5/10m. These are in-memory express-rate-limit counters unless the app configures a shared store elsewhere; they complement, rather than replace, database OTP state limits.

JWT secrets and expiration values are read from environment variables (`ACCESS_USER_TOKEN_SECRET`, `REFRESH_USER_TOKEN_SECRET`, `ACCESS_EXPIRES_IN`, `REFRESH_EXPIRES_IN`). Google login also needs `GOOGLE_CLIENT_ID`; bcrypt uses `SALT_ROUNDS`. See [Setup](../SETUP.md) and [Infrastructure](../INFRASTRUCTURE.md) for broader configuration.

## Maintenance checklist

1. When changing a JWT claim, keep credential creation, access/refresh decoding, admin token handling where applicable, and tests/clients consistent.
2. When changing refresh behavior, preserve atomic single-use revocation and reuse detection; concurrent refreshes are a security case, not just a duplicate-key nuisance.
3. When adding a sensitive User field, consider default query selection, schema serialization, explicit auth response objects, and repository projections.
4. Hash credentials and OTPs before query updates. Save middleware only applies to document saves.
5. Keep broad session invalidation (`tokenVersion`) in the same atomic operation as password or account-state changes when possible.
6. If changing OTP limits, update route IP limits, service cooldown/window checks, repository predicates, hidden-field selections, and cleanup together.
7. Keep external identity linking explicit. A verified Google email alone must not silently merge two existing accounts.
8. Keep refresh cookie path/security/expiry aligned with the auth prefix and the configured JWT expiry.
