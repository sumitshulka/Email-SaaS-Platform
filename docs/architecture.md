# Mailflow SaaS architecture

## Delivery order

Build in the eight product phases in the specification. Phase 1 is the current
scope: authentication, roles, tenant identity, user administration, admin
settings, and configuration. Subscription, SMTP sender accounts, contacts,
templates, campaigns, durable sending jobs, and analytics will be delivered in
their later phases; they are not represented as working features until then.

## System architecture

```text
React + TypeScript web app
        │ same-origin /api requests
        ▼
Express REST API ── authentication / role / tenant / subscription guards
        │
        ▼
Application services ── repositories ── PostgreSQL (Drizzle ORM)

Future campaign path:
Campaign API → persisted PostgreSQL job queue → worker → SMTP EmailService
Future payment path:
Subscription API → Razorpay order → signed webhook → idempotent payment service
```

- The existing Express API server is shared by this app. OpenAPI in
  `lib/api-spec/openapi.yaml` is the API contract; generated Zod validators and
  React Query hooks are used at the server and client boundaries.
- Tenant-facing records carry `user_id`; service/repository functions receive
  the authenticated user ID and scope reads and writes by it. Role checks are
  server-side. Public resource identifiers are UUIDs.
- Phase 1 uses local username/email + password authentication because the
  required seeded login is a fixed application username. Passwords are
  bcrypt-hashed; opaque session tokens are stored only as hashes in PostgreSQL
  and issued in HttpOnly, Secure-in-production, SameSite cookies. Admin
  credentials require rotation on the first login.
- SMTP and Razorpay secrets are encrypted with AES-256-GCM at rest using a
  server-side key derived with HKDF from the Replit-provided `SESSION_SECRET`;
  the derivation uses a separate application-specific context. Secrets are
  write-only in settings APIs and returned only as masked/configured status.
- Login, OTP and password-reset tokens are one-time, time-limited, attempt
  limited, and persisted in hashed form. Audit entries record admin actions
  without secret values.
- App-notification SMTP and customer sending SMTP remain separate configurations
  and services. Only the sending worker will decrypt a customer's sender
  credentials.
- A PostgreSQL-backed job table, idempotency keys, row/advisory locking, and
  atomic quota reservations are planned for campaigns. This avoids making
  delivery depend on a browser session or a volatile in-memory queue.
- Razorpay payment verification will happen server-side and in signed webhooks;
  payment and subscription activation will be one transaction with unique
  provider references for idempotency.
- Timestamps are stored in UTC; tenant profile timezone defaults to
  `Asia/Kolkata`. Provider delivery status is shown only when the provider
  actually supplies it.

## ER model

```text
users 1──* user_sessions
users 1──* otp_verifications
users 1──* password_reset_tokens
users 1──* user_subscriptions *──1 subscription_packages
users 1──* payments
users 1──* email_accounts
users 1──* contacts *──* contact_lists (via contact_list_members)
users 1──* email_templates
users 1──* uploaded_assets
users 1──* campaigns 1──* campaign_recipients
campaign_recipients 1──* email_logs 1──* email_events
users 1──* email_logs
users 1──* audit_logs (actor)
users 1──* email_rate_limit_buckets
system_configuration and application_email_configuration are platform-scoped
```

## Complete planned table inventory

| Table | Ownership and key relationships |
| --- | --- |
| `users` | Identity, role, active/deleted state, username, email, password hash, timezone, first-login credential rotation flag |
| `user_sessions` | User-owned hashed session token, CSRF metadata, expiry and revocation |
| `otp_verifications` | Optional user, purpose, destination, hashed OTP, expiry and attempt count |
| `password_reset_tokens` | User-owned hashed, one-time reset token and expiry |
| `subscription_packages` | Platform-managed package limits, price, frequency and visibility |
| `user_subscriptions` | User + package; status, start/end and provider subscription reference |
| `payments` | User + optional package/subscription; amount/currency/status and unique Razorpay order/payment references |
| `application_email_configuration` | Single platform-level encrypted app SMTP configuration, not a customer sender account |
| `email_accounts` | Tenant-owned encrypted sender SMTP settings, verification and activity state |
| `system_configuration` | Platform configuration key/value, update actor and timestamp |
| `contacts` | Tenant-owned normalized email/contact, suppression and delivery summary; unique active `(user_id,email)` |
| `contact_lists` | Tenant-owned named list |
| `contact_list_members` | Tenant-scoped many-to-many link between lists and contacts |
| `email_templates` | Tenant-owned subject, text body, signature and optional asset reference |
| `uploaded_assets` | Tenant-owned object-storage path and validated image metadata |
| `campaigns` | Tenant-owned list/template references, schedule, status and progress counters |
| `campaign_recipients` | Tenant + campaign + contact, recipient status and stable idempotency key |
| `email_logs` | Tenant-owned per-attempt history, provider message ID, status and retry state |
| `email_events` | Provider event/status history linked to tenant and email log |
| `email_rate_limit_buckets` | Atomic tenant sending quota reservations for a time window |
| `background_jobs` | Durable typed jobs, availability, attempts, lock state and idempotency key |
| `audit_logs` | Platform/admin actor, action, entity, IP and redacted metadata |

Foreign keys, tenant-aware uniqueness, status/time indexes, transactions for
cross-record state changes, and UUID public identifiers are used throughout.
The Phase 1 migration initially creates the identity, session, OTP, reset,
configuration, application SMTP, and audit tables; later phases add the rest.

## Phase 1 project structure

```text
artifacts/mailflow-saas/src/       React pages, shared shell, auth state
artifacts/api-server/src/routes/   Auth, profile, admin and settings routes
artifacts/api-server/src/lib/      Session, password, encryption and mail services
lib/api-spec/openapi.yaml          API source of truth
lib/api-zod/                       Generated server validators
lib/api-client-react/              Generated frontend hooks
lib/db/src/schema/                 Drizzle tables, grouped by domain
docs/architecture.md               This architecture and staged ER inventory
```