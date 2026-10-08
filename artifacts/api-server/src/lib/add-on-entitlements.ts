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

const paidEntitlementCondition = or(
  isNull(addOnEntitlementsTable.paymentId),
  eq(paymentsTable.status, "captured"),
)!;

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
  const [entitlementTotals] = await db
    .select({
      researchTotal: sql<number>`coalesce(sum(${addOnEntitlementsTable.researchAllowance}), 0)::int`,
      researchUsed: sql<number>`coalesce(sum(${addOnEntitlementsTable.researchUsed}), 0)::int`,
      assistTotal: sql<number>`coalesce(sum(${addOnEntitlementsTable.aiEmailAssistAllowance}), 0)::int`,
      mailboxTotal: sql<number>`coalesce(sum(${addOnEntitlementsTable.additionalMailboxCount}), 0)::int`,
    })
    .from(addOnEntitlementsTable)
    .leftJoin(
      paymentsTable,
      eq(addOnEntitlementsTable.paymentId, paymentsTable.id),
    )
    .where(
      and(
        eq(addOnEntitlementsTable.userId, userId),
        paidEntitlementCondition,
      ),
    );

  await db
    .update(aiEmailAssistUsagesTable)
    .set({ status: "released" })
    .where(
      and(
        eq(aiEmailAssistUsagesTable.userId, userId),
        eq(aiEmailAssistUsagesTable.status, "reserved"),
        lt(
          aiEmailAssistUsagesTable.createdAt,
          new Date(now.getTime() - 15 * 60 * 1000),
        ),
      ),
    );

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

  const additionalSlots = Number(entitlementTotals?.mailboxTotal ?? 0);
  const baseLimit = active?.pkg.packageType === "primary"
    ? active.pkg.emailAccountLimit
    : 0;
  const totalMailboxLimit = baseLimit + (eligible ? additionalSlots : 0);
  const researchTotal = Number(entitlementTotals?.researchTotal ?? 0);
  const researchUsed = Number(entitlementTotals?.researchUsed ?? 0);
  const assistTotal = Number(entitlementTotals?.assistTotal ?? 0);
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
      .where(
        and(
          eq(aiEmailAssistUsagesTable.userId, userId),
          eq(aiEmailAssistUsagesTable.status, "reserved"),
          lt(
            aiEmailAssistUsagesTable.createdAt,
            new Date(now.getTime() - 15 * 60 * 1000),
          ),
        ),
      );

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
          .select({ id: paymentsTable.id })
          .from(paymentsTable)
          .where(
            and(
              inArray(paymentsTable.id, paidIds),
              eq(paymentsTable.status, "captured"),
            ),
          )
      : [];
    const validPaymentIds = new Set(paidPayments.map((row) => row.id));
    const entitlements = entitlementRows.filter(
      (entitlement) =>
        entitlement.paymentId === null ||
        validPaymentIds.has(entitlement.paymentId),
    );
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
        entitlement.aiEmailAssistAllowance -
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
