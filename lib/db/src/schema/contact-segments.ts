import { createInsertSchema } from "drizzle-zod";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./users";

export type ContactDirectoryFilters = {
  search: string;
  status: string;
  listId: string;
  companyId: string;
  lifecycleStage: string;
  leadStatus: string;
  leadSource: string;
  addedWithin: string;
};

export const contactSegmentsTable = pgTable(
  "contact_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    filters: jsonb("filters").$type<ContactDirectoryFilters>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("contact_segments_user_name_unique").on(
      table.userId,
      table.name,
    ),
    index("contact_segments_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const insertContactSegmentSchema = createInsertSchema(
  contactSegmentsTable,
).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertContactSegment = z.infer<typeof insertContactSegmentSchema>;
export type ContactSegment = typeof contactSegmentsTable.$inferSelect;
