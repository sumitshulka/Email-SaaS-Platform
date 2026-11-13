# Open campaigns

Open campaigns send to a CSV audience instead of saved contacts or contact lists.
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
Pausing, resuming, rescheduling, and retrying interrupted recipients do not use
another allowance. Completion or cancellation does not refund an allowance.
Follow-ups are separate campaigns and use an allowance when first queued.
Unused allowances expire at term end. The next term, including an automatically
renewed free term, has its own allowance. Server-side checks enforce both limits;
concurrent queue requests are serialized with the existing per-account lock.

As with the existing package limits, the current package definition controls
limits for the active term. Package checkout snapshots include these fields so
changes are detected when a pending paid purchase is settled.

## Uploading an audience

Choose **New open campaign**, or switch the audience type in the new campaign
wizard. This uses the existing left-aligned campaign creation page.

Upload a CSV file of up to 10 MB:

```csv
email,first name,last name
alex@example.com,Alex,Smith
sam@example.com,Sam,Jones
```

Only `email` is required. Common header spellings such as `email id`,
`firstName`, and `last_name` are recognized. Export Excel spreadsheets as CSV.
Addresses are trimmed, lowercased, and deduplicated. The upload summary identifies
duplicates and invalid rows; invalid rows are skipped explicitly, not sent.
An upload above the package's unique-recipient limit is rejected without replacing
the previous audience. The API independently validates the records and limits.

Uploaded recipients have separate campaign-owned storage. They do not create
Contacts, count against the saved-contact limit, or appear as contact links.
The original CSV file is not retained; only normalized recipient records are
saved with the draft. A document-storage provider is not required for recipient
uploads. Optional email PDF attachments still use the configured storage provider.

## Personalization and preview

- `{{email}}` is always available.
- `{{firstName}}` is available only if every uploaded recipient has a first name.
- `{{lastName}}` is available only if every recipient has a last name.
- `{{fullName}}` requires both names on every recipient.
- Contact-only company, phone, and profile placeholders are unavailable.

The editor disables unavailable placeholder buttons and validates template/AI
content before saving. The server repeats these checks on create, update, and
queue. Add the missing names or remove those placeholders before continuing.
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
