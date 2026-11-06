# HttpOnly refresh-token cookies

Login and refresh now deliver the refresh credential exclusively through Set-Cookie.
Their JSON response retains `tokens.accessToken` and `tokens.tokenType`; login also
retains its user summary. No refresh token is returned in JSON.

## What changed

| Operation | Previous transport | Current transport |
| --- | --- | --- |
| Login | Access and refresh tokens in JSON | Access token in JSON; refresh credential in an HttpOnly cookie |
| Refresh | Refresh credential in Authorization header | Refresh credential read from `req.cookies.refreshToken` |
| Current-device logout | Access token in header; refresh token in body | Access token in header; refresh credential in cookie |
| Logout-all | Invalidate sessions through tokenVersion | Same invalidation, plus clear the local cookie |

The browser manages the refresh cookie. Frontend code receives the access token
and uses it for protected API requests. HttpOnly prevents frontend JavaScript
from reading the refresh cookie; it does not replace token verification or the
existing authorization checks.

## Login, refresh, and logout step by step

### 1. Login

1. The client sends email and password to `POST /api/v1/auth/login`.
2. The service validates credentials and account status, then creates both JWTs.
3. The controller calls `setRefreshTokenCookie()`, which uses `res.cookie()`.
4. The browser stores the cookie from the Set-Cookie response header.
5. The controller returns the existing user summary and the public token fields:

```json
{
  "success": true,
  "message": "Login successful",
  "tokens": {
    "accessToken": "<access JWT>",
    "tokenType": "user"
  }
}
```

This example omits the user summary for brevity. Admin accounts receive
`tokenType: "admin"`. The refresh credential is absent from the JSON response.

### 2. Refresh

1. The client sends `POST /api/v1/auth/refresh-token` with credentials enabled.
2. The browser attaches the matching cookie; `cookie-parser` populates `req.cookies`.
3. Route validation checks the cookie before the controller calls the service.
4. The existing verifier checks the JWT and account session state.
5. The service revokes the old refresh token and generates new credentials.
6. The controller replaces the cookie and returns `tokens.accessToken` and
   `tokens.tokenType`, with the success/message envelope.

The client replaces its in-memory access token. It never needs to extract the
refresh cookie. A reused refresh token triggers the existing session invalidation
logic rather than issuing another usable session.

### 3. Logout

1. The client sends `POST /api/v1/auth/logout` with its access Authorization header
   and credentials enabled so the browser includes the refresh cookie.
2. Authentication validates the access token; the service verifies the refresh
   token and checks that both tokens belong to the same account.
3. The service revokes both token IDs.
4. The controller calls `clearRefreshTokenCookie()`, which uses `res.clearCookie()`.
5. The client discards its in-memory access token after a successful response.

`POST /api/v1/auth/logout-all` requires access authentication and increments the
account's tokenVersion instead of revoking only the current pair. It also clears
the local cookie; cookies on other devices are invalidated server-side.

## Files involved

| File | Responsibility |
| --- | --- |
| [auth.cookie.ts](../src/Modules/auth/auth.cookie.ts) | Shared cookie name, options, setting, and clearing |
| [auth.controller.ts](../src/Modules/auth/auth.controller.ts) | Read cookies, set/clear response cookies, omit refresh tokens from JSON |
| [auth.service.ts](../src/Modules/auth/auth.service.ts) | Credential checks, rotation, reuse detection, revocation, and session invalidation |
| [auth.validation.ts](../src/Modules/auth/auth.validation.ts) | Validate refresh cookies and reject old body-based credentials |
| [auth.dto.ts](../src/Modules/auth/auth.dto.ts) | Infer cookie DTOs from Zod schemas |
| [auth.routes.ts](../src/Modules/auth/auth.routes.ts) | Apply authentication and validation to each endpoint |
| [validation.middlewares.ts](../src/Middlewares/validation.middlewares.ts) | Support validating the cookies request section |
| [cors.ts](../src/Utils/middleware/cors.ts) | Credentialed CORS and origin allowlist |
| [app.controller.ts](../src/app.controller.ts) | Install CORS and cookie parsing before routes |
| [token.ts](../src/Utils/security/token.ts) | Existing JWT generation, verification, and revocation utilities |

## Cookie contract

`refreshToken` is HttpOnly, SameSite=Lax, host-only, and scoped to `/api/v1/auth`.
Secure is enabled when `NODE_ENV=production`; production therefore requires HTTPS.
Expiration matches the issued refresh JWT's `exp`, derived from `REFRESH_EXPIRES_IN`
(seconds). Options are evaluated at request time after environment configuration.

The opaque cookie contains `user <JWT>` or `admin <JWT>` (URL-encoded by Express).
This retains existing role-specific signing secrets without requiring a refresh
Authorization header or an additional role cookie. Incoming credentials still pass
through the existing signature, expiration, claims, revocation and tokenVersion
checks. Decoding the newly issued token for cookie expiry is not authentication.

Cookie parsing runs before routes. Zod validates the parsed cookie on refresh and
current-device logout. Unrelated cookies are accepted. Missing/malformed cookies
return 400 validation errors. These endpoints accept an empty body or no body;
old refreshToken request-body fields are rejected. Authorization headers are never
used as a fallback source of refresh credentials.

## Client changes

Configure `CORS_ORIGINS` as a comma-separated list of exact allowed origins,
including protocol and port, with no trailing slash, for example:

Local HTTP development:

```dotenv
CORS_ORIGINS=http://localhost:5173
NODE_ENV=development
REFRESH_EXPIRES_IN=604800
```

Production with a same-site HTTPS frontend/API:

```dotenv
CORS_ORIGINS=https://shop.example.com
NODE_ENV=production
REFRESH_EXPIRES_IN=604800
```

Keep the existing access/refresh signing secrets configured separately. These
examples contain only the settings relevant to cookie transport.

Use development NODE_ENV for local HTTP. CORS enables credentials and reflects only
an explicitly allowed origin, never a wildcard. Requests with an unlisted Origin
are rejected with 403 before routing; requests without Origin remain usable by
non-browser clients. Include your API origin if browser requests originate there.
With no allowlist, requests carrying Origin are rejected.

```js
const login = await fetch(`${api}/api/v1/auth/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
let { tokens } = await login.json();

const refresh = await fetch(`${api}/api/v1/auth/refresh-token`, {
  method: 'POST',
  credentials: 'include',
});
({ tokens } = await refresh.json());

await fetch(`${api}/api/v1/auth/logout`, {
  method: 'POST',
  credentials: 'include',
  headers: { Authorization: `${tokens.tokenType} ${tokens.accessToken}` },
});
```

Axios clients use `withCredentials: true`. Keep the access token in client memory;
do not read or store the refresh token in JavaScript. Existing protected endpoints
continue using `Authorization: user <access JWT>` or `admin <access JWT>`.
SameSite=Lax supports same-site frontend/API deployments, including different
localhost ports. Unrelated cross-site frontend/API domains are not supported by
this cookie policy; credentialed CORS alone does not change SameSite behavior.

## Rotation and invalidation

Successful refresh revokes the old refresh JWT, issues a new pair, and replaces the
cookie. Reuse (including a concurrent duplicate revocation) increments tokenVersion
and rejects the request, invalidating all account sessions. Serialize refresh calls.
Frozen-account checks and logout ownership verification remain in the service.
Login and refresh responses set Cache-Control: no-store.

Successful current-device logout revokes both presented tokens, then clears the
cookie. Logout-all increments tokenVersion and clears the caller's cookie. Other
devices retain their cookies but their tokens become invalid. Successful password
change/reset also clears the local cookie after the existing session invalidation.
Clearing uses the same cookie scope/security options, without future expiry, per
[Express documentation](https://expressjs.com/en/4x/api/response/#res.clearCookie).
Failed logout does not claim to have revoked the session or clear its cookie.

## Verification

Run `npm test` or `npm run build` followed by
`node --test tests/auth*.test.cjs`. Cookie tests exercise actual Express routing,
cookie parsing, Zod validation, JWT signing/verification and rotation; database
repositories are mocked. They cover user/admin schemes, expiration, production
flags, CORS, ownership, replay and concurrent reuse, tokenVersion, and logout.
