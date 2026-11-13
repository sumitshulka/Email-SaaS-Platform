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
