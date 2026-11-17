import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCompanyProspectValues } from "../src/lib/company-prospect-summary.ts";

test("company prospect value includes linked deals while revenue includes only won deals", () => {
  const totals = summarizeCompanyProspectValues([
    { currencyCode: "USD", expectedDealValue: "100.25", stageType: "active", terminalOutcome: null },
    { currencyCode: "USD", expectedDealValue: "40.50", stageType: "terminal", terminalOutcome: "won" },
    { currencyCode: "USD", expectedDealValue: "75", stageType: "terminal", terminalOutcome: "lost" },
    { currencyCode: "INR", expectedDealValue: "1000", stageType: "active", terminalOutcome: null },
    { currencyCode: "EUR", expectedDealValue: "30", stageType: "terminal", terminalOutcome: "other" },
  ]);

  assert.deepEqual(totals, [
    { currencyCode: "EUR", totalProspectValue: 30, totalRevenueValue: 0 },
    { currencyCode: "INR", totalProspectValue: 1000, totalRevenueValue: 0 },
    { currencyCode: "USD", totalProspectValue: 215.75, totalRevenueValue: 40.5 },
  ]);
});
