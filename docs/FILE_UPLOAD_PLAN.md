# Shared File Upload Implementation Plan

Date: 2026-11-08

Status: implemented after user approval on 2026-11-08. See [FILE_UPLOADS.md](FILE_UPLOADS.md) for the shipped API, configuration, deployment limits, and verification details.

## Objective

Provide shared, secure file upload infrastructure for single files, multiple files, and multiple named file fields. Start with local storage and integrate image uploads into product, category, and user profile APIs. Keep storage replaceable with an S3-compatible provider later.

## Current integration points

- Products already store an `images` URL array, with a maximum of 10 images in request validation.
- Categories already support an optional `image` URL.
- Profile management lives under the auth module. Add an optional `avatar` field to the user model and profile response.
- Address, cart, order, and payment have no current attachment requirement. Do not add upload endpoints to these modules without a concrete use case.

## 1. Dependencies and shared components

Use Multer for multipart parsing and local staging, file-type for binary signature detection, and Sharp for image decoding and re-encoding. Select patched versions, check security advisories, and verify compatibility with the project's CommonJS build before installation.

Proposed source layout:

```text
/src/
|-- Utils/storage/
|   |-- storage.config.ts
|   |-- storage.types.ts
|   |-- storage.service.ts
|   |-- local.storage.ts
|   |-- upload.policies.ts
|   |-- file.inspection.ts
|   \-- upload.cleanup.ts
\-- Middlewares/
    |-- upload.middlewares.ts
    \-- multipart.validation.ts
```

Responsibilities:

- Define a storage interface with operations for staging, finalizing, retrieving, and deleting managed files.
- Implement local disk storage behind that interface.
- Provide reusable middleware factories for single, multiple, and named-field uploads.
- Let each route select allowed fields, types, counts, sizes, and destination policy.
- Track managed file metadata, ownership, and lifecycle state so cleanup and delivery do not depend on arbitrary client URLs.

## 2. Global storage layout

Use a configurable storage root outside `src` and `dist`:

```text
/storage/
|-- staging/<requestId>/
|-- users/<userId>/avatar/<generatedId>.webp
|-- products/<productId>/images/<generatedId>.webp
\-- categories/<categoryId>/image/<generatedId>.webp
```

- Derive module directories from server-controlled policies.
- Derive record directories from authenticated identity or validated, authorized record IDs.
- Generate random filenames; never use client filenames as filesystem paths.
- Allocate record IDs for create requests before finalizing storage.
- Keep files staged until form and content validation succeed.
- Exclude runtime uploads from Git and document persistent-volume and backup requirements for deployment.

## 3. Security and file inspection

Apply layered validation. A MIME header or matching signature alone does not establish that a file is safe.

- Authenticate and check permissions before accepting upload content.
- Use route-specific allowlists for extensions, declared MIME types, detected signatures, and decoded formats.
- Reject empty, truncated, malformed, unsupported, and mismatched files.
- Fully decode and re-encode accepted images, remove metadata, and enforce image dimension and pixel limits.
- Bound processing time and concurrency as well as upload sizes.
- Reject path traversal, Windows alternate data stream syntax, unsafe filenames, and any resolved path outside the configured storage root. Guard against symlink/reparse-point escapes.
- Enforce per-file and total request byte limits, file counts, multipart part counts, text-field counts and sizes, upload timeouts, and rate limits.
- Keep staging inaccessible over HTTP. Expose only finalized files through controlled delivery with correct content types and `X-Content-Type-Options: nosniff`.
- Define public versus protected delivery explicitly; authorization must apply to any future private attachments.
- Map parser and inspection failures to consistent application errors without leaking absolute paths.
- Perform binary inspection after staging, separately from Multer's preliminary file filter.

Initial image policies:

| Policy | Accepted input formats | Default limit |
| --- | --- | --- |
| Avatar | JPEG, PNG, WebP | 1 file, 2 MB |
| Category image | JPEG, PNG, WebP | 1 file, 5 MB |
| Product images | JPEG, PNG, WebP | Up to 10 total images, 5 MB per file |

Normalize accepted images to WebP. Reject animated/multi-frame inputs initially unless a bounded processing policy is explicitly added. Configure total request limits to accommodate allowed files plus a small, bounded form overhead.

The framework should permit future common-document policies. PDF and Office uploads remain disabled until structural validation and malware scanning are configured; fail closed if a required scanner is unavailable. Reject SVG, HTML, scripts, executables, and archives initially. No claim of universal file safety is implied by these checks.

## 4. Validate files with form inputs

Request flow:

```text
Authentication and permissions
  -> bounded multipart parsing into staging
  -> explicit form-field conversion
  -> Zod body and file validation
  -> content inspection and image processing
  -> service and storage persistence
  -> response
```

- Extend validation to cover file presence, field names, counts, and verified metadata together with normal body fields.
- Convert only schema-declared numeric, boolean, nullable, and JSON-array fields.
- Parse booleans explicitly: the string `"false"` must become `false`.
- Reject unknown fields, duplicate scalar fields, unexpected file fields, malformed JSON, and conflicting URL/file inputs for the same field.
- Preserve existing JSON request behavior.
- Do not depend on multipart field ordering to determine ownership or destination directories.

## 5. Module integration

| Module | Planned behavior |
| --- | --- |
| Auth/profile | Accept an optional single `avatar` on profile update; persist and return its managed metadata/URL |
| Product | Accept multiple `images` on create/update; enforce the existing maximum of 10 total images |
| Category | Accept an optional single `image` on create/update |
| Address, cart, order, payment | No upload endpoints until an attachment requirement exists |

- On product update, supplied images replace the image collection; omission preserves existing images.
- Replacing a category image or avatar preserves the old file until the new reference is committed.
- Continue supporting existing image-URL requests, but never fetch external URLs or classify them as inspected uploads.
- Keep generated URLs compatible with existing URL fields using a configured public base URL; keep internal storage keys distinct from presentation URLs.
- Apply existing administrator permissions to product/category uploads and authenticated ownership to profile uploads.

## 6. Persistence, cleanup, and concurrency

MongoDB and the filesystem do not share an atomic transaction. Implement explicit compensation and reconciliation:

- Clean up staged files on validation failures, parser errors, service failures, and aborted requests.
- Finalize validated files and persist references with compensating cleanup if persistence fails.
- Delete replaced files only after successful reference updates and confirmation that no remaining record references them.
- Protect concurrent replacements from deleting a winning request's files or overwriting changes silently.
- Reconcile expired staging files and unreferenced finalized uploads after crashes, using an age threshold that protects active requests.
- Retry failed deletions safely and make cleanup idempotent.
- Restrict deletion to server-managed storage keys; never delete arbitrary paths or external URLs supplied by clients.

## 7. Verification

- [x] Valid single-file, multiple-file, and named-field uploads.
- [x] Multipart form conversion and joint body/file validation.
- [x] Existing JSON request compatibility.
- [x] Authentication, administrator permissions, and ownership restrictions.
- [x] Spoofed extensions, MIME headers, and binary signatures.
- [x] Empty, malformed, truncated, oversized, and excessive-dimension images.
- [x] Unexpected fields, duplicate scalar fields, invalid JSON, and conflicting inputs.
- [x] File counts, individual/aggregate size limits, and bounded processing.
- [x] Traversal, unsafe filenames, and storage-root escape attempts.
- [x] Failure/abort cleanup, replacement behavior, concurrent updates, and crash reconciliation.
- [x] Controlled file delivery and response headers.
- [x] TypeScript build and affected module regression tests.

## 8. Documentation and configuration

- Document storage root, public base URL, file/request limits, and cleanup settings in configuration examples.
- Add multipart examples for profile, product, and category APIs, including field types and replacement semantics.
- Document supported formats, error responses, storage persistence, and cleanup operation.
- Update `Folder_Structure.md` and relevant architecture/module documentation after implementation.

## Approval checkpoint

User approved implementation on 2026-11-08 for this scope: shared local storage with image uploads enabled for profiles, products, and categories; document uploads disabled until structural validation and malware scanning are configured.

## References

- [Multer documentation](https://expressjs.com/en/resources/middleware/multer/)
- [file-type project](https://github.com/sindresorhus/file-type)
- [Sharp input options and pixel limits](https://sharp.pixelplumbing.com/api-constructor/)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Multer async file-filter size-limit advisory](https://github.com/expressjs/multer/security/advisories/GHSA-qvfw-j98x-7q72)

## Implementation verification (2026-11-08)

- `npm run test:upload`: 19 passed.
- `npm test`: 89 passed, 4 skipped, 0 failed; includes the TypeScript build.
- The four existing MongoDB integration suites were skipped because `MONGO_TEST_URI` was not configured. Upload route/persistence tests use mocked database access and real multipart parsing, image processing, and filesystem operations.
- `npm audit --omit=dev`: 0 reported vulnerabilities at verification time.
- `git diff --check`: passed.

Finalized-file cleanup is deferred through reconciliation to protect ambiguous database commits. Local storage supports one application process per root. Uploaded images are public while referenced; document uploads remain disabled. See [FILE_UPLOADS.md](FILE_UPLOADS.md) for the full shipped behavior and limitations.
