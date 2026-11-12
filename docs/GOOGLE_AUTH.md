# Google authentication (Option A)

The frontend obtains a Google Identity Services ID token and sends it to this API. The backend uses `google-auth-library` and `OAuth2Client.verifyIdToken({ idToken, audience })`. It does not accept Google access tokens or authorization codes, and does not store Google tokens. See [Google's server verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Configuration and rollout

1. Create a Google OAuth web client and configure the frontend's authorized JavaScript origins in Google Cloud Console.
2. Set `GOOGLE_CLIENT_ID` in `config/.env.dev` (or deployment environment) to that client's ID. Use the same ID in the frontend. No Google client secret is needed. Leaving it blank disables these endpoints with HTTP 503.
3. Install dependencies with `npm ci` and build with `npm run build`.
4. Before enabling traffic, create/verify the following indexes in the application's MongoDB database. Existing local users need no backfill; leave `googleSub` absent. Resolve duplicate data before rollout if index creation fails. Do not drop existing indexes.

```javascript
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ googleSub: 1 }, {
  unique: true,
  partialFilterExpression: { googleSub: { $type: 'string' } }
});
```

The Mongoose schema also declares both indexes. Deployments that disable automatic indexing must run the commands above explicitly. Uniqueness guarantees require these indexes to exist before serving requests.

## Login or registration

`POST /api/v1/auth/google`

```json
{ "idToken": "<Google Identity Services credential>" }
```

Use JSON requests and `credentials: 'include'` from the browser. Configure the existing CORS allowlist for the frontend. Serve production traffic over HTTPS. This is a JavaScript credential callback API, not Google's form-post redirect endpoint.

Successful requests return HTTP 200 using the same response shape as password login:

```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": "<MongoDB user ID>",
    "firstName": "Ahmed",
    "lastName": "User",
    "username": "Ahmed User",
    "email": "ahmed@example.com",
    "role": "user"
  },
  "tokens": { "accessToken": "<application JWT>", "tokenType": "user" }
}
```

The application refresh JWT is sent only in the existing HttpOnly `refreshToken` cookie. Its path, expiry, SameSite and production Secure behavior match password login. Responses use `Cache-Control: no-store`. Existing refresh rotation, revocation, logout and token-version checks apply unchanged.

The verified `sub` identifies the user permanently, even if their Google email changes. Existing account email/profile/role values are not overwritten. New accounts receive the default user role and a verified timestamp only when Google reports `email_verified: true`. They have no password. Missing or incompatible Google names use `Google` / `User` defaults; names can be edited through the profile endpoint. Password login still rejects accounts without a password; the existing email OTP password-reset flow can establish one.

## Explicit account linking

An email match returns HTTP 409; it never links automatically. Sign in to the existing account first, then explicitly submit:

`POST /api/v1/auth/google/link`

```http
Authorization: user <existing application access token>
Content-Type: application/json
```

```json
{
  "idToken": "<Google Identity Services credential>",
  "currentPassword": "<existing account password>"
}
```

Admin sessions use the existing `admin` authorization scheme. Linking requires a valid application session, correct current password, verified local account, verified Google email, and an unfrozen account. This proves control of both accounts even when their emails differ. A Google email already owned by another local user is rejected. An existing different Google identity cannot be replaced. The atomic update checks password, token version, account status and the absence of a linked identity; unique-index conflicts return 409. Linking does not issue a new session or change the local email or password.

## Errors and concurrency

- 400: invalid body or malformed token; unexpected body fields are rejected.
- 401: invalid/expired Google token, incorrect audience/issuer/signature, missing linking authentication, or wrong current password.
- 403: unverified Google email, unverified local account, or frozen account.
- 409: email conflict, identity already linked, or account changed during linking.
- 429: existing auth/login rate limits exceeded (Google and password login share the login budget).
- 503: `GOOGLE_CLIENT_ID` is missing.

Token verification failures return a generic error without exposing Google errors or tokens. Simultaneous registration requests are resolved through MongoDB unique indexes: a losing request may log in only after reloading the same `sub`; an email collision with another identity remains a conflict.

## Tests

```sh
npm run build
node --test tests/auth.google*.test.cjs tests/auth.cookies.test.cjs tests/auth.security.test.cjs
npm test
```

The unit/HTTP tests mock Google's verifier and database calls. They cover invalid/expired tokens, missing claims, unverified emails, existing/new users, email conflicts, duplicate-key recovery, blocked accounts, linking proof, validation and cookie behavior. Optional real MongoDB concurrency tests run when `MONGO_TEST_URI` is set; they create and remove a uniquely named test database, never the application database. No live Google credentials are required by the tests.
