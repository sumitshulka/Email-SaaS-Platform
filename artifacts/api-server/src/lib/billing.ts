import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notInArray,
} from "drizzle-orm";
import {
  addOnEntitlementsTable,
  db,
  emailCampaignsTable,
  paymentsTable,
  razorpayRefundsTable,
  subscriptionPackagesTable,
  tenantSendingConfigurationTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import {
  calculateProratedUpgradeAmountMinor,
  comparePrimaryPlanLimits,
} from "./subscription-plan-changes";

export {
  calculateProratedUpgradeAmountMinor,
  comparePrimaryPlanLimits,
} from "./subscription-plan-changes";

type PackageRow = typeof subscriptionPackagesTable.$inferSelect;
type SubscriptionRow = typeof userSubscriptionsTable.$inferSelect;
type PackageSnapshot = NonNullable<
  (typeof paymentsTable.$inferSelect)["packageSnapshot"]
>;

export function createPackageCheckoutSnapshot(
  pkg: PackageRow,
): PackageSnapshot {
  return {
    packageType: pkg.packageType,
    amountMinor: pkg.amountMinor,
    currency: pkg.currency,
    periodDays: pkg.periodDays,
    contactLimit: pkg.contactLimit,
    emailAccountLimit: pkg.emailAccountLimit,
    researchAllowance: pkg.researchAllowance,
    aiEmailAssistAllowance: pkg.aiEmailAssistAllowance,
    additionalMailboxCount: pkg.additionalMailboxCount,
  };
}

function packageMatchesCheckoutSnapshot(
  pkg: PackageRow,
  snapshot: PackageSnapshot | null,
): boolean {
  return (
    snapshot !== null &&
    snapshot.packageType === pkg.packageType &&
    snapshot.amountMinor === pkg.amountMinor &&
    snapshot.currency === pkg.currency &&
    snapshot.periodDays === pkg.periodDays &&
    snapshot.contactLimit === pkg.contactLimit &&
    snapshot.emailAccountLimit === pkg.emailAccountLimit &&
    snapshot.researchAllowance === pkg.researchAllowance &&
    snapshot.aiEmailAssistAllowance === pkg.aiEmailAssistAllowance &&
    snapshot.additionalMailboxCount === pkg.additionalMailboxCount
  );
}

export function serializePackage(pkg: PackageRow) {
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

function serializeSubscription(
  subscription: SubscriptionRow,
  pkg: PackageRow,
  status: "active" | "superseded" | "cancelled" | "expired" = subscription.status,
) {
  return {
    id: subscription.id,
    status,
    startsAt: subscription.startsAt.toISOString(),
    endsAt: subscription.endsAt.toISOString(),
    package: serializePackage(pkg),
  };
}

function getSubscriptionTerm(
  periodDays: number,
  previousEnd: Date | undefined,
  now: Date,
) {
  const startsAt = previousEnd && previousEnd > now ? previousEnd : now;
  const endsAt = new Date(startsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
}

export async function getCurrentSubscriptionForUser(userId: string) {
  await applyDueEmailAccountRetention(userId);
  const now = new Date();
  const [scheduled] = await db
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
        gt(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
      ),
    )
    .orderBy(asc(userSubscriptionsTable.startsAt))
    .limit(1);
  const scheduledSubscription = scheduled
    ? {
        ...serializeSubscription(scheduled.subscription, scheduled.pkg),
        paymentConfirmed: await isCapturedPaidScheduledChange(
          userId,
          scheduled.subscription.paymentId,
          scheduled.pkg.id,
        ),
      }
    : null;
  const [current] = await db
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
  if (current) {
    return {
      subscription: serializeSubscription(current.subscription, current.pkg),
      scheduledSubscription,
    };
  }

  const [latest] = await db
    .select({
      subscription: userSubscriptionsTable,
      pkg: subscriptionPackagesTable,
    })
    .from(userSubscriptionsTable)
    .innerJoin(
      subscriptionPackagesTable,
      eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
    )
    .where(eq(userSubscriptionsTable.userId, userId))
    .orderBy(desc(userSubscriptionsTable.createdAt))
    .limit(1);
  if (!latest) return { subscription: null, scheduledSubscription };
  if (latest.subscription.startsAt > now) {
    return { subscription: null, scheduledSubscription };
  }

  const status =
    latest.subscription.status === "active" && latest.subscription.endsAt <= now
      ? "expired"
      : latest.subscription.status;
  return {
    subscription: serializeSubscription(
      latest.subscription,
      latest.pkg,
      status,
    ),
    scheduledSubscription,
  };
}

async function isCapturedPaidScheduledChange(
  userId: string,
  paymentId: string | null,
  packageId: string,
): Promise<boolean> {
  if (!paymentId) return false;
  const [payment] = await db
    .select({
      status: paymentsTable.status,
      subscriptionChangeType: paymentsTable.subscriptionChangeType,
      packageId: paymentsTable.packageId,
      amountMinor: paymentsTable.amountMinor,
    })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.id, paymentId),
        eq(paymentsTable.userId, userId),
      ),
    )
    .limit(1);
  return (
    payment?.status === "captured" &&
    payment.subscriptionChangeType === "scheduled" &&
    payment.packageId === packageId &&
    payment.amountMinor > 0
  );
}

export async function hasUnresolvedCapturedPlanChangePayment(
  userId: string,
): Promise<boolean> {
  const [payment] = await db
    .select({ id: paymentsTable.id })
    .from(paymentsTable)
    .leftJoin(
      userSubscriptionsTable,
      eq(userSubscriptionsTable.paymentId, paymentsTable.id),
    )
    .where(
      and(
        eq(paymentsTable.userId, userId),
        eq(paymentsTable.status, "captured"),
        inArray(paymentsTable.subscriptionChangeType, ["upgrade", "scheduled"]),
        gt(paymentsTable.amountMinor, 0),
        isNull(userSubscriptionsTable.id),
      ),
    )
    .limit(1);
  return Boolean(payment);
}

async function applyDueEmailAccountRetention(userId: string): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    const [current] = await tx
      .select({ subscription: userSubscriptionsTable, pkg: subscriptionPackagesTable })
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
      .limit(1)
      .for("update");
    const keepIds = current?.subscription.senderAccountIdsToKeep;
    if (!current || keepIds === null) return;

    const accounts = await tx
      .select({ id: tenantSendingConfigurationTable.id })
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, userId));
    const removedIds = accounts
      .map((account) => account.id)
      .filter((id) => !keepIds.includes(id));
    if (removedIds.length > 0) {
      const [campaignInUse] = await tx
        .select({ id: emailCampaignsTable.id })
        .from(emailCampaignsTable)
        .where(
          and(
            eq(emailCampaignsTable.userId, userId),
            inArray(emailCampaignsTable.senderAccountId, removedIds),
            inArray(emailCampaignsTable.status, ["queued", "sending"]),
          ),
        )
        .limit(1);
      if (campaignInUse) return;
      const deleteAccounts = tx.delete(tenantSendingConfigurationTable);
      if (keepIds.length === 0) {
        await deleteAccounts.where(eq(tenantSendingConfigurationTable.userId, userId));
      } else {
        await deleteAccounts.where(
          and(
            eq(tenantSendingConfigurationTable.userId, userId),
            notInArray(tenantSendingConfigurationTable.id, keepIds),
          ),
        );
      }
    }
    await tx
      .update(userSubscriptionsTable)
      .set({ senderAccountIdsToKeep: null })
      .where(eq(userSubscriptionsTable.id, current.subscription.id));
  });
}

export async function activateCapturedPayment(input: {
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountMinor: number;
  currency: string;
}) {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, input.paymentId))
      .limit(1)
      .for("update");
    if (!payment) throw new Error("Payment record was not found.");
    if (
      payment.razorpayOrderId !== input.razorpayOrderId ||
      payment.amountMinor !== input.amountMinor ||
      payment.currency !== input.currency
    ) {
      throw new Error("Razorpay payment details did not match the saved order.");
    }

    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, payment.userId))
      .for("update");

    const now = new Date();
    const markCapturedForReconciliation = async (
      reconciliationReason: "package_changed" | "source_plan_changed" =
        "source_plan_changed",
    ) => {
      await tx
        .update(paymentsTable)
        .set({
          status: "captured",
          razorpayPaymentId: input.razorpayPaymentId,
          updatedAt: now,
        })
        .where(eq(paymentsTable.id, payment.id));
      return {
        subscription: null,
        addOnEntitlement: null,
        reconciliationRequired: true as const,
        reconciliationReason,
        paymentReference: input.razorpayPaymentId,
      };
    };

    if (payment.status === "captured") {
      if (payment.razorpayPaymentId !== input.razorpayPaymentId) {
        throw new Error("A different payment is already recorded for this order.");
      }
      const [existingEntitlement] = await tx
        .select({ id: addOnEntitlementsTable.id })
        .from(addOnEntitlementsTable)
        .where(eq(addOnEntitlementsTable.paymentId, payment.id))
        .limit(1);
      if (existingEntitlement) {
        return {
          subscription: null,
          addOnEntitlement: { entitlementId: existingEntitlement.id },
        };
      }
      const [existingSubscription] = await tx
        .select({
          subscription: userSubscriptionsTable,
          pkg: subscriptionPackagesTable,
        })
        .from(userSubscriptionsTable)
        .innerJoin(
          subscriptionPackagesTable,
          eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
        )
        .where(eq(userSubscriptionsTable.paymentId, payment.id))
        .limit(1);
      if (!existingSubscription) {
        const [currentPackage] = await tx
          .select()
          .from(subscriptionPackagesTable)
          .where(eq(subscriptionPackagesTable.id, payment.packageId))
          .limit(1);
        return {
          subscription: null,
          addOnEntitlement: null,
          reconciliationRequired: true as const,
          reconciliationReason:
            currentPackage &&
            packageMatchesCheckoutSnapshot(
              currentPackage,
              payment.packageSnapshot,
            )
              ? ("source_plan_changed" as const)
              : ("package_changed" as const),
          paymentReference: input.razorpayPaymentId,
        };
      }
      return {
        subscription: serializeSubscription(
          existingSubscription.subscription,
          existingSubscription.pkg,
        ),
        addOnEntitlement: null,
      };
    }
    if (payment.status !== "created" && payment.status !== "authorized") {
      throw new Error("This payment is not eligible for subscription activation.");
    }
    const [pkg] = await tx
      .select()
      .from(subscriptionPackagesTable)
      .where(eq(subscriptionPackagesTable.id, payment.packageId))
      .limit(1)
      .for("update");
    if (!pkg || !packageMatchesCheckoutSnapshot(pkg, payment.packageSnapshot)) {
      return markCapturedForReconciliation("package_changed");
    }

    if (pkg.packageType === "addon") {
      const [entitlement] = await tx
        .insert(addOnEntitlementsTable)
        .values({
          userId: payment.userId,
          packageId: pkg.id,
          paymentId: payment.id,
          researchAllowance: pkg.researchAllowance,
          aiEmailAssistAllowance: pkg.aiEmailAssistAllowance,
          additionalMailboxCount: pkg.additionalMailboxCount,
        })
        .returning({ id: addOnEntitlementsTable.id });
      await tx
        .update(paymentsTable)
        .set({
          status: "captured",
          razorpayPaymentId: input.razorpayPaymentId,
          updatedAt: now,
        })
        .where(eq(paymentsTable.id, payment.id));
      return {
        subscription: null,
        addOnEntitlement: { entitlementId: entitlement!.id },
      };
    }
    if (pkg.packageType !== "primary") {
      throw new Error("This package cannot be activated as a primary subscription.");
    }
    if (payment.subscriptionChangeType === "scheduled") {
      if (!payment.sourceSubscriptionId || !payment.planChangeEffectiveAt) {
        throw new Error("The scheduled plan change is missing its current subscription.");
      }
      const [source] = await tx
        .select()
        .from(userSubscriptionsTable)
        .where(
          and(
            eq(userSubscriptionsTable.id, payment.sourceSubscriptionId),
            eq(userSubscriptionsTable.userId, payment.userId),
            eq(userSubscriptionsTable.status, "active"),
          ),
        )
        .limit(1)
        .for("update");
      if (!source) {
        return markCapturedForReconciliation();
      }

      const [current] = await tx
        .select({ id: userSubscriptionsTable.id })
        .from(userSubscriptionsTable)
        .where(
          and(
            eq(userSubscriptionsTable.userId, payment.userId),
            eq(userSubscriptionsTable.status, "active"),
            lte(userSubscriptionsTable.startsAt, now),
            gt(userSubscriptionsTable.endsAt, now),
          ),
        )
        .orderBy(desc(userSubscriptionsTable.endsAt))
        .limit(1)
        .for("update");
      if (
        current?.id !== source.id ||
        source.endsAt.getTime() !== payment.planChangeEffectiveAt.getTime() ||
        source.endsAt <= now
      ) {
        return markCapturedForReconciliation();
      }

      const endsAt = new Date(
        source.endsAt.getTime() + pkg.periodDays * 24 * 60 * 60 * 1000,
      );
      const [scheduledSubscription] = await tx
        .insert(userSubscriptionsTable)
        .values({
          userId: payment.userId,
          packageId: pkg.id,
          paymentId: payment.id,
          status: "active",
          startsAt: source.endsAt,
          endsAt,
          senderAccountIdsToKeep: payment.senderAccountIdsToKeep,
        })
        .returning();
      await tx
        .update(paymentsTable)
        .set({
          status: "captured",
          razorpayPaymentId: input.razorpayPaymentId,
          updatedAt: now,
        })
        .where(eq(paymentsTable.id, payment.id));
      return {
        subscription: serializeSubscription(scheduledSubscription!, pkg),
        addOnEntitlement: null,
      };
    }
    if (payment.subscriptionChangeType === "upgrade") {
      if (!payment.sourceSubscriptionId || !payment.planChangeEffectiveAt) {
        return markCapturedForReconciliation();
      }
      const [source] = await tx
        .select()
        .from(userSubscriptionsTable)
        .where(
          and(
            eq(userSubscriptionsTable.id, payment.sourceSubscriptionId),
            eq(userSubscriptionsTable.userId, payment.userId),
            eq(userSubscriptionsTable.status, "active"),
          ),
        )
        .limit(1)
        .for("update");
      if (!source) {
        return markCapturedForReconciliation();
      }
      const [anotherCurrent] = await tx
        .select({ id: userSubscriptionsTable.id })
        .from(userSubscriptionsTable)
        .where(
          and(
            eq(userSubscriptionsTable.userId, payment.userId),
            eq(userSubscriptionsTable.status, "active"),
            lte(userSubscriptionsTable.startsAt, now),
            gt(userSubscriptionsTable.endsAt, now),
          ),
        )
        .orderBy(desc(userSubscriptionsTable.endsAt))
        .limit(1)
        .for("update");
      if (anotherCurrent && anotherCurrent.id !== source.id) {
        return markCapturedForReconciliation();
      }

      const plannedEndAt = payment.planChangeEffectiveAt;
      if (
        source.endsAt.getTime() !== plannedEndAt.getTime() ||
        plannedEndAt <= now
      ) {
        return markCapturedForReconciliation();
      }
      await tx
        .update(userSubscriptionsTable)
        .set({ status: "superseded" })
        .where(eq(userSubscriptionsTable.id, source.id));
      const [upgradedSubscription] = await tx
        .insert(userSubscriptionsTable)
        .values({
          userId: payment.userId,
          packageId: pkg.id,
          paymentId: payment.id,
          status: "active",
          startsAt: now,
          endsAt: plannedEndAt,
          senderAccountIdsToKeep: payment.senderAccountIdsToKeep,
        })
        .returning();
      await tx
        .update(paymentsTable)
        .set({
          status: "captured",
          razorpayPaymentId: input.razorpayPaymentId,
          updatedAt: now,
        })
        .where(eq(paymentsTable.id, payment.id));
      return {
        subscription: serializeSubscription(upgradedSubscription!, pkg),
        addOnEntitlement: null,
      };
    }

    const [latestActive] = await tx
      .select()
      .from(userSubscriptionsTable)
      .where(
        and(
          eq(userSubscriptionsTable.userId, payment.userId),
          eq(userSubscriptionsTable.status, "active"),
          gt(userSubscriptionsTable.endsAt, now),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1)
      .for("update");

    const { startsAt, endsAt } = getSubscriptionTerm(
      pkg.periodDays,
      latestActive?.endsAt,
      now,
    );
    const [subscription] = await tx
      .insert(userSubscriptionsTable)
      .values({
        userId: payment.userId,
        packageId: pkg.id,
        paymentId: payment.id,
        status: "active",
        startsAt,
        endsAt,
        senderAccountIdsToKeep: payment.senderAccountIdsToKeep,
      })
      .returning();
    await tx
      .update(paymentsTable)
      .set({
        status: "captured",
        razorpayPaymentId: input.razorpayPaymentId,
        updatedAt: now,
      })
      .where(eq(paymentsTable.id, payment.id));
    return {
      subscription: serializeSubscription(subscription!, pkg),
      addOnEntitlement: null,
    };
  });
}

export async function markRefundedPayment(input: {
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpayRefundId: string | null;
  amountMinor: number;
  currency: string;
  refundAmountMinor: number;
  totalRefundedAmountMinor: number | null;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, input.paymentId))
      .limit(1)
      .for("update");
    if (
      !payment ||
      payment.razorpayOrderId !== input.razorpayOrderId ||
      payment.amountMinor !== input.amountMinor ||
      payment.currency !== input.currency ||
      (payment.razorpayPaymentId !== null &&
        payment.razorpayPaymentId !== input.razorpayPaymentId) ||
      payment.status === "failed" ||
      (input.razorpayRefundId !== null &&
        (input.razorpayRefundId.length === 0 ||
          input.razorpayRefundId.length > 80)) ||
      !Number.isInteger(input.refundAmountMinor) ||
      input.refundAmountMinor <= 0 ||
      input.refundAmountMinor > payment.amountMinor ||
      (input.totalRefundedAmountMinor !== null &&
        (!Number.isInteger(input.totalRefundedAmountMinor) ||
          input.totalRefundedAmountMinor < input.refundAmountMinor ||
          input.totalRefundedAmountMinor > payment.amountMinor))
    ) {
      return false;
    }
    const [pkg] = await tx
      .select({ packageType: subscriptionPackagesTable.packageType })
      .from(subscriptionPackagesTable)
      .where(eq(subscriptionPackagesTable.id, payment.packageId))
      .limit(1);
    if (pkg?.packageType !== "addon") return false;

    if (input.razorpayRefundId !== null) {
      const [newRefund] = await tx
        .insert(razorpayRefundsTable)
        .values({
          paymentId: payment.id,
          razorpayRefundId: input.razorpayRefundId,
          amountMinor: input.refundAmountMinor,
        })
        .onConflictDoNothing()
        .returning({ id: razorpayRefundsTable.id });
      if (!newRefund) return false;
    } else if (
      input.totalRefundedAmountMinor === null &&
      input.refundAmountMinor < payment.amountMinor
    ) {
      // A partial refund without either a provider identity or cumulative
      // total cannot be safely distinguished from a repeated notification.
      return false;
    }

    const previouslyRefunded = payment.refundedAmountMinor ?? 0;
    const refundTotal = Math.min(
      payment.amountMinor,
      Math.max(
        previouslyRefunded,
        input.totalRefundedAmountMinor ??
          previouslyRefunded + input.refundAmountMinor,
      ),
    );
    await tx
      .update(paymentsTable)
      .set({
        refundedAmountMinor: refundTotal,
        status:
          refundTotal >= payment.amountMinor || payment.status === "refunded"
            ? "refunded"
            : payment.status,
        razorpayPaymentId: input.razorpayPaymentId,
        updatedAt: new Date(),
      })
      .where(eq(paymentsTable.id, payment.id));
    return true;
  });
}
export async function grantAdminGiftSubscription(input: {
  userId: string;
  packageId: string;
}) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, input.userId),
          eq(usersTable.role, "USER"),
          isNull(usersTable.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!user) return null;

    const [pkg] = await tx
      .select()
      .from(subscriptionPackagesTable)
      .where(eq(subscriptionPackagesTable.id, input.packageId))
      .limit(1);
    if (!pkg) return null;

    const now = new Date();
    if (pkg.packageType === "addon") {
      const [activePaidPrimary] = await tx
        .select({ id: userSubscriptionsTable.id })
        .from(userSubscriptionsTable)
        .innerJoin(
          subscriptionPackagesTable,
          eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
        )
        .where(
          and(
            eq(userSubscriptionsTable.userId, user.id),
            eq(userSubscriptionsTable.status, "active"),
            lte(userSubscriptionsTable.startsAt, now),
            gt(userSubscriptionsTable.endsAt, now),
            eq(subscriptionPackagesTable.packageType, "primary"),
            gt(subscriptionPackagesTable.amountMinor, 0),
          ),
        )
        .orderBy(desc(userSubscriptionsTable.endsAt))
        .limit(1)
        .for("update");
      if (!activePaidPrimary) return { kind: "primary-required" as const };

      const [entitlement] = await tx
        .insert(addOnEntitlementsTable)
        .values({
          userId: user.id,
          packageId: pkg.id,
          paymentId: null,
          grantSource: "admin_gift",
          researchAllowance: pkg.researchAllowance,
          aiEmailAssistAllowance: pkg.aiEmailAssistAllowance,
          additionalMailboxCount: pkg.additionalMailboxCount,
        })
        .returning({ id: addOnEntitlementsTable.id });
      if (!entitlement) return null;
      return {
        kind: "addon" as const,
        entitlementId: entitlement.id,
        packageId: pkg.id,
        packageName: pkg.name,
        researchAllowance: pkg.researchAllowance,
        aiEmailAssistAllowance: pkg.aiEmailAssistAllowance,
        additionalMailboxCount: pkg.additionalMailboxCount,
      };
    }
    if (pkg.packageType !== "primary") return null;

    const [latestActive] = await tx
      .select()
      .from(userSubscriptionsTable)
      .where(
        and(
          eq(userSubscriptionsTable.userId, user.id),
          eq(userSubscriptionsTable.status, "active"),
          gt(userSubscriptionsTable.endsAt, now),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1)
      .for("update");
    const { startsAt, endsAt } = getSubscriptionTerm(
      pkg.periodDays,
      latestActive?.endsAt,
      now,
    );

    const [subscription] = await tx
      .insert(userSubscriptionsTable)
      .values({
        userId: user.id,
        packageId: pkg.id,
        paymentId: null,
        status: "active",
        startsAt,
        endsAt,
      })
      .returning();
    return {
      kind: "primary" as const,
      subscription: serializeSubscription(subscription!, pkg),
    };
  });
}

export class PlanChangeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PlanChangeError";
  }
}

export async function activateNoCostPrimaryPlanChange(input: {
  userId: string;
  packageId: string;
  senderAccountIdsToKeep?: string[];
  effectiveEmailAccountLimit?: number;
}) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, input.userId),
          eq(usersTable.role, "USER"),
          isNull(usersTable.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!user) return null;

    const [pkg] = await tx
      .select()
      .from(subscriptionPackagesTable)
      .where(
        and(
          eq(subscriptionPackagesTable.id, input.packageId),
          eq(subscriptionPackagesTable.active, true),
          eq(subscriptionPackagesTable.packageType, "primary"),
        ),
      )
      .limit(1)
      .for("update");
    if (!pkg) return null;
    const senderAccountIdsToKeep = input.senderAccountIdsToKeep;
    const now = new Date();
    const ownedAccounts = await tx
      .select({ id: tenantSendingConfigurationTable.id })
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, user.id));
    const accountLimit =
      input.effectiveEmailAccountLimit ?? pkg.emailAccountLimit;
    const needsRetention = ownedAccounts.length > accountLimit;
    if (needsRetention && senderAccountIdsToKeep === undefined) {
      throw new Error("Choose which SMTP sender accounts to retain for this package.");
    }
    if (senderAccountIdsToKeep !== undefined) {
      const ownedIds = new Set(ownedAccounts.map((account) => account.id));
      if (
        new Set(senderAccountIdsToKeep).size !== senderAccountIdsToKeep.length ||
        senderAccountIdsToKeep.some((accountId) => !ownedIds.has(accountId)) ||
        senderAccountIdsToKeep.length > accountLimit ||
        (needsRetention &&
          senderAccountIdsToKeep.length !== accountLimit)
      ) {
        throw new Error("Choose the SMTP sender accounts allowed by this package.");
      }
      if (needsRetention) {
        const removedIds = ownedAccounts
          .map((account) => account.id)
          .filter((accountId) => !senderAccountIdsToKeep.includes(accountId));
        if (removedIds.length > 0) {
          const [campaignInUse] = await tx
            .select({ id: emailCampaignsTable.id })
            .from(emailCampaignsTable)
            .where(
              and(
                eq(emailCampaignsTable.userId, user.id),
                inArray(emailCampaignsTable.senderAccountId, removedIds),
                inArray(emailCampaignsTable.status, ["queued", "sending"]),
              ),
            )
            .limit(1);
          if (campaignInUse) {
            throw new Error("Finish or reassign active campaigns before removing their SMTP sender accounts.");
          }
        }
      }
    }

    const [existing] = await tx
      .select()
      .from(userSubscriptionsTable)
      .where(
        and(
          eq(userSubscriptionsTable.userId, user.id),
          eq(userSubscriptionsTable.packageId, pkg.id),
          eq(userSubscriptionsTable.status, "active"),
          gt(userSubscriptionsTable.endsAt, now),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1)
      .for("update");
    if (existing) return serializeSubscription(existing, pkg);

    const [scheduled] = await tx
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
          eq(userSubscriptionsTable.userId, user.id),
          eq(userSubscriptionsTable.status, "active"),
          gt(userSubscriptionsTable.startsAt, now),
          gt(userSubscriptionsTable.endsAt, now),
        ),
      )
      .orderBy(asc(userSubscriptionsTable.startsAt))
      .limit(1)
      .for("update");
    if (scheduled) {
      throw new PlanChangeError(
        "A primary plan change is already scheduled. It must start before another change can be made.",
        "PLAN_CHANGE_ALREADY_SCHEDULED",
      );
    }

    const [latestActive] = await tx
      .select()
      .from(userSubscriptionsTable)
      .where(
        and(
          eq(userSubscriptionsTable.userId, user.id),
          eq(userSubscriptionsTable.status, "active"),
          gt(userSubscriptionsTable.endsAt, now),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1)
      .for("update");
    let immediateUpgrade = false;
    if (latestActive) {
      const [currentPackage] = await tx
        .select()
        .from(subscriptionPackagesTable)
        .where(eq(subscriptionPackagesTable.id, latestActive.packageId))
        .limit(1);
      if (!currentPackage) {
        throw new Error("The current primary package could not be loaded.");
      }
      const changeKind = comparePrimaryPlanLimits(currentPackage, pkg);
      immediateUpgrade = changeKind === "upgrade";
      if (pkg.amountMinor > 0) {
        const zeroCostAmount = calculateProratedUpgradeAmountMinor({
          currentPackage,
          targetPackage: pkg,
          endsAt: latestActive.endsAt,
          now,
        });
        if (
          !immediateUpgrade ||
          zeroCostAmount !== 0
        ) {
          throw new PlanChangeError(
            "This plan change requires payment through checkout.",
            "UPGRADE_REQUIRES_PAYMENT",
          );
        }
      }
    } else if (pkg.amountMinor > 0) {
      throw new PlanChangeError(
        "A paid plan requires checkout unless it is a no-cost upgrade to an active plan.",
        "UPGRADE_REQUIRES_PAYMENT",
      );
    }

    const { startsAt, endsAt } = immediateUpgrade && latestActive
      ? { startsAt: now, endsAt: latestActive.endsAt }
      : getSubscriptionTerm(pkg.periodDays, latestActive?.endsAt, now);
    if (immediateUpgrade && latestActive) {
      await tx
        .update(userSubscriptionsTable)
        .set({ status: "superseded" })
        .where(eq(userSubscriptionsTable.id, latestActive.id));
    }
    const [subscription] = await tx
      .insert(userSubscriptionsTable)
      .values({
        userId: user.id,
        packageId: pkg.id,
        paymentId: null,
        status: "active",
        startsAt,
        endsAt,
        senderAccountIdsToKeep: needsRetention
          ? senderAccountIdsToKeep ?? null
          : null,
      })
      .returning();
    return serializeSubscription(subscription!, pkg);
  });
}
