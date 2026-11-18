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

test("report definition validation rejects unknown fields and non-tabular operations", async () => {
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
    () => validateReportDefinition({ ...base, groupBy: ["contacts.companyName"] }),
    /Grouped reports are not available/,
  );
  assert.throws(
    () => validateReportDefinition({ ...base, baseEntityId: "untrustedTable" }),
    /Choose an available report source/,
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
