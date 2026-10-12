import { createInsertSchema } from "drizzle-zod";
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const contactNotesTable = pgTable(
  "contact_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.contactId, table.userId],
      foreignColumns: [contactsTable.id, contactsTable.userId],
      name: "contact_notes_contact_tenant_fk",
    }).onDelete("cascade"),
    index("contact_notes_tenant_contact_created_idx").on(
      table.userId,
      table.contactId,
      table.createdAt,
    ),
  ],
);

export const insertContactNoteSchema = createInsertSchema(contactNotesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertContactNote = z.infer<typeof insertContactNoteSchema>;
export type ContactNote = typeof contactNotesTable.$inferSelect;
