import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRejectedContactsCsv } from "../src/lib/contact-csv.ts";

describe("buildRejectedContactsCsv", () => {
  it("returns an empty string when there are no rejected rows", () => {
    assert.equal(buildRejectedContactsCsv(["email", "name"], []), "");
  });

  it("preserves commas, quotes, and newlines in source values and reasons", () => {
    const csv = buildRejectedContactsCsv(
      ["email", "name", "note"],
      [
        {
          sourceValues: [
            "not-an-email@example.com",
            'Doe, "Jane"',
            "first line\nsecond line",
          ],
          reason: 'Fix "email", then retry',
        },
      ],
    );

    assert.equal(
      csv,
      [
        '"email","name","note","Import rejection reason"',
        '"not-an-email@example.com","Doe, ""Jane""","first line\nsecond line","Fix ""email"", then retry"',
        "",
      ].join("\r\n"),
    );
  });

  it("keeps source values when a rejected row has extra columns", () => {
    const csv = buildRejectedContactsCsv(["email"], [
      { sourceValues: ["bad", "unmapped"], reason: "Wrong column count" },
    ]);

    assert.equal(
      csv,
      '"email","Extra column 1","Import rejection reason"\r\n"bad","unmapped","Wrong column count"\r\n',
    );
  });
});