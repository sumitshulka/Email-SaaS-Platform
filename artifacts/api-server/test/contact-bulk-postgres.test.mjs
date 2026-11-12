import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { bulkUpdateTenantContacts } from "../src/lib/contact-bulk.ts";
import { BulkUpdateContactsBody } from "@workspace/api-zod";

test("bulk selection rejects empty, oversized and malformed inputs", () => {
  assert.equal(BulkUpdateContactsBody.safeParse({ action: "subscribe", contactIds: [] }).success, false);
  assert.equal(BulkUpdateContactsBody.safeParse({ action: "unsubscribe", contactIds: Array(1001).fill(randomUUID()) }).success, false);
  assert.equal(BulkUpdateContactsBody.safeParse({ action: "unknown", contactIds: [randomUUID()] }).success, false);
});

test("bulk contacts preserve memberships, consent suppression and tenant boundaries",
  { skip: !process.env.RUN_CONTACT_BULK_DB_TESTS }, async () => {
    const database = drizzle(schema.pool, { schema });
    const rollback = new Error("ROLLBACK_BULK_TEST");
    try {
      await assert.rejects(database.transaction(async tx => {
        const users = await tx.insert(schema.usersTable).values([1, 2].map(index => {
          const suffix = randomUUID();
          return { username: `bulk-${suffix}`, email: `bulk-${suffix}@example.test`,
            firstName: "Bulk", lastName: `Fixture ${index}`, passwordHash: "unused-test-hash" };
        })).returning();
        const userId = users[0].id;
        const [normal, bounced, foreign] = await tx.insert(schema.contactsTable).values([
          { userId, name: "Normal", email: `normal-${randomUUID()}@example.test`, subscribed: false, emailStatus: "unsubscribed" },
          { userId, name: "Bounced", email: `bounced-${randomUUID()}@example.test`, subscribed: false, emailStatus: "bounced" },
          { userId: users[1].id, name: "Foreign", email: `foreign-${randomUUID()}@example.test`, subscribed: true, emailStatus: "subscribed" },
        ]).returning();
        const [firstList, nextList, foreignList] = await tx.insert(schema.contactListsTable).values([
          { userId, name: "First" }, { userId, name: "Next" }, { userId: users[1].id, name: "Foreign" },
        ]).returning();
        await tx.insert(schema.contactListMembersTable).values({ userId, listId: firstList.id, contactId: normal.id });
        const input = { action: "add_to_list", contactIds: [normal.id, bounced.id, normal.id], listId: nextList.id };
        let result = await bulkUpdateTenantContacts(tx, userId, input);
        assert.equal(result.updatedCount, 2);
        result = await bulkUpdateTenantContacts(tx, userId, input);
        assert.equal(result.updatedCount, 0, "list assignment is idempotent");
        assert.equal(result.skippedCount, 2);
        let memberships = await tx.select().from(schema.contactListMembersTable).where(eq(schema.contactListMembersTable.contactId, normal.id));
        assert.deepEqual(new Set(memberships.map(row => row.listId)), new Set([firstList.id, nextList.id]));
        for (const action of ["add_to_list", "unsubscribe", "subscribe"]) {
          result = await bulkUpdateTenantContacts(tx, userId, { ...input, action, consentConfirmed: true, contactIds: [normal.id, foreign.id] });
          assert.equal(result.kind, "not_found", "mixed tenant selections fail atomically");
        }
        result = await bulkUpdateTenantContacts(tx, userId, { ...input, listId: foreignList.id });
        assert.equal(result.kind, "not_found", "foreign lists cannot receive tenant contacts");
        result = await bulkUpdateTenantContacts(tx, userId, { action: "subscribe", consentConfirmed: true, contactIds: [normal.id, bounced.id] });
        assert.equal(result.updatedCount, 1);
        assert.equal(result.skippedCount, 1, "bounced addresses must not be resubscribed");
        const [campaign] = await tx.insert(schema.emailCampaignsTable).values({
          userId, name: "Bulk fixture", subject: "Fixture", textBody: "Fixture", status: "draft",
        }).returning();
        await tx.insert(schema.emailCampaignRecipientsTable).values(["queued", "sending"].map(status => ({
          userId, campaignId: campaign.id, contactId: normal.id, email: normal.email, status,
        })));
        result = await bulkUpdateTenantContacts(tx, userId, { action: "unsubscribe", contactIds: [normal.id, bounced.id] });
        assert.equal(result.updatedCount, 2);
        assert.equal(result.campaignIds.length, 1);
        const [savedBounced] = await tx.select().from(schema.contactsTable).where(eq(schema.contactsTable.id, bounced.id));
        assert.equal(savedBounced.emailStatus, "bounced", "unsubscribe preserves the bounce marker");
        assert.equal(savedBounced.subscribed, false);
        await bulkUpdateTenantContacts(tx, userId, { action: "subscribe", consentConfirmed: true, contactIds: [normal.id] });
        const recipients = await tx.select().from(schema.emailCampaignRecipientsTable).where(eq(schema.emailCampaignRecipientsTable.campaignId, campaign.id));
        assert.deepEqual(new Set(recipients.map(row => row.status)), new Set(["suppressed", "sending"]), "resubscribe never requeues suppressed mail or changes in-flight mail");
        const [unchanged] = await tx.select().from(schema.contactsTable).where(eq(schema.contactsTable.id, foreign.id));
        assert.equal(unchanged.subscribed, true);
        throw rollback;
      }), error => error === rollback);
    } finally {
      await schema.pool.end();
    }
  });
