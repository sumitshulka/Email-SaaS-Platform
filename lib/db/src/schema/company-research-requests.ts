import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companyResearchJobsTable } from "./company-intelligence";
import { globalCompaniesTable } from "./global-companies";
import { usersTable } from "./users";

export const companyResearchRequestsTable = pgTable(
  "company_research_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    globalCompanyId: uuid("global_company_id")
      .notNull()
      .references(() => globalCompaniesTable.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    researchJobId: uuid("research_job_id").references(
      () => companyResearchJobsTable.id,
      { onDelete: "set null" },
    ),
    status: text("status")
      .$type<"requested" | "in_progress" | "completed" | "failed">()
      .notNull()
      .default("requested"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("company_research_request_one_open_per_user")
      .on(table.globalCompanyId, table.requestedBy)
      .where(sql`${table.status} IN ('requested', 'in_progress')`),
    index("company_research_request_queue_idx").on(table.status, table.createdAt),
    index("company_research_request_user_idx").on(
      table.requestedBy,
      table.globalCompanyId,
      table.createdAt,
    ),
    index("company_research_request_job_idx").on(table.researchJobId),
  ],
);

export const insertCompanyResearchRequestSchema = createInsertSchema(
  companyResearchRequestsTable,
).omit({ id: true, createdAt: true });

export type CompanyResearchRequest =
  typeof companyResearchRequestsTable.$inferSelect;
