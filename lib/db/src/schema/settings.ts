import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const systemConfigurationTable = pgTable("system_configuration", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull().$type<unknown>(),
  updatedBy: uuid("updated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const applicationEmailConfigurationTable = pgTable(
  "application_email_configuration",
  {
    id: varchar("id", { length: 30 }).primaryKey().default("platform"),
    provider: varchar("provider", { length: 32 }).notNull().default("other"),
    host: varchar("host", { length: 255 }).notNull(),
    port: integer("port").notNull(),
    encryption: varchar("encryption", { length: 10 }).notNull(),
    username: varchar("username", { length: 512 }).notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    fromName: varchar("from_name", { length: 120 }).notNull(),
    fromEmail: varchar("from_email", { length: 254 }).notNull(),
    replyTo: varchar("reply_to", { length: 254 }),
    updatedBy: uuid("updated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export const insertSystemConfigurationSchema = createInsertSchema(
  systemConfigurationTable,
);
export const insertApplicationEmailConfigurationSchema = createInsertSchema(
  applicationEmailConfigurationTable,
);

export type SystemConfiguration = typeof systemConfigurationTable.$inferSelect;
export type ApplicationEmailConfiguration =
  typeof applicationEmailConfigurationTable.$inferSelect;