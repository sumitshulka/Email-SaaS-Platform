import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  auditLogsTable,
  addOnEntitlementsTable,
  aiEmailAssistUsagesTable,
  db,
  paymentsTable,
  razorpayRefundsTable,
  subscriptionPackagesTable,
  tenantSendingConfigurationTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { RESEARCH_PROVIDER_REQUEST_TIMEOUT_MS } from "./company-research-provider";

export const AI_EMAIL_ASSIST_RESERVATION_TIMEOUT_MS = 15 * 60 * 1000;
export const AI_EMAIL_ASSIST_PROVIDER_SETTLE_GRACE_MS = 60 * 1000;
const RESERVATION_CLEANUP_INTERVAL_MS = 60 * 1000;
let reservationCleanupWorkerStarted = false;

export function getAiEmailAssistReservationTimeoutMs(
  providerRequestTimeoutMs = RESEARCH_PROVIDER_REQUEST_TIMEOUT_MS,
) {
  return Math.max(
    AI_EMAIL_ASSIST_RESERVATION_TIMEOUT_MS,
    providerRequestTimeoutMs + AI_EMAIL_ASSIST_PROVIDER_SETTLE_GRACE_MS,
  );
}

const paidEntitlementCondition = or(
  isNull(addOnEntitlementsTable.paymentId),
  eq(paymentsTable.status, "captured"),
)!;

export function prorateAddOnAllowance(
  allowance: number,
  amountMinor: number | null,
  refundedAmountMinor: number | null,
) {
  if (
    amountMinor === null ||
    amountMinor <= 0 ||
    refundedAmountMinor === null ||
    refundedAmountMinor <= 0
  ) {
    return Math.max(0, allowance);
  }
  // Paid add-ons retain the same share of each whole-unit allowance as the
  // payment retains; consumed units remain historical usage, not clawbacks.
  const retainedAmount = Math.max(
    0,
    amountMinor - Math.min(amountMinor, refundedAmountMinor),
  );
  return Number(
    (BigInt(Math.max(0, allowance)) * BigInt(retainedAmount)) /
      BigInt(amountMinor),
  );
}

function serializePackage(pkg: typeof subscriptionPackagesTable.$inferSelect) {
  return {
    id: pkg.id,
    packageType: pkg.packageType,
    name: pkg.name,
    description: pkg.description,
    amountMinor: pkg.amountMinor,
    currency: pkg.currency,
    periodDays: pkg.periodDays,
    contactLimit: pkg.contactLimit,
    emailAccountLimit: pkg.emailAccountLimit,
    researchAllowance: pkg.researchAllowance,
    aiEmailAssistAllowance: pkg.aiEmailAssistAllowance,
    additionalMailboxCount: pkg.additionalMailboxCount,
    preferred: pkg.preferred,
    active: pkg.active,
    createdAt: pkg.createdAt.toISOString(),
    updatedAt: pkg.updatedAt.toISOString(),
  };
}

function staleAiEmailAssistReservationCondition(now: Date, userId?: string) {
  // The existing 15-minute stale timeout remains the minimum. Keep it longer
  // than the provider's hard request timeout so cleanup cannot release a
  // reservation while its provider request is still active.
  const staleAfterMs = getAiEmailAssistReservationTimeoutMs();
  return and(
    eq(aiEmailAssistUsagesTable.status, "reserved"),
    lt(
      aiEmailAssistUsagesTable.createdAt,
      new Date(now.getTime() - staleAfterMs),
    ),
    ...(userId ? [eq(aiEmailAssistUsagesTable.userId, userId)] : []),
  );
}

export async function releaseStaleAiEmailAssistReservations(
  now = new Date(),
  userId?: string,
) {
  const released = await db
    .update(aiEmailAssistUsagesTable)
    .set({ status: "released" })
    .where(staleAiEmailAssistReservationCondition(now, userId))
    .returning({ id: aiEmailAssistUsagesTable.id });
  return released.length;
}

export async function startAiEmailAssistReservationCleanupWorker(): Promise<void> {
  if (reservationCleanupWorkerStarted) return;
  reservationCleanupWorkerStarted = true;

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await releaseStaleAiEmailAssistReservations();
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "AI Email Assist reservation cleanup failed",
      );
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), RESERVATION_CLEANUP_INTERVAL_MS);
  timer.unref();
  await tick();
}

export async function getSubscriptionAddOnsDashboard(
  userId: string,
  now = new Date(),
) {
  const [active] = await db
    .select({
      subscription: userSubscriptionsTable,
      pkg: subscriptionPackagesTable,
    })
    .from(userSubscriptionsTable)
    .innerJoin(
      subscriptionPackagesTable,
      eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
    )
    .where(
      and(
        eq(userSubscriptionsTable.userId, userId),
        eq(userSubscriptionsTable.status, "active"),
        lte(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
      ),
    )
    .orderBy(desc(userSubscriptionsTable.endsAt))
    .limit(1);

  const eligible =
    active?.pkg.packageType === "primary" && active.pkg.amountMinor > 0;
  const entitlementRows = await db
    .select({
      paymentId: addOnEntitlementsTable.paymentId,
      packageName: subscriptionPackagesTable.name,
      researchAllowance: addOnEntitlementsTable.researchAllowance,
      researchUsed: addOnEntitlementsTable.researchUsed,
      aiEmailAssistAllowance: addOnEntitlementsTable.aiEmailAssistAllowance,
      additionalMailboxCount: addOnEntitlementsTable.additionalMailboxCount,
      paymentAmountMinor: paymentsTable.amountMinor,
      refundedAmountMinor: paymentsTable.refundedAmountMinor,
      paymentCurrency: paymentsTable.currency,
      purchasedAt: paymentsTable.createdAt,
    })
    .from(addOnEntitlementsTable)
    .innerJoin(
      subscriptionPackagesTable,
      eq(addOnEntitlementsTable.packageId, subscriptionPackagesTable.id),
    )
    .leftJoin(
      paymentsTable,
      eq(addOnEntitlementsTable.paymentId, paymentsTable.id),
    )
    .where(
      and(
        eq(addOnEntitlementsTable.userId, userId),
        or(
          isNull(addOnEntitlementsTable.paymentId),
          eq(paymentsTable.userId, userId),
        ),
        paidEntitlementCondition,
      ),
    );
  const refundAdjustmentRows = await db
    .select({
      paymentId: paymentsTable.id,
      packageName: subscriptionPackagesTable.name,
      researchAllowance: addOnEntitlementsTable.researchAllowance,
      aiEmailAssistAllowance: addOnEntitlementsTable.aiEmailAssistAllowance,
      additionalMailboxCount: addOnEntitlementsTable.additionalMailboxCount,
      paymentAmountMinor: paymentsTable.amountMinor,
      refundedAmountMinor: paymentsTable.refundedAmountMinor,
      paymentCurrency: paymentsTable.currency,
      purchasedAt: paymentsTable.createdAt,
      paymentUpdatedAt: paymentsTable.updatedAt,
    })
    .from(addOnEntitlementsTable)
    .innerJoin(
      subscriptionPackagesTable,
      eq(addOnEntitlementsTable.packageId, subscriptionPackagesTable.id),
    )
    .innerJoin(
      paymentsTable,
      eq(addOnEntitlementsTable.paymentId, paymentsTable.id),
    )
    .where(
      and(
        eq(addOnEntitlementsTable.userId, userId),
        eq(paymentsTable.userId, userId),
        eq(subscriptionPackagesTable.packageType, "addon"),
        inArray(paymentsTable.status, ["captured", "refunded"]),
        gt(paymentsTable.refundedAmountMinor, 0),
      ),
    );
  const paidPaymentIds = refundAdjustmentRows.map((row) => row.paymentId);
  const refundRows = paidPaymentIds.length
    ? await db
        .select({
          paymentId: razorpayRefundsTable.paymentId,
          amountMinor: razorpayRefundsTable.amountMinor,
          refundedAt: razorpayRefundsTable.createdAt,
        })
        .from(razorpayRefundsTable)
        .innerJoin(
          paymentsTable,
          eq(razorpayRefundsTable.paymentId, paymentsTable.id),
        )
        .where(
          and(
            inArray(razorpayRefundsTable.paymentId, paidPaymentIds),
            eq(paymentsTable.userId, userId),
          ),
        )
        .orderBy(asc(razorpayRefundsTable.createdAt), asc(razorpayRefundsTable.id))
    : [];
  const refundsByPaymentId = new Map<
    string,
    { amountMinor: number; refundedAt: string }[]
  >();
  for (const refund of refundRows) {
    const events = refundsByPaymentId.get(refund.paymentId) ?? [];
    events.push({
      amountMinor: refund.amountMinor,
      refundedAt: refund.refundedAt.toISOString(),
    });
    refundsByPaymentId.set(refund.paymentId, events);
  }
  const researchTotal = entitlementRows.reduce(
    (total, row) =>
      total +
      prorateAddOnAllowance(
        row.researchAllowance,
        row.paymentId === null ? null : row.paymentAmountMinor,
        row.paymentId === null ? null : row.refundedAmountMinor,
      ),
    0,
  );
  const researchUsed = entitlementRows.reduce(
    (total, row) => total + row.researchUsed,
    0,
  );
  const assistTotal = entitlementRows.reduce(
    (total, row) =>
      total +
      prorateAddOnAllowance(
        row.aiEmailAssistAllowance,
        row.paymentId === null ? null : row.paymentAmountMinor,
        row.paymentId === null ? null : row.refundedAmountMinor,
      ),
    0,
  );
  const additionalSlots = entitlementRows.reduce(
    (total, row) =>
      total +
      prorateAddOnAllowance(
        row.additionalMailboxCount,
        row.paymentId === null ? null : row.paymentAmountMinor,
        row.paymentId === null ? null : row.refundedAmountMinor,
      ),
    0,
  );
  const refundAdjustments = refundAdjustmentRows.map((row) => {
    const refunds = [...(refundsByPaymentId.get(row.paymentId) ?? [])];
    const recordedRefundTotal = refunds.reduce(
      (total, refund) => total + refund.amountMinor,
      0,
    );
    if (recordedRefundTotal < row.refundedAmountMinor) {
      // Older aggregate refund notifications updated the cumulative payment
      // total without creating an individual refund row. Preserve that history
      // as one dated remainder rather than hiding part of the accepted total.
      refunds.push({
        amountMinor: row.refundedAmountMinor - recordedRefundTotal,
        refundedAt: row.paymentUpdatedAt.toISOString(),
      });
    }
    return {
      packageName: row.packageName,
      purchasedAt: row.purchasedAt.toISOString(),
      refundedAmountMinor: row.refundedAmountMinor,
      refunds,
      currency: row.paymentCurrency,
      researchCredits: prorateAddOnAllowance(
        row.researchAllowance,
        row.paymentAmountMinor,
        row.refundedAmountMinor,
      ),
      emailAssistDrafts: prorateAddOnAllowance(
        row.aiEmailAssistAllowance,
        row.paymentAmountMinor,
        row.refundedAmountMinor,
      ),
      additionalMailboxSlots: prorateAddOnAllowance(
        row.additionalMailboxCount,
        row.paymentAmountMinor,
        row.refundedAmountMinor,
      ),
    };
  });

  await releaseStaleAiEmailAssistReservations(now, userId);

  const [assistUsage] = await db
    .select({ used: count() })
    .from(aiEmailAssistUsagesTable)
    .innerJoin(
      addOnEntitlementsTable,
      eq(aiEmailAssistUsagesTable.entitlementId, addOnEntitlementsTable.id),
    )
    .leftJoin(
      paymentsTable,
      eq(addOnEntitlementsTable.paymentId, paymentsTable.id),
    )
    .where(
      and(
        eq(aiEmailAssistUsagesTable.userId, userId),
        inArray(aiEmailAssistUsagesTable.status, ["consumed", "reserved"]),
        paidEntitlementCondition,
      ),
    );

  const [accounts] = await db
    .select({ used: count() })
    .from(tenantSendingConfigurationTable)
    .where(eq(tenantSendingConfigurationTable.userId, userId));

  const baseLimit = active?.pkg.packageType === "primary"
    ? active.pkg.emailAccountLimit
    : 0;
  const totalMailboxLimit = baseLimit + (eligible ? additionalSlots : 0);
  const assistUsed = Number(assistUsage?.used ?? 0);
  const packages = eligible
    ? await db
        .select()
        .from(subscriptionPackagesTable)
        .where(
          and(
            eq(subscriptionPackagesTable.packageType, "addon"),
            eq(subscriptionPackagesTable.active, true),
          ),
        )
        .orderBy(asc(subscriptionPackagesTable.amountMinor), asc(subscriptionPackagesTable.name))
    : [];
  const claimed = await db
    .select({ packageId: addOnEntitlementsTable.packageId })
    .from(addOnEntitlementsTable)
    .where(
      and(
        eq(addOnEntitlementsTable.userId, userId),
        isNull(addOnEntitlementsTable.paymentId),
      ),
    );
  const claimedFreePackageIds = claimed.map((row) => row.packageId);
  const configuredAccounts = Number(accounts?.used ?? 0);

  return {
    eligible,
    eligibilityReason: eligible ? null : "paid_primary_required" as const,
    primaryEndsAt: eligible ? active.subscription.endsAt.toISOString() : null,
    balances: {
      research: {
        total: researchTotal,
        used: researchUsed,
        remaining: Math.max(0, researchTotal - researchUsed),
      },
      emailAssist: {
        total: assistTotal,
        used: assistUsed,
        remaining: Math.max(0, assistTotal - assistUsed),
      },
      mailboxes: {
        baseLimit,
        additionalSlots,
        totalLimit: totalMailboxLimit,
        used: configuredAccounts,
        remaining: Math.max(0, totalMailboxLimit - configuredAccounts),
        active: eligible,
      },
    },
    refundAdjustments,
    packages: packages.map(serializePackage),
    claimedFreePackageIds,
  };
}

function mailboxAllowanceToRetain(input: {
  giftedSlots: number;
  configuredAccounts: number;
  baseLimit: number;
  otherSlots: number;
}) {
  const slotsNeededFromGift = Math.max(
    0,
    input.configuredAccounts - input.baseLimit - input.otherSlots,
  );
  return Math.min(input.giftedSlots, slotsNeededFromGift);
}

export function calculateAdminAddOnGiftCorrection(input: {
  researchAllowance: number;
  researchUsed: number;
  aiEmailAssistAllowance: number;
  aiEmailAssistUsed: number;
  additionalMailboxCount: number;
  configuredAccounts: number;
  baseLimit: number;
  otherSlots: number;
}) {
  const retained = {
    researchAllowance: input.researchAllowance,
    aiEmailAssistAllowance: input.aiEmailAssistAllowance,
    additionalMailboxCount: mailboxAllowanceToRetain({
      giftedSlots: input.additionalMailboxCount,
      configuredAccounts: input.configuredAccounts,
      baseLimit: input.baseLimit,
      otherSlots: input.otherSlots,
    }),
  };
  const removed = {
    researchAllowance: Math.max(
      0,
      input.researchAllowance - input.researchUsed,
    ),
    aiEmailAssistAllowance: Math.max(
      0,
      input.aiEmailAssistAllowance - input.aiEmailAssistUsed,
    ),
    additionalMailboxCount:
      input.additionalMailboxCount - retained.additionalMailboxCount,
  };
  retained.researchAllowance -= removed.researchAllowance;
  retained.aiEmailAssistAllowance -= removed.aiEmailAssistAllowance;
  return { removed, retained };
}

function sumUsableMailboxSlots(
  rows: Array<{
    entitlement: {
      paymentId: string | null;
      additionalMailboxCount: number;
    };
    amountMinor: number | null;
    refundedAmountMinor: number | null;
    paymentStatus: string | null;
  }>,
) {
  return rows.reduce((total, row) => {
    if (
      row.entitlement.paymentId !== null &&
      row.paymentStatus !== "captured"
    ) {
      return total;
    }
    return total + prorateAddOnAllowance(
      row.entitlement.additionalMailboxCount,
      row.entitlement.paymentId === null ? null : row.amountMinor,
      row.entitlement.paymentId === null ? null : row.refundedAmountMinor,
    );
  }, 0);
}

export async function listAdminAddOnGiftEntitlements(userId: string) {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;

  const entitlements = await db
    .select({
      id: addOnEntitlementsTable.id,
      userId: addOnEntitlementsTable.userId,
      packageId: addOnEntitlementsTable.packageId,
      packageName: subscriptionPackagesTable.name,
      researchAllowance: addOnEntitlementsTable.researchAllowance,
      researchUsed: addOnEntitlementsTable.researchUsed,
      aiEmailAssistAllowance: addOnEntitlementsTable.aiEmailAssistAllowance,
      additionalMailboxCount: addOnEntitlementsTable.additionalMailboxCount,
      createdAt: addOnEntitlementsTable.createdAt,
    })
    .from(addOnEntitlementsTable)
    .innerJoin(
      subscriptionPackagesTable,
      eq(addOnEntitlementsTable.packageId, subscriptionPackagesTable.id),
    )
    .where(
      and(
        eq(addOnEntitlementsTable.userId, userId),
        eq(addOnEntitlementsTable.grantSource, "admin_gift"),
        eq(subscriptionPackagesTable.packageType, "addon"),
      ),
    )
    .orderBy(desc(addOnEntitlementsTable.createdAt));
  if (entitlements.length === 0) return [];

  const entitlementIds = entitlements.map((row) => row.id);
  const [usageRows, accountRows, activeRows, mailboxRows] = await Promise.all([
    db
      .select({
        entitlementId: aiEmailAssistUsagesTable.entitlementId,
        used: count(),
      })
      .from(aiEmailAssistUsagesTable)
      .where(
        and(
          eq(aiEmailAssistUsagesTable.userId, userId),
          inArray(aiEmailAssistUsagesTable.entitlementId, entitlementIds),
          inArray(aiEmailAssistUsagesTable.status, ["consumed", "reserved"]),
        ),
      )
      .groupBy(aiEmailAssistUsagesTable.entitlementId),
    db
      .select({ value: count() })
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, userId)),
    db
      .select({ package: subscriptionPackagesTable })
      .from(userSubscriptionsTable)
      .innerJoin(
        subscriptionPackagesTable,
        eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
      )
      .where(
        and(
          eq(userSubscriptionsTable.userId, userId),
          eq(userSubscriptionsTable.status, "active"),
          lte(userSubscriptionsTable.startsAt, new Date()),
          gt(userSubscriptionsTable.endsAt, new Date()),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1),
    db
      .select({
        entitlement: addOnEntitlementsTable,
        amountMinor: paymentsTable.amountMinor,
        refundedAmountMinor: paymentsTable.refundedAmountMinor,
        paymentStatus: paymentsTable.status,
      })
      .from(addOnEntitlementsTable)
      .innerJoin(
        subscriptionPackagesTable,
        eq(addOnEntitlementsTable.packageId, subscriptionPackagesTable.id),
      )
      .leftJoin(
        paymentsTable,
        eq(addOnEntitlementsTable.paymentId, paymentsTable.id),
      )
      .where(
        and(
          eq(addOnEntitlementsTable.userId, userId),
          eq(subscriptionPackagesTable.packageType, "addon"),
          or(
            isNull(addOnEntitlementsTable.paymentId),
            eq(paymentsTable.status, "captured"),
          ),
        ),
      ),
  ]);
  const usedByEntitlement = new Map(
    usageRows.map((row) => [row.entitlementId, Number(row.used)]),
  );
  const configuredAccounts = Number(accountRows[0]?.value ?? 0);
  const baseLimit = activeRows[0]?.package.emailAccountLimit ?? 1;

  return entitlements.map((row) => {
    const otherSlots = sumUsableMailboxSlots(
      mailboxRows.filter((gift) => gift.entitlement.id !== row.id),
    );
    const aiEmailAssistUsed = usedByEntitlement.get(row.id) ?? 0;
    const correction = calculateAdminAddOnGiftCorrection({
      researchAllowance: row.researchAllowance,
      researchUsed: row.researchUsed,
      aiEmailAssistAllowance: row.aiEmailAssistAllowance,
      aiEmailAssistUsed,
      additionalMailboxCount: row.additionalMailboxCount,
      configuredAccounts,
      baseLimit,
      otherSlots,
    });
    return {
      entitlementId: row.id,
      userId: row.userId,
      packageId: row.packageId,
      packageName: row.packageName,
      researchAllowance: row.researchAllowance,
      researchUsed: row.researchUsed,
      aiEmailAssistAllowance: row.aiEmailAssistAllowance,
      aiEmailAssistUsed,
      additionalMailboxCount: row.additionalMailboxCount,
      createdAt: row.createdAt.toISOString(),
      removable: correction.removed,
    };
  });
}

export async function correctAdminAddOnGift(input: {
  actorId: string;
  userId: string;
  entitlementId: string;
  ipAddress?: string | null;
}) {
  return db.transaction(async (tx) => {
    // AI-assist reservations use the same owner lock, so correction and new
    // reservations cannot spend the same remaining allowance concurrently.
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, input.userId))
      .limit(1)
      .for("update");
    if (!user) return { kind: "not-found" as const };

    const [entitlement] = await tx
      .select({
        id: addOnEntitlementsTable.id,
        userId: addOnEntitlementsTable.userId,
        packageId: addOnEntitlementsTable.packageId,
        packageName: subscriptionPackagesTable.name,
        packageType: subscriptionPackagesTable.packageType,
        researchAllowance: addOnEntitlementsTable.researchAllowance,
        researchUsed: addOnEntitlementsTable.researchUsed,
        aiEmailAssistAllowance: addOnEntitlementsTable.aiEmailAssistAllowance,
        additionalMailboxCount: addOnEntitlementsTable.additionalMailboxCount,
      })
      .from(addOnEntitlementsTable)
      .innerJoin(
        subscriptionPackagesTable,
        eq(addOnEntitlementsTable.packageId, subscriptionPackagesTable.id),
      )
      .where(
        and(
          eq(addOnEntitlementsTable.id, input.entitlementId),
          eq(addOnEntitlementsTable.userId, input.userId),
          eq(addOnEntitlementsTable.grantSource, "admin_gift"),
          eq(subscriptionPackagesTable.packageType, "addon"),
        ),
      )
      .for("update");
    if (!entitlement) return { kind: "not-found" as const };

    const [aiUsageRows, accountRows, activeRows, mailboxRows] = await Promise.all([
      tx
        .select({ used: count() })
        .from(aiEmailAssistUsagesTable)
        .where(
          and(
            eq(aiEmailAssistUsagesTable.userId, input.userId),
            eq(aiEmailAssistUsagesTable.entitlementId, entitlement.id),
            inArray(aiEmailAssistUsagesTable.status, ["consumed", "reserved"]),
          ),
        ),
      tx
        .select({ value: count() })
        .from(tenantSendingConfigurationTable)
        .where(eq(tenantSendingConfigurationTable.userId, input.userId)),
      tx
        .select({ package: subscriptionPackagesTable })
        .from(userSubscriptionsTable)
        .innerJoin(
          subscriptionPackagesTable,
          eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
        )
        .where(
          and(
            eq(userSubscriptionsTable.userId, input.userId),
            eq(userSubscriptionsTable.status, "active"),
            lte(userSubscriptionsTable.startsAt, new Date()),
            gt(userSubscriptionsTable.endsAt, new Date()),
          ),
        )
        .orderBy(desc(userSubscriptionsTable.endsAt))
        .limit(1),
      tx
        .select({
          entitlement: addOnEntitlementsTable,
          amountMinor: paymentsTable.amountMinor,
          refundedAmountMinor: paymentsTable.refundedAmountMinor,
          paymentStatus: paymentsTable.status,
        })
        .from(addOnEntitlementsTable)
        .innerJoin(
          subscriptionPackagesTable,
          eq(addOnEntitlementsTable.packageId, subscriptionPackagesTable.id),
        )
        .leftJoin(
          paymentsTable,
          eq(addOnEntitlementsTable.paymentId, paymentsTable.id),
        )
        .where(
          and(
            eq(addOnEntitlementsTable.userId, input.userId),
            eq(subscriptionPackagesTable.packageType, "addon"),
            sql`${addOnEntitlementsTable.id} <> ${entitlement.id}`,
            or(
              isNull(addOnEntitlementsTable.paymentId),
              eq(paymentsTable.status, "captured"),
            ),
          ),
        ),
    ]);
    const aiEmailAssistUsed = Number(aiUsageRows[0]?.used ?? 0);
    const configuredAccounts = Number(accountRows[0]?.value ?? 0);
    const baseLimit = activeRows[0]?.package.emailAccountLimit ?? 1;
    const otherSlots = sumUsableMailboxSlots(mailboxRows);
    const correction = calculateAdminAddOnGiftCorrection({
      researchAllowance: entitlement.researchAllowance,
      researchUsed: entitlement.researchUsed,
      aiEmailAssistAllowance: entitlement.aiEmailAssistAllowance,
      aiEmailAssistUsed,
      additionalMailboxCount: entitlement.additionalMailboxCount,
      configuredAccounts,
      baseLimit,
      otherSlots,
    });
    const { removed, retained } = correction;
    if (
      removed.researchAllowance === 0 &&
      removed.aiEmailAssistAllowance === 0 &&
      removed.additionalMailboxCount === 0
    ) {
      return { kind: "nothing-unused" as const };
    }

    await tx
      .update(addOnEntitlementsTable)
      .set({
        researchAllowance: retained.researchAllowance,
        aiEmailAssistAllowance: retained.aiEmailAssistAllowance,
        additionalMailboxCount: retained.additionalMailboxCount,
      })
      .where(eq(addOnEntitlementsTable.id, entitlement.id));
    await tx.insert(auditLogsTable).values({
      actorId: input.actorId,
      action: "subscription.add_on_gift_corrected",
      entity: "add_on_entitlement",
      entityId: entitlement.id,
      ipAddress: input.ipAddress?.slice(0, 80) ?? null,
      metadata: {
        userId: input.userId,
        packageId: entitlement.packageId,
        packageName: entitlement.packageName,
        removedAllowances: removed,
        retainedAllowances: retained,
        researchUsed: entitlement.researchUsed,
        aiEmailAssistUsed,
        configuredMailboxCount: configuredAccounts,
      },
    });
    return {
      kind: "corrected" as const,
      entitlementId: entitlement.id,
      packageId: entitlement.packageId,
      packageName: entitlement.packageName,
      removed,
      retained,
    };
  });
}

export async function reserveAiEmailAssistCredit(userId: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)
      .for("update");
    if (!user) return null;

    const now = new Date();
    const [active] = await tx
      .select({ pkg: subscriptionPackagesTable })
      .from(userSubscriptionsTable)
      .innerJoin(
        subscriptionPackagesTable,
        eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
      )
      .where(
        and(
          eq(userSubscriptionsTable.userId, userId),
          eq(userSubscriptionsTable.status, "active"),
          lte(userSubscriptionsTable.startsAt, now),
          gt(userSubscriptionsTable.endsAt, now),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1);
    if (!active || active.pkg.packageType !== "primary" || active.pkg.amountMinor <= 0) {
      return null;
    }

    await tx
      .update(aiEmailAssistUsagesTable)
      .set({ status: "released" })
      .where(staleAiEmailAssistReservationCondition(now, userId));

    const entitlementRows = await tx
      .select()
      .from(addOnEntitlementsTable)
      .where(
        and(
          eq(addOnEntitlementsTable.userId, userId),
          gt(addOnEntitlementsTable.aiEmailAssistAllowance, 0),
        ),
      )
      .orderBy(asc(addOnEntitlementsTable.createdAt), asc(addOnEntitlementsTable.id))
      .for("update");
    const paidIds = entitlementRows
      .map((row) => row.paymentId)
      .filter((id): id is string => id !== null);
    const paidPayments = paidIds.length
      ? await tx
          .select({
            id: paymentsTable.id,
            status: paymentsTable.status,
            amountMinor: paymentsTable.amountMinor,
            refundedAmountMinor: paymentsTable.refundedAmountMinor,
          })
          .from(paymentsTable)
          .where(inArray(paymentsTable.id, paidIds))
      : [];
    const paymentById = new Map(paidPayments.map((row) => [row.id, row]));
    const entitlements = entitlementRows.flatMap((entitlement) => {
      if (entitlement.paymentId === null) {
        return [{ ...entitlement, usableAllowance: entitlement.aiEmailAssistAllowance }];
      }
      const payment = paymentById.get(entitlement.paymentId);
      return !payment || payment.status !== "captured"
        ? []
        : [{
            ...entitlement,
            usableAllowance: prorateAddOnAllowance(
              entitlement.aiEmailAssistAllowance,
              payment.amountMinor,
              payment.refundedAmountMinor,
            ),
          }];
    });
    if (entitlements.length === 0) return null;

    const usageRows = await tx
      .select({
        entitlementId: aiEmailAssistUsagesTable.entitlementId,
        used: count(),
      })
      .from(aiEmailAssistUsagesTable)
      .where(
        and(
          eq(aiEmailAssistUsagesTable.userId, userId),
          inArray(
            aiEmailAssistUsagesTable.entitlementId,
            entitlements.map((row) => row.id),
          ),
          inArray(aiEmailAssistUsagesTable.status, ["consumed", "reserved"]),
        ),
      )
      .groupBy(aiEmailAssistUsagesTable.entitlementId);
    const usedByEntitlement = new Map(
      usageRows.map((row) => [row.entitlementId, Number(row.used)]),
    );
    const available = entitlements.find(
      (entitlement) =>
        entitlement.usableAllowance -
          (usedByEntitlement.get(entitlement.id) ?? 0) >
        0,
    );
    if (!available) return null;

    const [usage] = await tx
      .insert(aiEmailAssistUsagesTable)
      .values({
        userId,
        entitlementId: available.id,
        status: "reserved",
      })
      .returning({ id: aiEmailAssistUsagesTable.id });
    return usage ?? null;
  });
}

export async function finishAiEmailAssistCredit(
  userId: string,
  usageId: string,
  succeeded: boolean,
) {
  await db
    .update(aiEmailAssistUsagesTable)
    .set({
      status: succeeded ? "consumed" : "released",
      completedAt: succeeded ? new Date() : null,
    })
    .where(
      and(
        eq(aiEmailAssistUsagesTable.id, usageId),
        eq(aiEmailAssistUsagesTable.userId, userId),
        eq(aiEmailAssistUsagesTable.status, "reserved"),
      ),
    );
}
