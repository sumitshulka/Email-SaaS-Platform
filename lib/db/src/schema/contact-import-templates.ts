import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Stores only the latest issued import template for each tenant. The session
 * column allows a large file to be imported in API-sized batches while the
 * template remains single-use.
 */
export const contactImportTemplatesTable = pgTable("contact_import_templates", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  importSessionId: uuid("import_session_id"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export type ContactImportTemplate = typeof contactImportTemplatesTable.$inferSelect;
