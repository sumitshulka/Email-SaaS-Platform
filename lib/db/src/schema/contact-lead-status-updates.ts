import { createInsertSchema } from "drizzle-zod";
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const contactLeadStatusUpdatesTable = pgTable(
  "contact_lead_status_updates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    previousStatus: varchar("previous_status", { length: 80 }),
    newStatus: varchar("new_status", { length: 80 }),
    reason: text("reason").notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    changedByName: varchar("changed_by_name", { length: 161 }).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.contactId, table.userId],
      foreignColumns: [contactsTable.id, contactsTable.userId],
      name: "contact_lead_status_updates_contact_tenant_fk",
    }).onDelete("cascade"),
    index("contact_lead_status_updates_tenant_contact_time_idx").on(
      table.userId,
      table.contactId,
      table.changedAt,
    ),
  ],
);

export const insertContactLeadStatusUpdateSchema = createInsertSchema(
  contactLeadStatusUpdatesTable,
).omit({
  id: true,
  changedAt: true,
});

export type InsertContactLeadStatusUpdate = z.infer<
  typeof insertContactLeadStatusUpdateSchema
>;
export type ContactLeadStatusUpdate =
  typeof contactLeadStatusUpdatesTable.$inferSelect;
