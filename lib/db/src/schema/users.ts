import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["SUPERADMIN", "USER"]);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 50 }).notNull(),
    firstName: varchar("first_name", { length: 80 }).notNull(),
    lastName: varchar("last_name", { length: 80 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("USER"),
    timezone: varchar("timezone", { length: 80 }).notNull().default("Asia/Kolkata"),
    active: boolean("active").notNull().default(true),
    emailVerified: boolean("email_verified").notNull().default(false),
    mustChangeCredentials: boolean("must_change_credentials")
      .notNull()
      .default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("users_username_active_unique")
      .on(table.username)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("users_email_active_unique")
      .on(table.email)
      .where(sql`${table.deletedAt} IS NULL`),
    index("users_role_active_idx").on(table.role, table.active),
    index("users_created_at_idx").on(table.createdAt),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;