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
import { usersTable } from "./users";

export const companiesTable = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
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
    uniqueIndex("companies_id_user_unique").on(table.id, table.userId),
    uniqueIndex("companies_user_domain_unique")
      .on(table.userId, table.companyDomainKey)
      .where(sql`${table.companyDomainKey} IS NOT NULL`),
    index("companies_user_created_idx").on(table.userId, table.createdAt),
    index("companies_name_domain_trgm_idx").using(
      "gin",
      table.companyName.op("gin_trgm_ops"),
      table.companyDomain.op("gin_trgm_ops"),
    ),
  ],
);

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  userId: true,
  companyDomainKey: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;