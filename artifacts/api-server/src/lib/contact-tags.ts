import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, contactsTable, contactTagsTable, contactTagAssignmentsTable, usersTable } from "@workspace/db";

export function contactTagCondition(userId: string, tagId?: string) {
  if (!tagId || tagId === "all") return undefined;
  const matches = db.select({ contactId: contactTagAssignmentsTable.contactId })
    .from(contactTagAssignmentsTable).where(and(
      eq(contactTagAssignmentsTable.userId, userId),
      ...(tagId === "__none__" ? [] : [eq(contactTagAssignmentsTable.tagId, tagId)]),
    ));
  return tagId === "__none__"
    ? notInArray(contactsTable.id, matches) : inArray(contactsTable.id, matches);
}

export async function readContactTags(userId: string, contactIds: string[]) {
  const result = new Map<string, { id: string; name: string }[]>();
  if (!contactIds.length) return result;
  const rows = await db.select({
    contactId: contactTagAssignmentsTable.contactId,
    id: contactTagsTable.id, name: contactTagsTable.name,
  }).from(contactTagAssignmentsTable).innerJoin(contactTagsTable, and(
    eq(contactTagsTable.id, contactTagAssignmentsTable.tagId),
    eq(contactTagsTable.userId, contactTagAssignmentsTable.userId),
  )).where(and(
    eq(contactTagAssignmentsTable.userId, userId),
    inArray(contactTagAssignmentsTable.contactId, contactIds),
  )).orderBy(contactTagAssignmentsTable.slot);
  for (const row of rows) {
    const tags = result.get(row.contactId) ?? [];
    tags.push({ id: row.id, name: row.name });
    result.set(row.contactId, tags);
  }
  return result;
}

export async function replaceContactTags(database: Pick<typeof db, "transaction">, userId: string, contactId: string, tagIds: string[]) {
  if (tagIds.length > 2 || new Set(tagIds).size !== tagIds.length) return { kind: "invalid" as const };
  return database.transaction(async tx => {
    // Serialize assignments and library deletion using the same tenant lock order
    // as the contact editor, so ownership checks remain true until commit.
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
    const [contact] = await tx.select({ id: contactsTable.id }).from(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.userId, userId))).for("update");
    if (!contact) return { kind: "not_found" as const };
    const tags = tagIds.length ? await tx.select({ id: contactTagsTable.id, name: contactTagsTable.name })
      .from(contactTagsTable).where(and(eq(contactTagsTable.userId, userId), inArray(contactTagsTable.id, tagIds)))
      : [];
    if (tags.length !== tagIds.length) return { kind: "not_found" as const };
    await tx.delete(contactTagAssignmentsTable).where(and(
      eq(contactTagAssignmentsTable.userId, userId), eq(contactTagAssignmentsTable.contactId, contactId),
    ));
    if (tagIds.length) await tx.insert(contactTagAssignmentsTable).values(tagIds.map((tagId, index) => ({
      userId, contactId, tagId, slot: index + 1,
    })));
    // Tags have their own write endpoint. Do not advance the profile revision:
    // a tag-only cache refresh must not reset unsaved contact-profile fields.
    return { kind: "updated" as const, tags: tagIds.map(id => tags.find(tag => tag.id === id)!) };
  });
}
