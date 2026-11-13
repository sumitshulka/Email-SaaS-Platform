# Campaign personalization and fallback values

## User workflow

Standard campaigns support first name, last name, full name, email, company,
phone and LinkedIn placeholders. Open campaigns support email and names only.
Both the subject/greeting/signature controls and the formatted-body editor use
the same availability rules.

The content step includes **Fallback values**. Users choose their own plain-text
replacement for each optional field they use. For example, `{{firstName}}` with
the fallback `there` renders as `Ada` for a recipient with that name and `there`
for a recipient with no first name. The application never chooses generic text
automatically. Email does not need a fallback because a valid address is required
for every recipient.

The editor requires fallback values for every optional placeholder used in any
subject, greeting, signature, plain-text body or formatted HTML body. This
protects standard campaigns whose live contact records may change after editing.
Unused fields do not need values. Fallbacks may be up to 200 characters and must
be plain text, not other placeholders.

For open campaigns a missing name becomes available after its fallback is set.
Company, phone and LinkedIn remain unavailable regardless of fallback settings.
A partial uploaded full name uses the full-name fallback if either name is
missing. Standard contacts retain their existing full-name construction rules.

## Persistence and rendering

Fallbacks are stored per campaign in `placeholderFallbacks`, persisted in the
`email_campaigns.placeholder_fallbacks` JSON column. Create/update requests and
the standard preview request accept that map. Omitted update values preserve the
existing map; an explicit empty map requests removal, subject to open-audience
name validation. Follow-up drafts inherit the parent map.

Real nonblank values take precedence. Blank or whitespace values use a trimmed
fallback. Both message previews and the delivery renderer follow this rule.
Fallbacks are escaped as text in HTML and are never recursively interpreted as
other placeholders. HTML is sanitized after substitution too, preventing a
fallback from introducing an executable URL into an HTML attribute.

API-created drafts can be saved incomplete, but queueing checks all used optional
fields for a nonblank fallback and returns `PLACEHOLDER_FALLBACK_REQUIRED` if any
are missing. This applies to both standard and open campaigns, including legacy
drafts. Existing queued campaigns are not rewritten: real values continue to
work. If a legacy recipient value is missing and no fallback exists, the worker
does not send that recipient; it records a suppressed outcome with a clear
missing-data error, without marking the contact unsubscribed or bounced.

Fallback text is included in campaign content-policy checks. Tenant ownership,
quota accounting, original-recipient follow-up restrictions, pacing, scheduling
and unsubscribe handling are unchanged.

## Deployment

Development has been migrated. Self-hosted production must apply the additive,
idempotent migration before running the updated API:

```sh
pnpm --filter @workspace/api-server run migrate:campaign-fallbacks
```

This applies and verifies `0020_campaign_placeholder_fallbacks.sql`. Existing
campaigns receive an empty map; campaign content and recipients are not deleted.
No new external service or storage credentials are needed.
