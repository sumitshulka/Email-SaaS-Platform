import assert from "node:assert/strict";
import { test } from "node:test";

test("report catalogue templates use only fields exposed by their base entity", async () => {
  const { getReportWorkareaCatalog, reportTemplates } = await import(
    "../src/lib/report-workarea-catalog.ts"
  );
  const { validateReportDefinition } = await import(
    "../src/lib/report-workarea-query.ts"
  );
  const { GetReportWorkareaCatalogResponse } = await import("@workspace/api-zod");

  assert.equal(
    GetReportWorkareaCatalogResponse.safeParse(getReportWorkareaCatalog()).success,
    true,
  );
  assert.ok(reportTemplates.length >= 6);
  for (const template of reportTemplates) {
    assert.doesNotThrow(
      () => validateReportDefinition(template.definition),
      `${template.id} should be executable from the declared catalogue`,
    );
  }
});

test("report definition validation rejects unknown fields and unsupported grouped operations", async () => {
  const { validateReportDefinition, ReportDefinitionError } = await import(
    "../src/lib/report-workarea-query.ts"
  );
  const base = {
    version: 1,
    baseEntityId: "contacts",
    columns: [{ fieldId: "contacts.email" }],
  };

  assert.throws(
    () => validateReportDefinition({ ...base, columns: [{ fieldId: "contacts.passwordHash" }] }),
    (error) => error instanceof ReportDefinitionError && error.statusCode === 422,
  );
  assert.throws(
    () => validateReportDefinition({ ...base, baseEntityId: "untrustedTable" }),
    /Choose an available report source/,
  );
  assert.doesNotThrow(() => validateReportDefinition({
    version: 1,
    baseEntityId: "prospects",
    columns: [],
    groupBy: [{ fieldId: "prospects.stage.name" }],
    aggregates: [{ id: "count", label: "Prospects", operation: "count" }],
  }));
  assert.throws(
    () => validateReportDefinition({
      version: 1,
      baseEntityId: "contacts",
      columns: [],
      groupBy: [{ fieldId: "contacts.tags" }],
      aggregates: [{ id: "count", label: "Contacts", operation: "count" }],
    }),
    /cannot be used as a grouping field/,
  );
});

test("currency summaries group automatically and keep the field out of the saved definition", async () => {
  const { normalizeReportDefinition, validateReportDefinition } = await import(
    "../src/lib/report-workarea-query.ts"
  );
  const definition = {
    version: 1,
    baseEntityId: "prospects",
    columns: [],
    groupBy: [{ fieldId: "prospects.stage.name" }],
    aggregates: [{
      id: "value",
      label: "Weighted value",
      operation: "sum",
      fieldId: "prospects.weightedPipelineValue",
    }],
    subtotals: true,
    grandTotal: true,
  };
  const validated = validateReportDefinition(definition);
  assert.equal(validated.groupBy[0].fieldId, "prospects.currencyCode");
  assert.equal(validated.groupBy[0].implicitCurrency, true);
  const normalized = normalizeReportDefinition(definition);
  assert.deepEqual(normalized.groupBy, [{ fieldId: "prospects.stage.name" }]);
  assert.equal(normalized.aggregates[0].fieldId, "prospects.weightedPipelineValue");
  assert.throws(
    () => validateReportDefinition({
      ...definition,
      aggregates: [
        { id: "win", label: "Win rate", operation: "win_rate", fieldId: "prospects.name" },
      ],
    }),
    /not available/,
  );
});

test("chart definitions reference only selected measures and grouping fields", async () => {
  const { normalizeReportDefinition, validateReportDefinition } = await import(
    "../src/lib/report-workarea-query.ts"
  );
  const definition = {
    version: 1,
    baseEntityId: "prospects",
    columns: [],
    groupBy: [{ fieldId: "prospects.stage.name" }],
    aggregates: [{ id: "records", label: "Prospect count", operation: "count" }],
    visualization: {
      type: "bar",
      categoryFieldId: "group:prospects.stage.name",
      valueFieldId: "aggregate:records",
    },
  };
  assert.doesNotThrow(() => validateReportDefinition(definition));
  assert.deepEqual(normalizeReportDefinition(definition).visualization, definition.visualization);
  assert.throws(
    () => validateReportDefinition({
      ...definition,
      visualization: { ...definition.visualization, categoryFieldId: "group:prospects.name" },
    }),
    /grouping field/,
  );
});

test("nested filters are type-checked and user values remain parameter values", async () => {
  const { validateReportDefinition, ReportDefinitionError, normalizeReportDefinition } = await import(
    "../src/lib/report-workarea-query.ts"
  );
  const definition = {
    version: 1,
    baseEntityId: "contacts",
    columns: [{ fieldId: "contacts.name" }],
    filters: {
      kind: "group",
      logic: "and",
      children: [
        {
          kind: "condition",
          fieldId: "contacts.name",
          operator: "contains",
          value: "x%' OR 1=1 --",
        },
        {
          kind: "group",
          logic: "or",
          children: [
            { kind: "condition", fieldId: "contacts.subscribed", operator: "is_true" },
            { kind: "condition", fieldId: "contacts.subscribed", operator: "is_false" },
          ],
        },
      ],
    },
  };

  assert.doesNotThrow(() => validateReportDefinition(definition));
  const normalized = normalizeReportDefinition({
    ...definition,
    ignoredClientProperty: "not persisted",
  });
  assert.equal("ignoredClientProperty" in normalized, false);
  assert.equal(normalized.filters.children[0].value, "x%' OR 1=1 --");
  assert.throws(
    () => validateReportDefinition({
      ...definition,
      filters: {
        kind: "condition",
        fieldId: "contacts.subscribed",
        operator: "contains",
        value: "true",
      },
    }),
    (error) => error instanceof ReportDefinitionError && /filter is not available/.test(error.message),
  );
});

test("CSV spreadsheet formula prefixes are neutralized", async () => {
  const { protectSpreadsheetFormula } = await import(
    "../src/lib/report-workarea-query.ts"
  );
  assert.equal(protectSpreadsheetFormula("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(protectSpreadsheetFormula("  +SUM(A1:A2)"), "'  +SUM(A1:A2)");
  assert.equal(protectSpreadsheetFormula("ordinary text"), "ordinary text");
});

test("report query rejects excessive nested filter depth and invalid values", async () => {
  const { validateReportDefinition, ReportDefinitionError } = await import(
    "../src/lib/report-workarea-query.ts"
  );
  let nested = {
    kind: "condition",
    fieldId: "contacts.name",
    operator: "contains",
    value: "A",
  };
  for (let index = 0; index < 7; index += 1) {
    nested = { kind: "group", logic: "and", children: [nested] };
  }
  assert.throws(
    () => validateReportDefinition({
      version: 1,
      baseEntityId: "contacts",
      columns: [{ fieldId: "contacts.name" }],
      filters: nested,
    }),
    (error) => error instanceof ReportDefinitionError && /nested up to five/.test(error.message),
  );
  assert.throws(
    () => validateReportDefinition({
      version: 1,
      baseEntityId: "prospects",
      columns: [{ fieldId: "prospects.expectedDealValue" }],
      filters: {
        kind: "condition",
        fieldId: "prospects.expectedDealValue",
        operator: "greater_than",
        value: "not-a-number",
      },
    }),
    /valid number/,
  );
});

test("grouped queries and calculated metrics execute against empty tenant scope", {
  skip: !process.env.RUN_REPORT_WORKAREA_DB_TESTS,
}, async () => {
  const { runReport } = await import("../src/lib/report-workarea-query.ts");
  const userId = "00000000-0000-4000-8000-000000000000";
  const definitions = [
    {
      version: 1,
      baseEntityId: "prospects",
      columns: [],
      groupBy: [{ fieldId: "prospects.stage.name" }],
      aggregates: [
        { id: "weighted", label: "Weighted pipeline", operation: "sum", fieldId: "prospects.weightedPipelineValue" },
        { id: "win_rate", label: "Win rate", operation: "win_rate", fieldId: "prospects.stage.outcome" },
      ],
      subtotals: true,
      grandTotal: true,
    },
    {
      version: 1,
      baseEntityId: "prospectStageHistory",
      columns: [],
      groupBy: [{ fieldId: "prospectStageHistory.createdAt", interval: "month" }],
      aggregates: [
        { id: "duration", label: "Average stage duration", operation: "avg", fieldId: "prospectStageHistory.daysInStage" },
      ],
    },
    {
      version: 1,
      baseEntityId: "companies",
      columns: [],
      aggregates: [
        { id: "prospects", label: "Prospects", operation: "sum", fieldId: "companies.prospectCount" },
        { id: "campaigns", label: "Campaigns", operation: "sum", fieldId: "companies.campaignCount" },
      ],
    },
  ];
  for (const definition of definitions) {
    const result = await runReport(userId, definition, {
      page: 1,
      pageSize: 10,
      timeZone: "Asia/Kolkata",
    });
    assert.ok(Number.isInteger(result.totalRows));
    assert.ok(result.rows.length <= 10);
  }
});
