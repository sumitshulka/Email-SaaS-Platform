import { pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const emailTemplateKindEnum = pgEnum("email_template_kind", [
  "inactive_warning",
  "suspension_notice",
]);

export const emailTemplatesTable = pgTable("email_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: emailTemplateKindEnum("kind").notNull(),
  subject: varchar("subject", { length: 200 }).notNull(),
  htmlBody: text("html_body").notNull(),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;
