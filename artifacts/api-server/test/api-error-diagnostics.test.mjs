import assert from "node:assert/strict";
import test from "node:test";
import {
  describeApiError,
  sanitizeDiagnosticPath,
} from "../src/lib/api-error-diagnostics.ts";

test("diagnostic details retain database context while redacting secrets and values", () => {
  const databaseError = Object.assign(
    new Error(
      'column "placeholder_fallbacks" does not exist for customer@example.com; password=hunter2; params: ["private@example.com"]',
    ),
    {
      name: "PostgresError",
      code: "42703",
      schema: "public",
      table: "email_campaigns",
      column: "placeholder_fallbacks",
      constraint: null,
    },
  );
  const requestError = new Error("Campaign history query failed", { cause: databaseError });
  requestError.stack = [
    "DrizzleQueryError: Campaign history query failed",
    "    at loadHistory (/app/routes/sending.js:120:9)",
    "    at processRequest (/app/server.js:45:2)",
  ].join("\n");

  const details = describeApiError(requestError);

  assert.equal(details.errorName, "Error");
  assert.equal(details.rootErrorName, "PostgresError");
  assert.equal(details.errorCode, "42703");
  assert.equal(details.databaseSchema, "public");
  assert.equal(details.databaseTable, "email_campaigns");
  assert.equal(details.databaseColumn, "placeholder_fallbacks");
  assert.match(details.errorMessage, /placeholder_fallbacks/);
  assert.doesNotMatch(details.errorMessage, /customer@example\.com|private@example\.com|hunter2/);
  assert.match(details.errorMessage, /\[redacted email\]/);
  assert.match(details.errorMessage, /password=\[redacted\]/);
  assert.doesNotMatch(details.stackTrace, /Campaign history query failed/);
  assert.match(details.stackTrace, /loadHistory/);
});

test("diagnostic paths omit query values and replace record identifiers", () => {
  const path = sanitizeDiagnosticPath(
    "/api/campaigns/0f2f91a1-f240-46d1-9b75-83e85313b9cb?search=private@example.com&token=secret",
  );

  assert.equal(path, "/api/campaigns/:id");
  assert.doesNotMatch(path, /0f2f91a1|private@example.com|secret/);
});
