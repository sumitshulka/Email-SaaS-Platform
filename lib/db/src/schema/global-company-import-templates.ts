import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Latest single-use XLSX import template issued to each superadmin. */
export const globalCompanyImportTemplatesTable = pgTable("global_company_import_templates", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  importSessionId: uuid("import_session_id"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export type GlobalCompanyImportTemplate = typeof globalCompanyImportTemplatesTable.$inferSelect;
