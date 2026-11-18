import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lt,
  lte,
} from "drizzle-orm";
import {
  contactsTable,
  db,
  prospectActionTypesTable,
  prospectActionsTable,
  prospectFollowUpsTable,
  prospectStageHistoryTable,
  prospectStagesTable,
  prospectsTable,
} from "@workspace/db";
import {
  CreateProspectFollowUpBody,
  CreateProspectFollowUpResponse,
  GetProspectFollowUpsTodayResponse,
  ListProspectFollowUpsQueryParams,
  ListProspectFollowUpsResponse,
  UpdateProspectFollowUpBody,
  UpdateProspectFollowUpParams,
  UpdateProspectFollowUpResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requireUserRole } from "../lib/session";
import { requirePackageFeature } from "../lib/package-feature-access";

const router: IRouter = Router();
router.use("/prospect-follow-ups", requireUserRole, requirePackageFeature("prospectManagementEnabled"));

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
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function readFollowUps(
  userId: string,
  filters: { id?: string; fromDate?: string; toDate?: string; status?: string; exactDate?: string },
) {
  const conditions = [eq(prospectFollowUpsTable.userId, userId)];
  if (filters.id) conditions.push(eq(prospectFollowUpsTable.id, filters.id));
  if (filters.fromDate) conditions.push(gte(prospectFollowUpsTable.followUpDate, filters.fromDate));
  if (filters.toDate) conditions.push(lte(prospectFollowUpsTable.followUpDate, filters.toDate));
  if (filters.exactDate) conditions.push(eq(prospectFollowUpsTable.followUpDate, filters.exactDate));
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(prospectFollowUpsTable.status, filters.status));
  }

  const rows = await db.select({
    id: prospectFollowUpsTable.id,
    prospectId: prospectFollowUpsTable.prospectId,
    prospectName: prospectsTable.name,
    currentStageName: prospectStagesTable.name,
    contactFirstName: contactsTable.firstName,
    contactLastName: contactsTable.lastName,
    contactEmail: contactsTable.email,
    actionTypeId: prospectActionTypesTable.id,
    actionTypeName: prospectActionTypesTable.name,
    actionTypeDescription: prospectActionTypesTable.description,
    actionTypeActive: prospectActionTypesTable.active,
    actionTypeDisplayOrder: prospectActionTypesTable.displayOrder,
    followUpDate: prospectFollowUpsTable.followUpDate,
    notes: prospectFollowUpsTable.notes,
    status: prospectFollowUpsTable.status,
    completedAt: prospectFollowUpsTable.completedAt,
    createdAt: prospectFollowUpsTable.createdAt,
    updatedAt: prospectFollowUpsTable.updatedAt,
  }).from(prospectFollowUpsTable)
    .innerJoin(prospectsTable, and(
      eq(prospectsTable.id, prospectFollowUpsTable.prospectId),
      eq(prospectsTable.userId, prospectFollowUpsTable.userId),
    ))
    .innerJoin(prospectStagesTable, and(
      eq(prospectStagesTable.id, prospectsTable.currentStageId),
      eq(prospectStagesTable.userId, prospectsTable.userId),
    ))
    .innerJoin(contactsTable, and(
      eq(contactsTable.id, prospectsTable.contactId),
      eq(contactsTable.userId, prospectsTable.userId),
    ))
    .innerJoin(prospectActionTypesTable, and(
      eq(prospectActionTypesTable.id, prospectFollowUpsTable.actionTypeId),
      eq(prospectActionTypesTable.userId, prospectFollowUpsTable.userId),
    ))
    .where(and(...conditions))
    .orderBy(asc(prospectFollowUpsTable.followUpDate), desc(prospectFollowUpsTable.createdAt));

  return rows.map(row => ({
    id: row.id,
    prospectId: row.prospectId,
    prospectName: row.prospectName,
    currentStageName: row.currentStageName,
    contactName: `${row.contactFirstName} ${row.contactLastName}`.trim(),
    contactEmail: row.contactEmail,
    actionType: {
      id: row.actionTypeId,
      name: row.actionTypeName,
      description: row.actionTypeDescription,
      active: row.actionTypeActive,
      displayOrder: row.actionTypeDisplayOrder,
    },
    followUpDate: dateOnly(row.followUpDate),
    notes: row.notes,
    status: row.status,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

router.get("/prospect-follow-ups", requireUserRole, async (req, res): Promise<void> => {
  const filters = ListProspectFollowUpsQueryParams.safeParse(req.query);
  if (!filters.success) {
    res.status(400).json({ error: "Choose a valid follow-up date range and status." });
    return;
  }
  const from = filters.data.fromDate;
  const to = filters.data.toDate;
  if ((from && !isValidCalendarDate(from)) || (to && !isValidCalendarDate(to))) {
    res.status(400).json({ error: "Follow-up dates must be valid calendar dates." });
    return;
  }
  if (from && to && from > to) {
    res.status(400).json({ error: "The start date must be on or before the end date." });
    return;
  }
  if (from && to && Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 62 * 86_400_000) {
    res.status(400).json({ error: "Choose a date range of 63 days or less." });
    return;
  }
  const result = await readFollowUps(req.authUser!.id, {
    ...(filters.data.fromDate ? { fromDate: filters.data.fromDate } : {}),
    ...(filters.data.toDate ? { toDate: filters.data.toDate } : {}),
    ...(filters.data.status ? { status: filters.data.status } : {}),
  });
  res.json(ListProspectFollowUpsResponse.parse(result));
});

router.get("/prospect-follow-ups/today", requireUserRole, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;
  const today = todayInZone(req.authUser!.timezone);
  const [items, [overdue]] = await Promise.all([
    readFollowUps(userId, { exactDate: today, status: "pending" }),
    db.select({ count: count() }).from(prospectFollowUpsTable)
      .where(and(
        eq(prospectFollowUpsTable.userId, userId),
        eq(prospectFollowUpsTable.status, "pending"),
        lt(prospectFollowUpsTable.followUpDate, today),
      )),
  ]);
  res.json(GetProspectFollowUpsTodayResponse.parse({
    date: today,
    items,
    overdueCount: Number(overdue?.count ?? 0),
  }));
});

router.post("/prospect-follow-ups", requireUserRole, async (req, res): Promise<void> => {
  const input = CreateProspectFollowUpBody.safeParse(req.body);
  if (!input.success || !input.data.notes.trim() || !isValidCalendarDate(input.data.followUpDate)) {
    res.status(400).json({ error: "Choose an active prospect and action, date, and enter a note." });
    return;
  }
  const userId = req.authUser!.id;
  const result = await db.transaction(async tx => {
    const [prospect] = await tx.select().from(prospectsTable).where(and(
      eq(prospectsTable.id, input.data.prospectId),
      eq(prospectsTable.userId, userId),
    )).for("update");
    if (!prospect) return { kind: "prospect_not_found" as const };
    if (prospect.archivedAt) return { kind: "prospect_inactive" as const };
    const [stage] = await tx.select({ stageType: prospectStagesTable.stageType }).from(prospectStagesTable)
      .where(and(
        eq(prospectStagesTable.id, prospect.currentStageId),
        eq(prospectStagesTable.userId, userId),
      ));
    if (stage?.stageType !== "active") return { kind: "prospect_inactive" as const };
    const [actionType] = await tx.select({ id: prospectActionTypesTable.id }).from(prospectActionTypesTable)
      .where(and(
        eq(prospectActionTypesTable.id, input.data.actionTypeId),
        eq(prospectActionTypesTable.userId, userId),
        eq(prospectActionTypesTable.active, true),
      ));
    if (!actionType) return { kind: "action_type_not_found" as const };
    const [followUp] = await tx.insert(prospectFollowUpsTable).values({
      userId,
      prospectId: prospect.id,
      actionTypeId: actionType.id,
      followUpDate: dateOnly(input.data.followUpDate),
      notes: input.data.notes.trim(),
      createdBy: userId,
    }).returning({ id: prospectFollowUpsTable.id });
    return { kind: "created" as const, id: followUp.id };
  });
  if (result.kind === "prospect_not_found") {
    res.status(404).json({ error: "Prospect not found in this account." });
    return;
  }
  if (result.kind === "prospect_inactive") {
    res.status(409).json({ error: "Follow-ups can only be scheduled for active, non-archived prospects." });
    return;
  }
  if (result.kind === "action_type_not_found") {
    res.status(404).json({ error: "Choose an active action type from your prospect settings." });
    return;
  }
  const [followUp] = await readFollowUps(userId, { id: result.id });
  res.status(201).json(CreateProspectFollowUpResponse.parse(followUp));
});

router.patch("/prospect-follow-ups/:followUpId", requireUserRole, async (req, res): Promise<void> => {
  const params = UpdateProspectFollowUpParams.safeParse(req.params);
  const input = UpdateProspectFollowUpBody.safeParse(req.body);
  if (!params.success || !input.success || !Object.keys(input.data).length) {
    res.status(400).json({ error: "Provide a valid follow-up update." });
    return;
  }
  if (input.data.notes !== undefined && !input.data.notes.trim()) {
    res.status(400).json({ error: "Enter a note before saving the follow-up." });
    return;
  }
  if (input.data.followUpDate && !isValidCalendarDate(input.data.followUpDate)) {
    res.status(400).json({ error: "The follow-up date must be a valid calendar date." });
    return;
  }
  const userId = req.authUser!.id;
  const result = await db.transaction(async tx => {
    const [existing] = await tx.select().from(prospectFollowUpsTable).where(and(
      eq(prospectFollowUpsTable.id, params.data.followUpId),
      eq(prospectFollowUpsTable.userId, userId),
    )).for("update");
    if (!existing) return { kind: "not_found" as const };
    if (existing.status !== "pending") return { kind: "not_pending" as const };

    const nextActionTypeId = input.data.actionTypeId ?? existing.actionTypeId;
    if (input.data.actionTypeId && input.data.actionTypeId !== existing.actionTypeId) {
      const [actionType] = await tx.select({ id: prospectActionTypesTable.id }).from(prospectActionTypesTable)
        .where(and(
          eq(prospectActionTypesTable.id, input.data.actionTypeId),
          eq(prospectActionTypesTable.userId, userId),
          eq(prospectActionTypesTable.active, true),
        ));
      if (!actionType) return { kind: "action_type_not_found" as const };
    }

    let completedAt: Date | null = null;
    if (input.data.status === "completed") {
      const [prospect] = await tx.select().from(prospectsTable).where(and(
        eq(prospectsTable.id, existing.prospectId),
        eq(prospectsTable.userId, userId),
      )).for("update");
      if (!prospect) return { kind: "not_found" as const };
      const [stageHistory] = await tx.select({ id: prospectStageHistoryTable.id }).from(prospectStageHistoryTable)
        .where(and(
          eq(prospectStageHistoryTable.userId, userId),
          eq(prospectStageHistoryTable.prospectId, prospect.id),
          eq(prospectStageHistoryTable.newStageId, prospect.currentStageId),
        )).orderBy(desc(prospectStageHistoryTable.createdAt), desc(prospectStageHistoryTable.id))
        .limit(1);
      if (!stageHistory) return { kind: "history_missing" as const };
      const note = input.data.notes?.trim() ?? existing.notes;
      await tx.insert(prospectActionsTable).values({
        userId,
        prospectId: prospect.id,
        actionTypeId: nextActionTypeId,
        stageHistoryId: stageHistory.id,
        actionDate: todayInZone(req.authUser!.timezone),
        notes: note,
        recordedBy: userId,
      });
      completedAt = new Date();
    }

    const patch = {
      ...(input.data.actionTypeId ? { actionTypeId: input.data.actionTypeId } : {}),
      ...(input.data.followUpDate ? { followUpDate: dateOnly(input.data.followUpDate) } : {}),
      ...(input.data.notes !== undefined ? { notes: input.data.notes.trim() } : {}),
      ...(input.data.status ? { status: input.data.status } : {}),
      ...(input.data.status === "completed" ? { completedAt } : {}),
      ...(input.data.status === "cancelled" ? { completedAt: null } : {}),
      updatedAt: new Date(),
    };
    await tx.update(prospectFollowUpsTable).set(patch).where(and(
      eq(prospectFollowUpsTable.id, existing.id),
      eq(prospectFollowUpsTable.userId, userId),
    ));
    return { kind: "updated" as const };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Follow-up not found in this account." });
    return;
  }
  if (result.kind === "action_type_not_found") {
    res.status(404).json({ error: "Choose an active action type from your prospect settings." });
    return;
  }
  if (result.kind === "not_pending") {
    res.status(409).json({ error: "Only pending follow-ups can be changed." });
    return;
  }
  if (result.kind === "history_missing") {
    res.status(409).json({ error: "The current prospect stage history is unavailable. Refresh and try again." });
    return;
  }
  const [followUp] = await readFollowUps(userId, { id: params.data.followUpId });
  res.json(UpdateProspectFollowUpResponse.parse(followUp));
});

export default router;
