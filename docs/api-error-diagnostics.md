# API error diagnostics

Mailflow returns a generic error to normal users and includes an incident ID
that support can use to locate the matching report. Detailed capture is off by
default and can be enabled by a superadmin under **Admin → Settings → Error
diagnostics**.

When enabled, unexpected API errors (HTTP 500) are written to the API service
logs and saved for the superadmin diagnostics panel. The viewer shows the
sanitized error message, database error code and location when available, and
stack frames. It does not store request bodies, query values, cookies,
authorization headers, account IDs, contact data, or campaign content. Common
email, token, password, database-URL, and SQL-parameter patterns are redacted.
Only superadmins can read diagnostic records.

Records are limited to 500. Rows older than 14 days are removed during capture
or when the diagnostics panel is loaded, and are excluded from the returned
list. Leave capture off except when investigating a production issue; incident
IDs continue to appear in generic error messages when capture is off.

## Self-hosted production upgrade

Apply the additive diagnostics-table migration to the production database
before deploying the updated API:

```sh
pnpm --filter @workspace/api-server run migrate:api-error-diagnostics
```

Then deploy the API and web app from the same release. In the superadmin
console, enable **Capture detailed server errors** and save platform settings.
Reproduce the failing action as the affected account, then return to the
diagnostics panel and refresh. Expand the matching request to inspect its
details. Disable capture after investigation if the extra diagnostic output is
no longer needed.

The migration creates only the diagnostics table and indexes. It does not
change campaign, contact, account, or payment data.

## Signed access to self-hosted production

The superadmin diagnostics panel can request a read-only report from the
self-hosted production API through this project's API server. The production
endpoint accepts timestamped HMAC-SHA256 signatures, rejects stale requests and
reused nonces, and returns only database reachability, diagnostics-table
readiness, capture status, and recent sanitized error records. It does not
accept SQL, expose environment variables, or return customer content.

Generate one random 32-byte key:

```sh
openssl rand -hex 32
```

- In this Replit project, save the key as the `MAILFLOW_DIAGNOSTICS_HMAC_SECRET`
  Replit Secret. This caller-side key is never sent to the browser.
- On the self-hosted production app, open **Admin → Settings → Diagnostics**,
  enter the same key in **Production diagnostics verifier key**, and save. The
  production copy is encrypted at rest and never returned after saving.
- In this Replit project, set the non-secret variable
  `MAILFLOW_REMOTE_DIAGNOSTICS_ORIGIN` to
  `https://mailflow.taskone.world`.
- Deploy the updated API to production, then select **Check production** in the
  Replit Diagnostics tab.

The production endpoint is fixed to `mailflow.taskone.world` and uses HTTPS;
redirects are rejected. Signatures expire after 60 seconds, and requests use a
unique nonce to prevent replay on the API process that receives the request.
Keep the server clocks synchronized. Rotate the key by updating the Replit
Secret and production Diagnostics setting. The encrypted production key relies
on the existing stable `APP_ENCRYPTION_KEY` or `SESSION_SECRET` in production.
Back up that encryption key before rotating it; changing it without
re-encrypting saved credentials makes them unreadable.

Replit does not provide a stable outbound IP list, so this is authenticated
server-to-server access rather than a network firewall that makes the route
unroutable from other networks. A caller still needs the shared secret to
create a valid signature. Treat it as a credential and rotate it if it may
have been exposed.
