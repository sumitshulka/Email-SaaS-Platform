import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAttachmentList } from "../src/lib/campaign-attachments.ts";

const entry = (name, size, objectPath = "/objects/mailflow-attachments/user-id/01234567-89ab-4cde-8fab-0123456789ab") => ({
  objectPath,
  name,
  size,
});

describe("campaign PDF attachment limits", () => {
  it("allows at most two PDF objects within the 5 MB combined limit", () => {
    assert.equal(validateAttachmentList([]), true);
    assert.equal(validateAttachmentList([entry("brief.pdf", 2_500_000)]), true);
    assert.equal(validateAttachmentList([
      entry("brief.pdf", 2_500_000),
      entry("spec.pdf", 2_500_000, "/objects/mailflow-attachments/user-id/11234567-89ab-4cde-8fab-0123456789ab"),
    ]), true);
    assert.equal(validateAttachmentList([
      entry("one.pdf", 1),
      entry("two.pdf", 1, "/objects/mailflow-attachments/user-id/11234567-89ab-4cde-8fab-0123456789ab"),
      entry("three.pdf", 1, "/objects/mailflow-attachments/user-id/21234567-89ab-4cde-8fab-0123456789ab"),
    ]), false);
    assert.equal(validateAttachmentList([
      entry("one.pdf", 3_000_001),
      entry("two.pdf", 2_242_880, "/objects/mailflow-attachments/user-id/11234567-89ab-4cde-8fab-0123456789ab"),
    ]), false);
  });

  it("rejects non-PDF names and paths outside private campaign uploads", () => {
    assert.equal(validateAttachmentList([entry("report.exe", 100)]), false);
    assert.equal(validateAttachmentList([entry("report.pdf", 100, "/objects/other-user/file-id")]), false);
  });
});
