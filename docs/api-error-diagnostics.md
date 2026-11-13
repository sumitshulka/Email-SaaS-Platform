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

Configure both server environments with the same randomly generated value of at
least 32 bytes:

```sh
openssl rand -hex 32
```

- On the self-hosted production API, set
  `MAILFLOW_DIAGNOSTICS_HMAC_SECRET` in your cloud environment and deploy the
  updated API.
- In this Replit project, add that same value as the
  `MAILFLOW_DIAGNOSTICS_HMAC_SECRET` Replit Secret. Never paste it into chat,
  source code, or this document.
- In this Replit project, set the non-secret variable
  `MAILFLOW_REMOTE_DIAGNOSTICS_ORIGIN` to
  `https://mailflow.taskone.world`.
- Open **Admin → Settings → Diagnostics** and select **Check production**.

The production endpoint is fixed to `mailflow.taskone.world` and uses HTTPS;
redirects are rejected. Signatures expire after 60 seconds, and requests use a
unique nonce to prevent replay on the API process that receives the request.
Keep the server clocks synchronized. Rotate the key by updating both
environments and restarting/redeploying both API services.

Replit does not provide a stable outbound IP list, so this is authenticated
server-to-server access rather than a network firewall that makes the route
unroutable from other networks. A caller still needs the shared secret to
create a valid signature. Treat it as a credential and rotate it if it may
have been exposed.
