# Payment module

The module uses Stripe-hosted Checkout for one-time card payments. Card data never passes through this API. Stripe was selected because this project had no payment provider configured. Provider HTTP calls are isolated in `payment.gateway.ts`.

## Setup

Set these values in `config/.env.dev` (or the deployment environment):

- `STRIPE_SECRET_KEY`: your Stripe test/live secret key.
- `STRIPE_WEBHOOK_SECRET`: signing secret for this specific webhook endpoint.
- `PAYMENT_SUCCESS_URL`: trusted storefront success URL.
- `PAYMENT_CANCEL_URL`: trusted storefront return URL.

Return URLs must use HTTPS; HTTP localhost is allowed outside production. Missing configuration returns 503 on checkout/webhook requests without preventing the rest of the API from starting. No credentials are committed.

Register a **snapshot** webhook at `POST /api/v1/payments/webhook` with API version `2026-10-28.endive`. Subscribe to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`. Locally, use `stripe listen --forward-to localhost:4000/api/v1/payments/webhook` and its printed signing secret. Use test-mode credentials and Stripe test cards before enabling live payments. Merchant account availability and supported settlement currencies must be verified with Stripe.

## API

Customer routes require the existing access-token authentication and the `user` role.

| Method | Path                               | Input / result                                                                                                                                                                       |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/v1/payments/checkout`        | Body `{ "orderId": "24-character MongoDB ID" }`; required `Idempotency-Key` header, 16�128 letters, digits, underscores or hyphens. Returns 200 with payment state and checkout URL. |
| GET    | `/api/v1/payments/orders/:orderId` | Returns the authenticated customer's payment state; missing and foreign orders both return 404.                                                                                      |
| POST   | `/api/v1/payments/webhook`         | Raw JSON with Stripe signature; successful processing returns `{ "received": true }`. No customer token required.                                                                    |

Customer responses use `{ "success": true, "data": { "orderId", "status", "amountMinor", "currency", "checkoutUrl", "paidAt" } }`. Status is `unpaid`, `pending`, `paid`, or `expired`. Order responses also expose `paymentStatus`. Keys, secrets, and raw provider payloads are not exposed.

Create an order through the existing order checkout API first. Generate and retain one payment idempotency key for that order. POST the order ID, redirect the browser to `data.checkoutUrl`, and poll the GET endpoint after returning to the storefront. A success redirect is not proof of payment. A cancel redirect does not cancel or expire a session.

## Correctness and security

Amounts come exclusively from immutable version-2 order totals, in minor units. Client amount, currency, owner, and redirect URL overrides are rejected. Supported currencies are EGP, USD, EUR, GBP, AED, and SAR with exponent 2; totals must be positive safe integers at most 99,999,999. Stripe may impose stricter currency-specific minimums. Additional currency conventions need explicit implementation before expanding the allowlist.

An atomic order update reserves one payment attempt before contacting Stripe. Concurrent requests reuse a deterministic provider key and identical persisted redirect parameters. Network calls have a 10-second timeout. Errors retain the pending reservation: retry with the original key. Uncertain creation is blocked after 23 hours to avoid recreating a charge after Stripe's idempotency retention window. Existing sessions are returned without recreation.

Payment state is embedded in the order, so confirmation is a single atomic write. Webhook verification uses the raw body, HMAC-SHA256, constant-time comparison, and a five-minute timestamp tolerance. Multiple v1 signatures are accepted. The handler retrieves the current session from Stripe and checks its order metadata, session identity, amount, currency, and mode before changing state. Duplicate deliveries are safe; old events cannot downgrade a terminal payment. Provider/database failures return non-2xx for Stripe retry. Unrelated event types are acknowledged without mutation.

Customer endpoints use the payment rate limiter. Webhooks are outside that limiter and have a 256 KB body limit. Do not mount a JSON parser before the payment router.

Order cancellation rejects pending and paid payments. Fulfillment rejects orders with a pending or expired payment attempt. Existing orders with no online-payment attempt retain their prior fulfillment behavior. The order repository's MongoDB transaction and payment's atomic order update conflict safely if cancellation races payment initiation.

## Operational boundaries

This implementation permits one Checkout session per order. An expired session cannot be restarted on that order: cancel the expired order to restore stock and create a new order. Expiration itself does not restore inventory. Card declines can be retried inside the existing open Checkout session.

Refunds, disputes, partial payments, subscriptions, and automated reconciliation are not implemented. Paid orders cannot be cancelled through the existing order API; a refund and reconciliation workflow must be added before supporting that business operation. Never manually reset a pending reservation just because the client timed out.

For stuck pending payments, inspect Stripe using the order ID in session metadata. Replay the relevant event to synchronize the order. For a creation outcome older than 23 hours, reconcile the Stripe session/payment before any database repair. Alert on repeated webhook failures and aged pending orders. Back up records and keep an audit trail for manual reconciliation. Do not log secrets, card information, or full provider payloads.

## Validation

Run `npm test` for build and regression coverage, or `npm run build && node --test tests/payment.test.cjs` for payment tests. Tests cover signatures, replay age, tampering, amount checks, stable provider keys, duplicate delivery, raw-body HTTP routing, roles, and ownership. Provider calls and persistence are mocked in payment tests; live Stripe and real MongoDB concurrency still require deployment smoke tests. Existing database integration suites require `MONGO_TEST_URI` pointing to a disposable replica set.

References: [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [webhook verification](https://docs.stripe.com/webhooks), [idempotent requests](https://docs.stripe.com/api/idempotent_requests).
