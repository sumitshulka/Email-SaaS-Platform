import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const paymentStatusEnum = pgEnum("payment_status", [
  "created",
  "authorized",
  "captured",
  "failed",
  "refunded",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "superseded",
  "cancelled",
]);

export const razorpayEnvironmentEnum = pgEnum("razorpay_environment", [
  "sandbox",
  "production",
]);

export const subscriptionPackagesTable = pgTable(
  "subscription_packages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull().default(""),
    amountMinor: integer("amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    periodDays: integer("period_days").notNull(),
    contactLimit: integer("contact_limit").notNull().default(5000),
    emailAccountLimit: integer("email_account_limit").notNull().default(1),
    preferred: boolean("preferred").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("subscription_packages_active_idx").on(table.active),
    index("subscription_packages_created_at_idx").on(table.createdAt),
    uniqueIndex("subscription_packages_single_free_unique")
      .on(table.amountMinor)
      .where(sql`${table.amountMinor} = 0`),
    uniqueIndex("subscription_packages_single_preferred_unique")
      .on(table.preferred)
      .where(sql`${table.preferred} = true`),
  ],
);

export const razorpayConfigurationTable = pgTable("razorpay_configuration", {
  id: varchar("id", { length: 30 }).primaryKey().default("platform"),
  keyId: varchar("key_id", { length: 255 }).notNull(),
  keySecretEncrypted: text("key_secret_encrypted").notNull(),
  webhookSecretEncrypted: text("webhook_secret_encrypted").notNull(),
  activeEnvironment: razorpayEnvironmentEnum("active_environment"),
  sandboxKeyId: varchar("sandbox_key_id", { length: 255 }),
  sandboxKeySecretEncrypted: text("sandbox_key_secret_encrypted"),
  sandboxWebhookSecretEncrypted: text("sandbox_webhook_secret_encrypted"),
  sandboxUpdatedAt: timestamp("sandbox_updated_at", { withTimezone: true }),
  productionKeyId: varchar("production_key_id", { length: 255 }),
  productionKeySecretEncrypted: text("production_key_secret_encrypted"),
  productionWebhookSecretEncrypted: text("production_webhook_secret_encrypted"),
  productionUpdatedAt: timestamp("production_updated_at", { withTimezone: true }),
  updatedBy: uuid("updated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const paymentsTable = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => subscriptionPackagesTable.id, { onDelete: "restrict" }),
    receipt: varchar("receipt", { length: 40 }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: paymentStatusEnum("status").notNull().default("created"),
    razorpayEnvironment: razorpayEnvironmentEnum("razorpay_environment"),
    razorpayOrderId: varchar("razorpay_order_id", { length: 80 }),
    razorpayPaymentId: varchar("razorpay_payment_id", { length: 80 }),
    senderAccountIdsToKeep: uuid("sender_account_ids_to_keep").array(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payments_receipt_unique").on(table.receipt),
    uniqueIndex("payments_razorpay_order_unique")
      .on(table.razorpayOrderId)
      .where(sql`${table.razorpayOrderId} IS NOT NULL`),
    uniqueIndex("payments_razorpay_payment_unique")
      .on(table.razorpayPaymentId)
      .where(sql`${table.razorpayPaymentId} IS NOT NULL`),
    index("payments_user_created_idx").on(table.userId, table.createdAt),
    index("payments_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const userSubscriptionsTable = pgTable(
  "user_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => subscriptionPackagesTable.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id")
      .references(() => paymentsTable.id, { onDelete: "restrict" }),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    senderAccountIdsToKeep: uuid("sender_account_ids_to_keep").array(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_subscriptions_payment_unique").on(table.paymentId),
    index("user_subscriptions_owner_period_idx").on(
      table.userId,
      table.status,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export const razorpayWebhookEventsTable = pgTable(
  "razorpay_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: varchar("event_id", { length: 128 }).notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    razorpayOrderId: varchar("razorpay_order_id", { length: 80 }),
    razorpayPaymentId: varchar("razorpay_payment_id", { length: 80 }),
    bodySha256: varchar("body_sha256", { length: 64 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("razorpay_webhook_event_id_unique").on(table.eventId),
    index("razorpay_webhook_order_idx").on(table.razorpayOrderId),
  ],
);

export type SubscriptionPackage = typeof subscriptionPackagesTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type UserSubscription = typeof userSubscriptionsTable.$inferSelect;