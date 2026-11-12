import { and, eq, inArray, sql } from "drizzle-orm";
import {
  contactsTable, contactListsTable, contactListMembersTable,
  emailCampaignRecipientsTable, usersTable, db,
} from "@workspace/db";
import type { BulkUpdateContactsBody } from "@workspace/api-zod";
import type { z } from "zod";

export async function bulkUpdateTenantContacts(
  database: Pick<typeof db, "transaction">,
  userId: string,
  input: z.infer<typeof BulkUpdateContactsBody>,
) {
  const ids = [...new Set(input.contactIds)].sort();
  return database.transaction(async tx => {
    // Match the single-contact editor's lock order and keep validation/writes atomic.
    await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, userId)).for("update");
    const contacts = await tx.select({ id: contactsTable.id, emailStatus: contactsTable.emailStatus })
      .from(contactsTable)
      .where(and(eq(contactsTable.userId, userId), inArray(contactsTable.id, ids)))
      .orderBy(contactsTable.id).for("update");
    if (contacts.length !== ids.length) return { kind: "not_found" as const };

    if (input.action === "add_to_list") {
      const [list] = await tx.select({ id: contactListsTable.id }).from(contactListsTable)
        .where(and(eq(contactListsTable.userId, userId), eq(contactListsTable.id, input.listId!)))
        .for("update");
      if (!list) return { kind: "not_found" as const };
      const inserted = await tx.insert(contactListMembersTable)
        .values(ids.map(contactId => ({ userId, contactId, listId: list.id })))
        .onConflictDoNothing().returning({ id: contactListMembersTable.contactId });
      return { kind: "updated" as const, updatedCount: inserted.length,
        skippedCount: ids.length - inserted.length, campaignIds: [] as string[] };
    }

    const eligible = contacts.filter(contact => input.action !== "subscribe" || contact.emailStatus !== "bounced");
    const eligibleIds = eligible.map(contact => contact.id);
    const campaignIds: string[] = [];
    if (eligibleIds.length) {
      const subscribed = input.action === "subscribe";
      await tx.update(contactsTable).set({
        subscribed,
        emailStatus: subscribed ? "subscribed"
          : sql`case when ${contactsTable.emailStatus} = 'bounced' then 'bounced' else 'unsubscribed' end`,
        updatedAt: new Date(),
      }).where(and(eq(contactsTable.userId, userId), inArray(contactsTable.id, eligibleIds)));
      if (!subscribed) {
        const suppressed = await tx.update(emailCampaignRecipientsTable).set({
          status: "suppressed", lastError: "Contact unsubscribed before delivery.", updatedAt: new Date(),
        }).where(and(
          eq(emailCampaignRecipientsTable.userId, userId),
          inArray(emailCampaignRecipientsTable.contactId, eligibleIds),
          eq(emailCampaignRecipientsTable.status, "queued"),
        )).returning({ campaignId: emailCampaignRecipientsTable.campaignId });
        campaignIds.push(...suppressed.map(row => row.campaignId));
      }
    }
    return { kind: "updated" as const, updatedCount: eligible.length,
      skippedCount: contacts.length - eligible.length, campaignIds };
  });
}
