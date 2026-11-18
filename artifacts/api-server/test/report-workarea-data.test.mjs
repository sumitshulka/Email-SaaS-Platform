import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { test } from "node:test";

const enabled = process.env.RUN_REPORT_WORKAREA_DB_TESTS === "1";

test("report summaries preserve entity grain, activity counts, currency, and tenant scope", {
  skip: !enabled ? "Set RUN_REPORT_WORKAREA_DB_TESTS=1 to run against a disposable test database." : false,
}, async () => {
  const [
    {
      db,
      usersTable,
      companiesTable,
      contactsTable,
      prospectProductsTable,
      prospectStagesTable,
      prospectsTable,
      prospectStageHistoryTable,
      prospectActionTypesTable,
      prospectActionsTable,
    },
    { runReport },
  ] = await Promise.all([
    import("@workspace/db"),
    import("../src/lib/report-workarea-query.ts"),
  ]);

  const userId = randomUUID();
  const companyId = randomUUID();
  const contactId = randomUUID();
  const productId = randomUUID();
  const stageIds = [randomUUID(), randomUUID(), randomUUID()];
  const actionTypeId = randomUUID();
  const prospectIds = [randomUUID(), randomUUID(), randomUUID()];
  const stageHistoryIds = [randomUUID(), randomUUID(), randomUUID()];
  const actionIds = [randomUUID(), randomUUID(), randomUUID()];

  try {
    await db.insert(usersTable).values({
      id: userId,
      username: `report_test_${userId.slice(0, 8)}`,
      firstName: "Report",
      lastName: "Tester",
      email: `report-test-${userId}@example.invalid`,
      passwordHash: "unused-test-hash",
      role: "USER",
      timezone: "Asia/Kolkata",
      emailVerified: true,
    });
    await db.insert(companiesTable).values({
      id: companyId,
      userId,
      companyName: "Report test company",
    });
    await db.insert(contactsTable).values({
      id: contactId,
      userId,
      companyId,
      name: "Report test contact",
      email: `report-contact-${userId}@example.invalid`,
    });
    await db.insert(prospectProductsTable).values({
      id: productId,
      userId,
      name: "Report test product",
      itemType: "product",
    });
    await db.insert(prospectStagesTable).values([
      { id: stageIds[0], userId, name: "Report active", probability: 50, stageType: "active", terminalOutcome: null, displayOrder: 1 },
      { id: stageIds[1], userId, name: "Report won", probability: 100, stageType: "terminal", terminalOutcome: "won", displayOrder: 2 },
      { id: stageIds[2], userId, name: "Report lost", probability: 0, stageType: "terminal", terminalOutcome: "lost", displayOrder: 3 },
    ]);
    await db.insert(prospectActionTypesTable).values({
      id: actionTypeId,
      userId,
      name: "Report test activity",
      active: true,
      displayOrder: 1,
    });
    await db.insert(prospectsTable).values([
      {
        id: prospectIds[0], userId, contactId, name: "Report active prospect", productId,
        expectedDealValue: "100.0000", currencyCode: "USD", expectedClosureDate: "2027-01-31",
        currentStageId: stageIds[0], currentProbability: 50, notes: "Isolated report test fixture",
        createdBy: userId, updatedBy: userId,
      },
      {
        id: prospectIds[1], userId, contactId, name: "Report won prospect", productId,
        expectedDealValue: "200.0000", currencyCode: "USD", expectedClosureDate: "2027-02-28",
        currentStageId: stageIds[1], currentProbability: 100, notes: "Isolated report test fixture",
        createdBy: userId, updatedBy: userId,
      },
      {
        id: prospectIds[2], userId, contactId, name: "Report lost prospect", productId,
        expectedDealValue: "300.0000", currencyCode: "INR", expectedClosureDate: "2027-03-31",
        currentStageId: stageIds[2], currentProbability: 0, notes: "Isolated report test fixture",
        createdBy: userId, updatedBy: userId,
      },
    ]);
    await db.insert(prospectStageHistoryTable).values(prospectIds.map((prospectId, index) => ({
      id: stageHistoryIds[index],
      userId,
      prospectId,
      eventType: "created",
      previousStageId: null,
      newStageId: stageIds[index],
      previousProbability: null,
      newProbability: [50, 100, 0][index],
      changedBy: userId,
    })));
    await db.insert(prospectActionsTable).values([
      { id: actionIds[0], userId, prospectId: prospectIds[0], actionTypeId, stageHistoryId: stageHistoryIds[0], actionDate: "2026-11-10", notes: "First isolated action", recordedBy: userId },
      { id: actionIds[1], userId, prospectId: prospectIds[0], actionTypeId, stageHistoryId: stageHistoryIds[0], actionDate: "2026-11-11", notes: "Second isolated action", recordedBy: userId },
      { id: actionIds[2], userId, prospectId: prospectIds[1], actionTypeId, stageHistoryId: stageHistoryIds[1], actionDate: "2026-11-12", notes: "Third isolated action", recordedBy: userId },
    ]);

    const pipeline = await runReport(userId, {
      version: 1,
      baseEntityId: "prospects",
      columns: [],
      groupBy: [{ fieldId: "prospects.stage.name" }],
      aggregates: [
        { id: "record_count", label: "Prospects", operation: "count" },
        { id: "activity_count", label: "Activities", operation: "sum", fieldId: "prospects.activityCount" },
        { id: "win_rate", label: "Win rate", operation: "win_rate", fieldId: "prospects.stage.outcome" },
      ],
    }, { page: 1, pageSize: 10, timeZone: "Asia/Kolkata" });
    const pipelineTotal = pipeline.rows.find(row => row._rowType === "grand_total");
    assert.equal(Number(pipelineTotal?.["aggregate:record_count"]), 3);
    assert.equal(Number(pipelineTotal?.["aggregate:activity_count"]), 3);
    assert.equal(Number(pipelineTotal?.["aggregate:win_rate"]), 50);

    const companySummary = await runReport(userId, {
      version: 1,
      baseEntityId: "companies",
      columns: [],
      aggregates: [{ id: "prospects", label: "Prospect count", operation: "sum", fieldId: "companies.prospectCount" }],
    }, { page: 1, pageSize: 10 });
    assert.equal(Number(companySummary.rows[0]?.["aggregate:prospects"]), 3);

    const contactCompanies = await runReport(userId, {
      version: 1,
      baseEntityId: "contacts",
      columns: [
        { fieldId: "contacts.email" },
        { fieldId: "contacts.company.name" },
      ],
    }, { page: 1, pageSize: 10 });
    assert.equal(contactCompanies.rows.length, 1);
    assert.equal(contactCompanies.rows[0]?.["contacts.company.name"], "Report test company");

    const currencySummary = await runReport(userId, {
      version: 1,
      baseEntityId: "prospects",
      columns: [],
      aggregates: [{ id: "value", label: "Deal value", operation: "sum", fieldId: "prospects.expectedDealValue" }],
    }, { page: 1, pageSize: 10 });
    assert.equal(currencySummary.totalRows, 2);
    const currencyTotals = new Map(currencySummary.rows.map(row => [
      row["group:prospects.currencyCode"],
      Number(row["aggregate:value"]),
    ]));
    assert.equal(currencyTotals.get("USD"), 300);
    assert.equal(currencyTotals.get("INR"), 300);
    assert.ok(currencySummary.rows.every(row => row._rowType === "currency_total"));
  } finally {
    await db.delete(prospectActionsTable).where(eq(prospectActionsTable.userId, userId));
    await db.delete(prospectStageHistoryTable).where(eq(prospectStageHistoryTable.userId, userId));
    await db.delete(prospectsTable).where(eq(prospectsTable.userId, userId));
    await db.delete(prospectActionTypesTable).where(eq(prospectActionTypesTable.userId, userId));
    await db.delete(prospectProductsTable).where(eq(prospectProductsTable.userId, userId));
    await db.delete(prospectStagesTable).where(eq(prospectStagesTable.userId, userId));
    await db.delete(contactsTable).where(eq(contactsTable.userId, userId));
    await db.delete(companiesTable).where(eq(companiesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});
