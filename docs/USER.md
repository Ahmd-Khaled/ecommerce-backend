# User module and account data

The [User module](../src/Modules/user) manages customers with `user` and `guest` roles. Administrator identities are stored separately; see [Admin](ADMIN.md).

## What a request does today

`/api/v1/users` and its alias `/api/v1/admin/users` require an admin or super-admin access token. GET `/` lists users, POST `/` creates a user, GET `/:id` retrieves one, PATCH `/:id` (or `/:id/status`) updates one, and DELETE `/:id` soft-deletes one with a 204 response.

Creation accepts `{firstName, lastName, email, password, role?}` and queues the existing confirmation OTP. Role defaults to `user`; the user must verify their email. Updates accept only `firstName`, `lastName`, `role` (`user`/`guest`), and `status` (`active`/`frozen`). Setting `active` unfreezes an account but does not verify its email. Updates/deletion increment tokenVersion; frozen/deleted users cannot authenticate or refresh. Deletion preserves orders and historical references and cannot be undone through this API.

Lists accept `page` (default 1), `limit` (default 20, maximum 100), bounded literal `search` over names/email, `role`, and `status` (`active`, `pending`, `frozen`, `deleted`). Deleted accounts are excluded by default. Responses use `{success: true, data: {users, pagination: {page, limit, total, totalPages}}}`; individual responses use `data` for the safe user summary. Passwords, OTPs, token versions, provider IDs, and private address data are not included. Unknown input fields and operator-shaped queries are rejected.

## Where existing account APIs live

| Need | Actual API | Implementation |
| --- | --- | --- |
| Create an account | POST `/api/v1/auth/register` | Auth service and User model hooks |
| Read current profile | GET `/api/v1/auth/profile` | Auth controller -> `authService.getProfile` -> `userRepository.findUserById` |
| Change profile/contact/addresses | PATCH `/api/v1/auth/profile` | Auth controller -> `authService.updateProfile` -> document save |
| Change password | PATCH `/api/v1/auth/change-password` | Auth service -> guarded password update and session invalidation |
| Recover account | PATCH `/api/v1/auth/forgot-password`, PATCH `/api/v1/auth/reset-password` | OTP issue/consume workflow |

See [Auth](AUTH.md) for complete input contracts and behavior. Addresses are embedded in User and also have dedicated CRUD under `/api/v1/addresses`.

## User fields and hooks

The model stores firstName, lastName, slug, normalized unique email, hidden password hash, optional phone/gender/addresses, role, email confirmation state, password-reset state, tokenVersion, optional freeze/credential-change timestamps, and creation/update timestamps.

`username` is a virtual derived from firstName and lastName rather than a stored field. Changing names on document save regenerates the slug. Document pre-save hooks hash modified passwords and OTPs; a post-save hook queues confirmation email for a newly created user. Atomic repository updates bypass document save hooks, so relevant services hash passwords/OTPs before those updates.

Roles are only `user` and `guest`; both use the `user` authorization scheme. Registration defaults to user and exposes no role assignment field. Guests may use their own account/profile/address APIs, while cart/order/payment routes still require `user`. No user-management endpoint can assign administrator roles. See [Database](DATABASE.md) for more about documents, hooks, and repositories.
