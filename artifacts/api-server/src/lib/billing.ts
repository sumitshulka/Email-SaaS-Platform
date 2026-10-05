import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import {
  db,
  paymentsTable,
  subscriptionPackagesTable,
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
      })
      .returning();
    return serializeSubscription(subscription!, pkg);
  });
}