import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { prospectActionTypesTable, prospectsTable } from "./prospect-management";
import { usersTable } from "./users";

export const prospectFollowUpsTable = pgTable("prospect_follow_ups", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull(),
  actionTypeId: uuid("action_type_id").notNull(),
  followUpDate: date("follow_up_date", { mode: "string" }).notNull(),
  notes: text("notes").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  foreignKey({
    columns: [table.prospectId, table.userId],
    foreignColumns: [prospectsTable.id, prospectsTable.userId],
    name: "prospect_follow_ups_prospect_tenant_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.actionTypeId, table.userId],
    foreignColumns: [prospectActionTypesTable.id, prospectActionTypesTable.userId],
    name: "prospect_follow_ups_type_tenant_fk",
  }),
  index("prospect_follow_ups_user_date_status_idx").on(table.userId, table.followUpDate, table.status),
  index("prospect_follow_ups_prospect_date_idx").on(table.userId, table.prospectId, table.followUpDate),
  check("prospect_follow_ups_status_valid", sql`${table.status} in ('pending', 'completed', 'cancelled')`),
  check("prospect_follow_ups_notes_nonempty", sql`length(trim(${table.notes})) > 0`),
  check("prospect_follow_ups_completion_time", sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`),
]);

export type ProspectFollowUp = typeof prospectFollowUpsTable.$inferSelect;
export type InsertProspectFollowUp = typeof prospectFollowUpsTable.$inferInsert;
