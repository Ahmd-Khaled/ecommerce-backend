# Address Module

Addresses remain embedded in `User.address`; no separate collection is introduced.
Each address now has a stable MongoDB `_id`. Existing addresses receive persisted
IDs on first access, using an atomic comparison against the stored address array.
If old data contains multiple defaults, the first default is retained.

All routes require the existing access-token authentication. Ownership comes from
the authenticated user, never request data. Authenticated roles can manage only
their own addresses.

| Method | Route | Result |
| --- | --- | --- |
| POST | /api/v1/addresses | Create address (201) |
| GET | /api/v1/addresses | List own addresses (200) |
| PATCH | /api/v1/addresses/:addressId | Update supplied fields (200) |
| DELETE | /api/v1/addresses/:addressId | Delete and return remaining addresses (200) |
| PATCH | /api/v1/addresses/:addressId/default | Select default (200); no body required |

Create requires `label`, `fullName`, `phone`, `country`, `city`, and `street`.
Optional fields are `building`, `apartment`, and boolean `isDefault`. Strings are
trimmed and bounded. Unknown fields, invalid IDs, blank required fields, invalid
phone formats, and empty updates return 400. Optional building/apartment strings
can be cleared with an empty string. Responses use `{ success, message, data }`.

The first address defaults automatically unless `isDefault: false` is supplied.
Setting a default clears all others in the same atomic write. Explicitly unsetting
a default permits zero defaults. Deleting the default promotes the first remaining
address. Missing or other users' address IDs return the same 404 response.

Writes compare the previous array and retry up to five times, preserving concurrent
changes without requiring MongoDB transactions. Repeated contention returns 409.
Unrelated User fields are not replaced. The repository uses raw collection updates
to prevent Mongoose from adding IDs to legacy comparison filters; request validation
is performed by Zod before reaching the service.

Implementation: `src/Modules/address/` contains validation, inferred DTOs,
controller, routes and service. `src/DB/repository/address.repository.ts` handles
persistence against the existing User model. Routes are mounted in
`src/app.controller.ts` with the user rate limiter and a 10 KB JSON body limit.

Run `npm test` for the full suite, or build and run
`node --test tests/address*.test.cjs` for Address tests. Live MongoDB tests require
an explicit `MONGO_TEST_URI` and create/drop their own uniquely named test database.
