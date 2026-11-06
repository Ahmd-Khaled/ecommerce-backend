# User module and account data

The [User module directory](../src/Modules/user) is currently a scaffold. Its controller exports an empty Express router. `app.controller.ts` mounts that router at `/api/v1/users`; the service, routes, DTO, validation, and authorization files do not implement account-management endpoints.

## What a request does today

`GET /api/v1/users` goes through the users IP limiter and JSON parser, reaches the empty router, and falls through to the application's 404 handler. There is no user listing, admin user update, or address endpoint under this prefix. No user service call or database operation happens for that request.

The User database model and repository are fully used by the Auth module. An empty feature router does not mean there is no user persistence.

## Where existing account APIs live

| Need | Actual API | Implementation |
| --- | --- | --- |
| Create an account | POST `/api/v1/auth/register` | Auth service and User model hooks |
| Read current profile | GET `/api/v1/auth/profile` | Auth controller -> `authService.getProfile` -> `userRepository.findUserById` |
| Change profile/contact/addresses | PATCH `/api/v1/auth/profile` | Auth controller -> `authService.updateProfile` -> document save |
| Change password | PATCH `/api/v1/auth/change-password` | Auth service -> guarded password update and session invalidation |
| Recover account | PATCH `/api/v1/auth/forgot-password`, PATCH `/api/v1/auth/reset-password` | OTP issue/consume workflow |

See [Auth](AUTH.md) for complete input contracts and behavior. Addresses are embedded in the User document and replaced as an array through profile update; they have no separate CRUD router.

## User fields and hooks

The model stores firstName, lastName, slug, normalized unique email, hidden password hash, optional phone/gender/addresses, role, email confirmation state, password-reset state, tokenVersion, optional freeze/credential-change timestamps, and creation/update timestamps.

`username` is a virtual derived from firstName and lastName rather than a stored field. Changing names on document save regenerates the slug. Document pre-save hooks hash modified passwords and OTPs; a post-save hook queues confirmation email for a newly created user. Atomic repository updates bypass document save hooks, so relevant services hash passwords/OTPs before those updates.

Roles are `user`, `admin`, and `guest`, but credential generation only supports user/admin. Registration defaults to user and exposes no role assignment field. There is no implemented admin-promotion endpoint. See [Database](DATABASE.md) for more about documents, hooks, and repositories.
