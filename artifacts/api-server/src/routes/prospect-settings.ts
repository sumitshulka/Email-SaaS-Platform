import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  prospectActionTypesTable,
  prospectCurrenciesTable,
  prospectProductsTable,
  prospectStageTransitionsTable,
  prospectStagesTable,
  prospectsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateProspectActionTypeBody,
  CreateProspectActionTypeResponse,
  CreateProspectProductBody,
  CreateProspectProductResponse,
  CreateProspectStageBody,
  CreateProspectStageResponse,
  GetProspectCurrenciesResponse,
  ListProspectActionTypesResponse,
  ListProspectProductsResponse,
  ListProspectStagesResponse,
  SetProspectStageTransitionsBody,
  SetProspectStageTransitionsParams,
  SetProspectStageTransitionsResponse,
  UpdateProspectActionTypeBody,
  UpdateProspectActionTypeParams,
  UpdateProspectActionTypeResponse,
  UpdateProspectCurrenciesBody,
  UpdateProspectCurrenciesResponse,
  UpdateProspectProductBody,
  UpdateProspectProductParams,
  UpdateProspectProductResponse,
  UpdateProspectStageBody,
  UpdateProspectStageParams,
  UpdateProspectStageResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();
const iso4217CurrencyCodes = new Set(Intl.supportedValuesOf("currency"));

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return ("code" in error && error.code === "23505")
    || ("cause" in error && isUniqueViolation(error.cause));
}

function validStageType(input: { stageType: string; terminalOutcome: string | null }): boolean {
  return input.stageType === "active"
    ? input.terminalOutcome === null
    : input.stageType === "terminal" && Boolean(input.terminalOutcome?.trim());
}

async function stagesWithTransitions(userId: string) {
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
  const byFrom = new Map<string, string[]>();
  for (const transition of transitions) {
    const ids = byFrom.get(transition.fromStageId) ?? [];
    ids.push(transition.toStageId);
    byFrom.set(transition.fromStageId, ids);
  }
  return stages.map(stage => ({
    ...stage,
    allowedNextStageIds: byFrom.get(stage.id) ?? [],
  }));
}

router.get("/prospect-products", requireUserRole, async (req, res): Promise<void> => {
  const products = await db.select().from(prospectProductsTable)
    .where(eq(prospectProductsTable.userId, req.authUser!.id))
    .orderBy(asc(prospectProductsTable.displayOrder), asc(prospectProductsTable.name));
  res.json(ListProspectProductsResponse.parse(products));
});

router.post("/prospect-products", requireUserRole, async (req, res): Promise<void> => {
  const input = CreateProspectProductBody.safeParse(req.body);
  if (!input.success || !input.data.name.trim()) {
    res.status(400).json({ error: "Enter a valid product or service name." });
    return;
  }
  try {
    const [product] = await db.insert(prospectProductsTable).values({
      userId: req.authUser!.id,
      name: input.data.name.trim(),
      description: input.data.description.trim(),
      category: input.data.category?.trim() || null,
      active: input.data.active,
      displayOrder: input.data.displayOrder,
    }).returning();
    res.status(201).json(CreateProspectProductResponse.parse(product));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({ error: "A product or service with this name already exists." });
  }
});

router.patch("/prospect-products/:productId", requireUserRole, async (req, res): Promise<void> => {
  const params = UpdateProspectProductParams.safeParse(req.params);
  const input = UpdateProspectProductBody.safeParse(req.body);
  if (!params.success || !input.success || !input.data.name.trim()) {
    res.status(400).json({ error: "Enter valid product or service details." });
    return;
  }
  try {
    const [product] = await db.update(prospectProductsTable).set({
      name: input.data.name.trim(),
      description: input.data.description.trim(),
      category: input.data.category?.trim() || null,
      active: input.data.active,
      displayOrder: input.data.displayOrder,
      updatedAt: new Date(),
    }).where(and(
      eq(prospectProductsTable.id, params.data.productId),
      eq(prospectProductsTable.userId, req.authUser!.id),
    )).returning();
    if (!product) {
      res.status(404).json({ error: "Product or service not found." });
      return;
    }
    res.json(UpdateProspectProductResponse.parse(product));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({ error: "A product or service with this name already exists." });
  }
});

router.get("/prospect-currencies", requireUserRole, async (req, res): Promise<void> => {
  const currencies = await db.select({
    code: prospectCurrenciesTable.code,
    isDefault: prospectCurrenciesTable.isDefault,
  }).from(prospectCurrenciesTable)
    .where(eq(prospectCurrenciesTable.userId, req.authUser!.id))
    .orderBy(asc(prospectCurrenciesTable.code));
  const parsed = GetProspectCurrenciesResponse.parse({
    currencies,
    defaultCurrencyCode: currencies.find(currency => currency.isDefault)?.code ?? null,
  });
  res.json(parsed);
});

router.put("/prospect-currencies", requireUserRole, async (req, res): Promise<void> => {
  const input = UpdateProspectCurrenciesBody.safeParse(req.body);
  if (!input.success
    || new Set(input.data.currencies).size !== input.data.currencies.length
    || !input.data.currencies.includes(input.data.defaultCurrencyCode)
    || input.data.currencies.some(code => !iso4217CurrencyCodes.has(code))) {
    res.status(400).json({ error: "Choose at least one distinct ISO currency code and set one of them as the default." });
    return;
  }
  const userId = req.authUser!.id;
  const requested = new Set(input.data.currencies);
  const saved = await db.transaction(async tx => {
    await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, userId)).for("update");
    const inUse = await tx.select({
      currencyCode: prospectsTable.currencyCode,
      count: sql<number>`count(*)::int`,
    }).from(prospectsTable)
      .innerJoin(prospectStagesTable, and(
        eq(prospectStagesTable.id, prospectsTable.currentStageId),
        eq(prospectStagesTable.userId, prospectsTable.userId),
      ))
      .where(and(
        eq(prospectsTable.userId, userId),
        eq(prospectStagesTable.stageType, "active"),
        sql`${prospectsTable.archivedAt} is null`,
      ))
      .groupBy(prospectsTable.currencyCode);
    const removedInUse = inUse.find(row => Number(row.count) > 0 && !requested.has(row.currencyCode));
    if (removedInUse) return { kind: "in_use" as const, code: removedInUse.currencyCode };

    await tx.update(prospectCurrenciesTable).set({ isDefault: false })
      .where(eq(prospectCurrenciesTable.userId, userId));
    const existing = await tx.select({ code: prospectCurrenciesTable.code })
      .from(prospectCurrenciesTable)
      .where(eq(prospectCurrenciesTable.userId, userId));
    const removedCodes = existing.map(row => row.code).filter(code => !requested.has(code));
    if (removedCodes.length) {
      await tx.delete(prospectCurrenciesTable).where(and(
        eq(prospectCurrenciesTable.userId, userId),
        inArray(prospectCurrenciesTable.code, removedCodes),
      ));
    }
    for (const code of input.data.currencies) {
      await tx.insert(prospectCurrenciesTable).values({
        userId,
        code,
        isDefault: code === input.data.defaultCurrencyCode,
      }).onConflictDoUpdate({
        target: [prospectCurrenciesTable.userId, prospectCurrenciesTable.code],
        set: { isDefault: code === input.data.defaultCurrencyCode },
      });
    }
    const currencies = await tx.select({
      code: prospectCurrenciesTable.code,
      isDefault: prospectCurrenciesTable.isDefault,
    }).from(prospectCurrenciesTable)
      .where(eq(prospectCurrenciesTable.userId, userId))
      .orderBy(asc(prospectCurrenciesTable.code));
    return {
      kind: "saved" as const,
      currencies,
      defaultCurrencyCode: input.data.defaultCurrencyCode,
    };
  });
  if (saved.kind === "in_use") {
    res.status(409).json({ error: `${saved.code} is used by active prospects and cannot be removed yet.` });
    return;
  }
  res.json(UpdateProspectCurrenciesResponse.parse(saved));
});

router.get("/prospect-stages", requireUserRole, async (req, res): Promise<void> => {
  res.json(ListProspectStagesResponse.parse(await stagesWithTransitions(req.authUser!.id)));
});

router.post("/prospect-stages", requireUserRole, async (req, res): Promise<void> => {
  const input = CreateProspectStageBody.safeParse(req.body);
  if (!input.success || !input.data.name.trim() || !validStageType(input.data)) {
    res.status(400).json({ error: "Enter valid stage details. Terminal stages require an outcome; active stages cannot have one." });
    return;
  }
  try {
    const [stage] = await db.insert(prospectStagesTable).values({
      userId: req.authUser!.id,
      name: input.data.name.trim(),
      description: input.data.description.trim(),
      probability: input.data.probability,
      stageType: input.data.stageType,
      terminalOutcome: input.data.terminalOutcome?.trim() || null,
      displayOrder: input.data.displayOrder,
      active: input.data.active,
    }).returning();
    res.status(201).json(CreateProspectStageResponse.parse({ ...stage, allowedNextStageIds: [] }));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({ error: "A stage with this name already exists." });
  }
});

router.patch("/prospect-stages/:stageId", requireUserRole, async (req, res): Promise<void> => {
  const params = UpdateProspectStageParams.safeParse(req.params);
  const input = UpdateProspectStageBody.safeParse(req.body);
  if (!params.success || !input.success || !input.data.name.trim() || !validStageType(input.data)) {
    res.status(400).json({ error: "Enter valid stage details. Terminal stages require an outcome; active stages cannot have one." });
    return;
  }
  const userId = req.authUser!.id;
  try {
    const result = await db.transaction(async tx => {
      const [current] = await tx.select().from(prospectStagesTable).where(and(
        eq(prospectStagesTable.id, params.data.stageId),
        eq(prospectStagesTable.userId, userId),
      )).for("update");
      if (!current) return { kind: "not_found" as const };
      const newTerminalOutcome = input.data.terminalOutcome?.trim() || null;
      if (current.stageType !== input.data.stageType
        || current.terminalOutcome !== newTerminalOutcome) {
        const [used] = await tx.select({ id: prospectsTable.id }).from(prospectsTable)
          .where(and(eq(prospectsTable.userId, userId), eq(prospectsTable.currentStageId, current.id)))
          .limit(1);
        if (used) return { kind: "in_use" as const };
      }
      const [stage] = await tx.update(prospectStagesTable).set({
        name: input.data.name.trim(),
        description: input.data.description.trim(),
        probability: input.data.probability,
        stageType: input.data.stageType,
      terminalOutcome: input.data.terminalOutcome?.trim() || null,
        displayOrder: input.data.displayOrder,
        active: input.data.active,
        updatedAt: new Date(),
      }).where(and(
        eq(prospectStagesTable.id, current.id),
        eq(prospectStagesTable.userId, userId),
      )).returning();
      if (current.probability !== stage.probability) {
        await tx.update(prospectsTable).set({
          currentProbability: stage.probability,
          updatedAt: new Date(),
        }).where(and(
          eq(prospectsTable.userId, userId),
          eq(prospectsTable.currentStageId, stage.id),
        ));
      }
      const outgoing = await tx.select({ toStageId: prospectStageTransitionsTable.toStageId })
        .from(prospectStageTransitionsTable).where(and(
          eq(prospectStageTransitionsTable.userId, userId),
          eq(prospectStageTransitionsTable.fromStageId, stage.id),
        ));
      return {
        kind: "saved" as const,
        stage: { ...stage, allowedNextStageIds: outgoing.map(row => row.toStageId) },
      };
    });
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Stage not found." });
      return;
    }
    if (result.kind === "in_use") {
      res.status(409).json({ error: "You cannot change a stage between active and terminal or change its terminal outcome while prospects use it. Deactivate it and create a new stage instead." });
      return;
    }
    res.json(UpdateProspectStageResponse.parse(result.stage));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({ error: "A stage with this name already exists." });
  }
});

router.put("/prospect-stages/:stageId/transitions", requireUserRole, async (req, res): Promise<void> => {
  const params = SetProspectStageTransitionsParams.safeParse(req.params);
  const input = SetProspectStageTransitionsBody.safeParse(req.body);
  if (!params.success || !input.success) {
    res.status(400).json({ error: "Choose valid permitted stages." });
    return;
  }
  const userId = req.authUser!.id;
  const result = await db.transaction(async tx => {
    const [source] = await tx.select({ id: prospectStagesTable.id }).from(prospectStagesTable)
      .where(and(
        eq(prospectStagesTable.id, params.data.stageId),
        eq(prospectStagesTable.userId, userId),
      )).for("update");
    if (!source) return { kind: "not_found" as const };
    const distinct = [...new Set(input.data.toStageIds)];
    if (distinct.includes(source.id)) return { kind: "invalid" as const };
    const targets = distinct.length ? await tx.select({ id: prospectStagesTable.id })
      .from(prospectStagesTable).where(and(
        eq(prospectStagesTable.userId, userId),
        eq(prospectStagesTable.active, true),
        inArray(prospectStagesTable.id, distinct),
      )) : [];
    if (targets.length !== distinct.length) return { kind: "invalid" as const };
    await tx.delete(prospectStageTransitionsTable).where(and(
      eq(prospectStageTransitionsTable.userId, userId),
      eq(prospectStageTransitionsTable.fromStageId, source.id),
    ));
    if (distinct.length) {
      await tx.insert(prospectStageTransitionsTable).values(distinct.map(toStageId => ({
        userId,
        fromStageId: source.id,
        toStageId,
      })));
    }
    return { kind: "saved" as const, fromStageId: source.id, toStageIds: distinct, unrestricted: distinct.length === 0 };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Stage not found." });
    return;
  }
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Every destination must be a distinct active stage other than the current stage." });
    return;
  }
  res.json(SetProspectStageTransitionsResponse.parse(result));
});

router.get("/prospect-action-types", requireUserRole, async (req, res): Promise<void> => {
  const actionTypes = await db.select().from(prospectActionTypesTable)
    .where(eq(prospectActionTypesTable.userId, req.authUser!.id))
    .orderBy(asc(prospectActionTypesTable.displayOrder), asc(prospectActionTypesTable.name));
  res.json(ListProspectActionTypesResponse.parse(actionTypes));
});

router.post("/prospect-action-types", requireUserRole, async (req, res): Promise<void> => {
  const input = CreateProspectActionTypeBody.safeParse(req.body);
  if (!input.success || !input.data.name.trim()) {
    res.status(400).json({ error: "Enter a valid action type name." });
    return;
  }
  try {
    const [actionType] = await db.insert(prospectActionTypesTable).values({
      userId: req.authUser!.id,
      name: input.data.name.trim(),
      description: input.data.description.trim(),
      active: input.data.active,
      displayOrder: input.data.displayOrder,
    }).returning();
    res.status(201).json(CreateProspectActionTypeResponse.parse(actionType));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({ error: "An action type with this name already exists." });
  }
});

router.patch("/prospect-action-types/:actionTypeId", requireUserRole, async (req, res): Promise<void> => {
  const params = UpdateProspectActionTypeParams.safeParse(req.params);
  const input = UpdateProspectActionTypeBody.safeParse(req.body);
  if (!params.success || !input.success || !input.data.name.trim()) {
    res.status(400).json({ error: "Enter valid action type details." });
    return;
  }
  try {
    const [actionType] = await db.update(prospectActionTypesTable).set({
      name: input.data.name.trim(),
      description: input.data.description.trim(),
      active: input.data.active,
      displayOrder: input.data.displayOrder,
      updatedAt: new Date(),
    }).where(and(
      eq(prospectActionTypesTable.id, params.data.actionTypeId),
      eq(prospectActionTypesTable.userId, req.authUser!.id),
    )).returning();
    if (!actionType) {
      res.status(404).json({ error: "Action type not found." });
      return;
    }
    res.json(UpdateProspectActionTypeResponse.parse(actionType));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    res.status(409).json({ error: "An action type with this name already exists." });
  }
});

export default router;
