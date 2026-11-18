import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const savedReportDefinitionsTable = pgTable(
  "saved_report_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 1000 }).notNull().default(""),
    category: varchar("category", { length: 80 }).notNull().default("Custom"),
    baseEntityId: varchar("base_entity_id", { length: 80 }).notNull(),
    definition: jsonb("definition")
      .$type<Record<string, unknown>>()
      .notNull(),
    definitionVersion: integer("definition_version").notNull().default(1),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("saved_report_definitions_user_name_unique").on(
      table.userId,
      sql`lower(${table.name})`,
    ),
    index("saved_report_definitions_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

export type SavedReportDefinition =
  typeof savedReportDefinitionsTable.$inferSelect;
