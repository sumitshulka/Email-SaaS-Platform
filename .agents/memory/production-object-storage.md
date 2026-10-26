---
name: Production object storage
description: Storage deployment constraints for the self-hosted production environment.
---

Production runs in the user's own cloud environment, not Replit. Campaign PDF storage must not depend on Replit's object-storage sidecar or Replit Secrets. Use S3-compatible storage configured through the superadmin console; encrypt credentials at rest using the application's deployment-provided encryption key.

**Why:** The user explicitly stated that production is hosted outside Replit and chose S3-compatible storage.

**How to apply:** Keep storage configuration provider-compatible and editable by superadmins. Never request credentials in chat or store them as plaintext in DB/JSON. The user's cloud deployment must provide `APP_ENCRYPTION_KEY` or `SESSION_SECRET` for encrypted settings.

Campaign PDF uploads should go through the authenticated API as a raw `application/pdf` request; the server validates the PDF and writes it to S3-compatible storage. Do not depend on browser PUTs to presigned object URLs.

**Why:** Browser uploads to customer-owned buckets can fail with an unhelpful network error when bucket CORS does not allow the app origin. Server-side uploads avoid that browser CORS dependency and expose storage errors to server logs.

**How to apply:** Keep the API upload limit aligned with the campaign's 5 MB file limit, validate the PDF signature server-side, and keep provider endpoints and credentials out of browser code.
