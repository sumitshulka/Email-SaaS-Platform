import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Latest one-use company workbook issued to a customer workspace. */
export const companyImportTemplatesTable = pgTable("company_import_templates", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  importSessionId: uuid("import_session_id"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export type CompanyImportTemplate = typeof companyImportTemplatesTable.$inferSelect;
