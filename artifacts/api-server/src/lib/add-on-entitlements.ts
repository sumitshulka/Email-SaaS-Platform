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
  addOnEntitlementsTable,
  aiEmailAssistUsagesTable,
  db,
  paymentsTable,
  subscriptionPackagesTable,
  tenantSendingConfigurationTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { RESEARCH_PROVIDER_REQUEST_TIMEOUT_MS } from "./company-research-provider";

const AI_EMAIL_ASSIST_RESERVATION_TIMEOUT_MS = 15 * 60 * 1000;
const PROVIDER_SETTLE_GRACE_MS = 60 * 1000;
const RESERVATION_CLEANUP_INTERVAL_MS = 60 * 1000;
let reservationCleanupWorkerStarted = false;

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
  const staleAfterMs = Math.max(
    AI_EMAIL_ASSIST_RESERVATION_TIMEOUT_MS,
    RESEARCH_PROVIDER_REQUEST_TIMEOUT_MS + PROVIDER_SETTLE_GRACE_MS,
  );
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
  const refundAdjustments = entitlementRows.flatMap((row) => {
    if (
      row.paymentId === null ||
      row.paymentAmountMinor === null ||
      row.refundedAmountMinor === null ||
      row.refundedAmountMinor <= 0 ||
      row.paymentCurrency === null ||
      row.purchasedAt === null
    ) {
      return [];
    }
    return [{
      packageName: row.packageName,
      purchasedAt: row.purchasedAt.toISOString(),
      refundedAmountMinor: row.refundedAmountMinor,
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
    }];
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
