import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  foreignKey,
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
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const emailCampaignStatusEnum = pgEnum("email_campaign_status", [
  "draft",
  "queued",
  "sending",
  "completed",
]);

export const emailCampaignRecipientStatusEnum = pgEnum(
  "email_campaign_recipient_status",
  ["queued", "sending", "delivered", "bounced", "suppressed", "unknown"],
);

export const tenantSendingConfigurationTable = pgTable(
  "tenant_sending_configurations",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull().default("other"),
    host: varchar("host", { length: 255 }).notNull(),
    port: integer("port").notNull(),
    encryption: varchar("encryption", { length: 10 }).notNull(),
    usernameEncrypted: text("username_encrypted").notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    fromName: varchar("from_name", { length: 120 }).notNull(),
    fromEmail: varchar("from_email", { length: 254 }).notNull(),
    replyTo: varchar("reply_to", { length: 254 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export const contactListsTable = pgTable(
  "contact_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("contact_lists_user_name_unique").on(table.userId, table.name),
    uniqueIndex("contact_lists_id_user_unique").on(table.id, table.userId),
    index("contact_lists_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const contactListMembersTable = pgTable(
  "contact_list_members",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    listId: uuid("list_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.listId, table.userId],
      foreignColumns: [contactListsTable.id, contactListsTable.userId],
      name: "contact_list_members_list_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.contactId, table.userId],
      foreignColumns: [contactsTable.id, contactsTable.userId],
      name: "contact_list_members_contact_tenant_fk",
    }).onDelete("cascade"),
    uniqueIndex("contact_list_members_unique").on(
      table.userId,
      table.listId,
      table.contactId,
    ),
    index("contact_list_members_contact_idx").on(table.userId, table.contactId),
  ],
);

export const emailCampaignsTable = pgTable(
  "email_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    listId: uuid("list_id").references(() => contactListsTable.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 160 }).notNull(),
    subject: varchar("subject", { length: 200 }).notNull(),
    textBody: text("text_body").notNull(),
    status: emailCampaignStatusEnum("status").notNull().default("draft"),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("email_campaigns_user_created_idx").on(table.userId, table.createdAt),
    index("email_campaigns_user_status_idx").on(table.userId, table.status),
    index("email_campaigns_list_idx").on(table.listId),
  ],
);

export const emailCampaignRecipientsTable = pgTable(
  "email_campaign_recipients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => emailCampaignsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contactsTable.id, {
      onDelete: "set null",
    }),
    email: varchar("email", { length: 254 }).notNull(),
    firstName: varchar("first_name", { length: 100 }).notNull().default(""),
    lastName: varchar("last_name", { length: 100 }).notNull().default(""),
    status: emailCampaignRecipientStatusEnum("status")
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("email_campaign_recipients_queue_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index("email_campaign_recipients_campaign_idx").on(
      table.userId,
      table.campaignId,
      table.status,
    ),
    index("email_campaign_recipients_user_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const emailSendAttemptsTable = pgTable(
  "email_send_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => emailCampaignRecipientsTable.id, {
        onDelete: "cascade",
      }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("email_send_attempts_user_time_idx").on(
      table.userId,
      table.attemptedAt,
    ),
  ],
);

export const insertContactListSchema = createInsertSchema(contactListsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertEmailCampaignSchema = createInsertSchema(emailCampaignsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertEmailCampaignRecipientSchema = createInsertSchema(
  emailCampaignRecipientsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TenantSendingConfiguration =
  typeof tenantSendingConfigurationTable.$inferSelect;
export type ContactList = typeof contactListsTable.$inferSelect;
export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;
export type EmailCampaignRecipient =
  typeof emailCampaignRecipientsTable.$inferSelect;
export type EmailSendAttempt = typeof emailSendAttemptsTable.$inferSelect;