# Open campaigns

Open campaigns send to a CSV or XLSX audience instead of saved contacts or contact lists.
The feature is available to any active primary package, including free and gifted
packages, when a superadmin gives that package a nonzero allowance and recipient
limit. Existing package prices and allowances are not changed automatically.

## Package settings

In superadmin package creation or editing, set:

- **Open campaigns per term**: the number that can be queued in a subscription
  term. For example, set Free to 1 and Basic to 2 if those are your desired limits.
- **Recipients per open campaign**: the maximum unique uploaded addresses for one
  campaign. Both values must be greater than zero to enable the feature.

These are primary-package settings, not add-on settings. A package without an
allowance displays open campaigns as not included.

The allowance is consumed **once, on the first successful queue operation**.
Creating, editing, or deleting an unsent draft does not consume allowance.
Exhausting the term allowance does not block creating or editing a draft when
the package includes open campaigns. Queueing or scheduling that draft remains
blocked until allowance becomes available again; recipient limits still apply.
Pausing, resuming, rescheduling, and retrying interrupted recipients do not use
another allowance. Completion or cancellation does not refund an allowance.
Follow-ups are separate campaigns and use an allowance when first queued.
Their audience is restricted to the original parent campaign's queued recipient
snapshot. The editor does not allow replacing that audience with a new upload.
API updates cannot introduce new addresses, queueing revalidates the saved
audience, and the worker suppresses any non-original recipient left by older
data. Opt-outs and bounces can reduce the original audience before delivery.
Unused allowances expire at term end. The next term, including an automatically
renewed free term, has its own allowance. Server-side checks enforce both limits;
concurrent queue requests are serialized with the existing per-account lock.

As with the existing package limits, the current package definition controls
limits for the active term. Package checkout snapshots include these fields so
changes are detected when a pending paid purchase is settled.

## Uploading an audience

Choose **New open campaign**, or switch the audience type in the new campaign
wizard. This uses the existing left-aligned campaign creation page.

Upload a CSV or XLSX file of up to 10 MB. Example CSV:

```csv
email,first name,last name
alex@example.com,Alex,Smith
sam@example.com,Sam,Jones
```

Only `email` is required. Common header spellings such as `email id`,
`firstName`, and `last_name` are recognized. XLSX files use the first worksheet,
with headers in its first row. Additional worksheets are not imported.
Legacy `.xls` and password-protected workbooks are not supported; save these as
an unencrypted `.xlsx` or CSV first.
Addresses are trimmed, lowercased, and deduplicated. The upload summary identifies
duplicates and invalid rows; invalid rows are skipped explicitly, not sent.
The upload area displays the package maximum before file selection and the current
audience count against that maximum. Smaller files are allowed: the number of
unique valid addresses must be **less than or equal to** the package limit, not
an exact match. Duplicates count once and invalid rows are listed as skipped.
An oversized upload is rejected in full, with its unique count, the maximum, and
the excess shown; it is never trimmed automatically and does not replace the
previous audience. The API independently validates the records and limits when
creating, updating, and queueing a campaign.

Uploaded recipients have separate campaign-owned storage. They do not create
Contacts, count against the saved-contact limit, or appear as contact links.
The original CSV or XLSX file is not retained; only normalized recipient records are
saved with the draft. A document-storage provider is not required for recipient
uploads. Optional email PDF attachments still use the configured storage provider.

## Personalization and preview

- `{{email}}` is always available.
- `{{firstName}}` is available if every uploaded recipient has a first name, or a first-name fallback is set.
- `{{lastName}}` is available if every recipient has a last name, or a last-name fallback is set.
- `{{fullName}}` requires both names on every recipient, or a full-name fallback.
- Contact-only company, phone, and profile placeholders are unavailable.

Both editor toolbars hide unavailable placeholders. Contact-only fields (company,
phone and LinkedIn) are never offered for open campaigns. Name fallback inputs
remain available so a user can explicitly configure a value and enable a
previously unavailable name placeholder.

Every optional placeholder used in any message part needs a user-defined
fallback before continuing or saving in the editor. The API also enforces this
before queueing. Real values take precedence; only blank or whitespace values
use the fallback. See [Campaign personalization](campaign-personalization.md)
for rendering, legacy campaigns and the required production migration.
The uploaded-recipient preview is labeled as a local preview; it shows the first
content option and does not include the final unsubscribe footer. The normal
sending worker adds the unsubscribe footer to delivered email.

## Execution and opt-outs

Open campaigns use the same sender accounts, scheduling forecasts, mailbox
pacing, rate limits, content policy, variants, attachments, pause/resume, delivery
reports, and interrupted-delivery retry flow as standard campaigns. Existing
queued or running campaigns on a mailbox affect their scheduling and pacing.
The platform-wide maximum campaign size still applies in addition to the package
recipient limit.

Previously unsubscribed or bounced addresses in the workspace are suppressed.
Open recipients have signed unsubscribe links that work without saved Contacts.
Opt-outs are stored by account and normalized email, suppress queued messages,
and are checked again before sending. Re-uploading an address does not bypass an
open-campaign opt-out. Confirmed delivery-report bounces for uploaded recipients
are also retained as account-scoped suppressions. Suppression never creates a
Contact or changes another account's data.

## Self-hosted production upgrade

Apply the additive migration **before starting the updated API**:

```sh
pnpm --filter @workspace/api-server run migrate:open-campaigns
```

Equivalent SQL is in `lib/db/migrations/0019_open_campaigns.sql` if your deployment
pipeline applies SQL migrations directly. Use your production database connection
in your own cloud environment; Replit Secrets are not required.

Then deploy the updated API and frontend, and configure the desired package
allowances. Existing packages default to zero for both new fields so enabling the
feature is an explicit superadmin decision. Existing campaigns remain standard
campaigns. The migration does not copy uploaded recipients into saved contacts.
