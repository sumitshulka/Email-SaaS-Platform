import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, smallint, uniqueIndex, uuid, varchar, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { contactsTable } from "./contacts";

export const contactTagsTable = pgTable("contact_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 40 }).notNull(),
}, table => [
  uniqueIndex("contact_tags_id_user_unique").on(table.id, table.userId),
  uniqueIndex("contact_tags_user_name_unique").on(table.userId, sql`lower(${table.name})`),
  check("contact_tags_name_nonempty", sql`length(trim(${table.name})) > 0`),
]);

export const contactTagAssignmentsTable = pgTable("contact_tag_assignments", {
  userId: uuid("user_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  tagId: uuid("tag_id").notNull(),
  slot: smallint("slot").notNull(),
}, table => [
  foreignKey({ columns: [table.contactId, table.userId], foreignColumns: [contactsTable.id, contactsTable.userId] }).onDelete("cascade"),
  foreignKey({ columns: [table.tagId, table.userId], foreignColumns: [contactTagsTable.id, contactTagsTable.userId] }).onDelete("cascade"),
  check("contact_tags_two_slots", sql`${table.slot} in (1, 2)`),
  uniqueIndex("contact_tag_slot_unique").on(table.userId, table.contactId, table.slot),
  uniqueIndex("contact_tag_assignment_unique").on(table.userId, table.contactId, table.tagId),
  index("contact_tag_filter_idx").on(table.userId, table.tagId, table.contactId),
]);

export const insertContactTagSchema = createInsertSchema(contactTagsTable).omit({ id: true });
export type ContactTagRow = typeof contactTagsTable.$inferSelect;
