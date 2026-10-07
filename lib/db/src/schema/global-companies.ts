import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const globalCompaniesTable = pgTable(
  "global_companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyName: varchar("company_name", { length: 200 }).notNull(),
    companyWebsiteUrl: varchar("company_website_url", { length: 2048 }),
    companyDomain: varchar("company_domain", { length: 255 }),
    companyDomainKey: varchar("company_domain_key", { length: 255 }),
    companyIndustry: varchar("company_industry", { length: 120 }),
    companySize: varchar("company_size", { length: 80 }),
    companyRevenueRange: varchar("company_revenue_range", { length: 80 }),
    companyDescription: text("company_description"),
    companyPhoneNumber: varchar("company_phone_number", { length: 40 }),
    companyLinkedinUrl: varchar("company_linkedin_url", { length: 2048 }),
    companyLocation: varchar("company_location", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("global_companies_domain_unique")
      .on(table.companyDomainKey)
      .where(sql`${table.companyDomainKey} IS NOT NULL`),
    index("global_companies_name_domain_trgm_idx").using(
      "gin",
      table.companyName.op("gin_trgm_ops"),
      table.companyDomain.op("gin_trgm_ops"),
    ),
  ],
);

export const insertGlobalCompanySchema = createInsertSchema(
  globalCompaniesTable,
).omit({
  id: true,
  companyDomainKey: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertGlobalCompany = z.infer<typeof insertGlobalCompanySchema>;
export type GlobalCompany = typeof globalCompaniesTable.$inferSelect;
