# Microsoft 365 campaign sender setup

## Why a correct password can fail

Microsoft web login and SMTP authentication are different access paths. A mailbox
password can work in Outlook while SMTP is denied by organization policy, disabled
SMTP AUTH, MFA/Conditional Access, legacy-authentication restrictions, or network
restrictions on the Mailflow host. App passwords are not available in every tenant
and cannot bypass a policy blocking legacy authentication.

Mailflow now offers this order:

1. Try the mailbox password, using the full mailbox sign-in address,
   `smtp.office365.com`, port **587**, **STARTTLS**.
2. Try an app password **only if the organization makes it available and permits it**.
3. Use **Sign in with Microsoft**. This uses delegated Microsoft Graph sending,
   supports MFA, and does not require SMTP AUTH.

Mailflow never tries alternate passwords automatically, disables certificate
validation, or asks organizations to turn off MFA/security defaults.
Passwords are stored exactly as entered, including leading/trailing whitespace.

## Deploying to your own cloud

Before starting the updated API against an existing production database, install
the repository dependencies and run this additive migration:

```sh
pnpm --filter @workspace/api-server run migrate:microsoft-sender
```

It adds sender authentication metadata and encrypted Microsoft connection/state
tables. Existing sender passwords and campaign data are preserved. The migration
is transactional and safe to rerun. Deploy the updated API and frontend together.
Keep the existing application encryption/session secret stable; changing it can
make already-encrypted credentials unreadable.

No Microsoft credential needs to be added to Replit Secrets. Configure the
application once in **Superadmin → Settings → Microsoft sign-in —
application-wide setup**, on `/admin/settings#microsoft-sign-in`.

## One-time superadmin configuration

1. In Microsoft Entra, register one **Web** application supporting **Accounts in any
   organizational directory and personal Microsoft accounts**. This registration
   belongs to the Mailflow application, not to individual customers.
2. Add a Web redirect URI:

   ```text
   https://YOUR-MAILFLOW-DOMAIN/api/sending/microsoft/oauth/callback
   ```

   For a path-prefixed installation, include the deployment prefix. The URI must
   exactly match the value saved in Mailflow. HTTPS is required, except for local
   development on localhost/127.0.0.1.
3. Configure Microsoft Graph **delegated** permissions `User.Read` and `Mail.Send`.
   Authorization also requests `openid profile email offline_access`. Do not
   substitute application-only permissions.
4. Create a client secret, then save its **value**, application/client ID, and
   callback URI in the superadmin form. Enable Microsoft sign-in.
5. Keep track of the secret's expiry and rotate it before expiry. Leaving the
   secret blank retains it only when the client ID is unchanged. A client-ID
   change requires users to reconnect.

Secrets and mailbox access/refresh tokens are encrypted in the database. Settings
and connection responses never return these credentials. Individual customers
authorize their own mailbox; the superadmin does not configure each attempt.

Some customer organizations require their own administrator to consent to the
application. Correct credentials do not override that policy. Configure your
reverse proxy to preserve the external host and HTTPS request scheme so the
callback origin matches. This implementation targets Microsoft's global cloud;
sovereign/national-cloud endpoints are not configured by this form.

## User connection workflow

1. Save a Microsoft 365 sender with its real **From email** and sender name. A
   password may be left blank if Microsoft sign-in will be used.
2. Try password/app-password connection checks if those methods are permitted.
   Errors distinguish authentication policies, rejected authentication, network
   connectivity, DNS, and TLS problems without revealing raw provider responses.
3. In the Microsoft 365 connection options, choose **Sign in with Microsoft**, then
   open the generated Microsoft link in a new tab. Use the same directly owned
   mailbox as the saved From email.
4. Microsoft redirects back to Mailflow. The flow validates a short-lived,
   single-use, session-bound state and PKCE challenge. A different mailbox,
   changed sender identity, changed app configuration, or replayed callback is
   rejected. The result selects the relevant sender, not merely the primary one.
5. Successful Microsoft authorization marks the saved connection check successful
   and completes the email-setup onboarding check. **Send a test email** to enable
   campaign sending; authorization by itself does not set test-email verification.
6. Return to the original tab. Connection status refreshes on focus; a manual
   refresh action is also provided.

Disconnect before changing the connected mailbox, provider, or password. Changing
the sender name is allowed. Disconnecting clears verification and removes the
stored Microsoft connection; it does not revoke the organization's app consent
inside Entra or recall messages already submitted.

## Campaign behavior and limitations

- Microsoft-authorized accounts use the existing campaign worker and the same
  mailbox slot, pacing, hourly/daily caps, opt-out headers, attachments and
  recipient retry controls. Authorization is not a separate unlimited sender.
- Access tokens renew through an encrypted refresh token, under a per-connection
  row lock to avoid simultaneous refresh-token rotation.
- MIME requests preserve the sender, PDF attachments, attempt header, configured
  message ID and unsubscribe headers. Microsoft may apply its own processing.
- Mailflow limits Microsoft API requests to **4 MB after full MIME/base64
  encoding**. PDF encoding adds overhead; large PDFs must be reduced or sent using
  a permitted SMTP connection. Oversize messages fail before submission.
- Microsoft `202 Accepted` means submitted/accepted, **not delivered to an inbox**.
  Graph acceptance does not create synthetic SMTP responses or claim that SMTP
  delivery-status notifications were requested.
- Known authorization/message rejections are recorded as send failures.
  Microsoft throttling can use the existing retry allowance, honoring Retry-After
  and existing mailbox pacing. Network interruptions after submission and server
  errors have **unknown delivery outcomes** and are not silently resubmitted.
  Review them through the existing explicit retry workflow to avoid duplicates.
- This authorization sends mail only. Password-based inbox checking is disabled
  for Microsoft-authorized senders; inbox monitoring/message trace remains a
  separate connection.
- Shared/delegated mailbox sending and arbitrary From aliases are not enabled.
  The signed-in mailbox must match the saved From address.
- Disabling application-wide Microsoft sign-in stops new authorization and future
  sends through existing Microsoft connections. SMTP-password senders are
  independent. An already-submitted message cannot be cancelled by this toggle.

## Verification

Focused backend tests use an isolated in-memory database and mocked Microsoft
responses, without sending real mail:

```sh
pnpm --filter @workspace/api-server exec node --import tsx --test test/microsoft-sender.test.mjs
```

Tests cover encrypted shared setup, role/tenant isolation, PKCE/session state,
mailbox mismatch, callback replay, token renewal and MIME attachment construction.
A real Microsoft authorization and accepted test message still require the
application registration and a mailbox that grants the necessary consent.

Official Microsoft references:
- [SMTP AUTH policies](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission)
- [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
