# Shared image uploads

Implemented 2026-11-08. The API accepts local image uploads on existing profile, product, and category write routes. Other modules do not currently have an attachment requirement. PDF/Office documents, SVG, GIF, archives, video, scripts, and executables are not enabled.

## API contract

Send `multipart/form-data` with an access token in the `Authorization` header. Let your HTTP client generate the multipart boundary; do not manually set `Content-Type` when using browser `FormData`.

| Endpoint | Permission | File field | Maximum |
| --- | --- | --- | --- |
| `PATCH /api/v1/auth/profile` | Authenticated account, own profile | `avatar` | 1 file, 2 MiB |
| `POST /api/v1/products` | Admin | `images` (repeat field) | 10 files, 5 MiB each |
| `PATCH /api/v1/products/:productId` | Admin | `images` (repeat field) | 10 files, 5 MiB each |
| `POST /api/v1/categories` | Admin | `image` | 1 file, 5 MiB |
| `PATCH /api/v1/categories/:categoryId` | Admin | `image` | 1 file, 5 MiB |

Accepted input formats are JPEG (`.jpg`/`.jpeg`), PNG, and WebP. The extension, MIME type, binary signature, and decoded format must agree. Only static images are accepted. All accepted images are re-encoded as WebP, with orientation applied and metadata removed. Output must also fit the field's byte limit.

Product create still requires at least one image. Category images and avatars are optional. On update, supplying images replaces the collection; omitting the file/image field preserves its current value. Category image and avatar replacement follow the same omission rule. Existing response envelopes are preserved; profile responses now include `user.avatar` when present.

Existing JSON requests remain supported. Products/categories can still accept external HTTP(S) image URLs; the server does not fetch or inspect those URLs. Uploaded URLs are server-owned: do not send `/media/...` URLs back in image fields. Omit the image field to keep existing managed images, or upload a complete replacement. Mixing a file and a text URL in the same image field is rejected. Avatar text URLs are rejected.

## Multipart form values

The middleware converts only declared fields before running the existing strict Zod schemas:

- Product: `price`, `compareAtPrice`, and `stock` are numeric strings; `isActive` is exactly `true` or `false`; `compareAtPrice` may be `null`; a URL-only `images` field is a JSON array.
- Category: `sortOrder` is a numeric string; `isActive` is exactly `true` or `false`; `parent` may be `null` on update.
- Profile: `address` is a JSON array; `phone` and `gender` may be `null`.

Other text fields remain strings. Unknown fields, duplicate scalar fields, bracket-style field names, malformed JSON, invalid primitives, and unexpected file fields are rejected. Nested objects must be encoded in their declared JSON field, not as bracket notation. Normal module validation still determines whether a field is permitted on create or update.

## Examples

Use the appropriate `user` or `admin` token prefix expected by the existing authentication API.

```sh
curl -X PATCH http://localhost:4000/api/v1/auth/profile \
  -H "Authorization: user YOUR_ACCESS_TOKEN" \
  -F "firstName=Ahmed" \
  -F "avatar=@avatar.png;type=image/png"

curl -X POST http://localhost:4000/api/v1/products \
  -H "Authorization: admin YOUR_ACCESS_TOKEN" \
  -F "name=Camera" -F "slug=camera" \
  -F "description=Camera with interchangeable lens" \
  -F "sku=CAM-123" -F "price=1200" -F "stock=5" \
  -F "category=YOUR_CATEGORY_OBJECT_ID" \
  -F "images=@front.jpg;type=image/jpeg" \
  -F "images=@back.png;type=image/png"

curl -X PATCH http://localhost:4000/api/v1/categories/YOUR_CATEGORY_OBJECT_ID \
  -H "Authorization: admin YOUR_ACCESS_TOKEN" \
  -F "name=Cameras" -F "isActive=true" \
  -F "image=@category.webp;type=image/webp"
```

On Windows PowerShell, use `curl.exe` and PowerShell's line continuation syntax, or put each command on one line.

## Configuration

```dotenv
# Use a persistent application-owned directory outside src/dist.
STORAGE_ROOT=storage
# Fixed trusted URL; never derived from request Host headers.
STORAGE_PUBLIC_URL=http://localhost:4000/media
UPLOAD_MAX_PIXELS=20000000
UPLOAD_MAX_DIMENSION=8192
UPLOAD_CONCURRENCY=4
UPLOAD_TIMEOUT_MS=60000
UPLOAD_RETENTION_HOURS=24
```

The root defaults to `<working directory>/storage`. The URL defaults to `http://localhost:<PORT or 4000>/media`. Set the public URL to your externally reachable HTTPS origin in deployment and route its `/media` requests to this API. Keep that URL stable: existing records and manifests store absolute URLs, so changing origins requires an explicit migration.

Each route also limits total request bytes to its configured file budget plus 256 KiB of multipart overhead, 20 text fields, 16 KiB per field, 64 bytes per field name, and the allowed file count plus 20 total parts. Uploads share a limit of 30 multipart requests per IP per 15 minutes, in addition to existing prefix limits. The default parsing deadline is 60 seconds. Image processing has a 10-second timeout per file. Global concurrent multipart requests are bounded per application process.

Use Node.js 22.12 or later; this implementation was tested on Node.js 24.21.0. `file-type` is ESM and is loaded using Node's synchronous ESM support from the CommonJS build.

## Storage and delivery

```text
storage/
|-- staging/<request UUID>/<generated file>
|-- users/<user ObjectId>/avatar/<UUID>.webp
|-- products/<product ObjectId>/images/<UUID>.webp
\-- categories/<category ObjectId>/image/<UUID>.webp
```

Every finalized image has an adjacent `.webp.json` manifest containing its internal key, URL, owning module/record, uploader ID, field, dimensions, size, MIME type, and creation time. Manifests are not served. Original client filenames never become storage paths. New category/product IDs are allocated before processing and passed through to database creation.

`GET /media/:module/:ownerId/:folder/:filename` serves only a generated WebP with a manifest and a current reference on its owning record. It sends `nosniff`, a restrictive CSP, the fixed WebP content type, and `Cache-Control: no-store`. Staging and manifests are inaccessible through the route. No static directory mount exposes storage.

These are **public image assets**, including avatars: anyone with a current image URL can retrieve it. This delivery policy is independent of catalog listing visibility. It is not suitable for private documents. Future private attachment policies require authenticated delivery and malware/structural checks before release.

## Failures, replacement, and cleanup

- Body validation and image inspection complete before files are finalized or module services run.
- A complete replacement uses unique filenames. Multipart updates compare the original media reference before committing; a losing replacement receives 409.
- Staging is removed after success, rejection, or disconnect. Image file-handle caching is disabled to allow cleanup on Windows.
- Finalized files are retained after an ambiguous database failure. A failed response does not prove that a database commit failed.
- Reconciliation runs at startup and hourly, with a default 24-hour grace period. It removes stale staging and finalized files that no product, category, or user still references. Active in-process uploads are excluded. Database errors stop reconciliation; deletions are retried on later runs.
- Replaced files are no longer served once their owning reference changes, but disk removal waits for reconciliation. External URLs are never deleted.

Use one application process per local storage root. Active-upload protection and concurrency limits are process-local; shared roots across independent processes are not supported. For horizontal scaling, introduce shared leases/rate limits and an object-storage adapter. Restrict filesystem write access to the application OS account: path and symlink checks are defense in depth, not protection against a hostile local administrator. Persist and back up the storage volume together with the database, and monitor free disk space. In an ephemeral container, unmounted local uploads will be lost on replacement.

## Error behavior

| Status | Examples |
| --- | --- |
| 400 | Invalid body, duplicate/unexpected fields, type/signature mismatch, malformed/animated image, invalid dimensions |
| 401 / 403 | Missing authentication or insufficient permissions |
| 404 | Missing owner or unavailable managed file |
| 409 | Media reference changed while an upload was processing |
| 413 | Per-file parser limit or declared total request byte limit exceeded |
| 429 | Upload or API rate limit exceeded |
| 503 | Concurrent upload capacity reached |
| 500 | Storage or downstream persistence failure |

A streamed request exceeding the total byte budget, or a parsing timeout, closes the connection to stop resource consumption; the client may receive a network error instead of a JSON response. Retry with a fresh request after checking the record's current state.

## Extending and testing

`uploadRoute(policy, schemas, controller)` combines parsing, typed form conversion, validation, inspection, finalization, and cleanup. Register authentication/authorization and `uploadLimiter` before it. Policies declare named fields and counts; `maxCount: 1` handles a single file, `multiple: true` creates an array, and multiple field definitions support named groups. New storage destinations also need an explicit key allowlist, owner/reference checks, and reconciliation support. Do not enable arbitrary client-chosen directories or MIME types.

Run `npm run test:upload` for upload security, HTTP integration, image processing, and replacement checks. Run `npm test` for the complete suite. Database-free route tests mock token decoding and persistence while exercising real routers and files. Existing MongoDB integration suites require a dedicated `MONGO_TEST_URI`; they are skipped when it is absent. No live database or production storage migration is performed by this change.
