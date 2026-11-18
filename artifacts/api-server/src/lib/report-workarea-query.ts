import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  getField,
  getRelationPlan,
  getReportEntity,
  type ReportAggregationOperation,
  type ReportDataType,
  type ReportDateInterval,
  type ReportField,
  type ReportOperator,
} from "./report-workarea-catalog";

export const MAX_REPORT_COLUMNS = 30;
export const MAX_REPORT_PAGE_SIZE = 100;
export const MAX_REPORT_EXPORT_ROWS = 5000;
export const REPORT_STATEMENT_TIMEOUT_MS = 10_000;

export type ReportColumnDefinition = { fieldId: string; label?: string };
export type ReportFilterCondition = {
  kind: "condition";
  fieldId: string;
  operator: ReportOperator;
  value?: unknown;
  values?: unknown[];
};
export type ReportFilterGroup = {
  kind: "group";
  logic: "and" | "or";
  children: ReportFilterNode[];
};
export type ReportFilterNode = ReportFilterCondition | ReportFilterGroup;

export type ReportDefinition = {
  version: 1;
  baseEntityId: string;
  columns: ReportColumnDefinition[];
  filters?: ReportFilterNode;
  sorting?: Array<{ fieldId: string; direction: "asc" | "desc" }>;
  groupBy?: Array<{ fieldId: string; interval?: ReportDateInterval }>;
  aggregates?: Array<{
    id: string;
    label: string;
    operation: ReportAggregationOperation;
    fieldId?: string;
  }>;
  subtotals?: boolean;
  grandTotal?: boolean;
  visualization?: {
    type: "table" | "kpi" | "bar" | "horizontal_bar" | "line" | "area" | "pie" | "donut";
    categoryFieldId?: string;
    valueFieldId?: string;
  };
};

const reportDefinitionSchema = z.object({
  version: z.literal(1),
  baseEntityId: z.string().min(1).max(80),
  columns: z.array(z.object({
    fieldId: z.string().min(1).max(160),
    label: z.string().max(120).optional(),
  })).max(MAX_REPORT_COLUMNS),
  filters: z.unknown().optional(),
  sorting: z.array(z.object({
    fieldId: z.string().min(1).max(160),
    direction: z.enum(["asc", "desc"]),
  })).max(4).optional(),
  groupBy: z.array(z.object({
    fieldId: z.string().min(1).max(160),
    interval: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
  })).max(4).optional(),
  aggregates: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/),
    label: z.string().trim().min(1).max(100),
    operation: z.enum(["count", "count_distinct", "sum", "avg", "min", "max", "win_rate"]),
    fieldId: z.string().min(1).max(160).optional(),
  })).max(8).optional(),
  subtotals: z.boolean().optional(),
  grandTotal: z.boolean().optional(),
  visualization: z.object({
    type: z.enum(["table", "kpi", "bar", "horizontal_bar", "line", "area", "pie", "donut"]),
    categoryFieldId: z.string().min(1).max(160).optional(),
    valueFieldId: z.string().min(1).max(160).optional(),
  }).optional(),
}).passthrough();

const filterGroupShape = z.object({
  kind: z.literal("group"),
  logic: z.enum(["and", "or"]),
  children: z.array(z.unknown()).max(25),
});
const filterConditionShape = z.object({
  kind: z.literal("condition"),
  fieldId: z.string().min(1).max(160),
  operator: z.string().min(1).max(40),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).max(50).optional(),
});

export class ReportDefinitionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 422 = 400,
  ) {
    super(message);
    this.name = "ReportDefinitionError";
  }
}

export class ReportExportLimitError extends Error {
  constructor(public readonly maximumRows: number) {
    super(`This export exceeds the ${maximumRows.toLocaleString()} row limit. Add filters to narrow the report.`);
    this.name = "ReportExportLimitError";
  }
}

type ValidatedDefinition = Omit<
  ReportDefinition,
  "columns" | "sorting" | "filters" | "groupBy" | "aggregates"
> & {
  filters?: unknown;
  columns: Array<ReportColumnDefinition & { field: ReportField }>;
  sorting: Array<{ fieldId: string; direction: "asc" | "desc"; field: ReportField }>;
  groupBy: Array<{
    fieldId: string;
    interval?: ReportDateInterval;
    field: ReportField;
    implicitCurrency: boolean;
  }>;
  aggregates: Array<{
    id: string;
    label: string;
    operation: ReportAggregationOperation;
    fieldId?: string;
    field?: ReportField;
  }>;
  currencyGroupFieldId?: string;
  filterSql?: SQL;
  entity: NonNullable<ReturnType<typeof getReportEntity>>;
  joins: ReturnType<typeof getRelationPlan>;
};

function parseTextValue(value: unknown, fieldLabel: string): string {
  if (typeof value !== "string" || value.length > 500) {
    throw new ReportDefinitionError(`Enter a text value of 500 characters or fewer for ${fieldLabel}.`);
  }
  return value;
}

function parseNumericValue(value: unknown, fieldLabel: string): string {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !/^-?\d{1,16}(?:\.\d{1,8})?$/.test(text)) {
    throw new ReportDefinitionError(`Enter a valid number for ${fieldLabel}.`);
  }
  return text;
}

function parseDateValue(value: unknown, fieldLabel: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ReportDefinitionError(`Choose a valid date for ${fieldLabel}.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ReportDefinitionError(`Choose a valid date for ${fieldLabel}.`);
  }
  return value;
}

function parseDateTimeValue(value: unknown, fieldLabel: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ReportDefinitionError(`Choose a valid date and time for ${fieldLabel}.`);
  }
  return new Date(value).toISOString();
}

function parseValue(field: ReportField, value: unknown): string | boolean {
  switch (field.dataType) {
    case "number":
    case "currency":
      return parseNumericValue(value, field.label);
    case "date":
      return parseDateValue(value, field.label);
    case "datetime":
      return parseDateTimeValue(value, field.label);
    case "boolean":
      if (typeof value !== "boolean") {
        throw new ReportDefinitionError(`Choose true or false for ${field.label}.`);
      }
      return value;
    default:
      return parseTextValue(value, field.label);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildConditionSql(
  field: ReportField,
  operator: ReportOperator,
  node: ReportFilterCondition,
): SQL {
  const expression = field.expression as SQLWrapper;
  if (!field.operators.includes(operator)) {
    throw new ReportDefinitionError(`The "${operator.replaceAll("_", " ")}" filter is not available for ${field.label}.`);
  }
  if (operator === "is_empty") {
    return field.dataType === "text"
      ? sql`(${expression} is null or ${expression} = '')`
      : sql`${expression} is null`;
  }
  if (operator === "is_not_empty") {
    return field.dataType === "text"
      ? sql`(${expression} is not null and ${expression} <> '')`
      : sql`${expression} is not null`;
  }
  if (operator === "is_true") return sql`${expression} is true`;
  if (operator === "is_false") return sql`${expression} is false`;

  if (operator === "in") {
    if (!Array.isArray(node.values) || node.values.length < 1 || node.values.length > 50) {
      throw new ReportDefinitionError(`Choose between 1 and 50 values for ${field.label}.`);
    }
    const values = node.values.map((value) => parseValue(field, value));
    const parameters = sql.join(values.map((value) => sql`${value}`), sql`, `);
    return sql`${expression} in (${parameters})`;
  }

  if (operator === "between") {
    if (!Array.isArray(node.values) || node.values.length !== 2) {
      throw new ReportDefinitionError(`Enter both range values for ${field.label}.`);
    }
    const [lower, upper] = node.values.map((value) => parseValue(field, value));
    return sql`${expression} between ${lower} and ${upper}`;
  }

  const value = parseValue(field, node.value);
  switch (operator) {
    case "contains":
      return sql`${expression} ilike ${`%${escapeLike(String(value))}%`}`;
    case "not_contains":
      return sql`${expression} not ilike ${`%${escapeLike(String(value))}%`}`;
    case "starts_with":
      return sql`${expression} ilike ${`${escapeLike(String(value))}%`}`;
    case "ends_with":
      return sql`${expression} ilike ${`%${escapeLike(String(value))}`}`;
    case "equals":
      return sql`${expression} = ${value}`;
    case "not_equals":
      return sql`${expression} <> ${value}`;
    case "greater_than":
      return sql`${expression} > ${value}`;
    case "greater_or_equal":
      return sql`${expression} >= ${value}`;
    case "less_than":
      return sql`${expression} < ${value}`;
    case "less_or_equal":
      return sql`${expression} <= ${value}`;
    default:
      throw new ReportDefinitionError("Choose a valid filter operator.");
  }
}

function compileFilterNode(
  rawNode: unknown,
  getFieldById: (fieldId: string) => ReportField | undefined,
  depth: number,
  counter: { count: number },
): SQL | undefined {
  if (depth > 5) {
    throw new ReportDefinitionError("Filter groups can be nested up to five levels.");
  }
  const groupResult = filterGroupShape.safeParse(rawNode);
  if (groupResult.success) {
    if (groupResult.data.children.length === 0) return undefined;
    const children = groupResult.data.children
      .map((child) => compileFilterNode(child, getFieldById, depth + 1, counter))
      .filter((child): child is SQL => Boolean(child));
    if (children.length === 0) return undefined;
    return groupResult.data.logic === "and" ? and(...children)! : sql`(${sql.join(children, sql` or `)})`;
  }

  const conditionResult = filterConditionShape.safeParse(rawNode);
  if (!conditionResult.success) {
    throw new ReportDefinitionError("One or more report filters are invalid.");
  }
  counter.count += 1;
  if (counter.count > 50) {
    throw new ReportDefinitionError("A report can contain up to 50 filter conditions.");
  }
  const field = getFieldById(conditionResult.data.fieldId);
  if (!field) {
    throw new ReportDefinitionError("A selected filter field is not available for this report.", 422);
  }
  return buildConditionSql(
    field,
    conditionResult.data.operator as ReportOperator,
    conditionResult.data as ReportFilterCondition,
  );
}

export function validateReportDefinition(raw: unknown): ValidatedDefinition {
  const parsed = reportDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReportDefinitionError("The report definition is incomplete or invalid.");
  }
  const input = parsed.data;
  const entity = getReportEntity(input.baseEntityId);
  if (!entity) {
    throw new ReportDefinitionError("Choose an available report source.");
  }
  const selectedIds = new Set<string>();
  const columns = input.columns.map((column) => {
    if (selectedIds.has(column.fieldId)) {
      throw new ReportDefinitionError("The same field cannot be added more than once.");
    }
    selectedIds.add(column.fieldId);
    const field = getField(entity, column.fieldId);
    if (!field) {
      throw new ReportDefinitionError(`The field "${column.fieldId}" is no longer available in this report.`, 422);
    }
    return { ...column, field };
  });
  const userGroupFields = input.groupBy ?? [];
  const seenGroupFields = new Set<string>();
  const groupBy = userGroupFields.map((group) => {
    if (seenGroupFields.has(group.fieldId)) {
      throw new ReportDefinitionError("A report can group by each field only once.");
    }
    seenGroupFields.add(group.fieldId);
    const field = getField(entity, group.fieldId);
    if (!field) {
      throw new ReportDefinitionError(`The grouping field "${group.fieldId}" is no longer available.`, 422);
    }
    if (!field.groupable) {
      throw new ReportDefinitionError(`${field.label} cannot be used as a grouping field.`);
    }
    if (group.interval && !field.dateIntervals.includes(group.interval)) {
      throw new ReportDefinitionError(`Choose a supported date interval for ${field.label}.`);
    }
    if (field.dateIntervals.length > 0 && !group.interval) {
      throw new ReportDefinitionError(`Choose a date interval for ${field.label}.`);
    }
    if (field.dateIntervals.length === 0 && group.interval) {
      throw new ReportDefinitionError(`Date intervals do not apply to ${field.label}.`);
    }
    return { ...group, field, implicitCurrency: false };
  });

  const aggregateIds = new Set<string>();
  const aggregates = (input.aggregates ?? []).map((aggregate) => {
    if (aggregateIds.has(aggregate.id)) {
      throw new ReportDefinitionError("Each summary measure needs a unique identifier.");
    }
    aggregateIds.add(aggregate.id);
    if (aggregate.operation !== "count" && !aggregate.fieldId) {
      throw new ReportDefinitionError(`Choose a field for ${aggregate.label}.`);
    }
    const field = aggregate.fieldId ? getField(entity, aggregate.fieldId) : undefined;
    if (aggregate.fieldId && !field) {
      throw new ReportDefinitionError(`The measure field "${aggregate.fieldId}" is no longer available.`, 422);
    }
    if (field && !field.aggregations.includes(aggregate.operation as ReportAggregationOperation)) {
      throw new ReportDefinitionError(`${aggregate.operation.toUpperCase()} is not available for ${field.label}.`);
    }
    return {
      ...aggregate,
      operation: aggregate.operation as ReportAggregationOperation,
      ...(field ? { field } : {}),
    };
  });
  if (groupBy.length > 0 && aggregates.length === 0) {
    throw new ReportDefinitionError("Add at least one summary measure when grouping records.");
  }
  if (groupBy.length === 0 && aggregates.length === 0 && columns.length === 0) {
    throw new ReportDefinitionError("Add at least one column or summary measure.");
  }

  const currencyFieldIds = Array.from(new Set(
    aggregates
      .map((aggregate) => aggregate.field?.currencyGroupFieldId)
      .filter((fieldId): fieldId is string => Boolean(fieldId)),
  ));
  if (currencyFieldIds.length > 1) {
    throw new ReportDefinitionError("Measures using different currencies cannot be combined in one summary.");
  }
  const currencyGroupFieldId = currencyFieldIds[0];
  if (currencyGroupFieldId) {
    const existingCurrencyIndex = groupBy.findIndex((group) => group.fieldId === currencyGroupFieldId);
    if (existingCurrencyIndex >= 0) {
      const [currencyGroup] = groupBy.splice(existingCurrencyIndex, 1);
      groupBy.unshift(currencyGroup);
    } else {
      const field = getField(entity, currencyGroupFieldId);
      if (!field) {
        throw new ReportDefinitionError("The currency field needed to keep totals separate is unavailable.", 422);
      }
      groupBy.unshift({
        fieldId: field.id,
        field,
        implicitCurrency: true,
      });
    }
  }
  if ((groupBy.length > 0 || aggregates.length > 0) && input.sorting?.some(
    (sort) => !groupBy.some((group) => group.fieldId === sort.fieldId),
  )) {
    throw new ReportDefinitionError("Summary reports can be sorted by a grouping field.");
  }
  const visualization = input.visualization;
  if (visualization && visualization.type !== "table") {
    const allowedValueIds = new Set(aggregates.map((aggregate) => `aggregate:${aggregate.id}`));
    if (!visualization.valueFieldId || !allowedValueIds.has(visualization.valueFieldId)) {
      throw new ReportDefinitionError("Choose a measure from this report for the chart value.");
    }
    if (visualization.type === "kpi") {
      if (input.grandTotal === false) {
        throw new ReportDefinitionError("Enable grand totals to show a KPI value.");
      }
    } else {
      const allowedCategoryIds = new Set(groupBy.map((group) => `group:${group.fieldId}`));
      if (!visualization.categoryFieldId || !allowedCategoryIds.has(visualization.categoryFieldId)) {
        throw new ReportDefinitionError("Choose a grouping field from this report for the chart categories.");
      }
    }
  }

  const sorting = (input.sorting ?? []).map((item) => {
    const field = getField(entity, item.fieldId);
    if (!field) {
      throw new ReportDefinitionError("A selected sort field is not available for this report.", 422);
    }
    return { ...item, field };
  });
  const filterCounter = { count: 0 };
  const filterSql = input.filters
    ? compileFilterNode(input.filters, (id) => getField(entity, id), 0, filterCounter)
    : undefined;
  const relationFieldIds = [
    ...columns.map((column) => column.field.id),
    ...groupBy.map((group) => group.field.id),
    ...aggregates.flatMap((aggregate) => aggregate.field ? [aggregate.field.id] : []),
    ...sorting.map((item) => item.field.id),
    ...Array.from(getFilterFieldIds(input.filters)),
  ];
  return {
    ...input,
    columns,
    sorting,
    groupBy,
    aggregates,
    currencyGroupFieldId,
    entity,
    joins: getRelationPlan(entity, relationFieldIds),
    ...(filterSql ? { filterSql } : {}),
  };
}

function normalizeFilterNode(rawNode: unknown): ReportFilterNode | undefined {
  if (!rawNode || typeof rawNode !== "object") return undefined;
  const record = rawNode as Record<string, unknown>;
  if (record.kind === "group" && (record.logic === "and" || record.logic === "or") && Array.isArray(record.children)) {
    return {
      kind: "group",
      logic: record.logic,
      children: record.children
        .map(normalizeFilterNode)
        .filter((child): child is ReportFilterNode => Boolean(child)),
    };
  }
  if (
    record.kind === "condition"
    && typeof record.fieldId === "string"
    && typeof record.operator === "string"
  ) {
    return {
      kind: "condition",
      fieldId: record.fieldId,
      operator: record.operator as ReportOperator,
      ...(Object.hasOwn(record, "value") ? { value: record.value } : {}),
      ...(Array.isArray(record.values) ? { values: record.values } : {}),
    };
  }
  return undefined;
}

export function normalizeReportDefinition(raw: unknown): ReportDefinition {
  const validated = validateReportDefinition(raw);
  return {
    version: 1,
    baseEntityId: validated.entity.id,
    columns: validated.columns.map(({ fieldId, label }) => ({
      fieldId,
      ...(label ? { label } : {}),
    })),
    ...(validated.filters ? { filters: normalizeFilterNode(validated.filters) } : {}),
    ...(validated.sorting.length > 0
      ? {
          sorting: validated.sorting.map(({ fieldId, direction }) => ({
            fieldId,
            direction,
          })),
        }
      : {}),
    ...(validated.groupBy.some((group) => !group.implicitCurrency)
      ? {
          groupBy: validated.groupBy
            .filter((group) => !group.implicitCurrency)
            .map(({ fieldId, interval }) => ({
              fieldId,
              ...(interval ? { interval } : {}),
            })),
        }
      : {}),
    ...(validated.aggregates.length > 0
      ? {
          aggregates: validated.aggregates.map(({ id, label, operation, fieldId }) => ({
            id,
            label,
            operation,
            ...(fieldId ? { fieldId } : {}),
          })),
        }
      : {}),
    ...(typeof validated.subtotals === "boolean" ? { subtotals: validated.subtotals } : {}),
    ...(typeof validated.grandTotal === "boolean" ? { grandTotal: validated.grandTotal } : {}),
    ...(validated.visualization ? { visualization: { ...validated.visualization } } : {}),
  };
}

function getFilterFieldIds(rawNode: unknown, ids = new Set<string>()): Set<string> {
  if (!rawNode || typeof rawNode !== "object") return ids;
  const record = rawNode as Record<string, unknown>;
  if (record.kind === "condition" && typeof record.fieldId === "string") {
    ids.add(record.fieldId);
  } else if (record.kind === "group" && Array.isArray(record.children)) {
    for (const child of record.children) getFilterFieldIds(child, ids);
  }
  return ids;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "bigint") return value.toString();
  return value;
}

function buildBaseQuery(
  executor: any,
  validated: ValidatedDefinition,
  userId: string,
  selection: Record<string, SQLWrapper>,
): any {
  let query: any = executor.select(selection).from(validated.entity.table as any);
  for (const join of validated.joins) {
    query = query.leftJoin(join.table as any, join.on!);
  }
  const tenantFilter = eq(validated.entity.tenantColumn as any, userId);
  query = query.where(validated.filterSql ? and(tenantFilter, validated.filterSql) : tenantFilter);
  return query;
}

function buildGroupExpression(
  group: ValidatedDefinition["groupBy"][number],
  timeZone: string,
): SQLWrapper {
  if (!group.interval) return group.field.expression;
  const intervalSql = sql.raw(`'${group.interval}'`);
  if (group.field.dataType === "date") {
    return sql`date_trunc(${intervalSql}, (${group.field.expression})::timestamp)`;
  }
  const timeZoneSql = sql.raw(`'${timeZone.replaceAll("'", "''")}'`);
  return sql`date_trunc(${intervalSql}, timezone(${timeZoneSql}, ${group.field.expression}))`;
}

function buildAggregateExpression(
  aggregate: ValidatedDefinition["aggregates"][number],
): SQLWrapper {
  const field = aggregate.field?.expression;
  switch (aggregate.operation) {
    case "count":
      return field ? sql`count(${field})::bigint` : sql`count(*)::bigint`;
    case "count_distinct":
      if (!field) throw new ReportDefinitionError(`Choose a field for ${aggregate.label}.`);
      return sql`count(distinct ${field})::bigint`;
    case "sum":
      if (!field) throw new ReportDefinitionError(`Choose a field for ${aggregate.label}.`);
      return sql`sum(${field})`;
    case "avg":
      if (!field) throw new ReportDefinitionError(`Choose a field for ${aggregate.label}.`);
      return sql`avg(${field})`;
    case "min":
      if (!field) throw new ReportDefinitionError(`Choose a field for ${aggregate.label}.`);
      return sql`min(${field})`;
    case "max":
      if (!field) throw new ReportDefinitionError(`Choose a field for ${aggregate.label}.`);
      return sql`max(${field})`;
    case "win_rate":
      if (aggregate.fieldId !== "prospects.stage.outcome" || !field) {
        throw new ReportDefinitionError("The Win rate measure is available only for prospect terminal outcomes.");
      }
      return sql`(
        100.0 * count(*) filter (where lower(coalesce(${field}, '')) = 'won')
        / nullif(count(*) filter (where lower(coalesce(${field}, '')) in ('won', 'lost')), 0)
      )`;
  }
}

function getGroupingSets(validated: ValidatedDefinition): number[][] {
  const dimensionCount = validated.groupBy.length;
  if (!dimensionCount) return [[]];
  const full = Array.from({ length: dimensionCount }, (_, index) => index);
  const sets: number[][] = [full];
  if (validated.subtotals) {
    for (let length = dimensionCount - 1; length >= 1; length -= 1) {
      sets.push(Array.from({ length }, (_, index) => index));
    }
  }
  if (validated.grandTotal !== false) {
    if (validated.currencyGroupFieldId) {
      const currencyIndex = validated.groupBy.findIndex(
        (group) => group.fieldId === validated.currencyGroupFieldId,
      );
      sets.push(currencyIndex >= 0 ? [currencyIndex] : []);
    } else {
      sets.push([]);
    }
  }
  const seen = new Set<string>();
  return sets.filter((set) => {
    const key = set.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getGroupedResultColumns(validated: ValidatedDefinition) {
  const rowLabel = {
    fieldId: "_summaryLabel",
    label: "Summary level",
    dataType: "text" as const,
  };
  const groups = validated.groupBy.map((group) => ({
    fieldId: `group:${group.fieldId}`,
    label: group.interval
      ? `${group.field.label} (${group.interval})`
      : group.field.label,
    dataType: group.interval ? "date" as const : group.field.dataType,
  }));
  const aggregates = validated.aggregates.map((aggregate) => {
    let dataType: ReportDataType = "number";
    if (aggregate.operation !== "count" && aggregate.operation !== "count_distinct") {
      dataType = aggregate.operation === "win_rate" ? "number" : aggregate.field?.dataType ?? "number";
      if (aggregate.operation === "sum" || aggregate.operation === "avg") {
        if (aggregate.field?.dataType !== "currency") dataType = "number";
      }
    }
    return {
      fieldId: `aggregate:${aggregate.id}`,
      label: aggregate.label,
      dataType,
    };
  });
  return [rowLabel, ...groups, ...aggregates];
}

function groupingMaskValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getGroupedRowType(
  validated: ValidatedDefinition,
  groupingMask: number,
): { rowType: "detail" | "subtotal" | "grand_total" | "currency_total"; groupingLevel: number } {
  const count = validated.groupBy.length;
  if (count === 0) return { rowType: "grand_total", groupingLevel: 0 };
  const presentIndexes = validated.groupBy.flatMap((_, index) => {
    const bit = 1 << (count - index - 1);
    return (groupingMask & bit) === 0 ? [index] : [];
  });
  const userGroupCount = validated.groupBy.filter((group) => !group.implicitCurrency).length;
  if (
    validated.currencyGroupFieldId
    && presentIndexes.length === 1
    && validated.groupBy[presentIndexes[0]]?.fieldId === validated.currencyGroupFieldId
  ) {
    return { rowType: "currency_total", groupingLevel: 0 };
  }
  if (presentIndexes.length === count) {
    return { rowType: "detail", groupingLevel: userGroupCount };
  }
  if (presentIndexes.length === 0) {
    return { rowType: "grand_total", groupingLevel: 0 };
  }
  return {
    rowType: "subtotal",
    groupingLevel: presentIndexes.filter((index) => !validated.groupBy[index]?.implicitCurrency).length,
  };
}

async function executeGroupedReport(
  userId: string,
  validated: ValidatedDefinition,
  options: { page: number; pageSize: number; timeZone: string },
) {
  const groupExpressions = validated.groupBy.map((group) => buildGroupExpression(group, options.timeZone));
  const groupSets = getGroupingSets(validated);
  const aggregateExpressions = validated.aggregates.map((aggregate, index) =>
    buildAggregateExpression(aggregate),
  );
  const groupingMaskExpression = groupExpressions.length
    ? sql`grouping(${sql.join(groupExpressions, sql`, `)})`
    : sql`0`;
  const groupClause = groupExpressions.length
    ? sql`GROUPING SETS (${sql.join(
        groupSets.map((set) => sql`(${sql.join(
          set.map((index) => groupExpressions[index]),
          sql`, `,
        )})`),
        sql`, `,
      )})`
    : sql``;
  const selection: Record<string, SQLWrapper> = {};
  groupExpressions.forEach((expression, index) => {
    selection[`rw_group_${index}`] = sql`${expression}`.as(`rw_group_${index}`);
  });
  aggregateExpressions.forEach((expression, index) => {
    selection[`rw_aggregate_${index}`] = sql`${expression}`.as(`rw_aggregate_${index}`);
  });
  selection.rw_grouping_mask = sql`${groupingMaskExpression}`.as("rw_grouping_mask");
  const orderExpressions: SQL[] = [
    sql.raw(`"rw_grouping_mask" ${validated.visualization?.type === "kpi" ? "desc" : "asc"}`),
  ];
  const explicitSorts = validated.sorting.length
    ? validated.sorting
    : validated.groupBy.map((group) => ({ fieldId: group.fieldId, direction: "asc" as const }));
  for (const sort of explicitSorts) {
    const groupIndex = validated.groupBy.findIndex((group) => group.fieldId === sort.fieldId);
    if (groupIndex >= 0) {
      orderExpressions.push(
        sql.raw(`"rw_group_${groupIndex}" ${sort.direction === "desc" ? "desc" : "asc"} nulls last`),
      );
    }
  }
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    await transaction.execute(sql`select set_config('statement_timeout', ${`${REPORT_STATEMENT_TIMEOUT_MS}ms`}, true)`);

    let groupedQuery = buildBaseQuery(transaction, validated, userId, selection);
    if (groupExpressions.length) groupedQuery = groupedQuery.groupBy(groupClause);
    const groupedCountQuery = sql`
      SELECT count(*)::int as "reportCount"
      FROM (${groupedQuery.getSQL()}) as "report_groups"
    `;
    const countResult = await transaction.execute(groupedCountQuery);
    const totalRows = Number(countResult.rows[0]?.reportCount ?? 0);

    const offset = (options.page - 1) * options.pageSize;
    const rowQuery = groupedQuery
      .orderBy(...orderExpressions)
      .limit(options.pageSize)
      .offset(offset);
    const rowsResult = await rowQuery as Array<Record<string, unknown>>;
    const columns = getGroupedResultColumns(validated);
    const rows = rowsResult.map((row) => {
      const groupingMask = groupingMaskValue(row.rw_grouping_mask);
      const rowType = getGroupedRowType(validated, groupingMask);
      const output: Record<string, unknown> = {
        _rowType: rowType.rowType,
        _groupingLevel: rowType.groupingLevel,
        _summaryLabel: rowType.rowType === "detail"
          ? "Detail"
          : rowType.rowType === "subtotal"
            ? "Subtotal"
            : rowType.rowType === "currency_total"
              ? "Currency total"
              : "Grand total",
      };
      validated.groupBy.forEach((group, index) => {
        output[`group:${group.fieldId}`] = normalizeValue(row[`rw_group_${index}`]);
      });
      validated.aggregates.forEach((aggregate, index) => {
        output[`aggregate:${aggregate.id}`] = normalizeValue(row[`rw_aggregate_${index}`]);
      });
      return output;
    });

    const dimensions = validated.groupBy
      .map((group) => group.interval
        ? `${group.field.label} by ${group.interval}`
        : group.field.label)
      .join(", ");
    return {
      columns,
      rows,
      totalRows,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: totalRows === 0 ? 0 : Math.ceil(totalRows / options.pageSize),
      grain: dimensions
        ? `Summary grouped by ${dimensions}`
        : "Summary for the filtered records",
    };
  });
}

async function executeReport(
  userId: string,
  rawDefinition: unknown,
  options: { page: number; pageSize: number; timeZone: string },
) {
  const validated = validateReportDefinition(rawDefinition);
  if (validated.groupBy.length > 0 || validated.aggregates.length > 0) {
    return executeGroupedReport(userId, validated, options);
  }
  if (validated.columns.length === 0) {
    throw new ReportDefinitionError("Add at least one column to a detailed report.");
  }
  const columns = validated.columns.map((column) => ({
    fieldId: column.field.id,
    label: column.label?.trim() || column.field.label,
    dataType: column.field.dataType as ReportDataType,
  }));
  const selection = Object.fromEntries(
    validated.columns.map((column, index) => [`field${index}`, column.field.expression]),
  ) as Record<string, SQLWrapper>;

  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    await transaction.execute(sql`select set_config('statement_timeout', ${`${REPORT_STATEMENT_TIMEOUT_MS}ms`}, true)`);

    const countQuery = buildBaseQuery(transaction, validated, userId, {
      reportCount: sql<number>`count(*)::int`,
    });
    const countRows = await countQuery as Array<{ reportCount: number | string }>;
    const totalRows = Number(countRows[0]?.reportCount ?? 0);

    const orderBy = validated.sorting.map((item) =>
      item.direction === "asc" ? asc(item.field.expression as any) : desc(item.field.expression as any),
    );
    orderBy.push(asc(validated.entity.primaryKey as any));
    const offset = (options.page - 1) * options.pageSize;
    const rows = await buildBaseQuery(transaction, validated, userId, selection)
      .orderBy(...orderBy)
      .limit(options.pageSize)
      .offset(offset) as Array<Record<string, unknown>>;

    return {
      columns,
      rows: rows.map((row) => Object.fromEntries(
        validated.columns.map((column, index) => [
          column.field.id,
          normalizeValue(row[`field${index}`]),
        ]),
      )),
      totalRows,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: totalRows === 0 ? 0 : Math.ceil(totalRows / options.pageSize),
      grain: validated.entity.grain,
    };
  });
}

export function runReport(
  userId: string,
  rawDefinition: unknown,
  options: { page?: number; pageSize?: number; timeZone?: string } = {},
) {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new ReportDefinitionError("Choose a valid report page.");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_REPORT_PAGE_SIZE) {
    throw new ReportDefinitionError(`Choose between 1 and ${MAX_REPORT_PAGE_SIZE} rows per page.`);
  }
  const timeZone = options.timeZone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  } catch {
    throw new ReportDefinitionError("The workspace time zone is not valid. Update it in your profile.");
  }
  return executeReport(userId, rawDefinition, { page, pageSize, timeZone });
}

export async function exportReport(
  userId: string,
  rawDefinition: unknown,
  timeZone = "UTC",
) {
  const result = await executeReport(userId, rawDefinition, {
    page: 1,
    pageSize: MAX_REPORT_EXPORT_ROWS + 1,
    timeZone,
  });
  if (result.totalRows > MAX_REPORT_EXPORT_ROWS) {
    throw new ReportExportLimitError(MAX_REPORT_EXPORT_ROWS);
  }
  return result;
}

export function formatReportCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function protectSpreadsheetFormula(value: string): string {
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
}
