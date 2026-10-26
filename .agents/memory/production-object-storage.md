---
name: Production object storage
description: Storage deployment constraints for the self-hosted production environment.
---

Production runs in the user's own cloud environment, not Replit. Campaign PDF storage must not depend on Replit's object-storage sidecar or Replit Secrets. Use S3-compatible storage configured through the superadmin console; encrypt credentials at rest using the application's deployment-provided encryption key.

**Why:** The user explicitly stated that production is hosted outside Replit and chose S3-compatible storage.

**How to apply:** Keep storage configuration provider-compatible and editable by superadmins. Never request credentials in chat or store them as plaintext in DB/JSON. The user's cloud deployment must provide `APP_ENCRYPTION_KEY` or `SESSION_SECRET` for encrypted settings.
