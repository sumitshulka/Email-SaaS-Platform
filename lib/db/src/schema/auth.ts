import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userSessionsTable = pgTable(
  "user_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    ipAddress: varchar("ip_address", { length: 80 }),
    userAgent: varchar("user_agent", { length: 512 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_sessions_token_hash_unique").on(table.tokenHash),
    index("user_sessions_user_id_idx").on(table.userId),
    index("user_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const otpVerificationsTable = pgTable(
  "otp_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    email: varchar("email", { length: 254 }).notNull(),
    purpose: varchar("purpose", { length: 40 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("otp_verifications_email_purpose_idx").on(table.email, table.purpose),
    index("otp_verifications_expiry_idx").on(table.expiresAt),
  ],
);

export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_id_idx").on(table.userId),
  ],
);

export const loginAttemptsTable = pgTable(
  "login_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: varchar("identifier", { length: 254 }).notNull(),
    ipAddress: varchar("ip_address", { length: 80 }).notNull(),
    failedCount: integer("failed_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("login_attempts_identifier_ip_unique").on(
      table.identifier,
      table.ipAddress,
    ),
    index("login_attempts_locked_until_idx").on(table.lockedUntil),
  ],
);

export const insertUserSessionSchema = createInsertSchema(userSessionsTable).omit({
  id: true,
  createdAt: true,
});
export const insertOtpVerificationSchema = createInsertSchema(
  otpVerificationsTable,
).omit({ id: true, createdAt: true });
export const insertPasswordResetTokenSchema = createInsertSchema(
  passwordResetTokensTable,
).omit({ id: true, createdAt: true });

export type UserSession = typeof userSessionsTable.$inferSelect;
export type OtpVerification = typeof otpVerificationsTable.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;