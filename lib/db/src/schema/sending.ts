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

export const gmailMailboxConnectionsTable = pgTable(
  "gmail_mailbox_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    emailAddress: varchar("email_address", { length: 254 }).notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    historyId: varchar("history_id", { length: 64 }).notNull(),
    syncStatus: varchar("sync_status", { length: 32 })
      .notNull()
      .default("connected"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("gmail_mailbox_connections_due_sync_idx").on(
      table.syncStatus,
      table.nextSyncAt,
      table.leaseExpiresAt,
    ),
  ],
);

export const microsoft365TraceConnectionsTable = pgTable(
  "microsoft365_trace_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tenantId: varchar("tenant_id", { length: 36 }).notNull(),
    clientId: varchar("client_id", { length: 36 }).notNull(),
    clientSecretEncrypted: text("client_secret_encrypted").notNull(),
    syncStatus: varchar("sync_status", { length: 32 })
      .notNull()
      .default("connected"),
    backfillStartAt: timestamp("backfill_start_at", { withTimezone: true }),
    backfillEndAt: timestamp("backfill_end_at", { withTimezone: true }),
    pageNextLink: text("page_next_link"),
    backfillCompletedAt: timestamp("backfill_completed_at", {
      withTimezone: true,
    }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("microsoft365_trace_connections_due_sync_idx").on(
      table.syncStatus,
      table.nextSyncAt,
      table.leaseExpiresAt,
    ),
  ],
);

export const microsoft365MessageTracesTable = pgTable(
  "microsoft365_message_traces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => microsoft365TraceConnectionsTable.id, {
        onDelete: "cascade",
      }),
    traceId: varchar("trace_id", { length: 128 }).notNull(),
    messageId: varchar("message_id", { length: 512 }).notNull(),
    recipientAddress: varchar("recipient_address", { length: 254 }).notNull(),
    receivedDateTime: timestamp("received_date_time", {
      withTimezone: true,
    }).notNull(),
    providerStatus: varchar("provider_status", { length: 32 }),
    detailsCheckedAt: timestamp("details_checked_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("microsoft365_message_traces_connection_trace_recipient_unique").on(
      table.connectionId,
      table.traceId,
      table.recipientAddress,
    ),
    index("microsoft365_message_traces_due_details_idx").on(
      table.connectionId,
      table.nextAttemptAt,
    ),
  ],
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
    htmlBody: text("html_body"),
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
    reportOutcome: varchar("report_outcome", { length: 24 })
      .notNull()
      .default("unconfirmed"),
    reportSource: varchar("report_source", { length: 32 }),
    reportDiagnostic: text("report_diagnostic"),
    reportStatusCode: varchar("report_status_code", { length: 64 }),
    reportAt: timestamp("report_at", { withTimezone: true }),
    reportDeliveryScope: varchar("report_delivery_scope", { length: 24 }),
    reportEvidenceVerification: varchar("report_evidence_verification", {
      length: 32,
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
    messageId: varchar("message_id", { length: 512 }),
    smtpResponse: text("smtp_response"),
    smtpCode: integer("smtp_code"),
    enhancedStatus: varchar("enhanced_status", { length: 24 }),
    outcome: varchar("outcome", { length: 24 }).notNull().default("pending"),
    errorMessage: text("error_message"),
    dsnRequested: boolean("dsn_requested").notNull().default(false),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("email_send_attempts_user_time_idx").on(
      table.userId,
      table.attemptedAt,
    ),
    index("email_send_attempts_user_message_idx").on(
      table.userId,
      table.messageId,
    ),
  ],
);

export const emailDeliveryReportsTable = pgTable(
  "email_delivery_reports",
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
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => emailSendAttemptsTable.id, { onDelete: "cascade" }),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    diagnostic: text("diagnostic"),
    statusCode: varchar("status_code", { length: 64 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveryScope: varchar("delivery_scope", { length: 24 })
      .notNull()
      .default("unspecified"),
    evidenceVerification: varchar("evidence_verification", { length: 32 })
      .notNull()
      .default("user_imported"),
    gmailMailboxConnectionId: uuid("gmail_mailbox_connection_id").references(
      () => gmailMailboxConnectionsTable.id,
      { onDelete: "set null" },
    ),
    microsoft365TraceConnectionId: uuid(
      "microsoft365_trace_connection_id",
    ).references(() => microsoft365TraceConnectionsTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("email_delivery_reports_user_fingerprint_unique").on(
      table.userId,
      table.fingerprint,
    ),
    index("email_delivery_reports_recipient_time_idx").on(
      table.userId,
      table.recipientId,
      table.receivedAt,
    ),
    index("email_delivery_reports_attempt_idx").on(
      table.userId,
      table.attemptId,
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
export type EmailDeliveryReport = typeof emailDeliveryReportsTable.$inferSelect;