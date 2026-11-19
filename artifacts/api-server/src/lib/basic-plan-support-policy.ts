export type PaidWindow = { startsAt: Date; endsAt: Date };
export type SubscriptionPlanWindow = PaidWindow & {
  id: string;
  packageId: string;
  packageType: "primary" | "addon";
  amountMinor: number;
};

export function isFirstFreePlanChain(
  terms: SubscriptionPlanWindow[],
  currentFreeTerm: SubscriptionPlanWindow | undefined,
): boolean {
  if (!currentFreeTerm) return false;
  const firstFreeTerm = terms
    .filter(
      (term) =>
        term.packageType === "primary" &&
        term.amountMinor === 0,
    )
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())[0];
  if (!firstFreeTerm || firstFreeTerm.packageId !== currentFreeTerm.packageId) {
    return false;
  }
  const history = terms
    .filter(
      (term) =>
        term.packageType === "primary" &&
        term.startsAt >= firstFreeTerm.startsAt &&
        term.startsAt <= currentFreeTerm.startsAt,
    )
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  let previousEnd: Date | null = null;
  for (const term of history) {
    if (
      term.amountMinor !== 0 ||
      term.packageId !== currentFreeTerm.packageId ||
      (previousEnd !== null && term.startsAt.getTime() !== previousEnd.getTime())
    ) {
      return false;
    }
    previousEnd = term.endsAt;
  }
  return history.some((term) => term.id === currentFreeTerm.id);
}

export function addCalendarMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function mergeContinuousPaidWindows(
  windows: PaidWindow[],
  now: Date,
): PaidWindow[] {
  const clipped = windows
    .map(({ startsAt, endsAt }) => ({
      startsAt,
      endsAt: endsAt > now ? now : endsAt,
    }))
    .filter(({ startsAt, endsAt }) => startsAt < endsAt)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());

  const merged: PaidWindow[] = [];
  for (const window of clipped) {
    const last = merged.at(-1);
    if (!last || window.startsAt > last.endsAt) {
      merged.push({ ...window });
      continue;
    }
    if (window.endsAt > last.endsAt) last.endsAt = window.endsAt;
  }
  return merged;
}

export function completedContinuousPaidMonths(
  windows: PaidWindow[],
  now: Date,
): number {
  let completed = 0;
  for (const window of mergeContinuousPaidWindows(windows, now)) {
    for (let month = 1; month <= 6; month += 1) {
      if (addCalendarMonthsUtc(window.startsAt, month) <= window.endsAt) {
        completed = Math.max(completed, month);
      } else {
        break;
      }
    }
  }
  return completed;
}

export function getBasicPlanMilestone(requestsUsed: number): {
  milestone: 1 | 2 | 3 | null;
  requiredPaidMonths: 0 | 3 | 6 | null;
} {
  if (requestsUsed >= 3) return { milestone: null, requiredPaidMonths: null };
  const milestone = (requestsUsed + 1) as 1 | 2 | 3;
  return {
    milestone,
    requiredPaidMonths: milestone === 1 ? 0 : milestone === 2 ? 3 : 6,
  };
}

export function isBasicPlanMilestoneEligible(input: {
  milestone: 1 | 2 | 3 | null;
  firstFreePlan: boolean;
  completedPaidMonths: number;
}): boolean {
  if (input.milestone === null) return false;
  if (input.milestone === 1) return input.firstFreePlan;
  return input.completedPaidMonths >= (input.milestone === 2 ? 3 : 6);
}
