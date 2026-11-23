# User data and module reference

This guide documents the user persistence model, repository, user-management module, and the adjacent account flows that read or mutate the same user records. It describes the implementation in this repository; for endpoint contracts see [the existing user API overview](../USER.md), [Auth](../AUTH.md), and [Address](../ADDRESS.md).

## Scope and terminology

There are two meanings of “user module” in the codebase:

1. `src/Modules/user` is the **admin user-management API**. Admin or super-admin credentials are required to list, inspect, create, edit, freeze, or soft-delete customer accounts.
2. `src/Modules/auth` handles a signed-in customer’s **own account**: registration, email confirmation, login, profile, password change and recovery, token refresh, and Google sign-in.

Both operate on the same `UserModel`. Addresses are embedded in the user document and can also be managed through `src/Modules/address`.

## Request and data flow

```text
HTTP request
  ├─ /users (admin user management)
  │    routes → admin authentication → controller → service → UserModel
  ├─ /auth (self-service and authentication)
  │    routes → validation/auth middleware → auth controller/service
  │       → userRepository → UserModel
  └─ /addresses
       routes → authentication/validation → address controller/service
          → addressRepository → embedded User.address array

UserModel document save hooks: slug generation → password/OTP hashing →
new-user confirmation email enqueue
```

The admin user service directly calls `UserModel`; it does not use `userRepository`. The repository exists for reusable user queries and atomic auth operations.

## File map

| File | Responsibility |
| --- | --- |
| [`user.interface.ts`](../../src/DB/models/user/user.interface.ts) | User/address shapes, enums, Mongoose hydrated-document, model and virtual types. |
| [`user.model.ts`](../../src/DB/models/user/user.model.ts) | Address and user schemas, indexes, `username` virtual, slug and hashing hooks, serialization, confirmation-email enqueue, model export. |
| [`user.repository.ts`](../../src/DB/repository/user.repository.ts) | Query and atomic update methods used by auth/Google/OTP/password flows. |
| [`db.repository.ts`](../../src/DB/repository/db.repository.ts) | Generic repository base (create/find/paginate/update/delete helpers). |
| [`user.authorization.ts`](../../src/Modules/user/user.authorization.ts) | Reuses admin authentication for all user-management routes. |
| [`user.routes.ts`](../../src/Modules/user/user.routes.ts) | Binds HTTP paths to controller handlers. |
| [`user.controller.ts`](../../src/Modules/user/user.controller.ts) | Express request/response adapters; wraps successful responses and sets create/delete status codes. |
| [`user.validation.ts`](../../src/Modules/user/user.validation.ts) | Strict Zod schemas for list, create, and update input. |
| [`user.dto.ts`](../../src/Modules/user/user.dto.ts) | TypeScript DTO types inferred from validation schemas. |
| [`user.service.ts`](../../src/Modules/user/user.service.ts) | Admin authorization, list filters, safe projections, creation, updates, freeze/unfreeze, and soft deletion. |
| [`auth.service.ts`](../../src/Modules/auth/auth.service.ts) | Customer self-service account workflows that use the same model/repository. |
| [`address.service.ts`](../../src/Modules/address/address.service.ts) | Address-array normalization and CRUD with optimistic concurrency. |
| [`address.repository.ts`](../../src/DB/repository/address.repository.ts) | Reads and compare-and-replaces the embedded address array. |

## Data model

### Enumerations

`GenderEnum` allows `male` and `female`. `RoleEnum` allows `user` and `guest`. Admin identities are stored in a separate model. Both user roles use the customer authentication scheme; routes may impose a narrower role requirement for particular features.

### User fields

| Field group | Fields | Notes |
| --- | --- | --- |
| Identity | `firstName`, `lastName`, `slug` | Names are required, trimmed, 2–30 characters. Slug is required, lowercased, max 100, and regenerated on document validation for new documents or changed names. |
| Authentication | `email`, `password`, `googleSub` | Email is required, trimmed, lowercased, max 254, unique. Password is optional in the TypeScript shape and conditionally required by the schema when `googleSub` is absent. Password is excluded from default queries. Google subject has a partial unique index. |
| Contact/profile | `avatar`, `phone`, `address`, `gender` | Optional. Address is an array of embedded address documents. |
| Access/state | `role`, `confirmedAt`, `freezedAt`, `deletedAt`, `tokenVersion` | Role defaults to `user`. Freeze and deletion are represented by timestamps. `tokenVersion` defaults to zero and is used to invalidate sessions. |
| Email confirmation | `confirmEmailOTP`, `confirmEmailOTPExpiresAt`, `confirmedAt` | OTP and expiration are hidden by default; confirmation is represented by `confirmedAt`. |
| Confirmation rate limits | `confirmEmailOTPAttempts`, `confirmEmailOTPSentAt`, `confirmEmailOTPResendCount`, `confirmEmailOTPResendWindowStartedAt` | Attempt and resend state is hidden by default. Auth service/repository enforce limits and consume codes atomically. |
| Password recovery | `resetPasswordOTP`, `resetPasswordOTPExpiresAt`, `resetPasswordOTPSentAt`, `resetPasswordOTPWindowStartedAt`, `resetPasswordOTPResendCount`, `resetPasswordOTPAttempts` | Recovery state is hidden by default and manipulated through explicit repository operations. |
| Other security | `changeCredentialsTime` | Hidden by default; available for credential/session age checks in related auth logic. |
| Mongoose metadata | `createdAt`, `updatedAt`, `__v` | Timestamps are automatic. `__v` is Mongoose’s version key and is used as an optimistic concurrency check in password-reset issuance. |

Schema `select: false` is a query default, not a serialization guarantee. Explicit `+field` projections in repository methods intentionally load secrets for verification. The schema’s JSON/object transform removes `password`, confirmation/reset OTP values, and `changeCredentialsTime`; API services should still return explicit safe objects, as `userService.safeUser` does.

### Embedded address shape

Each address has its own `_id`, `label`, `fullName`, `phone`, `country`, `city`, `street`, optional `building` and `apartment`, and `isDefault`. Required string fields are trimmed. The address sub-schema does not disable `_id`, so Mongoose normally creates an ID. The address service also supplies IDs when normalizing legacy records that lack them. The service ensures at most one default address after mutations and makes the first address default unless the caller explicitly chooses otherwise.

## Model behavior and lifecycle

### Username and slug

`username` is a virtual getter joining `firstName` and `lastName`; it is not stored. Its setter normalizes whitespace, splits the first token into `firstName` and the remainder into `lastName`, and sets a slug. The `pre('validate')` hook also derives the slug from names for new documents or when either name changes. Slug normalization uses Unicode NFKC, lowercase, and replaces runs of non-letter/non-number characters with `-`, so names in Arabic and other scripts are retained.

The hook runs during document validation/save. Query updates such as `findOneAndUpdate` do not run the document `pre('validate')` hook. The admin user service therefore calculates the slug itself when changing names.

### Password and OTP hashing

The document `pre('save')` hook hashes a modified password, modified confirmation OTP, and modified reset OTP. Hashing happens only for document saves. The auth flows that use atomic MongoDB update operations hash the value in the service before calling the repository; otherwise those query updates would persist a plaintext value because `save` middleware is bypassed.

When a confirmation OTP is hashed during a new document save, the hook temporarily keeps the plaintext in `$locals` so the post-save hook can enqueue it to the email queue. Post-save only sends for a newly created user with a supplied confirmation OTP, and clears those temporary locals in a `finally` block. Resend and reset-email flows enqueue mail explicitly from their services after the atomic update succeeds.

### Indexes

- `{ role: 1, createdAt: -1, _id: -1 }` supports role-scoped, newest-first user listing with a stable tie-breaker.
- `googleSub` has a unique partial index applying only when the field is a string. Users without a Google identity do not collide on missing values.
- `email` is declared unique in the schema.

## Admin user-management module

All `/users` routes first pass through `userManagement`, which is `adminAuthentication()`. The controller passes `req.admin` to the service, and each service operation also calls `requireAdmin(actor)` before doing work.

### Routes

The router defines `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `PATCH /:id/status`, and `DELETE /:id`. The app mounts this router under `/api/v1/users` and an admin alias; check the app route mounting for the exact alias in the deployed version. `DELETE` calls the update service in remove mode and returns HTTP 204.

### Input validation

All schemas are strict objects, so unknown keys are rejected.

- List accepts the shared admin account pagination/search fields, optional `role`, and optional status among `active`, `pending`, `frozen`, `deleted`.
- Create accepts validated first and last names, email, password, and optional role (default `user`).
- Update accepts optional first and last names, role, and status `active` or `frozen`; at least one field is required. The separate status path uses the same update schema and handler. Delete skips update-body validation because it invokes remove mode with an empty body.

The DTO file derives compile-time types from these Zod schemas rather than maintaining duplicate interfaces.

### Listing and status rules

`accountFilter` from admin helpers supplies pagination, text search, and default deleted-account filtering behavior. The user service additionally restricts results to known customer roles unless a role filter is provided. `active` means `confirmedAt` is non-null; `pending` means it is null. `frozen` and `deleted` are filtered by the shared account helper. Results sort by `createdAt` descending and `_id` descending; count and page query run concurrently.

The returned user summary contains `id`, names, email, role, `confirmedAt`, computed status, and timestamps. It omits password, OTP state, provider subject, token version, address, and other private fields. Computed status precedence is deleted, then frozen, then active if confirmed, otherwise pending.

### Create

After authorization and schema parsing, creation generates a confirmation OTP and initializes its ten-minute expiry, sent time, resend-window start, resend count, and failed-attempt count. `UserModel.create` invokes document middleware: password and OTP are hashed, and the post-save hook queues the confirmation email. Duplicate/write errors are translated through `accountWriteError`.

### Update, freeze, unfreeze, delete

The service loads a non-deleted account, then performs a conditional `findOneAndUpdate` matching `_id`, the current `tokenVersion`, non-deleted state, and an allowed customer role. It writes supplied fields and a freshly calculated slug, increments `tokenVersion`, and returns the safe projection. A concurrent update that changes the version prevents this write and is reported as not found.

- `status: frozen` sets `freezedAt` to now.
- `status: active` unsets `freezedAt`; it does not set `confirmedAt`, so a pending account remains pending.
- Delete sets `deletedAt` to now. It is a soft delete and preserves related historical references.
- Every successful update, freeze/unfreeze, and deletion increments `tokenVersion`, invalidating existing sessions that check the version.

These are query updates, so model document save hooks do not run. That is why the service explicitly calculates the slug. No admin user endpoint changes password or email.

## User repository

`UserRepository` extends `DatabaseRepository<IUser, IUserVirtuals, HUserDocument>` and binds the generic base to `UserModel`. It exports a singleton `userRepository`. Specialized methods are used where a named query or atomic condition makes auth behavior clearer; the admin user service currently accesses `UserModel` directly.

| Method | Purpose / notable behavior |
| --- | --- |
| `findByGoogleSub` | Resolve an account by provider subject. |
| `linkGoogle` | Conditionally attach a Google subject only if the account still has the same password and token version, has no provider subject, is confirmed, and is not frozen. |
| `findByEmail` | Normalize email before lookup; does not request hidden password. |
| `findByEmailWithPassword` | Same lookup, explicitly includes password for login. |
| `findUserById` | Default user lookup by ObjectId. |
| `createUser` | Creates via the model, invoking document hooks. |
| `findByEmailWithConfirmEmailOTP` | Explicitly selects hidden confirmation OTP, expiry, attempts, and resend metadata for verification/resend workflows. |
| `incrementConfirmEmailOTPAttempts` | Atomically increments only a still-active, unexpired OTP below the maximum; clears the OTP after the final failed attempt. Returns count or `null` if the condition stopped matching. |
| `confirmUserEmail` | Atomically marks confirmation and unsets the confirmation OTP/rate-limit state only when the code hash is current, unexpired, and under the attempt limit. |
| `issueNewConfirmEmailOTP` | Replaces confirmation OTP and rate-limit state only when a snapshot of prior send/window/count fields still matches; this prevents competing resends from both winning. |
| `incrementTokenVersion` | Increments the session version by ID. |
| `findUserByIdWithPassword` | Loads a user and explicitly selects the hidden password for password change. |
| `changePasswordAndInvalidateSessions` | Replaces password only if the existing hash still equals the verified hash, and increments `tokenVersion`; returns whether one document changed. |
| `findUserForPasswordReset` | Finds confirmed account and selects password plus reset-OTP/resend fields. |
| `issueResetPasswordOTP` | Issues hashed OTP and limits using expected `__v`; increments `__v`, so concurrent issuance based on an old snapshot fails. |
| `incrementResetPasswordOTPAttempts` | Atomically increments attempts for the same unexpired OTP hash below the maximum and increments `__v`; returns count or `null`. |
| `invalidateResetPasswordOTP` | Unsets reset state once the attempts threshold is reached and increments `__v`. |
| `resetPasswordAndInvalidateSessions` | Atomically replaces password, consumes reset state, and increments both `tokenVersion` and `__v` when OTP is still valid and under the attempt limit. |
| `findUserForPasswordResetWithPassword` | Loads confirmed account including password, OTP, expiry and attempts for reset validation. |

`DatabaseRepository` supplies generic `create`, `insertMany`, `find`, `findOne`, `findById`, `findOneAndUpdate`, `paginate`, `updateOne`, delete, and find-and-delete methods. Its `updateOne` helper automatically increments `__v`; specialized methods in `UserRepository` often construct their own version/session semantics instead. Generic helpers are available through inheritance but most auth paths call specialized methods.

## Self-service authentication and account flows

The following are not implemented by `src/Modules/user`, but are relevant to a complete picture of user records:

- Registration creates a user with a confirmation OTP; the model hooks hash credentials and enqueue confirmation email.
- Email confirmation and resend use repository methods that condition updates on the current OTP hash and rate-limit snapshot.
- Login explicitly loads and compares the hidden password, then checks account state and issues credentials.
- Profile reads return a deliberate safe subset. Profile updates assign only supported fields and call `save`, which runs validation and model hooks.
- Password change compares the current password, hashes the replacement in service code, and atomically updates the hash while incrementing `tokenVersion`.
- Forgot/reset password use generic responses for account discovery, bounded OTP sends/attempts, atomic OTP consumption, and session invalidation. Query update paths receive already-hashed values.
- Google auth finds by `googleSub` or conditionally links a provider subject to a compatible existing account.
- Address CRUD uses `addressService` and `addressRepository`: it normalizes the current array, applies a change, then replaces the raw old array only if it still matches. It retries up to five times before returning a conflict. This avoids silently overwriting a concurrent address update.

See [`auth.service.ts`](../../src/Modules/auth/auth.service.ts), [`auth.routes.ts`](../../src/Modules/auth/auth.routes.ts), and the [Auth guide](../AUTH.md) for endpoint details.

## Practical maintenance notes

1. When adding a sensitive property, decide its default query selection, JSON/object serialization behavior, and whether each service response could expose it.
2. When changing names via a query update, update `slug` explicitly; document validation middleware will not run for ordinary query updates.
3. When writing a password or OTP through an atomic update, hash it before the repository call; pre-save middleware does not apply.
4. When adding an auth mutation that should revoke sessions, increment `tokenVersion` in the same atomic operation as the credential/state change.
5. If changing OTP fields or limits, keep service comparisons, repository query filters, field selection, cleanup/unset operations, and email enqueue behavior aligned.
6. Keep API output projections explicit. Hidden Mongoose fields protect default reads but should not be treated as a complete response policy.
7. Address writes compare the old embedded array before replacement. Preserve that concurrency check when changing the address storage or mutation design.
