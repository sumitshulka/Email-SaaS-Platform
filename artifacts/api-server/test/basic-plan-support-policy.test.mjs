import test from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarMonthsUtc,
  completedContinuousPaidMonths,
  getBasicPlanMilestone,
  isBasicPlanMilestoneEligible,
  isFirstFreePlanChain,
  mergeContinuousPaidWindows,
} from "../src/lib/basic-plan-support-policy.ts";

const date = (value) => new Date(`${value}T00:00:00.000Z`);

test("calendar-month milestones clamp to the last valid day", () => {
  assert.equal(
    addCalendarMonthsUtc(date("2028-01-31"), 1).toISOString(),
    "2028-02-29T00:00:00.000Z",
  );
  assert.equal(
    addCalendarMonthsUtc(date("2028-01-31"), 3).toISOString(),
    "2028-04-30T00:00:00.000Z",
  );
});

test("continuous paid terms merge only when their boundaries touch or overlap", () => {
  const windows = mergeContinuousPaidWindows(
    [
      { startsAt: date("2026-01-01"), endsAt: date("2026-02-01") },
      { startsAt: date("2026-02-01"), endsAt: date("2026-03-01") },
      { startsAt: date("2026-03-03"), endsAt: date("2026-04-03") },
    ],
    date("2026-05-01"),
  );
  assert.equal(windows.length, 2);
  assert.equal(windows[0].endsAt.toISOString(), "2026-03-01T00:00:00.000Z");
});

test("paid months are based on calendar dates and never sum across a gap", () => {
  assert.equal(
    completedContinuousPaidMonths(
      [{ startsAt: date("2026-01-31"), endsAt: date("2026-04-30") }],
      date("2026-05-01"),
    ),
    3,
  );
  assert.equal(
    completedContinuousPaidMonths(
      [
        { startsAt: date("2026-01-01"), endsAt: date("2026-03-01") },
        { startsAt: date("2026-03-03"), endsAt: date("2026-05-03") },
      ],
      date("2026-06-01"),
    ),
    2,
  );
});

test("request stages stay sequential even when a user has more paid tenure", () => {
  assert.deepEqual(getBasicPlanMilestone(0), {
    milestone: 1,
    requiredPaidMonths: 0,
  });
  assert.deepEqual(getBasicPlanMilestone(1), {
    milestone: 2,
    requiredPaidMonths: 3,
  });
  assert.deepEqual(getBasicPlanMilestone(2), {
    milestone: 3,
    requiredPaidMonths: 6,
  });
  assert.deepEqual(getBasicPlanMilestone(3), {
    milestone: null,
    requiredPaidMonths: null,
  });
  assert.equal(
    isBasicPlanMilestoneEligible({
      milestone: 1,
      firstFreePlan: false,
      completedPaidMonths: 6,
    }),
    false,
  );
  assert.equal(
    isBasicPlanMilestoneEligible({
      milestone: 2,
      firstFreePlan: true,
      completedPaidMonths: 2,
    }),
    false,
  );
  assert.equal(
    isBasicPlanMilestoneEligible({
      milestone: 3,
      firstFreePlan: false,
      completedPaidMonths: 6,
    }),
    true,
  );
});

test("first Free-plan eligibility starts at a customer's first Free term", () => {
  const terms = [
    {
      id: "paid-before-free",
      packageId: "paid",
      packageType: "primary",
      amountMinor: 100,
      startsAt: date("2026-01-01"),
      endsAt: date("2026-02-01"),
    },
    {
      id: "free-one",
      packageId: "free",
      packageType: "primary",
      amountMinor: 0,
      startsAt: date("2026-02-01"),
      endsAt: date("2026-03-01"),
    },
    {
      id: "free-two",
      packageId: "free",
      packageType: "primary",
      amountMinor: 0,
      startsAt: date("2026-03-01"),
      endsAt: date("2026-04-01"),
    },
  ];
  assert.equal(isFirstFreePlanChain(terms, terms[2]), true);
  assert.equal(
    isFirstFreePlanChain(
      [
        ...terms,
        {
          id: "paid-gap",
          packageId: "paid",
          packageType: "primary",
          amountMinor: 100,
          startsAt: date("2026-04-01"),
          endsAt: date("2026-05-01"),
        },
        {
          id: "free-after-paid",
          packageId: "free",
          packageType: "primary",
          amountMinor: 0,
          startsAt: date("2026-05-01"),
          endsAt: date("2026-06-01"),
        },
      ],
      {
        id: "free-after-paid",
        packageId: "free",
        packageType: "primary",
        amountMinor: 0,
        startsAt: date("2026-05-01"),
        endsAt: date("2026-06-01"),
      },
    ),
    false,
  );
});
