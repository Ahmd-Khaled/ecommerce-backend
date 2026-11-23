# User, Admin, and Authentication Relationships

This document describes how user and administrator identities relate in storage and how their authentication implementations share infrastructure while remaining separate. For file-by-file details, see the [User reference](../user/README.md), [Auth reference](../auth/README.md), and [Admin reference](../admin/README.md).

## Identity model overview

The application has two separate identity collections:

| Concern | Customer identity | Administrator identity |
| --- | --- | --- |
| Mongoose model/collection | `UserModel` / `User` | `AdminModel` / `Admin` |
| TypeScript shape | `IUser` / `HUserDocument` | `IAdmin` / `HAdminDocument` |
| Roles | `user`, `guest` | `admin`, `super-admin` |
| HTTP auth scheme | `user <JWT>` | `admin <JWT>` |
| Token signing level | `SignatureLevelEnum.USER` | `SignatureLevelEnum.ADMIN` |
| Access/refresh secrets | `ACCESS_USER_TOKEN_SECRET`, `REFRESH_USER_TOKEN_SECRET` | `ACCESS_ADMIN_TOKEN_SECRET`, `REFRESH_ADMIN_TOKEN_SECRET` |
| Decoder | `decodedToken` | `decodedAdminToken` |
| Refresh cookie | `refreshToken` | `adminRefreshToken` |

The role name does not itself determine the database model. `user` and `guest` are both customer accounts, while `admin` and `super-admin` are both administrator accounts. An admin is not a User document and cannot authenticate through the customer token decoder. The same email may exist independently in both collections.

## Database relationship map

```text
User collection                         Admin collection
┌──────────────────────┐                ┌──────────────────────┐
│ User                 │                │ Admin                │
│ _id                  │                │ _id                  │
│ role: user|guest     │                │ role: admin|super... │
│ password / googleSub │                │ password             │
│ tokenVersion         │                │ tokenVersion         │
│ account state        │                │ account state        │
└──────────┬───────────┘                └──────────┬───────────┘
           │                                       │
           └──────────────┐       ┌────────────────┘
                          ▼       ▼
                   ┌─────────────────────┐
                   │ Token collection    │
                   │ jti (unique)        │
                   │ expiresAt (TTL)     │
                   │ userId (ObjectId)   │
                   │ identityModel       │
                   └─────────────────────┘
```

`Token.userId` is an ObjectId with `refPath: 'identityModel'`, where `identityModel` is either `User` or `Admin`. This polymorphic reference identifies which collection owns the token subject. Token rows represent revoked JWT IDs; they are not the user/admin session record and do not hold credentials. Validation primarily looks up `jti`, while broad invalidation compares the token’s `tokenVersion` claim with the current identity document.

Other domain relationships use these identities in their own collections: products and categories record an Admin creator; carts, wishlists, orders, and reviews refer to User IDs. Those references do not make the two identity types interchangeable.

## Shared infrastructure and separate responsibilities

Both authentication systems reuse lower-level utilities:

- `generateHash` and `compareHash` use bcrypt for password hashing and comparison.
- `generateToken` and `verifyToken` sign and verify HS256 JWTs.
- `getSignatures` selects access/refresh secrets by signature level.
- `TokenModel` and `TokenRepository` store revoked `jti` values for both identity types.
- `createRevokeToken(s)` validates decoded claims and writes revocation rows.
- `TokenTypeEnum` distinguishes access and refresh tokens.

Each identity keeps its own application logic:

- User flows live in `Modules/auth`, use `userRepository`, and support registration, email confirmation, Google login/link, profile management, password recovery, and customer sessions.
- Admin flows live in `Modules/admin`, use `adminRepository` and `adminAuthService`, and support admin login, profile/password management, refresh, and logout. Admin account CRUD is handled separately by `adminService` and is super-admin-only.
- Customer role rules use `RoleEnum`; admin role rules use `AdminRoleEnum`.
- Customer and admin token decoders each verify their own scheme, secret, identity claim, model record, account state, token version, and revocation state.

Shared token utilities do not mean shared credentials: a customer token must not validate as an admin token, or vice versa.

## Customer authentication lifecycle

### Registration and account confirmation

Customer password registration creates a User with normalized email/name fields and a confirmation OTP. The User document pre-save hook hashes the password and OTP. The new-user post-save hook queues the confirmation email using the one-time plaintext retained only in document locals, then clears those locals. Email confirmation and OTP resend use atomic repository updates so the same code cannot be consumed or replaced twice under concurrent requests.

Google sign-in verifies the Google ID token and its audience, requires a verified email, then finds or creates a User by Google subject. An existing email account is not silently linked. Linking is a separate authenticated operation that requires the current password and a conditional write.

### Login and request authentication

After checking password/provider state, email confirmation and freeze/deletion state, the auth service issues an access and refresh token. Both contain the User `_id`, identity `user`, token type, `jti`, and current `tokenVersion`. The access token is returned for the Authorization header; the refresh token is placed in an HttpOnly `refreshToken` cookie.

Protected customer routes use `authentication()`. The middleware calls `decodedToken`, which verifies the `user` scheme and the matching user secret, loads the current User, rejects invalid role/deleted/frozen state, checks token version and credential-change time, and checks the shared Token collection for a revoked `jti`. It attaches `req.user` and `req.decoded` to the request.

Both `user` and `guest` roles are recognized by the decoder, but individual features can demand a narrower role. For example, product optional-customer personalization restricts supplied customer tokens to `user`.

## Administrator authentication lifecycle

Admin login loads the Admin by normalized email with the normally hidden password explicitly selected, compares the bcrypt hash, verifies the role and active account state, and issues `admin` access/refresh tokens. Admin JWTs use the Admin secrets and include identity `admin`, Admin `_id`, token type, `jti`, and `tokenVersion`. Refresh credentials use the separate HttpOnly `adminRefreshToken` cookie.

Protected admin routes use `adminAuthentication`. It calls `decodedAdminToken`, which requires the `admin` scheme, verifies the admin secret and claims, loads the Admin document, rejects frozen/deleted/invalid-role accounts and stale token versions, then checks the shared Token collection. The middleware attaches `req.admin` and `req.decoded`.

Admin auth profile updates and password changes are distinct from super-admin management of other Admin records. `requireAdmin` guards service operations and may additionally require `super-admin`. The customer user-management router is nested under `/api/v1/admin/users`; it authenticates an admin actor, but it changes User records rather than Admin records.

## Session invalidation and token revocation

Two complementary mechanisms invalidate sessions:

### Per-token revocation

When a current device logs out, the service verifies the refresh token belongs to the same identity as the authenticated access token and writes a Token record for both `jti` values. Future decodes reject those tokens. User and admin logout flows use the same Token collection and unique `jti` index.

### Identity-wide invalidation

Access and refresh JWTs carry the identity document’s `tokenVersion`. The decoder compares that claim to the current User/Admin record. Incrementing the document’s `tokenVersion` invalidates every previously issued token without inserting one Token row per JWT.

This occurs for important actions such as logout-all and password change/reset. User management updates (including freeze/unfreeze and deletion) also increment User `tokenVersion`; Admin management updates similarly increment Admin `tokenVersion`. In addition, each decoder checks freeze/deletion state directly, so the account becomes unusable even if a token was issued recently.

### Refresh rotation and reuse detection

Refresh endpoints decode the refresh JWT while allowing the decoder to report that it was already revoked. If it is already revoked, that indicates reuse: the service increments the owning identity’s token version and rejects the request. Otherwise it stores the old refresh `jti` before issuing a new pair. The unique `jti` index handles simultaneous refresh requests: only one request can revoke the old token; a duplicate-key result is treated as reuse and invalidates sessions.

User and admin refresh cookies have different names and paths, and their tokens use separate secrets. Their rotation logic follows the same shared revocation principle but is implemented in their respective services.

## Data flow by operation

| Operation | Identity document changed | Shared Token collection | Result |
| --- | --- | --- | --- |
| User registration | Create User; save hooks hash password/OTP | No row until revocation | Confirmation email queued. |
| User/admin login | No account mutation | No row | New access and refresh JWTs. |
| Logout current device | No version change | Insert access and refresh `jti` revocations | Current pair rejected; cookie cleared. |
| Logout all | Increment User/Admin `tokenVersion` | No per-token inserts | Every existing token becomes stale. |
| Refresh | No mutation on normal rotation | Revoke old refresh `jti` | New pair issued. |
| Refresh reuse | Increment owning identity `tokenVersion` | Old `jti` already present or insert race | All sessions invalidated. |
| Password change/reset | Replace password and increment version atomically | No per-token inserts | Existing sessions invalidated. |
| Freeze/delete via management | Set account state and increment version | No per-token inserts | Existing tokens fail state and version checks. |
| User email confirmation/resend | Update confirmation OTP state / `confirmedAt` | None | Enables verified-user access; no tokens issued by confirmation itself. |

## Security and maintenance invariants

1. Keep User and Admin in separate collections, role enums, authorization schemes, signing secrets, decoders, and refresh cookies.
2. Keep token `identity` and `tokenType` claims validated against the decoder’s expected values; do not trust a valid signature alone.
3. Include the correct identity model in revocation records (`User` or `Admin`) so the polymorphic reference remains meaningful.
4. Hash secrets before query-based updates. Mongoose save hooks only run on document saves, not ordinary atomic updates.
5. Increment `tokenVersion` atomically with password changes and account changes that should revoke every session.
6. Preserve the `jti` unique index and insert-before-issuing refresh rotation behavior for replay detection.
7. Check current account freeze/deletion state on every token decode; token lifetime alone is not sufficient.
8. Keep response projections explicit. Hidden fields protect default model reads but do not replace safe response construction.
9. A verified Google email is not authority to merge an existing customer account; linking must remain explicit and authenticated.
10. Admin permission to manage customers comes from the admin route policy; it does not promote the admin into a User identity or change the customer’s role to an admin role.

## Source references

- User model and repository: [`user.model.ts`](../../src/DB/models/user/user.model.ts), [`user.repository.ts`](../../src/DB/repository/user.repository.ts).
- Admin model and repository: [`admin.model.ts`](../../src/DB/models/admin/admin.model.ts), [`admin.repository.ts`](../../src/DB/repository/admin.repository.ts).
- User auth module: [`auth.routes.ts`](../../src/Modules/auth/auth.routes.ts), [`auth.service.ts`](../../src/Modules/auth/auth.service.ts), [`authentication.middlewares.ts`](../../src/Middlewares/authentication.middlewares.ts).
- Admin auth module: [`admin.routes.ts`](../../src/Modules/admin/admin.routes.ts), [`admin.auth.service.ts`](../../src/Modules/admin/admin.auth.service.ts), [`admin.token.ts`](../../src/Modules/admin/admin.token.ts).
- Shared revocation and JWT code: [`token.model.ts`](../../src/DB/models/token/token.model.ts), [`token.repository.ts`](../../src/DB/repository/token.repository.ts), [`token.ts`](../../src/Utils/security/token.ts).
