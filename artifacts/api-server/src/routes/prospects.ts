import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  contactTagAssignmentsTable,
  contactTagsTable,
  companiesTable,
  contactsTable,
  db,
  prospectActionTypesTable,
  prospectActionsTable,
  prospectCurrenciesTable,
  prospectProductsTable,
  prospectStageHistoryTable,
  prospectStageTransitionsTable,
  prospectStagesTable,
  prospectTagAssignmentsTable,
  prospectValueHistoryTable,
  prospectsTable,
  usersTable,
} from "@workspace/db";
import {
  ChangeProspectStageBody,
  ChangeProspectStageParams,
  ChangeProspectStageResponse,
  CreateProspectActionBody,
  CreateProspectActionParams,
  CreateProspectActionResponse,
  CreateProspectBody,
  CreateProspectResponse,
  GetProspectDashboardResponse,
  GetProspectParams,
  GetProspectResponse,
  GetProspectValueHistoryParams,
  GetProspectValueHistoryResponse,
  ListContactProspectsParams,
  ListContactProspectsResponse,
  ListProspectActionsParams,
  ListProspectActionsQueryParams,
  ListProspectActionsResponse,
  ListProspectGrowthAuditParams,
  ListProspectGrowthAuditResponse,
  ListProspectsQueryParams,
  ListProspectsResponse,
  SetProspectTagsBody,
  SetProspectTagsParams,
  SetProspectTagsResponse,
  UpdateProspectBody,
  UpdateProspectParams,
  UpdateProspectResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { readContactTags } from "../lib/contact-tags";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();
const auditActor = alias(usersTable, "prospect_audit_actor");
const valueAuditActor = alias(usersTable, "prospect_value_audit_actor");
const actionActor = alias(usersTable, "prospect_action_actor");

type ProspectFilterInput = ReturnType<typeof ListProspectsQueryParams.parse>;

function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function canonicalDealValue(value: number | string): string {
  return Number(value).toFixed(4);
}

function normalizeDateQuery(query: Record<string, unknown>, names: string[]) {
  const normalized = { ...query };
  for (const name of names) {
    const value = normalized[name];
    if (typeof value === "string") normalized[name] = new Date(`${value}T00:00:00.000Z`);
  }
  return normalized;
}

function mapBy<T, K extends string | number>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const current = result.get(key) ?? [];
    current.push(item);
    result.set(key, current);
  }
  return result;
}

async function readTenantStages(userId: string) {
  const [stages, transitions] = await Promise.all([
    db.select().from(prospectStagesTable)
      .where(eq(prospectStagesTable.userId, userId))
      .orderBy(asc(prospectStagesTable.displayOrder), asc(prospectStagesTable.name)),
    db.select({
      fromStageId: prospectStageTransitionsTable.fromStageId,
      toStageId: prospectStageTransitionsTable.toStageId,
    }).from(prospectStageTransitionsTable)
      .where(eq(prospectStageTransitionsTable.userId, userId)),
  ]);
  const transitionsByStage = mapBy(transitions, transition => transition.fromStageId);
  return new Map(stages.map(stage => [stage.id, {
    id: stage.id,
    name: stage.name,
    description: stage.description,
    probability: stage.probability,
    stageType: stage.stageType,
    terminalOutcome: stage.terminalOutcome,
    displayOrder: stage.displayOrder,
    active: stage.active,
    allowedNextStageIds: (transitionsByStage.get(stage.id) ?? []).map(item => item.toStageId),
  }]));
}

async function readProspectTags(userId: string, prospectIds: string[]) {
  const result = new Map<string, { id: string; name: string }[]>();
  if (!prospectIds.length) return result;
  const rows = await db.select({
    prospectId: prospectTagAssignmentsTable.prospectId,
    id: contactTagsTable.id,
    name: contactTagsTable.name,
  }).from(prospectTagAssignmentsTable)
    .innerJoin(contactTagsTable, and(
      eq(contactTagsTable.id, prospectTagAssignmentsTable.tagId),
      eq(contactTagsTable.userId, prospectTagAssignmentsTable.userId),
    ))
    .where(and(
      eq(prospectTagAssignmentsTable.userId, userId),
      inArray(prospectTagAssignmentsTable.prospectId, prospectIds),
    )).orderBy(asc(contactTagsTable.name));
  for (const row of rows) {
    const tags = result.get(row.prospectId) ?? [];
    tags.push({ id: row.id, name: row.name });
    result.set(row.prospectId, tags);
  }
  return result;
}

const historyLatest = db.select({
  userId: prospectStageHistoryTable.userId,
  prospectId: prospectStageHistoryTable.prospectId,
  activityAt: max(prospectStageHistoryTable.createdAt).as("history_activity_at"),
}).from(prospectStageHistoryTable)
  .groupBy(prospectStageHistoryTable.userId, prospectStageHistoryTable.prospectId)
  .as("prospect_history_latest");
const actionLatest = db.select({
  userId: prospectActionsTable.userId,
  prospectId: prospectActionsTable.prospectId,
  activityAt: max(prospectActionsTable.createdAt).as("action_activity_at"),
}).from(prospectActionsTable)
  .groupBy(prospectActionsTable.userId, prospectActionsTable.prospectId)
  .as("prospect_action_latest");
const activityAtSql = sql<Date | null>`coalesce(greatest(${historyLatest.activityAt}, ${actionLatest.activityAt}), ${prospectsTable.updatedAt})`;

function buildFilters(userId: string, filters: ProspectFilterInput) {
  const conditions = [eq(prospectsTable.userId, userId)];
  if (!filters.includeArchived) conditions.push(isNull(prospectsTable.archivedAt));
  if (filters.stageId) conditions.push(eq(prospectsTable.currentStageId, filters.stageId));
  if (filters.productId) conditions.push(eq(prospectsTable.productId, filters.productId));
  if (filters.companyId) conditions.push(eq(contactsTable.companyId, filters.companyId));
  if (filters.currencyCode) conditions.push(eq(prospectsTable.currencyCode, filters.currencyCode));
  if (filters.closeFrom) conditions.push(gte(prospectsTable.expectedClosureDate, dateOnly(filters.closeFrom)));
  if (filters.closeTo) conditions.push(lte(prospectsTable.expectedClosureDate, dateOnly(filters.closeTo)));
  if (filters.search?.trim()) {
    const query = `%${filters.search.trim()}%`;
    conditions.push(or(
      ilike(prospectsTable.name, query),
      ilike(contactsTable.name, query),
      ilike(contactsTable.email, query),
      ilike(contactsTable.companyName, query),
      inArray(contactsTable.companyId, db.select({ id: companiesTable.id }).from(companiesTable).where(and(
        eq(companiesTable.userId, userId),
        ilike(companiesTable.companyName, query),
      ))),
      ilike(prospectProductsTable.name, query),
    )!);
  }
  if (filters.contactTagId) {
    const matchingContacts = db.select({ contactId: contactTagAssignmentsTable.contactId })
      .from(contactTagAssignmentsTable).where(and(
        eq(contactTagAssignmentsTable.userId, userId),
        eq(contactTagAssignmentsTable.tagId, filters.contactTagId),
      ));
    conditions.push(inArray(prospectsTable.contactId, matchingContacts));
  }
  if (filters.prospectTagId) {
    const matchingProspects = db.select({ prospectId: prospectTagAssignmentsTable.prospectId })
      .from(prospectTagAssignmentsTable).where(and(
        eq(prospectTagAssignmentsTable.userId, userId),
        eq(prospectTagAssignmentsTable.tagId, filters.prospectTagId),
      ));
    conditions.push(inArray(prospectsTable.id, matchingProspects));
  }
  if (filters.status === "active") {
    conditions.push(eq(prospectStagesTable.stageType, "active"));
  } else if (filters.status === "won") {
    conditions.push(and(
      eq(prospectStagesTable.stageType, "terminal"),
      sql`lower(${prospectStagesTable.terminalOutcome}) = 'won'`,
    )!);
  } else if (filters.status === "lost") {
    conditions.push(and(
      eq(prospectStagesTable.stageType, "terminal"),
      sql`lower(${prospectStagesTable.terminalOutcome}) = 'lost'`,
    )!);
  } else if (filters.status === "other_terminal") {
    conditions.push(and(
      eq(prospectStagesTable.stageType, "terminal"),
      sql`lower(${prospectStagesTable.terminalOutcome}) not in ('won', 'lost')`,
    )!);
  }
  return and(...conditions)!;
}

async function buildRecords(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.select({
    id: prospectsTable.id,
    name: prospectsTable.name,
    contactId: contactsTable.id,
    contactName: contactsTable.name,
    contactEmail: contactsTable.email,
    contactFirstName: contactsTable.firstName,
    contactLastName: contactsTable.lastName,
    contactCompanyName: contactsTable.companyName,
    linkedCompanyId: companiesTable.id,
    linkedCompanyName: companiesTable.companyName,
    linkedCompanyDomain: companiesTable.companyDomain,
    contactJobTitle: contactsTable.jobTitle,
    productId: prospectProductsTable.id,
    productName: prospectProductsTable.name,
    productItemType: prospectProductsTable.itemType,
    productDescription: prospectProductsTable.description,
    productCategory: prospectProductsTable.category,
    productActive: prospectProductsTable.active,
    productDisplayOrder: prospectProductsTable.displayOrder,
    expectedDealValue: prospectsTable.expectedDealValue,
    currencyCode: prospectsTable.currencyCode,
    expectedClosureDate: prospectsTable.expectedClosureDate,
    stageId: prospectStagesTable.id,
    stageName: prospectStagesTable.name,
    stageDescription: prospectStagesTable.description,
    stageProbability: prospectStagesTable.probability,
    stageType: prospectStagesTable.stageType,
    stageTerminalOutcome: prospectStagesTable.terminalOutcome,
    stageDisplayOrder: prospectStagesTable.displayOrder,
    stageActive: prospectStagesTable.active,
    currentProbability: prospectsTable.currentProbability,
    notes: prospectsTable.notes,
    actualClosureDate: prospectsTable.actualClosureDate,
    closureOutcome: prospectsTable.closureOutcome,
    closureRemarks: prospectsTable.closureRemarks,
    archivedAt: prospectsTable.archivedAt,
    lastActivityAt: activityAtSql,
    createdAt: prospectsTable.createdAt,
    updatedAt: prospectsTable.updatedAt,
  }).from(prospectsTable)
    .innerJoin(contactsTable, and(
      eq(contactsTable.id, prospectsTable.contactId),
      eq(contactsTable.userId, prospectsTable.userId),
    ))
    .leftJoin(companiesTable, and(
      eq(companiesTable.id, contactsTable.companyId),
      eq(companiesTable.userId, contactsTable.userId),
    ))
    .innerJoin(prospectProductsTable, and(
      eq(prospectProductsTable.id, prospectsTable.productId),
      eq(prospectProductsTable.userId, prospectsTable.userId),
    ))
    .innerJoin(prospectStagesTable, and(
      eq(prospectStagesTable.id, prospectsTable.currentStageId),
      eq(prospectStagesTable.userId, prospectsTable.userId),
    ))
    .leftJoin(historyLatest, and(
      eq(historyLatest.userId, prospectsTable.userId),
      eq(historyLatest.prospectId, prospectsTable.id),
    ))
    .leftJoin(actionLatest, and(
      eq(actionLatest.userId, prospectsTable.userId),
      eq(actionLatest.prospectId, prospectsTable.id),
    ))
    .where(and(
      eq(prospectsTable.userId, userId),
      inArray(prospectsTable.id, ids),
    ));
  const [contactTags, prospectTags, stages] = await Promise.all([
    readContactTags(userId, rows.map(row => row.contactId)),
    readProspectTags(userId, rows.map(row => row.id)),
    readTenantStages(userId),
  ]);
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    contact: {
      id: row.contactId,
      name: row.contactName,
      email: row.contactEmail,
      firstName: row.contactFirstName,
      lastName: row.contactLastName,
      companyName: row.contactCompanyName,
      company: row.linkedCompanyId ? {
        id: row.linkedCompanyId,
        name: row.linkedCompanyName!,
        domain: row.linkedCompanyDomain,
      } : null,
      jobTitle: row.contactJobTitle,
      tags: contactTags.get(row.contactId) ?? [],
    },
    product: {
      id: row.productId,
      name: row.productName,
      itemType: row.productItemType,
      description: row.productDescription,
      category: row.productCategory,
      active: row.productActive,
      displayOrder: row.productDisplayOrder,
    },
    expectedDealValue: Number(row.expectedDealValue),
    currencyCode: row.currencyCode,
    expectedClosureDate: row.expectedClosureDate,
    currentStage: stages.get(row.stageId)!,
    currentProbability: row.currentProbability,
    notes: row.notes,
    actualClosureDate: row.actualClosureDate,
    closureOutcome: row.closureOutcome,
    closureRemarks: row.closureRemarks,
    archivedAt: row.archivedAt,
    lastActivityAt: row.lastActivityAt,
    prospectTags: prospectTags.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function ownedProspect(userId: string, prospectId: string) {
  const [row] = await db.select({ id: prospectsTable.id }).from(prospectsTable)
    .where(and(
      eq(prospectsTable.id, prospectId),
      eq(prospectsTable.userId, userId),
    )).limit(1);
  return row ?? null;
}

async function getOwnedRecord(userId: string, prospectId: string) {
  const records = await buildRecords(userId, [prospectId]);
  return records[0] ?? null;
}

router.get("/prospects", requireUserRole, async (req, res): Promise<void> => {
  const parsed = ListProspectsQueryParams.safeParse(normalizeDateQuery(
    req.query as Record<string, unknown>,
    ["closeFrom", "closeTo"],
  ));
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid prospect filters." });
    return;
  }
  const filters = parsed.data;
  const where = buildFilters(req.authUser!.id, filters);
  const orderColumn = filters.sortBy === "name"
    ? prospectsTable.name
    : filters.sortBy === "expectedDealValue"
      ? prospectsTable.expectedDealValue
      : filters.sortBy === "expectedClosureDate"
        ? prospectsTable.expectedClosureDate
        : filters.sortBy === "lastActivityAt"
          ? activityAtSql
          : prospectsTable.updatedAt;
  const order = filters.sortDirection === "asc" ? asc(orderColumn) : desc(orderColumn);
  const [rows, [totalRow]] = await Promise.all([
    db.select({ id: prospectsTable.id }).from(prospectsTable)
      .innerJoin(contactsTable, and(
        eq(contactsTable.id, prospectsTable.contactId),
        eq(contactsTable.userId, prospectsTable.userId),
      ))
      .innerJoin(prospectProductsTable, and(
        eq(prospectProductsTable.id, prospectsTable.productId),
        eq(prospectProductsTable.userId, prospectsTable.userId),
      ))
      .innerJoin(prospectStagesTable, and(
        eq(prospectStagesTable.id, prospectsTable.currentStageId),
        eq(prospectStagesTable.userId, prospectsTable.userId),
      ))
      .leftJoin(historyLatest, and(
        eq(historyLatest.userId, prospectsTable.userId),
        eq(historyLatest.prospectId, prospectsTable.id),
      ))
      .leftJoin(actionLatest, and(
        eq(actionLatest.userId, prospectsTable.userId),
        eq(actionLatest.prospectId, prospectsTable.id),
      ))
      .where(where)
      .orderBy(order, asc(prospectsTable.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(prospectsTable)
      .innerJoin(contactsTable, and(
        eq(contactsTable.id, prospectsTable.contactId),
        eq(contactsTable.userId, prospectsTable.userId),
      ))
      .innerJoin(prospectProductsTable, and(
        eq(prospectProductsTable.id, prospectsTable.productId),
        eq(prospectProductsTable.userId, prospectsTable.userId),
      ))
      .innerJoin(prospectStagesTable, and(
        eq(prospectStagesTable.id, prospectsTable.currentStageId),
        eq(prospectStagesTable.userId, prospectsTable.userId),
      ))
      .where(where),
  ]);
  const total = Number(totalRow?.total ?? 0);
  const prospects = await buildRecords(req.authUser!.id, rows.map(row => row.id));
  const response = {
    prospects,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    pageCount: Math.ceil(total / filters.pageSize),
  };
  res.json(ListProspectsResponse.parse(response));
});

router.post("/prospects", requireUserRole, async (req, res): Promise<void> => {
  const input = CreateProspectBody.safeParse(req.body);
  if (!input.success || !input.data.name.trim() || !input.data.notes.trim() || input.data.expectedDealValue < 0) {
    res.status(400).json({ error: "Provide a prospect name, contact, product, valid value, closure date, stage, and notes." });
    return;
  }
  const userId = req.authUser!.id;
  const result = await db.transaction(async tx => {
    const [contact] = await tx.select({ id: contactsTable.id }).from(contactsTable)
      .where(and(eq(contactsTable.id, input.data.contactId), eq(contactsTable.userId, userId)));
    const [product] = await tx.select({ id: prospectProductsTable.id }).from(prospectProductsTable)
      .where(and(
        eq(prospectProductsTable.id, input.data.productId),
        eq(prospectProductsTable.userId, userId),
        eq(prospectProductsTable.active, true),
      ));
    const [currency] = await tx.select({ code: prospectCurrenciesTable.code }).from(prospectCurrenciesTable)
      .where(and(
        eq(prospectCurrenciesTable.userId, userId),
        eq(prospectCurrenciesTable.code, input.data.currencyCode),
      ));
    const [stage] = await tx.select().from(prospectStagesTable)
      .where(and(
        eq(prospectStagesTable.id, input.data.stageId),
        eq(prospectStagesTable.userId, userId),
        eq(prospectStagesTable.active, true),
      ));
    if (!contact || !product || !currency || !stage) return { kind: "not_found" as const };
    const tagIds = [...new Set(input.data.prospectTagIds)];
    const tags = tagIds.length ? await tx.select({ id: contactTagsTable.id })
      .from(contactTagsTable).where(and(
        eq(contactTagsTable.userId, userId),
        inArray(contactTagsTable.id, tagIds),
      )) : [];
    if (tags.length !== tagIds.length) return { kind: "invalid_tags" as const };
    const today = todayInZone(req.authUser!.timezone);
    const [prospect] = await tx.insert(prospectsTable).values({
      userId,
      contactId: contact.id,
      name: input.data.name.trim(),
      productId: product.id,
      expectedDealValue: String(input.data.expectedDealValue),
      currencyCode: currency.code,
      expectedClosureDate: dateOnly(input.data.expectedClosureDate),
      currentStageId: stage.id,
      currentProbability: stage.probability,
      notes: input.data.notes.trim(),
      ...(stage.stageType === "terminal" ? {
        actualClosureDate: today,
        closureOutcome: stage.terminalOutcome,
        closureRemarks: "Created in a terminal stage.",
      } : {}),
      createdBy: userId,
      updatedBy: userId,
    }).returning();
    await tx.insert(prospectStageHistoryTable).values({
      userId,
      prospectId: prospect.id,
      eventType: "created",
      newStageId: stage.id,
      newProbability: stage.probability,
      notesSnapshot: input.data.notes.trim(),
      changedBy: userId,
    });
    if (tagIds.length) {
      await tx.insert(prospectTagAssignmentsTable).values(tagIds.map(tagId => ({
        userId, prospectId: prospect.id, tagId,
      })));
    }
    return { kind: "created" as const, id: prospect.id };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Contact or one of the selected active prospect options was not found in your account." });
    return;
  }
  if (result.kind === "invalid_tags") {
    res.status(400).json({ error: "One or more selected tags are not in your tag library." });
    return;
  }
  const record = await getOwnedRecord(userId, result.id);
  res.status(201).json(CreateProspectResponse.parse({ prospect: record }));
});

router.get("/prospects/:prospectId", requireUserRole, async (req, res): Promise<void> => {
  const params = GetProspectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid prospect identifier." });
    return;
  }
  const record = await getOwnedRecord(req.authUser!.id, params.data.prospectId);
  if (!record) {
    res.status(404).json({ error: "Prospect not found." });
    return;
  }
  res.json(GetProspectResponse.parse({ prospect: record }));
});

router.patch("/prospects/:prospectId", requireUserRole, async (req, res): Promise<void> => {
  const params = UpdateProspectParams.safeParse(req.params);
  const input = UpdateProspectBody.safeParse(req.body);
  if (!params.success || !input.success || !Object.keys(input.data).length) {
    res.status(400).json({ error: "Provide at least one valid prospect field to update." });
    return;
  }
  const userId = req.authUser!.id;
  const result = await db.transaction(async tx => {
    const [current] = await tx.select().from(prospectsTable).where(and(
      eq(prospectsTable.id, params.data.prospectId),
      eq(prospectsTable.userId, userId),
    )).for("update");
    if (!current) return { kind: "not_found" as const };
    if (input.data.productId) {
      const [product] = await tx.select({ id: prospectProductsTable.id }).from(prospectProductsTable)
        .where(and(
          eq(prospectProductsTable.id, input.data.productId),
          eq(prospectProductsTable.userId, userId),
          eq(prospectProductsTable.active, true),
        ));
      if (!product) return { kind: "invalid_product" as const };
    }
    if (input.data.currencyCode) {
      const [currency] = await tx.select({ code: prospectCurrenciesTable.code }).from(prospectCurrenciesTable)
        .where(and(
          eq(prospectCurrenciesTable.userId, userId),
          eq(prospectCurrenciesTable.code, input.data.currencyCode),
        ));
      if (!currency) return { kind: "invalid_currency" as const };
    }
    const nextDealValue = input.data.expectedDealValue ?? Number(current.expectedDealValue);
    const nextCurrencyCode = input.data.currencyCode ?? current.currencyCode;
    const valueChanged = canonicalDealValue(current.expectedDealValue) !== canonicalDealValue(nextDealValue)
      || current.currencyCode !== nextCurrencyCode;
    if (valueChanged && !input.data.dealValueChangeReason?.trim()) {
      return { kind: "value_reason_required" as const };
    }
    const patch: Partial<typeof prospectsTable.$inferInsert> = { updatedBy: userId, updatedAt: new Date() };
    if (input.data.name !== undefined) patch.name = input.data.name.trim();
    if (input.data.productId !== undefined) patch.productId = input.data.productId;
    if (input.data.expectedDealValue !== undefined) patch.expectedDealValue = String(input.data.expectedDealValue);
    if (input.data.currencyCode !== undefined) patch.currencyCode = input.data.currencyCode;
    if (input.data.expectedClosureDate !== undefined) patch.expectedClosureDate = dateOnly(input.data.expectedClosureDate);
    if (input.data.notes !== undefined) patch.notes = input.data.notes.trim();
    if (input.data.archived !== undefined) patch.archivedAt = input.data.archived ? new Date() : null;
    if (input.data.actualClosureDate !== undefined) patch.actualClosureDate = input.data.actualClosureDate === null
      ? null
      : dateOnly(input.data.actualClosureDate);
    if (input.data.closureRemarks !== undefined) patch.closureRemarks = input.data.closureRemarks?.trim() || null;
    if (valueChanged) {
      await tx.insert(prospectValueHistoryTable).values({
        userId,
        prospectId: current.id,
        previousDealValue: canonicalDealValue(current.expectedDealValue),
        previousCurrencyCode: current.currencyCode,
        newDealValue: canonicalDealValue(nextDealValue),
        newCurrencyCode: nextCurrencyCode,
        reason: input.data.dealValueChangeReason!.trim(),
        changedBy: userId,
      });
    }
    await tx.update(prospectsTable).set(patch).where(and(
      eq(prospectsTable.id, current.id),
      eq(prospectsTable.userId, userId),
    ));
    return { kind: "saved" as const };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Prospect not found." });
    return;
  }
  if (result.kind === "invalid_product") {
    res.status(400).json({ error: "Select an active product or service from your catalogue." });
    return;
  }
  if (result.kind === "invalid_currency") {
    res.status(400).json({ error: "Select a currency configured for your account." });
    return;
  }
  if (result.kind === "value_reason_required") {
    res.status(400).json({ error: "Provide a reason of at least 3 characters when changing the deal value or currency." });
    return;
  }
  const record = await getOwnedRecord(userId, params.data.prospectId);
  res.json(UpdateProspectResponse.parse({ prospect: record }));
});

router.get("/contacts/:contactId/prospects", requireUserRole, async (req, res): Promise<void> => {
  const params = ListContactProspectsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid contact identifier." });
    return;
  }
  const userId = req.authUser!.id;
  const [contact] = await db.select({ id: contactsTable.id }).from(contactsTable)
    .where(and(eq(contactsTable.id, params.data.contactId), eq(contactsTable.userId, userId)));
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  const prospects = await db.select({ id: prospectsTable.id }).from(prospectsTable)
    .where(and(
      eq(prospectsTable.userId, userId),
      eq(prospectsTable.contactId, contact.id),
      isNull(prospectsTable.archivedAt),
    )).orderBy(desc(prospectsTable.updatedAt));
  const records = await buildRecords(userId, prospects.map(prospect => prospect.id));
  res.json(ListContactProspectsResponse.parse(records));
});

router.post("/prospects/:prospectId/stage", requireUserRole, async (req, res): Promise<void> => {
  const params = ChangeProspectStageParams.safeParse(req.params);
  const input = ChangeProspectStageBody.safeParse(req.body);
  const reason = input.success ? input.data.reason.trim() : "";
  if (!params.success || !input.success || reason.length < 3) {
    res.status(400).json({ error: "Enter a meaningful reason of at least 3 characters for this stage change." });
    return;
  }
  const userId = req.authUser!.id;
  const outcome = await db.transaction(async tx => {
    const [current] = await tx.select().from(prospectsTable).where(and(
      eq(prospectsTable.id, params.data.prospectId),
      eq(prospectsTable.userId, userId),
    )).for("update");
    if (!current) return { kind: "not_found" as const };
    const [target] = await tx.select().from(prospectStagesTable).where(and(
      eq(prospectStagesTable.id, input.data.newStageId),
      eq(prospectStagesTable.userId, userId),
      eq(prospectStagesTable.active, true),
    ));
    if (!target) return { kind: "stage_not_found" as const };
    if (target.id === current.currentStageId) return { kind: "same_stage" as const };
    if (target.stageType === "active") {
      const [currency] = await tx.select({ code: prospectCurrenciesTable.code })
        .from(prospectCurrenciesTable).where(and(
          eq(prospectCurrenciesTable.userId, userId),
          eq(prospectCurrenciesTable.code, current.currencyCode),
        ));
      if (!currency) return { kind: "currency_not_configured" as const };
    }
    const transitions = await tx.select({ toStageId: prospectStageTransitionsTable.toStageId })
      .from(prospectStageTransitionsTable).where(and(
        eq(prospectStageTransitionsTable.userId, userId),
        eq(prospectStageTransitionsTable.fromStageId, current.currentStageId),
      ));
    if (transitions.length && !transitions.some(transition => transition.toStageId === target.id)) {
      return { kind: "transition_not_allowed" as const };
    }
    const [previousStage] = await tx.select().from(prospectStagesTable).where(and(
      eq(prospectStagesTable.id, current.currentStageId),
      eq(prospectStagesTable.userId, userId),
    ));
    const now = new Date();
    const terminal = target.stageType === "terminal";
    await tx.insert(prospectStageHistoryTable).values({
      userId,
      prospectId: current.id,
      eventType: "stage_change",
      previousStageId: current.currentStageId,
      newStageId: target.id,
      previousProbability: current.currentProbability,
      newProbability: target.probability,
      reason,
      changedBy: userId,
    });
    await tx.update(prospectsTable).set({
      currentStageId: target.id,
      currentProbability: target.probability,
      ...(terminal ? {
        actualClosureDate: todayInZone(req.authUser!.timezone),
        closureOutcome: target.terminalOutcome,
        closureRemarks: reason,
      } : {
        actualClosureDate: null,
        closureOutcome: null,
        closureRemarks: null,
      }),
      updatedBy: userId,
      updatedAt: now,
    }).where(and(eq(prospectsTable.id, current.id), eq(prospectsTable.userId, userId)));
    return {
      kind: "changed" as const,
      previousStageName: previousStage?.name ?? "Previous stage",
    };
  });
  if (outcome.kind === "not_found") {
    res.status(404).json({ error: "Prospect not found." });
    return;
  }
  if (outcome.kind === "stage_not_found") {
    res.status(404).json({ error: "Choose an active stage in your pipeline." });
    return;
  }
  if (outcome.kind === "same_stage") {
    res.status(400).json({ error: "The prospect is already in that stage." });
    return;
  }
  if (outcome.kind === "currency_not_configured") {
    res.status(409).json({ error: "Add this prospect's currency back in Currency Configuration before moving it into an active stage." });
    return;
  }
  if (outcome.kind === "transition_not_allowed") {
    res.status(400).json({ error: "That stage change is not configured as an allowed transition." });
    return;
  }
  const record = await getOwnedRecord(userId, params.data.prospectId);
  res.json(ChangeProspectStageResponse.parse({ prospect: record }));
});

async function readActionRecords(userId: string, historyIds: string[]) {
  if (!historyIds.length) return new Map<string, unknown[]>();
  const rows = await db.select({
    id: prospectActionsTable.id,
    prospectId: prospectActionsTable.prospectId,
    stageHistoryId: prospectActionsTable.stageHistoryId,
    actionDate: prospectActionsTable.actionDate,
    notes: prospectActionsTable.notes,
    createdAt: prospectActionsTable.createdAt,
    actionTypeId: prospectActionTypesTable.id,
    actionTypeName: prospectActionTypesTable.name,
    actionTypeDescription: prospectActionTypesTable.description,
    actionTypeActive: prospectActionTypesTable.active,
    actionTypeDisplayOrder: prospectActionTypesTable.displayOrder,
    stageNameAtAction: prospectStagesTable.name,
    recordedByFirstName: actionActor.firstName,
    recordedByLastName: actionActor.lastName,
  }).from(prospectActionsTable)
    .innerJoin(prospectActionTypesTable, and(
      eq(prospectActionTypesTable.id, prospectActionsTable.actionTypeId),
      eq(prospectActionTypesTable.userId, prospectActionsTable.userId),
    ))
    .innerJoin(prospectStageHistoryTable, and(
      eq(prospectStageHistoryTable.id, prospectActionsTable.stageHistoryId),
      eq(prospectStageHistoryTable.userId, prospectActionsTable.userId),
    ))
    .innerJoin(prospectStagesTable, and(
      eq(prospectStagesTable.id, prospectStageHistoryTable.newStageId),
      eq(prospectStagesTable.userId, prospectStageHistoryTable.userId),
    ))
    .innerJoin(actionActor, eq(actionActor.id, prospectActionsTable.recordedBy))
    .where(and(
      eq(prospectActionsTable.userId, userId),
      inArray(prospectActionsTable.stageHistoryId, historyIds),
    )).orderBy(asc(prospectActionsTable.actionDate), asc(prospectActionsTable.createdAt));
  const grouped = new Map<string, unknown[]>();
  for (const row of rows) {
    const actions = grouped.get(row.stageHistoryId) ?? [];
    actions.push({
      id: row.id,
      actionType: {
        id: row.actionTypeId,
        name: row.actionTypeName,
        description: row.actionTypeDescription,
        active: row.actionTypeActive,
        displayOrder: row.actionTypeDisplayOrder,
      },
      stageHistoryId: row.stageHistoryId,
      stageNameAtAction: row.stageNameAtAction,
      actionDate: row.actionDate,
      notes: row.notes,
      recordedByName: `${row.recordedByFirstName} ${row.recordedByLastName}`.trim(),
      createdAt: row.createdAt,
    });
    grouped.set(row.stageHistoryId, actions);
  }
  return grouped;
}

router.get("/prospects/:prospectId/history", requireUserRole, async (req, res): Promise<void> => {
  const params = ListProspectGrowthAuditParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid prospect identifier." });
    return;
  }
  const userId = req.authUser!.id;
  if (!await ownedProspect(userId, params.data.prospectId)) {
    res.status(404).json({ error: "Prospect not found." });
    return;
  }
  const rows = await db.select({
    id: prospectStageHistoryTable.id,
    eventType: prospectStageHistoryTable.eventType,
    previousStageId: prospectStageHistoryTable.previousStageId,
    newStageId: prospectStageHistoryTable.newStageId,
    previousProbability: prospectStageHistoryTable.previousProbability,
    newProbability: prospectStageHistoryTable.newProbability,
    reason: prospectStageHistoryTable.reason,
    notesSnapshot: prospectStageHistoryTable.notesSnapshot,
    createdAt: prospectStageHistoryTable.createdAt,
    actorFirstName: auditActor.firstName,
    actorLastName: auditActor.lastName,
  }).from(prospectStageHistoryTable)
    .innerJoin(auditActor, eq(auditActor.id, prospectStageHistoryTable.changedBy))
    .where(and(
      eq(prospectStageHistoryTable.userId, userId),
      eq(prospectStageHistoryTable.prospectId, params.data.prospectId),
    )).orderBy(asc(prospectStageHistoryTable.createdAt), asc(prospectStageHistoryTable.id));
  const [stages, actions] = await Promise.all([
    readTenantStages(userId),
    readActionRecords(userId, rows.map(row => row.id)),
  ]);
  const history = rows.map(row => ({
    id: row.id,
    eventType: row.eventType,
    previousStage: row.previousStageId ? stages.get(row.previousStageId) ?? null : null,
    newStage: stages.get(row.newStageId)!,
    previousProbability: row.previousProbability,
    newProbability: row.newProbability,
    reason: row.reason,
    notesSnapshot: row.notesSnapshot,
    changedByName: `${row.actorFirstName} ${row.actorLastName}`.trim(),
    createdAt: row.createdAt,
    actions: (actions.get(row.id) ?? []) as never[],
  }));
  res.json(ListProspectGrowthAuditResponse.parse(history));
});

router.get("/prospects/:prospectId/value-history", requireUserRole, async (req, res): Promise<void> => {
  const params = GetProspectValueHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid prospect identifier." });
    return;
  }
  const userId = req.authUser!.id;
  if (!await ownedProspect(userId, params.data.prospectId)) {
    res.status(404).json({ error: "Prospect not found." });
    return;
  }
  const rows = await db.select({
    id: prospectValueHistoryTable.id,
    previousDealValue: prospectValueHistoryTable.previousDealValue,
    previousCurrencyCode: prospectValueHistoryTable.previousCurrencyCode,
    newDealValue: prospectValueHistoryTable.newDealValue,
    newCurrencyCode: prospectValueHistoryTable.newCurrencyCode,
    reason: prospectValueHistoryTable.reason,
    actorFirstName: valueAuditActor.firstName,
    actorLastName: valueAuditActor.lastName,
    createdAt: prospectValueHistoryTable.createdAt,
  }).from(prospectValueHistoryTable)
    .innerJoin(valueAuditActor, eq(valueAuditActor.id, prospectValueHistoryTable.changedBy))
    .where(and(
      eq(prospectValueHistoryTable.userId, userId),
      eq(prospectValueHistoryTable.prospectId, params.data.prospectId),
    )).orderBy(desc(prospectValueHistoryTable.createdAt), desc(prospectValueHistoryTable.id));
  res.json(GetProspectValueHistoryResponse.parse(rows.map(row => ({
    id: row.id,
    previousDealValue: Number(row.previousDealValue),
    previousCurrencyCode: row.previousCurrencyCode,
    newDealValue: Number(row.newDealValue),
    newCurrencyCode: row.newCurrencyCode,
    reason: row.reason,
    changedByName: `${row.actorFirstName} ${row.actorLastName}`.trim(),
    createdAt: row.createdAt,
  }))));
});

router.get("/prospects/:prospectId/actions", requireUserRole, async (req, res): Promise<void> => {
  const params = ListProspectActionsParams.safeParse(req.params);
  const filters = ListProspectActionsQueryParams.safeParse(normalizeDateQuery(
    req.query as Record<string, unknown>,
    ["fromDate", "toDate"],
  ));
  if (!params.success || !filters.success) {
    res.status(400).json({ error: "Invalid action filters." });
    return;
  }
  const userId = req.authUser!.id;
  if (!await ownedProspect(userId, params.data.prospectId)) {
    res.status(404).json({ error: "Prospect not found." });
    return;
  }
  const historyIds = await db.select({ id: prospectStageHistoryTable.id }).from(prospectStageHistoryTable)
    .where(and(
      eq(prospectStageHistoryTable.userId, userId),
      eq(prospectStageHistoryTable.prospectId, params.data.prospectId),
    ));
  const grouped = await readActionRecords(userId, historyIds.map(item => item.id));
  const all = [...grouped.values()].flat() as Array<Record<string, unknown> & { actionType: { id: string } }>;
  const output = all.filter(action =>
    (!filters.data.actionTypeId || action.actionType.id === filters.data.actionTypeId)
      && (!filters.data.fromDate || String(action.actionDate) >= dateOnly(filters.data.fromDate))
      && (!filters.data.toDate || String(action.actionDate) <= dateOnly(filters.data.toDate)),
  ).sort((a, b) => String(b.actionDate).localeCompare(String(a.actionDate)));
  res.json(ListProspectActionsResponse.parse(output));
});

router.post("/prospects/:prospectId/actions", requireUserRole, async (req, res): Promise<void> => {
  const params = CreateProspectActionParams.safeParse(req.params);
  const input = CreateProspectActionBody.safeParse(req.body);
  if (!params.success || !input.success || !input.data.notes.trim()) {
    res.status(400).json({ error: "Choose an action type and date, and enter notes." });
    return;
  }
  const userId = req.authUser!.id;
  const result = await db.transaction(async tx => {
    const [prospect] = await tx.select().from(prospectsTable).where(and(
      eq(prospectsTable.id, params.data.prospectId),
      eq(prospectsTable.userId, userId),
    )).for("update");
    if (!prospect) return { kind: "not_found" as const };
    const [actionType] = await tx.select({ id: prospectActionTypesTable.id }).from(prospectActionTypesTable)
      .where(and(
        eq(prospectActionTypesTable.id, input.data.actionTypeId),
        eq(prospectActionTypesTable.userId, userId),
        eq(prospectActionTypesTable.active, true),
      ));
    if (!actionType) return { kind: "action_type_not_found" as const };
    const [stageHistory] = await tx.select({
      id: prospectStageHistoryTable.id,
      newStageId: prospectStageHistoryTable.newStageId,
    }).from(prospectStageHistoryTable)
      .where(and(
        eq(prospectStageHistoryTable.userId, userId),
        eq(prospectStageHistoryTable.prospectId, prospect.id),
      )).orderBy(desc(prospectStageHistoryTable.createdAt), desc(prospectStageHistoryTable.id))
      .limit(1);
    if (!stageHistory || stageHistory.newStageId !== prospect.currentStageId) {
      return { kind: "history_missing" as const };
    }
    const [action] = await tx.insert(prospectActionsTable).values({
      userId,
      prospectId: prospect.id,
      actionTypeId: actionType.id,
      stageHistoryId: stageHistory.id,
      actionDate: dateOnly(input.data.actionDate),
      notes: input.data.notes.trim(),
      recordedBy: userId,
    }).returning();
    return { kind: "created" as const, actionId: action.id, historyId: stageHistory.id };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Prospect not found." });
    return;
  }
  if (result.kind === "action_type_not_found") {
    res.status(404).json({ error: "Choose an active action type from your settings." });
    return;
  }
  if (result.kind === "history_missing") {
    res.status(409).json({ error: "The current stage history is unavailable. Refresh the prospect and try again." });
    return;
  }
  const actionMap = await readActionRecords(userId, [result.historyId]);
  const actions = actionMap.get(result.historyId) as Array<{ id: string }>;
  const action = actions.find(item => item.id === result.actionId);
  res.status(201).json(CreateProspectActionResponse.parse(action));
});

router.put("/prospects/:prospectId/tags", requireUserRole, async (req, res): Promise<void> => {
  const params = SetProspectTagsParams.safeParse(req.params);
  const input = SetProspectTagsBody.safeParse(req.body);
  if (!params.success || !input.success) {
    res.status(400).json({ error: "Select valid prospect tags." });
    return;
  }
  const userId = req.authUser!.id;
  const result = await db.transaction(async tx => {
    const [prospect] = await tx.select({ id: prospectsTable.id }).from(prospectsTable)
      .where(and(
        eq(prospectsTable.id, params.data.prospectId),
        eq(prospectsTable.userId, userId),
      )).for("update");
    if (!prospect) return { kind: "not_found" as const };
    const tagIds = [...new Set(input.data.tagIds)];
    const tags = tagIds.length ? await tx.select({
      id: contactTagsTable.id,
      name: contactTagsTable.name,
    }).from(contactTagsTable).where(and(
      eq(contactTagsTable.userId, userId),
      inArray(contactTagsTable.id, tagIds),
    )) : [];
    if (tags.length !== tagIds.length) return { kind: "invalid_tags" as const };
    await tx.delete(prospectTagAssignmentsTable).where(and(
      eq(prospectTagAssignmentsTable.userId, userId),
      eq(prospectTagAssignmentsTable.prospectId, prospect.id),
    ));
    if (tagIds.length) {
      await tx.insert(prospectTagAssignmentsTable).values(tagIds.map(tagId => ({
        userId, prospectId: prospect.id, tagId,
      })));
    }
    return {
      kind: "saved" as const,
      tags: tagIds.map(id => tags.find(tag => tag.id === id)!),
    };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Prospect not found." });
    return;
  }
  if (result.kind === "invalid_tags") {
    res.status(400).json({ error: "One or more selected tags are not in your tag library." });
    return;
  }
  res.json(SetProspectTagsResponse.parse(result.tags));
});

function currencyTotals(rows: Array<{
  currencyCode: string;
  expectedDealValue: string;
  currentProbability: number;
  stageType: string;
  terminalOutcome: string | null;
}>) {
  const totals = new Map<string, { currencyCode: string; activeValue: number; weightedValue: number; wonValue: number; lostValue: number }>();
  for (const row of rows) {
    const total = totals.get(row.currencyCode) ?? {
      currencyCode: row.currencyCode,
      activeValue: 0,
      weightedValue: 0,
      wonValue: 0,
      lostValue: 0,
    };
    const amount = Number(row.expectedDealValue);
    if (row.stageType === "active") {
      total.activeValue += amount;
      total.weightedValue += amount * row.currentProbability / 100;
    } else if (row.terminalOutcome?.toLowerCase() === "won") {
      total.wonValue += amount;
    } else if (row.terminalOutcome?.toLowerCase() === "lost") {
      total.lostValue += amount;
    }
    totals.set(row.currencyCode, total);
  }
  return [...totals.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

router.get("/prospect-dashboard", requireUserRole, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;
  const rows = await db.select({
    id: prospectsTable.id,
    currencyCode: prospectsTable.currencyCode,
    expectedDealValue: prospectsTable.expectedDealValue,
    currentProbability: prospectsTable.currentProbability,
    expectedClosureDate: prospectsTable.expectedClosureDate,
    stageId: prospectStagesTable.id,
    stageName: prospectStagesTable.name,
    stageType: prospectStagesTable.stageType,
    terminalOutcome: prospectStagesTable.terminalOutcome,
    productId: prospectProductsTable.id,
    productName: prospectProductsTable.name,
  }).from(prospectsTable)
    .innerJoin(prospectStagesTable, and(
      eq(prospectStagesTable.id, prospectsTable.currentStageId),
      eq(prospectStagesTable.userId, prospectsTable.userId),
    ))
    .innerJoin(prospectProductsTable, and(
      eq(prospectProductsTable.id, prospectsTable.productId),
      eq(prospectProductsTable.userId, prospectsTable.userId),
    ))
    .where(and(eq(prospectsTable.userId, userId), isNull(prospectsTable.archivedAt)));

  const totals = currencyTotals(rows);
  const stages = await readTenantStages(userId);
  const stageGroups = mapBy(rows, row => row.stageId);
  const byStage = [...stageGroups.entries()].map(([stageId, stageRows]) => {
    const stage = stages.get(stageId)!;
    return {
      stageId,
      stageName: stage.name,
      stageType: stage.stageType,
      terminalOutcome: stage.terminalOutcome,
      probability: stage.probability,
      count: stageRows.length,
      currencyTotals: currencyTotals(stageRows),
    };
  }).sort((a, b) => a.stageName.localeCompare(b.stageName));
  const productGroups = mapBy(rows, row => row.productId);
  const byProduct = [...productGroups.entries()].map(([productId, productRows]) => ({
    productId,
    productName: productRows[0]!.productName,
    count: productRows.length,
    currencyTotals: currencyTotals(productRows),
  })).sort((a, b) => a.productName.localeCompare(b.productName));
  const closureGroups = mapBy(
    rows.filter(row => row.stageType === "active"),
    row => row.expectedClosureDate.slice(0, 7),
  );
  const byClosurePeriod = [...closureGroups.entries()].map(([period, periodRows]) => ({
    period,
    count: periodRows.length,
    currencyTotals: currencyTotals(periodRows),
  })).sort((a, b) => a.period.localeCompare(b.period));
  const result = {
    totalActive: rows.filter(row => row.stageType === "active").length,
    totalWon: rows.filter(row => row.terminalOutcome?.toLowerCase() === "won").length,
    totalLost: rows.filter(row => row.terminalOutcome?.toLowerCase() === "lost").length,
    currencyTotals: totals,
    byStage,
    byProduct,
    byClosurePeriod,
  };
  res.json(GetProspectDashboardResponse.parse(result));
});

export default router;
