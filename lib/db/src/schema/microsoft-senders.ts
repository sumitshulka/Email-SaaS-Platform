import { pgTable, uuid, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { tenantSendingConfigurationTable } from "./sending";

export const microsoftSenderConnectionsTable = pgTable("microsoft_sender_connections", {
  accountId: uuid("account_id").primaryKey().references(() => tenantSendingConfigurationTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  mailbox: varchar("mailbox", { length: 254 }).notNull(),
  clientId: varchar("client_id", { length: 100 }).notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("microsoft_sender_user_idx").on(table.userId)]);

export const microsoftSenderStatesTable = pgTable("microsoft_sender_states", {
  nonce: varchar("nonce", { length: 64 }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => tenantSendingConfigurationTable.id, { onDelete: "cascade" }),
  sessionHash: varchar("session_hash", { length: 64 }).notNull(),
  verifierEncrypted: text("verifier_encrypted").notNull(),
  configurationFingerprint: varchar("configuration_fingerprint", { length: 64 }).notNull(),
  senderFingerprint: varchar("sender_fingerprint", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, table => [index("microsoft_sender_states_expiry_idx").on(table.expiresAt)]);

export const insertMicrosoftSenderConnectionSchema = createInsertSchema(microsoftSenderConnectionsTable);
export const insertMicrosoftSenderStateSchema = createInsertSchema(microsoftSenderStatesTable);
export type MicrosoftSenderConnection = typeof microsoftSenderConnectionsTable.$inferSelect;
