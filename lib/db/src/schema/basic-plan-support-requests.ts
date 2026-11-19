import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { subscriptionPackagesTable, userSubscriptionsTable } from "./billing";
import { usersTable } from "./users";

export const basicPlanSupportRequestsTable = pgTable(
  "basic_plan_support_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    milestone: integer("milestone").notNull(),
    freePackageId: uuid("free_package_id")
      .notNull()
      .references(() => subscriptionPackagesTable.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<"pending" | "approved" | "auto_approved" | "rejected">()
      .notNull()
      .default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decisionDeadlineAt: timestamp("decision_deadline_at", {
      withTimezone: true,
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    rejectionReason: text("rejection_reason"),
    grantSubscriptionId: uuid("grant_subscription_id").references(
      () => userSubscriptionsTable.id,
      { onDelete: "set null" },
    ),
    paidWindowStartedAt: timestamp("paid_window_started_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    check(
      "basic_plan_support_request_milestone_check",
      sql`${table.milestone} BETWEEN 1 AND 3`,
    ),
    check(
      "basic_plan_support_request_status_check",
      sql`${table.status} IN ('pending', 'approved', 'auto_approved', 'rejected')`,
    ),
    check(
      "basic_plan_support_request_deadline_check",
      sql`${table.decisionDeadlineAt} > ${table.requestedAt}`,
    ),
    check(
      "basic_plan_support_request_resolution_check",
      sql`(${table.status} = 'pending' AND ${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL AND ${table.rejectionReason} IS NULL AND ${table.grantSubscriptionId} IS NULL) OR (${table.status} = 'rejected' AND ${table.resolvedAt} IS NOT NULL AND ${table.rejectionReason} IS NOT NULL AND ${table.grantSubscriptionId} IS NULL) OR (${table.status} IN ('approved', 'auto_approved') AND ${table.resolvedAt} IS NOT NULL AND ${table.grantSubscriptionId} IS NOT NULL)`,
    ),
    uniqueIndex("basic_plan_support_request_user_milestone_unique").on(
      table.userId,
      table.milestone,
    ),
    uniqueIndex("basic_plan_support_request_one_pending_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("basic_plan_support_request_queue_idx").on(
      table.status,
      table.decisionDeadlineAt,
    ),
    index("basic_plan_support_request_user_idx").on(
      table.userId,
      table.requestedAt,
    ),
  ],
);

export const insertBasicPlanSupportRequestSchema = createInsertSchema(
  basicPlanSupportRequestsTable,
).omit({ id: true, requestedAt: true });

export type BasicPlanSupportRequest =
  typeof basicPlanSupportRequestsTable.$inferSelect;
