import { index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const apiErrorDiagnosticsTable = pgTable(
  "api_error_diagnostics",
  {
    id: uuid("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 255 }).notNull(),
    statusCode: integer("status_code").notNull(),
    errorName: varchar("error_name", { length: 160 }).notNull(),
    rootErrorName: varchar("root_error_name", { length: 160 }),
    errorCode: varchar("error_code", { length: 40 }),
    databaseSchema: varchar("database_schema", { length: 128 }),
    databaseTable: varchar("database_table", { length: 128 }),
    databaseColumn: varchar("database_column", { length: 128 }),
    databaseConstraint: varchar("database_constraint", { length: 128 }),
    errorMessage: text("error_message"),
    stackTrace: text("stack_trace"),
  },
  (table) => [
    index("api_error_diagnostics_occurred_at_idx").on(table.occurredAt),
    index("api_error_diagnostics_path_idx").on(table.path, table.occurredAt),
  ],
);
