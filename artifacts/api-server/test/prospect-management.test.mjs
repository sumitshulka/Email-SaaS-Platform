import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import { test } from "node:test";

const enabled = process.env.RUN_PROSPECT_MANAGEMENT_DB_TESTS === "1";

test("prospects preserve tenant, stage, currency, action, tag, and contact invariants", {
  skip: !enabled ? "Set RUN_PROSPECT_MANAGEMENT_DB_TESTS=1 to run against a disposable test database." : false,
}, async () => {
  const [
    { db, usersTable, contactsTable, contactTagsTable, contactTagAssignmentsTable,
      prospectsTable, prospectProductsTable, prospectCurrenciesTable, prospectStagesTable,
      prospectStageTransitionsTable, prospectActionTypesTable, prospectStageHistoryTable,
      prospectActionsTable, prospectFollowUpsTable, prospectTagAssignmentsTable },
    { default: prospectSettingsRouter },
    { default: prospectsRouter },
    { default: prospectFollowUpsRouter },
    { default: sendingRouter },
  ] = await Promise.all([
    import("@workspace/db"),
    import("../src/routes/prospect-settings.ts"),
    import("../src/routes/prospects.ts"),
    import("../src/routes/prospect-follow-ups.ts"),
    import("../src/routes/sending.ts"),
  ]);
  const tenantIds = [randomUUID(), randomUUID()];
  const testUsers = tenantIds.map((id, index) => ({
    id,
    username: `prospect_test_${id.slice(0, 8)}`,
    firstName: "Prospect",
    lastName: `Tester${index}`,
    email: `prospect-test-${id}@example.invalid`,
    passwordHash: "unused-test-hash",
    role: "USER",
    timezone: "Asia/Kolkata",
    emailVerified: true,
  }));
  const contactId = randomUUID();
  const tagIds = [randomUUID(), randomUUID()];
  const servers = [];

  function startTenantApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.authUser = {
        id: user.id,
        role: "USER",
        timezone: user.timezone,
        mustChangeCredentials: false,
      };
      next();
    });
    app.use(prospectSettingsRouter);
    app.use(prospectFollowUpsRouter);
    app.use(prospectsRouter);
    app.use(sendingRouter);
    const server = app.listen(0);
    servers.push(server);
    return new Promise(resolve => server.once("listening", () => resolve(server)));
  }

  async function call(server, path, method = "GET", body) {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data = null;
    if (response.status !== 204) {
      const raw = await response.text();
      try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    }
    return { status: response.status, data };
  }

  async function cleanup() {
    for (const server of servers) {
      await new Promise(resolve => server.close(resolve));
    }
    await db.transaction(async tx => {
      for (const userId of tenantIds) {
        await tx.delete(prospectFollowUpsTable).where(eq(prospectFollowUpsTable.userId, userId));
        await tx.delete(prospectActionsTable).where(eq(prospectActionsTable.userId, userId));
        await tx.delete(prospectTagAssignmentsTable).where(eq(prospectTagAssignmentsTable.userId, userId));
        await tx.delete(prospectStageHistoryTable).where(eq(prospectStageHistoryTable.userId, userId));
        await tx.delete(prospectsTable).where(eq(prospectsTable.userId, userId));
        await tx.delete(prospectStageTransitionsTable).where(eq(prospectStageTransitionsTable.userId, userId));
        await tx.delete(prospectActionTypesTable).where(eq(prospectActionTypesTable.userId, userId));
        await tx.delete(prospectCurrenciesTable).where(eq(prospectCurrenciesTable.userId, userId));
        await tx.delete(prospectProductsTable).where(eq(prospectProductsTable.userId, userId));
        await tx.delete(prospectStagesTable).where(eq(prospectStagesTable.userId, userId));
        await tx.delete(contactTagAssignmentsTable).where(eq(contactTagAssignmentsTable.userId, userId));
        await tx.delete(contactTagsTable).where(eq(contactTagsTable.userId, userId));
        await tx.delete(contactsTable).where(eq(contactsTable.userId, userId));
        await tx.delete(usersTable).where(eq(usersTable.id, userId));
      }
    });
  }

  let mainServer;
  let otherTenantServer;
  try {
    await db.insert(usersTable).values(testUsers);
    await db.insert(contactsTable).values({
      id: contactId,
      userId: tenantIds[0],
      name: "Prospect Test Contact",
      firstName: "Prospect",
      lastName: "Contact",
      email: `prospect-contact-${contactId}@example.invalid`,
      subscribed: true,
    });
    await db.insert(contactTagsTable).values([
      { id: tagIds[0], userId: tenantIds[0], name: "Contact source" },
      { id: tagIds[1], userId: tenantIds[0], name: "Deal priority" },
    ]);
    await db.insert(contactTagAssignmentsTable).values({
      userId: tenantIds[0],
      contactId,
      tagId: tagIds[0],
      slot: 1,
    });
    [mainServer, otherTenantServer] = await Promise.all([
      startTenantApp(testUsers[0]),
      startTenantApp(testUsers[1]),
    ]);

    const currencySave = await call(mainServer, "/prospect-currencies", "PUT", {
      currencies: ["INR", "USD"],
      defaultCurrencyCode: "INR",
    });
    assert.equal(currencySave.status, 200);
    const categoryList = await call(mainServer, "/prospect-product-categories");
    assert.equal(categoryList.status, 200);
    assert.ok(categoryList.data.some(category => category.isSystem && category.name === "Consulting"));
    const systemCategory = categoryList.data.find(category => category.isSystem);
    assert.equal((await call(mainServer, `/prospect-product-categories/${systemCategory.id}`, "DELETE")).status, 400);
    const customCategory = await call(mainServer, "/prospect-product-categories", "POST", { name: "Services" });
    assert.equal(customCategory.status, 201);
    assert.equal(customCategory.data.isSystem, false);
    const otherTenantCategories = await call(otherTenantServer, "/prospect-product-categories");
    assert.ok(!otherTenantCategories.data.some(category => category.name === "Services"));
    const duplicateCategory = await call(mainServer, "/prospect-product-categories", "POST", { name: "services" });
    assert.equal(duplicateCategory.status, 409);
    const productResponse = await call(mainServer, "/prospect-products", "POST", {
      name: "Consulting",
      itemType: "service",
      description: "Commercial consulting",
      category: customCategory.data.name,
      active: true,
      displayOrder: 1,
    });
    assert.equal(productResponse.status, 201);
    assert.equal(productResponse.data.itemType, "service");
    const productId = productResponse.data.id;

    async function createStage(name, probability, stageType = "active", terminalOutcome = null, displayOrder = 1) {
      const response = await call(mainServer, "/prospect-stages", "POST", {
        name,
        description: `${name} stage`,
        probability,
        stageType,
        terminalOutcome,
        active: true,
        displayOrder,
      });
      assert.equal(response.status, 201, JSON.stringify(response.data));
      return response.data;
    }
    const qualification = await createStage("Qualification", 20, "active", null, 1);
    const proposal = await createStage("Proposal", 70, "active", null, 2);
    const won = await createStage("Won", 100, "terminal", "won", 3);
    const transitionSave = await call(mainServer, `/prospect-stages/${qualification.id}/transitions`, "PUT", {
      toStageIds: [proposal.id],
    });
    assert.equal(transitionSave.status, 200);
    for (const [source, destinations] of [
      [proposal, [qualification.id, won.id]],
      [won, [proposal.id]],
    ]) {
      const response = await call(mainServer, `/prospect-stages/${source.id}/transitions`, "PUT", {
        toStageIds: destinations,
      });
      assert.equal(response.status, 200);
    }
    const actionTypeResponse = await call(mainServer, "/prospect-action-types", "POST", {
      name: "Discovery call",
      description: "",
      active: true,
      displayOrder: 1,
    });
    assert.equal(actionTypeResponse.status, 201);

    async function createProspect(name, currencyCode, value, prospectTagIds = []) {
      const response = await call(mainServer, "/prospects", "POST", {
        contactId,
        name,
        productId,
        expectedDealValue: value,
        currencyCode,
        expectedClosureDate: "2026-12-31",
        stageId: qualification.id,
        notes: `Initial notes for ${name}`,
        prospectTagIds,
      });
      assert.equal(response.status, 201, JSON.stringify(response.data));
      return response.data.prospect;
    }
    const first = await createProspect("First deal", "INR", 100, [tagIds[1]]);
    const second = await createProspect("Second deal", "USD", 50);
    assert.equal(first.contact.email, `prospect-contact-${contactId}@example.invalid`);
    assert.deepEqual(first.contact.tags.map(tag => tag.id), [tagIds[0]]);
    assert.deepEqual(first.prospectTags.map(tag => tag.id), [tagIds[1]]);

    const linked = await call(mainServer, `/contacts/${contactId}/prospects`);
    assert.equal(linked.status, 200);
    assert.equal(linked.data.length, 2, "one contact can own multiple separate prospects");
    const tagFilter = await call(mainServer, `/prospects?prospectTagId=${tagIds[1]}`);
    assert.equal(tagFilter.status, 200);
    assert.deepEqual(tagFilter.data.prospects.map(item => item.id), [first.id]);
    const contactTagFilter = await call(mainServer, `/prospects?contactTagId=${tagIds[0]}`);
    assert.equal(contactTagFilter.data.total, 2, "contact tags remain searchable separately");

    const blockedCurrencyRemoval = await call(mainServer, "/prospect-currencies", "PUT", {
      currencies: ["USD"],
      defaultCurrencyCode: "USD",
    });
    assert.equal(blockedCurrencyRemoval.status, 409);

    const beforeStageMetrics = await call(mainServer, "/prospect-dashboard");
    assert.equal(beforeStageMetrics.status, 200);
    assert.equal(beforeStageMetrics.data.totalActive, 2);
    const inrTotals = beforeStageMetrics.data.currencyTotals.find(item => item.currencyCode === "INR");
    const usdTotals = beforeStageMetrics.data.currencyTotals.find(item => item.currencyCode === "USD");
    assert.equal(inrTotals.activeValue, 100);
    assert.equal(inrTotals.weightedValue, 20);
    assert.equal(usdTotals.activeValue, 50);
    assert.equal(usdTotals.weightedValue, 10);

    const wrongTenantRead = await call(otherTenantServer, `/prospects/${first.id}`);
    assert.equal(wrongTenantRead.status, 404, "another tenant cannot read a prospect by UUID");

    const invalidTransition = await call(mainServer, `/prospects/${first.id}/stage`, "POST", {
      newStageId: won.id,
      reason: "Skipping configured stage",
    });
    assert.equal(invalidTransition.status, 400);
    const missingReason = await call(mainServer, `/prospects/${first.id}/stage`, "POST", {
      newStageId: proposal.id,
      reason: "  ",
    });
    assert.equal(missingReason.status, 400);

    const firstMove = await call(mainServer, `/prospects/${first.id}/stage`, "POST", {
      newStageId: proposal.id,
      reason: "Discovery completed; proposal prepared.",
    });
    assert.equal(firstMove.status, 200);
    const backMove = await call(mainServer, `/prospects/${first.id}/stage`, "POST", {
      newStageId: qualification.id,
      reason: "Revisit qualification after budget review.",
    });
    assert.equal(backMove.status, 200, "configured backward transitions are allowed");
    const reentryMove = await call(mainServer, `/prospects/${first.id}/stage`, "POST", {
      newStageId: proposal.id,
      reason: "Budget confirmed; return to proposal.",
    });
    assert.equal(reentryMove.status, 200, "re-entering a stage creates a new history period");

    const action = await call(mainServer, `/prospects/${first.id}/actions`, "POST", {
      actionTypeId: actionTypeResponse.data.id,
      actionDate: "2026-02-15",
      notes: "Reviewed commercial proposal.",
    });
    assert.equal(action.status, 201);
    assert.equal(action.data.stageHistoryId, reentryMove.data.prospect.currentStage.id === proposal.id
      ? (await call(mainServer, `/prospects/${first.id}/history`)).data.at(-1).id
      : "unexpected");
    const filteredAction = await call(mainServer, `/prospects/${first.id}/actions?fromDate=2026-02-01&toDate=2026-02-28`);
    assert.equal(filteredAction.status, 200);
    assert.equal(filteredAction.data.length, 1);

    const followUp = await call(mainServer, "/prospect-follow-ups", "POST", {
      prospectId: first.id,
      actionTypeId: actionTypeResponse.data.id,
      followUpDate: "2026-02-20",
      notes: "Check whether procurement approved the revised proposal.",
    });
    assert.equal(followUp.status, 201, JSON.stringify(followUp.data));
    assert.equal(followUp.data.status, "pending");
    assert.equal(followUp.data.prospectName, "First deal");
    const invalidCalendarDate = await call(mainServer, "/prospect-follow-ups", "POST", {
      prospectId: first.id,
      actionTypeId: actionTypeResponse.data.id,
      followUpDate: "2026-02-30",
      notes: "This date does not exist.",
    });
    assert.equal(invalidCalendarDate.status, 400);
    const followUpRange = await call(mainServer, "/prospect-follow-ups?fromDate=2026-02-01&toDate=2026-02-28&status=pending");
    assert.equal(followUpRange.status, 200);
    assert.equal(followUpRange.data.some(item => item.id === followUp.data.id), true);
    const otherTenantFollowUps = await call(otherTenantServer, "/prospect-follow-ups?status=all");
    assert.equal(otherTenantFollowUps.status, 200);
    assert.equal(otherTenantFollowUps.data.some(item => item.id === followUp.data.id), false);
    const crossTenantUpdate = await call(otherTenantServer, `/prospect-follow-ups/${followUp.data.id}`, "PATCH", {
      status: "completed",
    });
    assert.equal(crossTenantUpdate.status, 404);
    const rescheduledFollowUp = await call(mainServer, `/prospect-follow-ups/${followUp.data.id}`, "PATCH", {
      followUpDate: "2026-02-23",
      notes: "Procurement review moved to Monday.",
    });
    assert.equal(rescheduledFollowUp.status, 200);
    assert.equal(rescheduledFollowUp.data.followUpDate, "2026-02-23");
    await db.update(prospectActionTypesTable).set({ active: false })
      .where(eq(prospectActionTypesTable.id, actionTypeResponse.data.id));
    const editWithInactiveActionType = await call(mainServer, `/prospect-follow-ups/${followUp.data.id}`, "PATCH", {
      actionTypeId: actionTypeResponse.data.id,
      notes: "Procurement review is still pending.",
    });
    assert.equal(editWithInactiveActionType.status, 200);
    await db.update(prospectActionTypesTable).set({ active: true })
      .where(eq(prospectActionTypesTable.id, actionTypeResponse.data.id));
    const completedFollowUp = await call(mainServer, `/prospect-follow-ups/${followUp.data.id}`, "PATCH", {
      status: "completed",
    });
    assert.equal(completedFollowUp.status, 200, JSON.stringify(completedFollowUp.data));
    assert.equal(completedFollowUp.data.completedAt !== null, true);
    const completedHistory = await call(mainServer, `/prospects/${first.id}/history`);
    assert.equal(completedHistory.data.at(-1).actions.some(item =>
      item.notes === "Procurement review is still pending."), true);
    const duplicateCompletion = await call(mainServer, `/prospect-follow-ups/${followUp.data.id}`, "PATCH", {
      status: "completed",
    });
    assert.equal(duplicateCompletion.status, 409);
    const cancellableFollowUp = await call(mainServer, "/prospect-follow-ups", "POST", {
      prospectId: first.id,
      actionTypeId: actionTypeResponse.data.id,
      followUpDate: "2026-02-24",
      notes: "Cancel this test follow-up.",
    });
    assert.equal(cancellableFollowUp.status, 201);
    const cancelledFollowUp = await call(mainServer, `/prospect-follow-ups/${cancellableFollowUp.data.id}`, "PATCH", {
      status: "cancelled",
    });
    assert.equal(cancelledFollowUp.status, 200);
    assert.equal(cancelledFollowUp.data.status, "cancelled");
    assert.equal(cancelledFollowUp.data.completedAt, null);
    const todayFollowUps = await call(mainServer, "/prospect-follow-ups/today");
    assert.equal(todayFollowUps.status, 200);
    assert.match(todayFollowUps.data.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Number.isInteger(todayFollowUps.data.overdueCount), true);

    const updatedProposal = await call(mainServer, `/prospect-stages/${proposal.id}`, "PATCH", {
      name: "Proposal",
      description: "Updated probability",
      probability: 90,
      stageType: "active",
      terminalOutcome: null,
      displayOrder: 2,
      active: true,
    });
    assert.equal(updatedProposal.status, 200);
    const afterProbabilityChange = await call(mainServer, `/prospects/${first.id}`);
    assert.equal(afterProbabilityChange.data.prospect.currentProbability, 90);
    const audit = await call(mainServer, `/prospects/${first.id}/history`);
    assert.equal(audit.status, 200);
    assert.equal(audit.data[0].eventType, "created");
    assert.equal(audit.data[0].notesSnapshot, "Initial notes for First deal");
    assert.equal(audit.data[1].newProbability, 70, "audit keeps the probability used at that historical transition");
    assert.equal(audit.data.filter(entry => entry.newStage.id === proposal.id).length, 2);
    assert.equal(audit.data.at(-1).actions[0].stageHistoryId, action.data.stageHistoryId);

    const terminalMove = await call(mainServer, `/prospects/${first.id}/stage`, "POST", {
      newStageId: won.id,
      reason: "Customer approved the commercial proposal.",
    });
    assert.equal(terminalMove.status, 200);
    assert.equal(terminalMove.data.prospect.closureOutcome, "won");
    const wonMetrics = await call(mainServer, "/prospect-dashboard");
    assert.equal(wonMetrics.data.totalWon, 1);
    const inrWonTotal = wonMetrics.data.currencyTotals.find(item => item.currencyCode === "INR");
    assert.equal(inrWonTotal.wonValue, 100);
    assert.equal(inrWonTotal.activeValue, 0);

    const inactiveProduct = await call(mainServer, `/prospect-products/${productId}`, "PATCH", {
      name: "Consulting",
      itemType: "service",
      description: "Commercial consulting",
      category: customCategory.data.name,
      active: false,
      displayOrder: 1,
    });
    assert.equal(inactiveProduct.status, 200);
    const usedCategoryDelete = await call(mainServer, `/prospect-product-categories/${customCategory.data.id}`, "DELETE");
    assert.equal(usedCategoryDelete.status, 409);
    const reclassifiedProduct = await call(mainServer, `/prospect-products/${productId}`, "PATCH", {
      name: "Consulting",
      itemType: "service",
      description: "Commercial consulting",
      category: "Consulting",
      active: false,
      displayOrder: 1,
    });
    assert.equal(reclassifiedProduct.status, 200);
    const removedCategory = await call(mainServer, `/prospect-product-categories/${customCategory.data.id}`, "DELETE");
    assert.equal(removedCategory.status, 204);
    const newDealWithInactiveProduct = await call(mainServer, "/prospects", "POST", {
      contactId,
      name: "Blocked deal",
      productId,
      expectedDealValue: 5,
      currencyCode: "USD",
      expectedClosureDate: "2026-12-31",
      stageId: qualification.id,
      notes: "Should not create.",
      prospectTagIds: [],
    });
    assert.equal(newDealWithInactiveProduct.status, 404);

    const deletedContact = await call(mainServer, `/contacts/${contactId}`, "DELETE");
    assert.equal(deletedContact.status, 409, "a linked contact cannot be hard-deleted");

    const removeClosedCurrency = await call(mainServer, "/prospect-currencies", "PUT", {
      currencies: ["USD"],
      defaultCurrencyCode: "USD",
    });
    assert.equal(removeClosedCurrency.status, 200);
    const historicalCurrency = await call(mainServer, `/prospects/${first.id}`);
    assert.equal(historicalCurrency.data.prospect.currencyCode, "INR", "removing a currency does not rewrite historical deal values");
    const reopenWithoutCurrency = await call(mainServer, `/prospects/${first.id}/stage`, "POST", {
      newStageId: proposal.id,
      reason: "Reopened for an amended offer.",
    });
    assert.equal(reopenWithoutCurrency.status, 409);
    await call(mainServer, "/prospect-currencies", "PUT", {
      currencies: ["INR", "USD"],
      defaultCurrencyCode: "USD",
    });
    const reopen = await call(mainServer, `/prospects/${first.id}/stage`, "POST", {
      newStageId: proposal.id,
      reason: "Currency restored and amended offer reopened.",
    });
    assert.equal(reopen.status, 200);
    assert.equal(reopen.data.prospect.closureOutcome, null);
    assert.equal(reopen.data.prospect.actualClosureDate, null);
  } finally {
    await cleanup();
  }
});
