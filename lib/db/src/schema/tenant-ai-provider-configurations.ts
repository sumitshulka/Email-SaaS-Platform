import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const tenantAIProviderConfigurationsTable = pgTable(
  "tenant_ai_provider_configurations",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    selectedModel: varchar("selected_model", { length: 200 }).notNull(),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [],
);

export const insertTenantAIProviderConfigurationSchema =
  createInsertSchema(tenantAIProviderConfigurationsTable).omit({
    createdAt: true,
    updatedAt: true,
  });

export type InsertTenantAIProviderConfiguration = z.infer<
  typeof insertTenantAIProviderConfigurationSchema
>;
export type TenantAIProviderConfiguration =
  typeof tenantAIProviderConfigurationsTable.$inferSelect;
