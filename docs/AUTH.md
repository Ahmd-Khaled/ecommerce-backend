# Authentication module

Source: [routes](../src/Modules/auth/auth.routes.ts), [validation](../src/Modules/auth/auth.validation.ts), [DTOs](../src/Modules/auth/auth.dto.ts), [controller](../src/Modules/auth/auth.controller.ts), [service](../src/Modules/auth/auth.service.ts), [user repository](../src/DB/repository/user.repository.ts), [user model](../src/DB/models/user/user.model.ts), [token utilities](../src/Utils/security/token.ts).

Prefix: `/api/v1/auth`. All endpoints share the auth IP budget. Public below means no login token is required, not unlimited requests. Unless noted, successful operations return 200.

## Every route and its call chain

Controller and service names below refer to `authController` and `authService`.

| Method and suffix | Middleware/input | Controller -> service -> persistence | Result |
| --- | --- | --- | --- |
| POST `/register` | Register limiter; `signupSchema` | `register` -> `register` -> `findByEmail`, `createUser` -> User hooks | 201, success/message |
| POST `/confirm-email` | OTP limiter; `confirmEmailSchema` | `confirmEmail` -> `confirmEmail(body, req.ip)` -> `findByEmailWithConfirmEmailOTP`, attempt increment or `confirmUserEmail` | success/message |
| POST `/resend-confirm-email` | Resend limiter; email body | `resendConfirmEmail` -> same service -> guarded `issueNewConfirmEmailOTP` -> enqueue email | Generic success/message |
| POST `/login` | Login limiter; `loginSchema` | `login` -> same service -> `findByEmailWithPassword` -> `createLoginCredentials` | user, access token and refresh cookie |
| POST `/logout` | Access authentication; validated refresh cookie | `logoutCurrentDevice` -> same service -> verify refresh token, `createRevokeTokens` | success/message |
| POST `/logout-all` | Access authentication | `logoutAllDevices` -> same service -> `incrementTokenVersion` | success/message |
| POST `/refresh-token` | Validated refresh cookie; empty or absent body | `refreshToken` -> same service -> decode refresh token, revoke it, create credentials | New access token and rotated cookie |
| GET `/profile` | Access authentication | `getProfile` -> same service -> `findUserById` | Safe user profile |
| PATCH `/profile` | Access authentication; `updateProfileSchema` | `updateProfile` -> same service -> `findUserById`, mutate allowlisted fields, `user.save()` | Updated safe user profile |
| PATCH `/change-password` | Access authentication; `changePasswordSchema` | `changePassword` -> same service -> `findUserByIdWithPassword`, `changePasswordAndInvalidateSessions` | Login-again message |
| PATCH `/forgot-password` | Forgot-password limiter; email body | `forgotPassword` -> same service -> `findUserForPasswordReset`, `issueResetPasswordOTP`, enqueue | Generic success/message |
| PATCH `/reset-password` | Reset-password limiter; `resetPasswordSchema` | `resetPassword` -> same service -> OTP/password lookup, attempt guards, `resetPasswordAndInvalidateSessions` | Login-again message |
| POST `/test-revoke` | `developmentOnly`, access authentication | `testRevoke` -> directly calls `createRevokeToken`; no service method | `data.jti`, `data.expiresAt` |

## Registration and verification

Registration body:

```json
{
  "firstName": "Ahmed",
  "lastName": "Example",
  "email": "ahmed@example.com",
  "password": "ExamplePass123",
  "confirmPassword": "ExamplePass123"
}
```

The strict schema rejects extra fields, including a client-supplied role. Email is trimmed and lowercased. Passwords need 8-128 characters with lowercase, uppercase, and a digit; confirmation must match. Name validation allows up to 50 characters at the request layer, but the User model currently allows 30. This mismatch is existing behavior, not a guarantee that 50-character names can be saved.

The service checks for an existing email, generates a six-digit string OTP with a ten-minute expiry, and creates a user. The model generates a slug, hashes password and OTP, and retains the plaintext confirmation code temporarily in `$locals` for the post-save email enqueue. The default role is `user`. Duplicate email errors become 409, including a race that passes the initial existence check.

Confirmation body is `{ "email": "ahmed@example.com", "otp": "004821" }`. Keep OTPs as strings to preserve leading zeroes. The service loads hidden verification fields, rejects missing/confirmed/expired/locked state, and compares the hash. Invalid attempts are incremented conditionally against the same stored code. At five attempts the code is invalidated. Valid confirmation conditionally sets `confirmedAt` and removes verification state. A code consumed or replaced concurrently cannot be accepted again. Confirmation failures use a generic 400 verification error.

Resend takes an email only. Missing or already-confirmed accounts get a generic response. Existing unconfirmed accounts have a 60-second cooldown and at most five resends per one-hour account window. The repository matches the prior send/window/count state before replacing the code, so concurrent resends cannot both advance that state. The route additionally permits three requests per 15 minutes per IP. Issued codes are hashed in MongoDB and queued for email delivery.

## Login, access tokens, and refresh

Login takes `{ "email": "ahmed@example.com", "password": "ExamplePass123" }`. The service explicitly selects the normally hidden password hash. Unknown email and wrong password both yield 401. Unconfirmed or frozen users get 403. Success includes a safe user summary and:

```json
{
  "tokens": {
    "accessToken": "<access JWT>",
    "tokenType": "user"
  }
}
```

Use `Authorization: user <access JWT>` for a normal account and `Authorization: admin <access JWT>` for an admin. Role-specific access and refresh secrets are separate. The token contains user ID, `tokenVersion`, unique `jti`, issuance time, and expiry. The database user role is checked by protected module routers; choosing `admin` in a header does not grant an admin role.

Refresh sends the HttpOnly cookie to POST `/refresh-token` using `credentials: "include"`; no Authorization header or request body is needed. This endpoint verifies the refresh secret, checks revocation with reuse detection, rejects frozen users, revokes the old refresh token, and sets a rotated cookie while returning only the new access token and tokenType in JSON. A previously revoked refresh token or concurrent duplicate revocation increments the account token version and rejects the request. Clients should serialize refresh attempts rather than refreshing the same token in parallel.

Current-device logout uses the access token in the header and the refresh credential from the cookie, with an empty or absent body. It verifies that both tokens belong to the same user, then stores both token IDs in the revocation collection. Logout-all instead increments `tokenVersion`, invalidating every previously issued token for that account. Both successful logout endpoints clear the local refresh cookie.

See [HttpOnly cookie migration](AUTH_COOKIES.md) for cookie options, CORS_ORIGINS configuration, frontend examples, and testing. Successful password change/reset also clears the local cookie.

## Profile APIs

GET `/profile` returns `user` at the top response level, including identity, contact/address data, role, confirmation date, and timestamps. It does not return password or OTP hashes.

PATCH `/profile` permits `firstName`, `lastName`, `phone`, `gender`, and `address`. At least one field is required. `phone: null` and `gender: null` remove those fields. Gender values are `male` and `female`. Role, email, and password are not editable here.

```json
{
  "phone": "+201000000000",
  "address": [{
    "label": "Home", "fullName": "Ahmed Example", "phone": "+201000000000",
    "country": "Egypt", "city": "Cairo", "street": "Example Street",
    "building": "12", "apartment": "4", "isDefault": true
  }]
}
```

`address` replaces the entire array; it is not an append operation. There can be at most 20 addresses and at most one default. Building and apartment are optional. Updating names triggers the model slug hook on save. Profile updates return the safe profile fields again.

## Password change and recovery

Authenticated change takes `{ "currentPassword": "ExamplePass123", "newPassword": "NewExample456" }`. Validation rejects equal strings. The service verifies the current hash, hashes the new password, and uses a database predicate matching the old hash to update the password and invalidate sessions atomically. A competing password change returns 409. Login again afterward.

Forgot-password takes `{ "email": "ahmed@example.com" }`. It returns the same message for unknown/ineligible accounts and throttled sends. Eligible accounts have a ten-minute code lifetime, 60-second cooldown, and maximum five sends per ten-minute account window. Issuance uses the expected document version, then queues delivery.

Reset takes:

```json
{
  "email": "ahmed@example.com",
  "otp": "004821",
  "newPassword": "NewExample456",
  "confirmPassword": "NewExample456"
}
```

The service checks expiry, allows at most five guesses, compares the OTP hash, prevents reuse of the current password, hashes the new password, and conditionally consumes the code while invalidating sessions. Invalid reset codes generally return 401; reusing the existing password returns 400. Failure monitoring records attempts without logging the code itself.

## Development endpoint and limits

`/test-revoke` exists only when `MODE=DEV` and `NODE_ENV` is not `production`; otherwise it returns 404. It revokes the presented authenticated token directly in the controller.

Email delivery is asynchronous after successful enqueue. MongoDB updates and Redis enqueue are not one transaction: a 503 can occur after a user/code is already saved. See [email operations](EMAIL_QUEUE.md). Auth profile functions are implemented here even though a separate User module directory exists.
