import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateProratedUpgradeAmountMinor,
  comparePrimaryPlanLimits,
} from "../src/lib/subscription-plan-changes.ts";

const currentLimits = {
  contactLimit: 500,
  emailAccountLimit: 1,
  researchAllowance: 5,
  aiEmailAssistAllowance: 0,
};

describe("primary plan change rules", () => {
  it("classifies upgrades, downgrades, mixed switches, and equal limits", () => {
    assert.equal(
      comparePrimaryPlanLimits(currentLimits, {
        contactLimit: 1_000,
        emailAccountLimit: 2,
        researchAllowance: 10,
        aiEmailAssistAllowance: 5,
      }),
      "upgrade",
    );
    assert.equal(
      comparePrimaryPlanLimits(currentLimits, {
        contactLimit: 250,
        emailAccountLimit: 1,
        researchAllowance: 2,
        aiEmailAssistAllowance: 0,
      }),
      "downgrade",
    );
    assert.equal(
      comparePrimaryPlanLimits(currentLimits, {
        contactLimit: 1_000,
        emailAccountLimit: 1,
        researchAllowance: 2,
        aiEmailAssistAllowance: 0,
      }),
      "switch",
    );
    assert.equal(comparePrimaryPlanLimits(currentLimits, { ...currentLimits }), "same");
  });

  it("charges only the daily price difference for the remaining term", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    assert.equal(
      calculateProratedUpgradeAmountMinor({
        currentPackage: { amountMinor: 59_000, currency: "INR", periodDays: 30 },
        targetPackage: { amountMinor: 99_000, currency: "INR", periodDays: 30 },
        now,
        endsAt: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
      }),
      20_000,
    );
  });

  it("returns zero when no upgrade amount is due and does not create negative credit", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const endsAt = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    assert.equal(
      calculateProratedUpgradeAmountMinor({
        currentPackage: { amountMinor: 10_000, currency: "INR", periodDays: 30 },
        targetPackage: { amountMinor: 5_000, currency: "INR", periodDays: 30 },
        now,
        endsAt,
      }),
      0,
    );
    assert.equal(
      calculateProratedUpgradeAmountMinor({
        currentPackage: { amountMinor: 10_000, currency: "INR", periodDays: 30 },
        targetPackage: { amountMinor: 20_000, currency: "INR", periodDays: 30 },
        now,
        endsAt: now,
      }),
      0,
    );
  });

  it("does not prorate across currencies", () => {
    assert.equal(
      calculateProratedUpgradeAmountMinor({
        currentPackage: { amountMinor: 10_000, currency: "INR", periodDays: 30 },
        targetPackage: { amountMinor: 20_000, currency: "USD", periodDays: 30 },
        now: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-10-16T00:00:00.000Z"),
      }),
      null,
    );
  });
});
