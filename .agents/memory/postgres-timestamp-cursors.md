---
name: PostgreSQL timestamp cursor precision
description: Keep cursor and neighbor ordering on the database side when timestamptz values may contain microseconds.
---

When navigation or cursor logic orders rows by PostgreSQL `timestamptz`, compare the current row's timestamp to other timestamp columns inside SQL (for example, through a one-row subquery). Do not decode the value into JavaScript `Date` and bind it back for equality or range comparisons; JavaScript dates retain milliseconds while PostgreSQL can store microseconds. A truncated cursor can include the current row as its own neighbor and break traversal.

**Why:** contact navigation appeared to stop early because PostgreSQL microseconds were lost at the JavaScript boundary, even though the account's contact rows were intact.

**How to apply:** use SQL-to-SQL comparisons for adjacent-row queries and keep the ordering keys identical to the list view. Test the navigation chain with repeated timestamp groups and verify against PostgreSQL if an in-memory test database cannot model timestamp precision.
