import { index, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";
import { addOnEntitlementsTable } from "./billing";

export const contactIntentAnalysesTable = pgTable("contact_intent_analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  creditSource: varchar("credit_source", { length: 12 }).notNull().default("primary"),
  entitlementId: uuid("entitlement_id").references(() => addOnEntitlementsTable.id, { onDelete: "set null" }),
  answers: jsonb("answers").notNull().$type<Record<string, string>>(),
  intents: jsonb("intents").notNull().$type<Array<{ intent: string; confidence: number; evidence: string[]; suggestedNextStep: string }>>(),
  provider: varchar("provider", { length: 20 }).notNull(),
  model: varchar("model", { length: 200 }).notNull(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("contact_intent_analysis_source_unique").on(table.userId, table.contactId, table.sourceHash),
  index("contact_intent_analysis_contact_idx").on(table.userId, table.contactId, table.analyzedAt),
]);
