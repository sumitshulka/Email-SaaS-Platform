import { and, eq, inArray, sql } from "drizzle-orm";
import {
  contactsTable, contactListsTable, contactListMembersTable,
  contactTagsTable, contactTagAssignmentsTable,
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

    if (input.action === "add_tag" || input.action === "remove_tag") {
      const [tag] = await tx.select({ id: contactTagsTable.id })
        .from(contactTagsTable)
        .where(and(
          eq(contactTagsTable.userId, userId),
          eq(contactTagsTable.id, input.tagId!),
        ))
        .for("update");
      if (!tag) return { kind: "not_found" as const };

      if (input.action === "remove_tag") {
        const removed = await tx.delete(contactTagAssignmentsTable).where(and(
          eq(contactTagAssignmentsTable.userId, userId),
          eq(contactTagAssignmentsTable.tagId, tag.id),
          inArray(contactTagAssignmentsTable.contactId, ids),
        )).returning({ contactId: contactTagAssignmentsTable.contactId });
        return {
          kind: "updated" as const,
          updatedCount: removed.length,
          skippedCount: ids.length - removed.length,
          campaignIds: [] as string[],
        };
      }

      const assignments = await tx.select({
        contactId: contactTagAssignmentsTable.contactId,
        tagId: contactTagAssignmentsTable.tagId,
        slot: contactTagAssignmentsTable.slot,
      }).from(contactTagAssignmentsTable).where(and(
        eq(contactTagAssignmentsTable.userId, userId),
        inArray(contactTagAssignmentsTable.contactId, ids),
      ));
      const byContact = new Map<string, typeof assignments>();
      for (const assignment of assignments) {
        const current = byContact.get(assignment.contactId) ?? [];
        current.push(assignment);
        byContact.set(assignment.contactId, current);
      }
      const toInsert: Array<{
        userId: string;
        contactId: string;
        tagId: string;
        slot: number;
      }> = [];
      for (const contactId of ids) {
        const current = byContact.get(contactId) ?? [];
        if (current.length >= 2 || current.some(assignment => assignment.tagId === tag.id)) continue;
        const occupiedSlots = new Set(current.map(assignment => assignment.slot));
        const slot = occupiedSlots.has(1) ? 2 : 1;
        toInsert.push({ userId, contactId, tagId: tag.id, slot });
      }
      if (toInsert.length) await tx.insert(contactTagAssignmentsTable).values(toInsert);
      return {
        kind: "updated" as const,
        updatedCount: toInsert.length,
        skippedCount: ids.length - toInsert.length,
        campaignIds: [] as string[],
      };
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
