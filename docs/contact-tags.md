# Contact tags

Each account owns a private tag library. Users can create, rename and delete tags
from **Contacts → Manage tags**, and use **Tags** on a contact row or **Edit tags**
on a contact's detail page to assign up to two library tags.

Tags appear beside the contact name. **Contact tag** filters the full directory
before pagination, alongside other filters. **No tags** finds untagged contacts.
Tag filters are retained in saved audience segments and applied to filtered
contact downloads.

Renaming updates every badge using that tag. Deleting a library tag removes its
assignments, not the contacts. The deletion dialog requires confirmation.
Duplicate names are rejected ignoring case; names are limited to 40 characters.

## Self-hosted production upgrade

Apply the additive migration against the intended production database using your
normal secure database configuration before starting the updated API:

```sh
pnpm --filter @workspace/api-server run migrate:contact-tags
```

The migration adds `contact_tags` and `contact_tag_assignments`; it does not
replace or modify existing contact records. Deploy the updated API and frontend
together. The schema includes tenant-scoped foreign keys, unique tag names and
two assignment slots per contact, so the two-tag limit also holds at database
level.

Tag-only edits do not advance the contact profile revision, preventing a tag
refresh from resetting unfinished profile edits. Tag assignments are saved
separately from the profile form.

## Regression verification

```sh
RUN_CONTACT_TAGS_DB_TESTS=1 pnpm --filter @workspace/api-server exec \
  node --import tsx --test test/contact-tags-postgres.test.mjs
```

The database tests use isolated fixtures inside a transaction that is rolled
back. They check tag limits, duplicate names, tenant isolation, filters,
renaming, removal and preservation of contact records.
