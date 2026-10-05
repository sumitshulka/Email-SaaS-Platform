import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const platformNotificationAudienceEnum = pgEnum(
  "platform_notification_audience",
  ["broadcast", "focused"],
);

export const platformNotificationsTable = pgTable(
  "platform_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 120 }).notNull(),
    message: text("message").notNull(),
    audience: platformNotificationAudienceEnum("audience").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id, {
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
    index("platform_notifications_visibility_idx").on(
      table.enabled,
      table.startsAt,
      table.expiresAt,
    ),
    index("platform_notifications_created_at_idx").on(table.createdAt),
  ],
);

export const platformNotificationRecipientsTable = pgTable(
  "platform_notification_recipients",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => platformNotificationsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.notificationId, table.userId],
      name: "platform_notification_recipients_pkey",
    }),
    index("platform_notification_recipients_user_idx").on(table.userId),
  ],
);

export const platformNotificationReadsTable = pgTable(
  "platform_notification_reads",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => platformNotificationsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.notificationId, table.userId],
      name: "platform_notification_reads_pkey",
    }),
    index("platform_notification_reads_user_read_at_idx").on(
      table.userId,
      table.readAt,
    ),
  ],
);
