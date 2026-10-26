# Mailflow functional guide

## Purpose and scope

Mailflow is a multi-tenant CRM and email-campaign workspace for small teams. It keeps contact and company context, campaign preparation, user-owned SMTP sending, and recorded campaign outcomes together. Mailflow does not provide a separate bulk-mail transport service: customers configure the SMTP account that sends their campaigns.

This guide describes functionality implemented in this repository. Availability can still depend on an active plan, package allowances, enabled platform settings, and valid provider configuration. The API contract is maintained in `lib/api-spec/openapi.yaml`; this guide describes product behavior rather than every request and response.

## Roles and access

| Role | Main capabilities |
| --- | --- |
| Customer (`USER`) | Manage their workspace, audience, campaigns, sending accounts, plan, notifications, and support requests. |
| Platform administrator (`SUPERADMIN`) | Manage platform settings, customer accounts, packages, billing, company catalog, provider setup, notifications, support, and operational controls. |
| Public visitor | View public marketing, features, pricing, legal pages, and unsubscribe confirmation; register or start verified plan checkout. |

Tenant records are scoped to the authenticated customer. Administrative APIs enforce administrator access on the server; hiding a page in the interface is not the access control boundary.

## Public site and account access

- **Marketing and features:** Public pages explain Mailflow's audience-to-campaign workflow, the use of the customer's SMTP account, contact/company context, drafting assistance, campaign history, and functional limits.
- **Pricing:** Displays currently published packages and their configured duration, price, contact capacity, sender capacity, sending limits, and research allowance. If the plan list cannot be loaded, the page shows an unavailable or retry state rather than inventing plan data.
- **Registration:** Creates a customer account through email verification. Checkout's email check verifies ownership before deciding whether the address belongs to an existing account or should continue to registration.
- **Eligibility:** Mailflow accounts are for users aged 18 or older.
- **Login and recovery:** Username/email and password login, email verification, forgot-password and reset-password flows, logout, and authenticated password changes. Verification and reset codes are time-limited and attempt-limited.
- **Profile and security:** Update account details and credentials. Administratively required credential rotation is handled before the user continues.
- **Legal pages:** Terms, privacy, and shipping/refund information are linked from the public site and checkout.
- **Unsubscribe:** A recipient can view the campaign opt-out page and submit the signed one-click unsubscribe action. The action updates that contact's subscription state in the owning workspace.

## Customer workspace

### Overview

The customer dashboard shows contact, company, and active-list totals; captured payment totals by currency; contact lifecycle and lead-status charts; and campaign outcome summaries. For active campaigns it shows shared SMTP-mailbox attempt and remaining-capacity figures. Captured spend excludes gifts, non-captured payments, and refunded rows. Unread platform notices appear on the dashboard and can be marked read there.

### Contacts and CRM

The contact directory supports:

- Create, edit, and delete tenant-owned contacts.
- Search and filter contacts using available CRM fields; save reusable filter combinations as named segments.
- Import contacts using a workspace-specific Excel template and export selected or filtered records to an Excel workbook.
- Configure workspace-specific options for supported contact fields.
- Keep subscription, bounce/suppression, and campaign activity associated with the contact. Bounced addresses remain visible but are not eligible for new campaign sends. A bounce does not itself mean the person unsubscribed.
- Run an individual no-message SMTP address check. A check can be inconclusive; it is not a guarantee that a mailbox exists or will accept a later campaign.

The contact detail view includes editable profile data, linked company context, dated notes, lead-status change history (including reason and actor), campaign email history, and matched campaign replies. Contact intent analysis can be explicitly requested when the required questionnaire, source data, provider configuration, and allowance are available. It draws on the contact's campaign email history, notes, and questionnaire answers; it is not an automatic action on all contacts.

The Contact Report provides recent successful campaign-send dates for contacts. It is a reporting view, not a separate sending workflow.

### Companies and company intelligence

- Create and manage workspace company profiles, search them, link contacts, and export the workspace's company data.
- Import company profiles from a reviewed workbook. A template-based import helps map company fields before changes are applied.
- Matching company/contact domains can link profiles where compatible. Users can review unlinked legacy profiles and resolve them; linking a company does not silently move contacts between lists.
- Search the platform-managed Global Company DB and add a company profile to the workspace. The shared catalog contains company-level information only; customer contacts and campaign information remain private.
- A workspace may explicitly share a company profile with the global catalog. A catalog profile can be live-linked to workspace profiles; a catalog update may update linked company details, not private contacts.
- Company intelligence can be requested for supported global profiles. Where enabled and allowed, research returns reusable company-level findings, dated signals, and source evidence; previous successful versions can be reviewed. Research is explicit, allowance-controlled, and distinct from contact research.
- Company business-area choices are managed centrally by the platform administrator. Industry and technical domain matching are separate concepts.

### Lists and segments

- Create, rename, activate/deactivate, and delete tenant-owned contact lists.
- Add or remove existing contacts from lists and manage memberships from the list workflow.
- Reuse saved contact segments to find contacts; segments are saved filter definitions, not copied contact lists.
- Campaigns can target multiple ordered lists. List membership for a draft remains live until queueing; the audience is revalidated when it is queued.

### Email setup and sender accounts

Customers configure one or more SMTP sender accounts within their package allowance. Setup includes provider, host, port, encryption, credentials, sender identity, and optional reply-to/incoming-mail settings where supported.

- Check the SMTP connection without sending a message and send a test message.
- Select a primary sender account for campaigns without an explicit sender.
- Choose a sender account for an individual campaign. A sender account cannot be deleted while an active campaign uses it.
- Credentials are write-only in the interface/API and encrypted at rest; reads return configuration status rather than secrets.
- Application email used for verification, password reset, and platform notices is configured separately from customer campaign SMTP.

Provider quotas and restrictions still apply. Platform campaign-attempt caps are applied per SMTP mailbox over rolling hourly and daily windows, retries count against those caps, and messages sent through a mailbox are paced across campaigns (normally a randomized 5–15 minute interval) unless a stricter cap requires a longer wait. Multiple mailboxes have separate limits.

Optional inbox/report integrations include:

- **Gmail:** OAuth connection for mailbox bounce/reply monitoring, automatic or manual sync, and bounded recent-message rescans.
- **Microsoft 365:** Tenant-authorized message trace connection, sync, and backfill.
- **IMAP inbox scan:** Scan a configured sender inbox for campaign bounce reports and matched replies.

These integrations require platform/provider setup and mailbox permissions. Imported or provider-supplied evidence is shown with its source and limitations; it is not equivalent to guaranteed inbox placement.

### Campaigns

Campaigns are prepared and sent through this workflow:

1. Create a draft and define its name, objective, subject, message content, ordered target lists, optional contact-level exclusions, sender account, content variants, and supported PDF attachments.
2. Preview the rendered message for an eligible contact. The audience preview reports unique eligible recipients and list overlap. A duplicate address on multiple selected lists is queued once; the first matching list in saved order takes priority.
3. Review eligibility and any blocked-term, sender, schedule, or audience validation before queueing. Queueing rechecks current contact eligibility; bounced and unsubscribed recipients are excluded.
4. Queue immediately or choose a future schedule. The worker sends independently of the browser session and tracks recipient outcomes. The dashboard estimates pacing and remaining time.
5. Review campaign history and the campaign dashboard, including audience breakdown, SMTP accepted, rejected/failed, suppressed, unknown, queued, variant, and delivery-evidence information where available.

Additional campaign controls:

- **Variants:** Subject, greeting, and signature variants use stable recipient-level assignments within a campaign; the assignment does not rotate on each send.
- **AI Email Assist:** When configured and allowed by plan/add-on balance, generate or revise an editable first draft from the campaign objective. It never sends automatically.
- **Attachments:** Campaign PDF uploads use private object storage and are attached to the campaign delivery.
- **Pause/resume:** Pause an active campaign, optionally set an automatic resume time, edit that time, or resume manually. Queued recipients remain on hold. A message already being submitted to SMTP may finish.
- **Reschedule:** Change the start time of an upcoming scheduled campaign. Conflicts with another active, unpaused campaign are rejected. A conflicting paused schedule requires explicit confirmation to clear that schedule; the other campaign remains paused.
- **Cancel paused campaign:** Stop a paused campaign. Queued recipients are suppressed, existing sent history remains, and any in-flight SMTP submission may finish. The completed campaign can be used to create a follow-up draft and schedule a new run through the normal queue workflow.
- **Follow-up:** Create a new draft from an eligible queued or completed campaign. Follow-ups must start at least 24 hours after the primary campaign completes; bounced and unsubscribed contacts remain excluded.
- **Delete:** Only drafts can be deleted. Queued, sending, and completed campaign history is retained.
- **Replies and delivery evidence:** Review matched replies, scan supported sender inboxes, view campaign delivery evidence, and import a supported user-provided delivery report.
- **History:** Search and filter campaign records by campaign text, status, type, audience, and date; follow-up records retain parent context.

Campaign outcome terminology is intentionally limited. “SMTP accepted” means the sending server accepted the message for processing; it does not confirm inbox delivery, opens, clicks, or engagement. Mailflow is not a behavioral drip-journey builder and does not rotate content per send to evade provider controls.

### Plans, billing, and add-ons

The Plans & Billing area shows the active term, any scheduled plan change, usage, package limits, and purchased add-on balances.

- Free plans activate directly without creating a payment or payment record.
- Paid checkouts use the active configured Razorpay environment. Prices and package values are server-owned; payment confirmation is verified server-side and through signed provider events.
- When online payments are disabled, new paid checkouts are blocked; free-plan activation and settlement of an existing payment are not disabled by that switch.
- If a user cancels a paid checkout after account creation, the account remains but the paid plan is not activated.
- Plans do not auto-renew. Access is restricted when the purchased term expires.
- Higher-limit primary plan upgrades may start immediately with the prorated difference through the current expiry. Lower-limit plans and other plan switches are charged once and scheduled to start at the current term's expiry. Only one future primary plan change can be scheduled at a time.
- Add-ons can provide eligible allowances such as research credits, AI Email Assist drafts, or additional SMTP mailbox slots. Add-ons are separate from primary plan changes.
- Unused add-on balances pause when paid-primary access ends and can resume with a later paid term. Allowance lifetimes and availability depend on the applicable package rules.
- Eligible refunds are subject to the published policy: request within seven days of payment confirmation and no campaign has been processed. Add-on refund adjustments are reflected in remaining allowances.
- The platform administrator can gift a primary subscription term or add-on allowance without collecting payment.

### Notifications and support

- Customers can read active notices and their notice history; notices can be marked read.
- Customers can open support tickets, review their conversations, and reply in the same workspace.
- Platform administrators can broadcast notices or target accounts, monitor read-through, and manage notice availability and expiry.
- Administrators can search support tickets across customers, reply, and update ticket status.

### Maintenance mode

Maintenance is a platform-wide access and delivery gate, not a forced logout. Existing authenticated sessions can continue until the user logs out; new customer sessions and registration are restricted while maintenance is active (superadmin access is retained). Queued campaign delivery pauses without deleting or terminally changing queued recipients and resumes after maintenance is turned off. An already in-flight message may finish.

## Platform administration

The superadmin workspace provides:

- **Overview:** Platform-level account and service summary.
- **Accounts:** Search customers, inspect account and subscription status, activate/deactivate accounts, and soft-delete accounts. Separate inactivity stages let administrators issue configured notices and perform later soft deletion while preserving recoverability during the grace period.
- **Inactivity templates:** Create and maintain the email templates used by inactivity notices.
- **Packages:** Create and edit primary and add-on packages, their availability, term, price, and allowance limits.
- **Billing and payment gateway:** Configure and test separate Razorpay sandbox/production credentials, select the active environment, enable/disable new online checkouts, and gift subscriptions or add-ons.
- **Finance:** Search and summarize successful payment records, with subscription/payment detail views. Revenue views use the currently active payment environment.
- **Platform settings:** Configure operational controls such as maintenance, signup/verification, platform sending limits, campaign policy and blocked-term checks. Blocked-term preview helps administrators evaluate campaign fields before changing enforcement.
- **Application email:** Configure and test the platform's own SMTP sender, separate from customer campaign accounts.
- **Google OAuth:** Store and test platform OAuth settings required by tenant Gmail connections.
- **AI provider:** Test and configure the provider/model used by AI features; secrets are not returned in reads.
- **Company intelligence:** Configure freshness, supported source types, research limits, models, and estimation rates; monitor job and usage totals.
- **Global companies and business areas:** Maintain shared company profiles, import/export catalog data, configure business-area choices, and review catalog details. Workspace contact data is not exposed in the catalog.
- **Contact intent:** Maintain the factual questionnaire used by explicit contact intent analysis.
- **Notifications and support:** Publish notices, review read counts, answer tickets, and update ticket status.

Administrative capabilities are configuration and moderation tools. Their presence does not imply every customer feature is enabled: packages, payment setup, OAuth consent, AI provider setup, SMTP configuration, and third-party permissions may still be required.

## System behavior and data boundaries

- The React web application calls the Express API. OpenAPI is the API contract and generated validators/client hooks are used at the boundaries.
- PostgreSQL stores tenant-owned contacts, companies, lists, campaigns, subscription state, and audit/history records. Private uploaded campaign files use object storage.
- Authentication uses a cookie-backed session. Role and tenant ownership are checked on the server.
- Customer campaign SMTP and platform application SMTP are separate. SMTP and provider outcomes are persisted with the campaign for later review.
- Contact-level data remains private to its workspace. Shared company catalog entries contain company-level profile information, not lists, contacts, or campaign data.
- User-entered campaign and CRM data may be exported through the available Excel exports. Exports should be treated as sensitive workspace data.
- Dates are displayed in the user's local timezone where supported; stored service timestamps are UTC.

## Important limitations

- SMTP configuration, provider permissions, package capacity, and sender-provider policies constrain sending. Mailflow cannot guarantee acceptance or inbox placement.
- No open/click tracking, automatic behavioral journeys, per-send variant rotation, or independent bulk-mail delivery network is provided.
- An individual SMTP address check can be inconclusive and does not guarantee future delivery.
- Gmail, Microsoft 365, AI, and payment features require corresponding platform configuration and user/provider authorization.
- Public pricing and all package-specific limits are dynamic; the values shown in the UI are the current configured values, not fixed promises in this document.

## Main screen map

| Area | Route |
| --- | --- |
| Public home, features, pricing, checkout | `/`, `/features`, `/pricing`, `/package-checkout`, `/package-checkout/:packageSlug` |
| Register, login, email verification, recovery | `/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password` |
| Customer overview and profile | `/dashboard`, `/profile` |
| Contacts, contact report, fields | `/contacts`, `/contacts/:contactId`, `/contact-report`, `/contact-field-settings` |
| Companies and shared company directory | `/companies`, `/companies/:companyId` |
| Lists and campaigns | `/lists`, `/campaigns`, `/campaigns/:campaignId` |
| Sending setup and account management | `/sending-settings` |
| Plans, notifications, customer support | `/plans`, `/notifications`, `/support` |
| Platform administration | `/admin` and `/admin/*` |
| Legal and unsubscribe | `/terms-and-conditions`, `/privacy-policy`, `/shipping-refund`, `/unsubscribe` |

This screen map is a navigation aid; available routes and controls remain subject to authentication, role, package, and configuration checks.
