import { and, desc, eq, gt, inArray, isNull, lte, notInArray } from "drizzle-orm";
import {
  db,
  emailCampaignsTable,
  paymentsTable,
  subscriptionPackagesTable,
  tenantSendingConfigurationTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";

type PackageRow = typeof subscriptionPackagesTable.$inferSelect;
type SubscriptionRow = typeof userSubscriptionsTable.$inferSelect;

export function serializePackage(pkg: PackageRow) {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    amountMinor: pkg.amountMinor,
    currency: pkg.currency,
    periodDays: pkg.periodDays,
    contactLimit: pkg.contactLimit,
    emailAccountLimit: pkg.emailAccountLimit,
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
  if (!latest) return { subscription: null };
  if (latest.subscription.startsAt > now) return { subscription: null };

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
  };
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

    if (payment.status === "captured") {
      if (payment.razorpayPaymentId !== input.razorpayPaymentId) {
        throw new Error("A different payment is already recorded for this order.");
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
        throw new Error("The captured payment has no subscription record.");
      }
      return serializeSubscription(
        existingSubscription.subscription,
        existingSubscription.pkg,
      );
    }
    if (payment.status !== "created" && payment.status !== "authorized") {
      throw new Error("This payment is not eligible for subscription activation.");
    }
    const [pkg] = await tx
      .select()
      .from(subscriptionPackagesTable)
      .where(eq(subscriptionPackagesTable.id, payment.packageId))
      .limit(1);
    if (!pkg) throw new Error("The purchased package is no longer available.");

    const now = new Date();
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
    return serializeSubscription(subscription!, pkg);
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
    return serializeSubscription(subscription!, pkg);
  });
}

export async function activateFreePackageForUser(input: {
  userId: string;
  packageId: string;
  senderAccountIdsToKeep?: string[];
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
          eq(subscriptionPackagesTable.amountMinor, 0),
        ),
      )
      .limit(1)
      .for("update");
    if (!pkg) return null;
    const senderAccountIdsToKeep = input.senderAccountIdsToKeep;
    const ownedAccounts = await tx
      .select({ id: tenantSendingConfigurationTable.id })
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, user.id));
    const needsRetention = ownedAccounts.length > pkg.emailAccountLimit;
    if (needsRetention && senderAccountIdsToKeep === undefined) {
      throw new Error("Choose which SMTP sender accounts to retain for this package.");
    }
    if (senderAccountIdsToKeep !== undefined) {
      const ownedIds = new Set(ownedAccounts.map((account) => account.id));
      if (
        new Set(senderAccountIdsToKeep).size !== senderAccountIdsToKeep.length ||
        senderAccountIdsToKeep.some((accountId) => !ownedIds.has(accountId)) ||
        senderAccountIdsToKeep.length > pkg.emailAccountLimit ||
        (needsRetention &&
          senderAccountIdsToKeep.length !== pkg.emailAccountLimit)
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

    const now = new Date();
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
        senderAccountIdsToKeep: needsRetention
          ? senderAccountIdsToKeep ?? null
          : null,
      })
      .returning();
    return serializeSubscription(subscription!, pkg);
  });
}