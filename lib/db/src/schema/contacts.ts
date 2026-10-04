import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
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

export const contactsTable = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 201 }).notNull().default(""),
    email: varchar("email", { length: 254 }).notNull(),
    firstName: varchar("first_name", { length: 100 }).notNull().default(""),
    lastName: varchar("last_name", { length: 100 }).notNull().default(""),
    companyName: varchar("company_name", { length: 200 }),
    linkedinUrl: varchar("linkedin_url", { length: 2048 }),
    phoneNumber: varchar("phone_number", { length: 40 }),
    jobTitle: varchar("job_title", { length: 200 }),
    department: varchar("department", { length: 120 }),
    seniority: varchar("seniority", { length: 80 }),
    mobilePhone: varchar("mobile_phone", { length: 40 }),
    websiteUrl: varchar("website_url", { length: 2048 }),
    twitterUrl: varchar("twitter_url", { length: 2048 }),
    facebookUrl: varchar("facebook_url", { length: 2048 }),
    instagramUrl: varchar("instagram_url", { length: 2048 }),
    location: varchar("location", { length: 200 }),
    preferredLanguage: varchar("preferred_language", { length: 80 }),
    timeZone: varchar("time_zone", { length: 100 }),
    lifecycleStage: varchar("lifecycle_stage", { length: 80 }),
    leadStatus: varchar("lead_status", { length: 80 }),
    leadSource: varchar("lead_source", { length: 120 }),
    interests: text("interests"),
    goals: text("goals"),
    painPoints: text("pain_points"),
    personalizationContext: text("personalization_context"),
    notes: text("notes"),
    companyWebsiteUrl: varchar("company_website_url", { length: 2048 }),
    companyDomain: varchar("company_domain", { length: 255 }),
    companyIndustry: varchar("company_industry", { length: 120 }),
    companySize: varchar("company_size", { length: 80 }),
    companyRevenueRange: varchar("company_revenue_range", { length: 80 }),
    companyDescription: text("company_description"),
    companyPhoneNumber: varchar("company_phone_number", { length: 40 }),
    companyLinkedinUrl: varchar("company_linkedin_url", { length: 2048 }),
    companyLocation: varchar("company_location", { length: 200 }),
    subscribed: boolean("subscribed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("contacts_user_email_unique").on(table.userId, table.email),
    uniqueIndex("contacts_id_user_unique").on(table.id, table.userId),
    index("contacts_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const insertContactSchema = createInsertSchema(contactsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;