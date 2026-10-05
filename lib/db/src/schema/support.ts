import { createInsertSchema } from "drizzle-zod";
import { index, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable, userRoleEnum } from "./users";

export const supportTicketStatusEnum = pgEnum("support_ticket_status", [
  "open",
  "in_progress",
  "waiting_on_customer",
  "resolved",
  "closed",
]);

export const supportTicketsTable = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    subject: varchar("subject", { length: 160 }).notNull(),
    status: supportTicketStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("support_tickets_user_last_message_idx").on(
      table.userId,
      table.lastMessageAt,
    ),
    index("support_tickets_status_last_message_idx").on(
      table.status,
      table.lastMessageAt,
    ),
  ],
);

export const supportTicketMessagesTable = pgTable(
  "support_ticket_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    authorRole: userRoleEnum("author_role").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("support_ticket_messages_ticket_created_idx").on(
      table.ticketId,
      table.createdAt,
    ),
  ],
);

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
});

export const insertSupportTicketMessageSchema = createInsertSchema(
  supportTicketMessagesTable,
).omit({
  id: true,
  createdAt: true,
});
