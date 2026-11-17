import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { contactsTable } from "./contacts";
import { contactTagsTable } from "./contact-tags";
import { usersTable } from "./users";

export const prospectProductsTable = pgTable("prospect_products", {
  id: uuid("id").defaultRandom().notNull(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description").notNull().default(""),
  category: varchar("category", { length: 100 }),
  active: boolean("active").notNull().default(true),
  displayOrder: smallint("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  primaryKey({ columns: [table.id, table.userId], name: "prospect_products_pkey" }),
  uniqueIndex("prospect_products_id_unique").on(table.id),
  uniqueIndex("prospect_products_user_name_unique").on(table.userId, sql`lower(${table.name})`),
  index("prospect_products_user_active_order_idx").on(table.userId, table.active, table.displayOrder),
  check("prospect_products_name_nonempty", sql`length(trim(${table.name})) > 0`),
]);

export const prospectCurrenciesTable = pgTable("prospect_currencies", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 3 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("prospect_currencies_id_user_unique").on(table.id, table.userId),
  uniqueIndex("prospect_currencies_user_code_unique").on(table.userId, table.code),
  uniqueIndex("prospect_currencies_one_default_per_user").on(table.userId).where(sql`${table.isDefault}`),
  check("prospect_currencies_iso_code", sql`${table.code} ~ '^[A-Z]{3}$'`),
  index("prospect_currencies_user_default_idx").on(table.userId, table.isDefault),
]);

export const prospectStagesTable = pgTable("prospect_stages", {
  id: uuid("id").defaultRandom().notNull(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull().default(""),
  probability: smallint("probability").notNull(),
  stageType: varchar("stage_type", { length: 16 }).notNull().default("active"),
  terminalOutcome: varchar("terminal_outcome", { length: 80 }),
  displayOrder: smallint("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  primaryKey({ columns: [table.id, table.userId], name: "prospect_stages_pkey" }),
  uniqueIndex("prospect_stages_id_unique").on(table.id),
  uniqueIndex("prospect_stages_user_name_unique").on(table.userId, sql`lower(${table.name})`),
  index("prospect_stages_user_active_order_idx").on(table.userId, table.active, table.displayOrder),
  check("prospect_stages_name_nonempty", sql`length(trim(${table.name})) > 0`),
  check("prospect_stages_probability_range", sql`${table.probability} between 0 and 100`),
  check("prospect_stages_type_valid", sql`${table.stageType} in ('active', 'terminal')`),
  check("prospect_stages_terminal_outcome", sql`(${table.stageType} = 'active' and ${table.terminalOutcome} is null) or (${table.stageType} = 'terminal' and length(trim(coalesce(${table.terminalOutcome}, ''))) > 0)`),
]);

export const prospectStageTransitionsTable = pgTable("prospect_stage_transitions", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  fromStageId: uuid("from_stage_id").notNull(),
  toStageId: uuid("to_stage_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    columns: [table.fromStageId, table.userId],
    foreignColumns: [prospectStagesTable.id, prospectStagesTable.userId],
    name: "prospect_stage_transitions_from_tenant_fk",
  }),
  foreignKey({
    columns: [table.toStageId, table.userId],
    foreignColumns: [prospectStagesTable.id, prospectStagesTable.userId],
    name: "prospect_stage_transitions_to_tenant_fk",
  }),
  uniqueIndex("prospect_stage_transition_unique").on(table.userId, table.fromStageId, table.toStageId),
  check("prospect_stage_transition_not_self", sql`${table.fromStageId} <> ${table.toStageId}`),
  index("prospect_stage_transitions_from_idx").on(table.userId, table.fromStageId),
]);

export const prospectActionTypesTable = pgTable("prospect_action_types", {
  id: uuid("id").defaultRandom().notNull(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull().default(""),
  active: boolean("active").notNull().default(true),
  displayOrder: smallint("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  primaryKey({ columns: [table.id, table.userId], name: "prospect_action_types_pkey" }),
  uniqueIndex("prospect_action_types_id_unique").on(table.id),
  uniqueIndex("prospect_action_types_user_name_unique").on(table.userId, sql`lower(${table.name})`),
  index("prospect_action_types_user_active_order_idx").on(table.userId, table.active, table.displayOrder),
  check("prospect_action_types_name_nonempty", sql`length(trim(${table.name})) > 0`),
]);

export const prospectsTable = pgTable("prospects", {
  id: uuid("id").defaultRandom().notNull(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  productId: uuid("product_id").notNull(),
  expectedDealValue: numeric("expected_deal_value", { precision: 20, scale: 4 }).notNull(),
  currencyCode: varchar("currency_code", { length: 3 }).notNull(),
  expectedClosureDate: date("expected_closure_date", { mode: "string" }).notNull(),
  currentStageId: uuid("current_stage_id").notNull(),
  currentProbability: smallint("current_probability").notNull(),
  notes: text("notes").notNull(),
  actualClosureDate: date("actual_closure_date", { mode: "string" }),
  closureOutcome: varchar("closure_outcome", { length: 80 }),
  closureRemarks: text("closure_remarks"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  updatedBy: uuid("updated_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  primaryKey({ columns: [table.id, table.userId], name: "prospects_pkey" }),
  uniqueIndex("prospects_id_unique").on(table.id),
  foreignKey({
    columns: [table.contactId, table.userId],
    foreignColumns: [contactsTable.id, contactsTable.userId],
    name: "prospects_contact_tenant_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.productId, table.userId],
    foreignColumns: [prospectProductsTable.id, prospectProductsTable.userId],
    name: "prospects_product_tenant_fk",
  }),
  foreignKey({
    columns: [table.currentStageId, table.userId],
    foreignColumns: [prospectStagesTable.id, prospectStagesTable.userId],
    name: "prospects_stage_tenant_fk",
  }),
  index("prospects_user_active_updated_idx").on(table.userId, table.archivedAt, table.updatedAt),
  index("prospects_contact_idx").on(table.userId, table.contactId, table.archivedAt),
  index("prospects_stage_idx").on(table.userId, table.currentStageId, table.archivedAt),
  index("prospects_close_date_idx").on(table.userId, table.expectedClosureDate),
  check("prospects_name_nonempty", sql`length(trim(${table.name})) > 0`),
  check("prospects_value_nonnegative", sql`${table.expectedDealValue} >= 0`),
  check("prospects_probability_range", sql`${table.currentProbability} between 0 and 100`),
  check("prospects_currency_code", sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
  check("prospects_notes_nonempty", sql`length(trim(${table.notes})) > 0`),
]);

export const prospectStageHistoryTable = pgTable("prospect_stage_history", {
  id: uuid("id").defaultRandom().notNull(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull(),
  eventType: varchar("event_type", { length: 16 }).notNull(),
  previousStageId: uuid("previous_stage_id"),
  newStageId: uuid("new_stage_id").notNull(),
  previousProbability: smallint("previous_probability"),
  newProbability: smallint("new_probability").notNull(),
  reason: text("reason"),
  notesSnapshot: text("notes_snapshot"),
  changedBy: uuid("changed_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.id, table.userId], name: "prospect_stage_history_pkey" }),
  uniqueIndex("prospect_stage_history_id_unique").on(table.id),
  foreignKey({
    columns: [table.prospectId, table.userId],
    foreignColumns: [prospectsTable.id, prospectsTable.userId],
    name: "prospect_stage_history_prospect_tenant_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.previousStageId, table.userId],
    foreignColumns: [prospectStagesTable.id, prospectStagesTable.userId],
    name: "prospect_stage_history_previous_tenant_fk",
  }),
  foreignKey({
    columns: [table.newStageId, table.userId],
    foreignColumns: [prospectStagesTable.id, prospectStagesTable.userId],
    name: "prospect_stage_history_new_tenant_fk",
  }),
  index("prospect_stage_history_prospect_time_idx").on(table.userId, table.prospectId, table.createdAt),
  check("prospect_stage_history_event_type", sql`${table.eventType} in ('created', 'stage_change')`),
  check("prospect_stage_history_probabilities", sql`(${table.previousProbability} is null or ${table.previousProbability} between 0 and 100) and ${table.newProbability} between 0 and 100`),
  check("prospect_stage_history_reason_required", sql`${table.eventType} = 'created' or length(trim(coalesce(${table.reason}, ''))) > 0`),
]);

export const prospectActionsTable = pgTable("prospect_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  prospectId: uuid("prospect_id").notNull(),
  actionTypeId: uuid("action_type_id").notNull(),
  stageHistoryId: uuid("stage_history_id").notNull(),
  actionDate: date("action_date", { mode: "string" }).notNull(),
  notes: text("notes").notNull(),
  recordedBy: uuid("recorded_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    columns: [table.prospectId, table.userId],
    foreignColumns: [prospectsTable.id, prospectsTable.userId],
    name: "prospect_actions_prospect_tenant_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.actionTypeId, table.userId],
    foreignColumns: [prospectActionTypesTable.id, prospectActionTypesTable.userId],
    name: "prospect_actions_type_tenant_fk",
  }),
  foreignKey({
    columns: [table.stageHistoryId, table.userId],
    foreignColumns: [prospectStageHistoryTable.id, prospectStageHistoryTable.userId],
    name: "prospect_actions_stage_period_tenant_fk",
  }).onDelete("restrict"),
  index("prospect_actions_prospect_date_idx").on(table.userId, table.prospectId, table.actionDate),
  index("prospect_actions_stage_period_idx").on(table.userId, table.stageHistoryId, table.actionDate),
  check("prospect_actions_notes_nonempty", sql`length(trim(${table.notes})) > 0`),
]);

export const prospectTagAssignmentsTable = pgTable("prospect_tag_assignments", {
  userId: uuid("user_id").notNull(),
  prospectId: uuid("prospect_id").notNull(),
  tagId: uuid("tag_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({
    columns: [table.prospectId, table.userId],
    foreignColumns: [prospectsTable.id, prospectsTable.userId],
    name: "prospect_tag_assignments_prospect_tenant_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.tagId, table.userId],
    foreignColumns: [contactTagsTable.id, contactTagsTable.userId],
    name: "prospect_tag_assignments_tag_tenant_fk",
  }).onDelete("cascade"),
  uniqueIndex("prospect_tag_assignment_unique").on(table.userId, table.prospectId, table.tagId),
  index("prospect_tag_filter_idx").on(table.userId, table.tagId, table.prospectId),
]);

export const insertProspectProductSchema = createInsertSchema(prospectProductsTable);
export const insertProspectCurrencySchema = createInsertSchema(prospectCurrenciesTable);
export const insertProspectStageSchema = createInsertSchema(prospectStagesTable);
export const insertProspectActionTypeSchema = createInsertSchema(prospectActionTypesTable);
export const insertProspectSchema = createInsertSchema(prospectsTable);
export const insertProspectStageHistorySchema = createInsertSchema(prospectStageHistoryTable);
export const insertProspectActionSchema = createInsertSchema(prospectActionsTable);
export type ProspectProduct = typeof prospectProductsTable.$inferSelect;
export type ProspectCurrency = typeof prospectCurrenciesTable.$inferSelect;
export type ProspectStage = typeof prospectStagesTable.$inferSelect;
export type ProspectStageTransition = typeof prospectStageTransitionsTable.$inferSelect;
export type ProspectActionType = typeof prospectActionTypesTable.$inferSelect;
export type Prospect = typeof prospectsTable.$inferSelect;
export type ProspectStageHistory = typeof prospectStageHistoryTable.$inferSelect;
export type ProspectAction = typeof prospectActionsTable.$inferSelect;
export type ProspectTagAssignment = typeof prospectTagAssignmentsTable.$inferSelect;
