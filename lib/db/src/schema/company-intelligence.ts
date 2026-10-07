import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { globalCompaniesTable } from "./global-companies";
import { usersTable } from "./users";

export const companyResearchJobsTable = pgTable("company_research_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  globalCompanyId: uuid("global_company_id").notNull().references(() => globalCompaniesTable.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").references(() => usersTable.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  stage: varchar("stage", { length: 40 }).notNull().default("queued"),
  depth: integer("depth").notNull().default(1),
  creditCost: integer("credit_cost").notNull().default(1),
  settings: jsonb("settings").notNull().$type<unknown>(),
  provider: varchar("provider", { length: 20 }).notNull(),
  model: varchar("model", { length: 200 }).notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  webSearchCount: integer("web_search_count").notNull().default(0),
  sourceCount: integer("source_count").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 16, scale: 8 }),
  estimatedCostInr: numeric("estimated_cost_inr", { precision: 16, scale: 8 }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => [
  uniqueIndex("company_research_one_active_job").on(table.globalCompanyId).where(sql`${table.status} IN ('queued', 'running')`),
  index("company_research_company_created_idx").on(table.globalCompanyId, table.createdAt),
  index("company_research_queue_idx").on(table.status, table.createdAt),
]);

export const companyIntelligenceTable = pgTable("company_intelligence", {
  id: uuid("id").defaultRandom().primaryKey(),
  globalCompanyId: uuid("global_company_id").notNull().references(() => globalCompaniesTable.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => companyResearchJobsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  schemaVersion: varchar("schema_version", { length: 20 }).notNull().default("1.0"),
  profile: jsonb("profile").notNull().$type<unknown>(),
  provider: varchar("provider", { length: 20 }).notNull(),
  model: varchar("model", { length: 200 }).notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
  sourceCount: integer("source_count").notNull(),
  researchedAt: timestamp("researched_at", { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
}, table => [
  uniqueIndex("company_intelligence_version_unique").on(table.globalCompanyId, table.version),
  uniqueIndex("company_intelligence_job_unique").on(table.jobId),
  index("company_intelligence_latest_idx").on(table.globalCompanyId, table.researchedAt),
]);

export const insertCompanyResearchJobSchema = createInsertSchema(companyResearchJobsTable).omit({ id: true, createdAt: true });
export const insertCompanyIntelligenceSchema = createInsertSchema(companyIntelligenceTable).omit({ id: true, researchedAt: true });
export type CompanyResearchJob = typeof companyResearchJobsTable.$inferSelect;
export type CompanyIntelligence = typeof companyIntelligenceTable.$inferSelect;
