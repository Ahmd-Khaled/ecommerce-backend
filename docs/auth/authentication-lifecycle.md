# Full Authentication Lifecycle

This document follows a customer account through the complete authentication lifecycle implemented by `src/Modules/auth`: registration, email confirmation, login, authenticated requests, token refresh, logout, profile and password changes, account recovery, and Google sign-in/linking. It focuses on the order of operations and how User and Token records change. See the [Auth implementation reference](README.md) for the file map and [Auth API guide](../AUTH.md) for endpoint examples.

## 1. Shared request path

The application mounts the router at `/api/v1/auth`. The app-level auth limiter and JSON body-size limit run before the router. Individual routes add a route-specific rate limiter, Zod validation, and authentication middleware where required.

For a protected request, the client sends:

```http
Authorization: user <access-token>
```

The client does not send `Bearer`. `authentication()` validates the access JWT through `decodedToken`, loads the current User, checks current account state and revocation, then attaches the hydrated document as `req.user` and claims as `req.decoded`. The controller delegates business rules to `authService`; persistence is mostly through `userRepository` and `UserModel`.

### Persistent records involved

- `User` holds account identity, local password hash or Google subject, email confirmation state, recovery OTP state, contact/profile fields, and `tokenVersion`.
- `Token` stores revoked JWT IDs (`jti`) for per-token logout and refresh reuse detection. Expired rows are removed by MongoDB TTL behavior.
- Redis/BullMQ holds queued confirmation and reset email jobs; SMTP delivery is performed by the email worker.

The Admin model and admin login lifecycle are separate. Customer `user` and `guest` roles both use this flow and the `user` token scheme.

## 2. Registration and email verification

### Registration

`POST /register` passes the shared auth IP limit, registration limiter, and strict signup schema. The schema requires first name, last name, email, password, and matching `confirmPassword`; the confirmation value is validation-only.

The service then:

1. Trims names and lowercases/trims email.
2. Checks whether that email already exists, then handles a duplicate-key race during insert as a conflict too.
3. Generates an OTP and a ten-minute expiration.
4. Initializes the confirmation attempt and resend state on the new User.
5. Creates the User document.

The User model's document `pre('save')` hook hashes the password and modified confirmation OTP. Its `post('save')` hook detects a newly created user and enqueues a confirmation email using the plaintext OTP kept temporarily in `$locals`; those locals are cleared in a `finally` block. Registration returns a success message, not tokens. The account is not ready for password login until email is confirmed.

### Confirm email

`POST /confirm-email` validates email and OTP and uses an OTP-specific IP limiter. The service explicitly selects hidden OTP fields, rejects absent/already-confirmed/expired/exhausted state, and compares the submitted value with the stored bcrypt hash.

- Wrong code: an atomic repository update increments attempts only if the same OTP hash is still current and unexpired. The maximum is five; the code is cleared at the threshold. Threshold attempts are logged without email, OTP, password, or request body.
- Correct code: an atomic update verifies the same hash is still active, sets `confirmedAt`, and unsets the OTP, expiry, attempts, and resend metadata.
- If another request consumes/replaces the OTP during verification, the conditional update fails and the request gets an invalid/expired code response.

Email confirmation does not issue a session. The user must subsequently log in (or use Google login if applicable).

### Resend confirmation

`POST /resend-confirm-email` uses a stricter resend IP limiter. The service returns the same generic response for unknown and already-confirmed accounts. Eligible accounts are subject to a 60-second cooldown and five sends per one-hour window. A new OTP is hashed in service code and written with an atomic snapshot condition on prior send time/window/count. Email is queued only after the update succeeds. This avoids concurrent resends both replacing the same code state.

## 3. Password login and session issuance

`POST /login` runs the login limiter and strict email/password validation. The service loads the User with `+password`, compares the bcrypt hash, and returns the same invalid-credentials response for unknown email and incorrect password. It then requires:

- a valid customer role (`user` or `guest`),
- a non-deleted account,
- a confirmed email,
- an unfrozen account,
- a local password credential.

On success, `createLoginCredentials` makes two independently identified HS256 JWTs:

| Claim | Access | Refresh |
| --- | --- | --- |
| `_id` | User ObjectId string | User ObjectId string |
| `identity` | `user` | `user` |
| `tokenType` | `access` | `refresh` |
| `tokenVersion` | Current User version | Current User version |
| `jti` | Random unique ID | Different random unique ID |
| expiry | `ACCESS_EXPIRES_IN` | `REFRESH_EXPIRES_IN` |

Signing secrets are `ACCESS_USER_TOKEN_SECRET` and `REFRESH_USER_TOKEN_SECRET`. Both roles use the `user` signature level. Credentials are not persisted as a session pair. The access token is included in JSON; the refresh token is removed from JSON and set in the `refreshToken` cookie. The cookie is HttpOnly, SameSite=Lax, secure in production, scoped to `/api/v1/auth`, and expires at the token `exp`. Login returns `Cache-Control: no-store`.

## 4. Authenticated request lifecycle

On each protected request, `decodedToken`:

1. Parses exactly two authorization parts and requires scheme `user`.
2. Chooses the access secret (or refresh secret for refresh/logout validation).
3. Verifies JWT signature/expiry using HS256.
4. Validates `identity`, expected `tokenType`, ObjectId, `jti`, `iat`, `exp`, and nonnegative integer `tokenVersion`.
5. Loads the current User by `_id` and rejects deleted accounts or invalid roles.
6. Rejects frozen accounts.
7. Compares token `tokenVersion` with the current document value.
8. If `changeCredentialsTime` exists, rejects tokens issued before it.
9. Checks whether the `jti` exists in Token collection; revoked tokens fail.

The current database read is deliberate: freeze, deletion, role, credential-time, and token-version changes take effect before the JWT expires. Route-specific role restrictions may narrow which valid customer role can use a feature.

## 5. Refresh rotation and replay response

`POST /refresh-token` validates the refresh cookie and an empty body. The controller passes the cookie authorization value to the service. The decoder verifies it as a refresh token but reports revocation rather than immediately rejecting it.

Normal rotation:

1. Reject if the refresh token is already revoked. This means it has already been used or logged out.
2. Insert a Token record for its `jti` and expiry. The `jti` unique index makes this a one-time operation.
3. Issue a fresh access/refresh pair using the current User and tokenVersion.
4. Return the access token in JSON and replace the refresh cookie; response has no-store.

If the old token is already in Token, or two refresh requests race and one hits the unique index, the service treats it as reuse. It increments the User `tokenVersion` and rejects the request, invalidating all sessions. The client must sign in again. This also means simultaneous refreshes from the same cookie can force a full re-login if both race.

## 6. Logout and broad session invalidation

### Current device

`POST /logout` requires a valid access token and valid refresh cookie. The service verifies the refresh JWT and confirms it belongs to the same User as the access token. It inserts revocation records for both `jti` values. The controller clears the refresh cookie.

### All devices

`POST /logout-all` requires access authentication. The service increments User `tokenVersion`, making every previously issued access and refresh token stale at the next validation. The controller clears the current refresh cookie. It does not need to enumerate all sessions or write one revocation row per token.

The development-only `/test-revoke` route revokes the presented access token as a diagnostic path.

## 7. Profile lifecycle

`GET /profile` loads current User data and returns an explicit safe projection: ID, names, virtual username, email, phone, address, gender, avatar, role, confirmation date, and timestamps.

`PATCH /profile` requires authentication and uses upload middleware plus a strict allowlist. It supports avatar, first/last name, phone, gender, and embedded addresses. Nullable phone/gender values clear those optional fields. The service assigns only supplied fields and calls `user.save()`, so schema validation and slug generation run. Passwords, OTP state, provider subject, and tokenVersion are not included in the response. Avatar uploads carry expected-current-value information to guard against stale concurrent replacement.

Address item-level operations also exist under `/api/v1/addresses`; those use an optimistic compare-and-replace of the embedded array. The profile endpoint replaces the whole address array, so clients should use the dedicated address API for granular concurrent edits.

## 8. Password change

`PATCH /change-password` requires access authentication and validates current/new passwords. The service explicitly loads the hidden password, compares the current password, hashes the new password, then performs a conditional atomic update matching the old hash. That update writes the new hash and increments `tokenVersion` together. If the old credential changed concurrently, the service reports a conflict. The controller clears the refresh cookie and asks the client to log in again.

Because this is a query update, the User pre-save password hook does not run; the service must supply the already-hashed password.

## 9. Forgot and reset password

### Request reset code

`PATCH /forgot-password` is public, rate-limited, and accepts email. Only confirmed, active, non-frozen accounts with a valid customer role are eligible. Every case returns the same generic response to avoid revealing whether an email is registered.

Eligible account limits are a ten-minute OTP lifetime, 60-second resend cooldown, at most five sends per ten-minute window, and a five-attempt verification maximum. The service hashes the OTP before an atomic update. Repository issuance matches the expected Mongoose `__v` and increments it, so only one concurrent request based on the same account snapshot succeeds. Email is queued after persistence succeeds.

### Consume reset code

`PATCH /reset-password` validates email, OTP, new password, and matching confirmation. The service loads hidden password and reset fields, checks active/confirmed account state, expiration and attempt maximum, then compares the OTP hash.

- Invalid OTP increments attempts atomically only if that same hash remains unexpired and below the cap. At the maximum, reset state is cleared. Repeated threshold failures are monitored without secrets.
- Reusing the current password is rejected.
- A valid OTP causes one conditional update to write the pre-hashed new password, unset all reset state, and increment both `tokenVersion` and `__v`.
- If OTP replacement/expiry/attempt exhaustion wins a race, the reset update fails and no password change occurs.

On success the controller clears the refresh cookie; the client must log in again.

## 10. Google login and explicit account linking

### Google login

`POST /google` validates the ID token shape and runs the login limiter. `verifyGoogleToken` requires `GOOGLE_CLIENT_ID`, verifies token signature/audience with Google’s library, checks subject/email/expiry and verified-email status, and normalizes email.

The service first finds a User by `googleSub`. If none exists, it checks whether the email is already owned. Existing accounts are not automatically merged, even if email matches. Otherwise it creates a confirmed User with the Google subject, normalized email, and bounded fallback-safe names; a Google-only account may have no password. A duplicate insertion race is resolved only by looking up the same Google subject. The service then enforces account role, deletion, confirmation, and freeze rules, and issues the normal customer token pair.

### Link Google to a password account

`POST /google/link` requires access authentication, the current password, and a verified Google ID token. It refuses an account owned by another User, refuses replacing an existing different Google subject, and performs a conditional link requiring the same password/tokenVersion and an active confirmed account. The partial unique `googleSub` index prevents one Google subject from linking to multiple Users. Linking does not issue a new session or change tokenVersion.

## 11. Rate limits and delivery

At the app/router boundary, auth requests share a 30-request-per-15-minute IP budget. Route limiters add separate counters: registration 5/15m, login and Google sign-in 10/15m, confirmation 5/10m, resend confirmation 3/15m, forgot password 5/10m, and reset password 5/10m. Database OTP cooldown/window/attempt checks remain necessary because IP limits and account-level controls address different abuse patterns.

Email is queued through BullMQ in Redis. Queue jobs retry up to five times with exponential backoff. The worker sends confirmation/reset email through configured SMTP; an OTP that expires before delivery is marked unrecoverable. Redis or queue unavailability surfaces as a service-unavailable error when the API cannot persist the email job.

## 12. Account state transitions

| State/event | Persistent effect | Login/token behavior |
| --- | --- | --- |
| Password registration | User created; password and confirmation OTP hashed; resend counters initialized | No credentials until verified. |
| Email confirmation | `confirmedAt` set; confirmation OTP state removed | Password login becomes eligible. |
| Google account creation | User created with `googleSub` and `confirmedAt`; password omitted | Google login may issue credentials immediately if account is active. |
| Freeze by admin | `freezedAt` set and `tokenVersion` incremented | Existing and new auth rejected. |
| Unfreeze by admin | `freezedAt` removed and version incremented | Account may authenticate if otherwise eligible; unfreezing does not verify email. |
| Soft delete by admin | `deletedAt` set and version incremented | Account is rejected by token decoder and login. |
| Password change/reset | Password replaced and `tokenVersion` incremented | All old sessions rejected. |
| Logout all | `tokenVersion` incremented | All old sessions rejected. |
| Current-device logout | Access and refresh `jti` rows inserted in Token | Those tokens rejected individually. |

## 13. Operational configuration

- `ACCESS_USER_TOKEN_SECRET` and `REFRESH_USER_TOKEN_SECRET`: customer signing keys.
- `ACCESS_EXPIRES_IN` and `REFRESH_EXPIRES_IN`: positive integer seconds used by both user and admin token creation.
- `SALT_ROUNDS`: bcrypt work factor.
- `GOOGLE_CLIENT_ID`: Google token audience for Google login/link.
- `REDIS_URL`: BullMQ email queue connection.
- SMTP settings are consumed by `send.email.ts`.

See [Setup](../SETUP.md), [Infrastructure](../INFRASTRUCTURE.md), and [Email Queue](../EMAIL_QUEUE.md) for configuration and deployment details.

## Lifecycle invariants

1. Never issue password-login tokens before email confirmation.
2. Never return plaintext passwords, OTP hashes, reset state, or provider subject in API responses.
3. Store only hashed OTPs/passwords; plaintext OTP exists only long enough to enqueue delivery.
4. Use conditional atomic repository updates when consuming, replacing, or counting OTP attempts.
5. Revoke refresh tokens before issuing their replacement; duplicate/reused refresh IDs trigger broad invalidation.
6. Increment `tokenVersion` for password changes, logout-all, and account-management state changes that must revoke sessions.
7. Check User state from the database on every token validation, rather than relying only on JWT expiry.
8. Keep Google email matching separate from account linking; verified email alone does not authorize account merging.
9. Treat the access token as client-held authorization and the refresh token as an HttpOnly cookie credential.

