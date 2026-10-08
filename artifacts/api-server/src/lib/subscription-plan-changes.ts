const DAY_MS = 24 * 60 * 60 * 1000;

const PRIMARY_PLAN_LIMIT_FIELDS = [
  "contactLimit",
  "emailAccountLimit",
  "researchAllowance",
  "aiEmailAssistAllowance",
] as const;

export type PrimaryPlanLimits = {
  contactLimit: number;
  emailAccountLimit: number;
  researchAllowance: number;
  aiEmailAssistAllowance: number;
};

type ProrationPackage = {
  amountMinor: number;
  currency: string;
  periodDays: number;
};

export type PrimaryPlanChangeKind =
  | "upgrade"
  | "downgrade"
  | "switch"
  | "same";

export function comparePrimaryPlanLimits(
  current: PrimaryPlanLimits,
  target: PrimaryPlanLimits,
): PrimaryPlanChangeKind {
  const targetAtLeastAsHigh = PRIMARY_PLAN_LIMIT_FIELDS.every(
    (field) => target[field] >= current[field],
  );
  const targetAtMostAsHigh = PRIMARY_PLAN_LIMIT_FIELDS.every(
    (field) => target[field] <= current[field],
  );
  const exactlyEqual = PRIMARY_PLAN_LIMIT_FIELDS.every(
    (field) => target[field] === current[field],
  );

  if (exactlyEqual) return "same";
  if (targetAtLeastAsHigh) return "upgrade";
  if (targetAtMostAsHigh) return "downgrade";
  return "switch";
}

export function calculateProratedUpgradeAmountMinor(input: {
  currentPackage: ProrationPackage;
  targetPackage: ProrationPackage;
  endsAt: Date;
  now: Date;
}): number | null {
  if (input.currentPackage.currency !== input.targetPackage.currency) {
    return null;
  }

  const remainingMs = Math.max(0, input.endsAt.getTime() - input.now.getTime());
  const perDayDifference =
    input.targetPackage.amountMinor / input.targetPackage.periodDays -
    input.currentPackage.amountMinor / input.currentPackage.periodDays;
  if (remainingMs === 0 || perDayDifference <= 0) return 0;

  const prorated = (perDayDifference * remainingMs) / DAY_MS;
  if (!Number.isFinite(prorated)) {
    throw new Error("The prorated plan amount could not be calculated.");
  }
  return Math.max(1, Math.round(prorated));
}
