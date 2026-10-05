import { pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const contactFieldKeys = [
  "jobTitle",
  "preferredLanguage",
  "lifecycleStage",
  "leadStatus",
  "leadSource",
] as const;

export type ContactFieldKey = (typeof contactFieldKeys)[number];

export const contactFieldOptionsTable = pgTable(
  "contact_field_options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    fieldKey: varchar("field_key", { length: 40 }).$type<ContactFieldKey>().notNull(),
    value: varchar("value", { length: 200 }).notNull(),
    normalizedValue: varchar("normalized_value", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("contact_field_options_user_field_value_unique").on(
      table.userId,
      table.fieldKey,
      table.normalizedValue,
    ),
    uniqueIndex("contact_field_options_id_user_unique").on(table.id, table.userId),
  ],
);

export type ContactFieldOption = typeof contactFieldOptionsTable.$inferSelect;
