import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateAdminAddOnGiftCorrection } from "../src/lib/add-on-entitlements.ts";

describe("admin add-on gift correction", () => {
  it("removes only research and AI-assist credits beyond recorded usage", () => {
    const result = calculateAdminAddOnGiftCorrection({
      researchAllowance: 8,
      researchUsed: 5,
      aiEmailAssistAllowance: 6,
      aiEmailAssistUsed: 4,
      additionalMailboxCount: 0,
      configuredAccounts: 1,
      baseLimit: 1,
      otherSlots: 0,
    });

    assert.deepEqual(result, {
      removed: {
        researchAllowance: 3,
        aiEmailAssistAllowance: 2,
        additionalMailboxCount: 0,
      },
      retained: {
        researchAllowance: 5,
        aiEmailAssistAllowance: 4,
        additionalMailboxCount: 0,
      },
    });
  });

  it("preserves reserved AI-assist use even when it exhausts the allowance", () => {
    const result = calculateAdminAddOnGiftCorrection({
      researchAllowance: 2,
      researchUsed: 3,
      aiEmailAssistAllowance: 2,
      aiEmailAssistUsed: 2,
      additionalMailboxCount: 1,
      configuredAccounts: 3,
      baseLimit: 1,
      otherSlots: 0,
    });

    assert.deepEqual(result, {
      removed: {
        researchAllowance: 0,
        aiEmailAssistAllowance: 0,
        additionalMailboxCount: 0,
      },
      retained: {
        researchAllowance: 2,
        aiEmailAssistAllowance: 2,
        additionalMailboxCount: 1,
      },
    });
  });

  it("removes mailbox slots only when existing mailboxes fit within other access", () => {
    const result = calculateAdminAddOnGiftCorrection({
      researchAllowance: 0,
      researchUsed: 0,
      aiEmailAssistAllowance: 0,
      aiEmailAssistUsed: 0,
      additionalMailboxCount: 4,
      configuredAccounts: 5,
      baseLimit: 1,
      otherSlots: 2,
    });

    assert.deepEqual(result.removed, {
      researchAllowance: 0,
      aiEmailAssistAllowance: 0,
      additionalMailboxCount: 2,
    });
    assert.deepEqual(result.retained, {
      researchAllowance: 0,
      aiEmailAssistAllowance: 0,
      additionalMailboxCount: 2,
    });
  });
});
