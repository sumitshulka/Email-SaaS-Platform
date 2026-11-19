import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  basicPlanSupportRequestsTable,
  db,
  paymentsTable,
  platformNotificationRecipientsTable,
  platformNotificationsTable,
  subscriptionPackagesTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import {
  addCalendarMonthsUtc,
  completedContinuousPaidMonths,
  getBasicPlanMilestone,
  isBasicPlanMilestoneEligible,
  isFirstFreePlanChain,
  mergeContinuousPaidWindows,
  type PaidWindow,
  type SubscriptionPlanWindow,
} from "./basic-plan-support-policy";
import { logger } from "./logger";

const REQUEST_DECISION_WINDOW_MS = 72 * 60 * 60 * 1000;
const BASIC_GRANT_DAYS = 30;
const AUTO_GRANT_INTERVAL_MS = 30_000;
const AUTO_GRANT_BATCH_SIZE = 100;
let autoGrantWorkerStarted = false;

type QueryExecutor = Pick<typeof db, "select">;
type MutationExecutor = Pick<typeof db, "select" | "insert" | "update">;
type RequestStatus =
  | "pending"
  | "approved"
  | "auto_approved"
  | "rejected";

type TermRow = SubscriptionPlanWindow & {
  status: "active" | "superseded" | "cancelled";
  packageName: string;
  periodDays: number;
  paymentStatus: "created" | "authorized" | "captured" | "failed" | "refunded" | null;
  paymentAmountMinor: number | null;
};

type RequestGrantDates = {
  grantStartsAt: string | null;
  grantEndsAt: string | null;
  freePlanResumesAt: string | null;
};

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function serializeRequest(
  request: typeof basicPlanSupportRequestsTable.$inferSelect,
  grantDates?: RequestGrantDates,
) {
  return {
    id: request.id,
    milestone: request.milestone as 1 | 2 | 3,
    status: request.status as RequestStatus,
    requestedAt: request.requestedAt.toISOString(),
    decisionDeadlineAt: request.decisionDeadlineAt.toISOString(),
    resolvedAt: toIso(request.resolvedAt),
    rejectionReason: request.rejectionReason,
    grantStartsAt: grantDates?.grantStartsAt ?? null,
    grantEndsAt: grantDates?.grantEndsAt ?? null,
    freePlanResumesAt: grantDates?.freePlanResumesAt ?? null,
  };
}

async function getTermRows(
  executor: QueryExecutor,
  userId: string,
): Promise<TermRow[]> {
  return executor
    .select({
      id: userSubscriptionsTable.id,
      packageId: userSubscriptionsTable.packageId,
      startsAt: userSubscriptionsTable.startsAt,
      endsAt: userSubscriptionsTable.endsAt,
      status: userSubscriptionsTable.status,
      packageType: subscriptionPackagesTable.packageType,
      packageName: subscriptionPackagesTable.name,
      amountMinor: subscriptionPackagesTable.amountMinor,
      periodDays: subscriptionPackagesTable.periodDays,
      paymentStatus: paymentsTable.status,
      paymentAmountMinor: paymentsTable.amountMinor,
    })
    .from(userSubscriptionsTable)
    .innerJoin(
      subscriptionPackagesTable,
      eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
    )
    .leftJoin(
      paymentsTable,
      eq(userSubscriptionsTable.paymentId, paymentsTable.id),
    )
    .where(eq(userSubscriptionsTable.userId, userId))
    .orderBy(asc(userSubscriptionsTable.startsAt));
}

function getPaidWindows(terms: TermRow[]): PaidWindow[] {
  return terms
    .filter(
      (term) =>
        term.status !== "cancelled" &&
        term.packageType === "primary" &&
        term.amountMinor > 0 &&
        term.paymentStatus === "captured" &&
        (term.paymentAmountMinor ?? 0) > 0,
    )
    .map((term) => ({ startsAt: term.startsAt, endsAt: term.endsAt }));
}

async function loadSupportState(
  executor: QueryExecutor,
  userId: string,
  now = new Date(),
) {
  const [terms, requests] = await Promise.all([
    getTermRows(executor, userId),
    executor
      .select()
      .from(basicPlanSupportRequestsTable)
      .where(eq(basicPlanSupportRequestsTable.userId, userId))
      .orderBy(asc(basicPlanSupportRequestsTable.milestone)),
  ]);
  const [namedBasicPackage] = await executor
    .select({ id: subscriptionPackagesTable.id })
    .from(subscriptionPackagesTable)
    .where(
      and(
        eq(subscriptionPackagesTable.packageType, "primary"),
        gt(subscriptionPackagesTable.amountMinor, 0),
        eq(subscriptionPackagesTable.active, true),
        sql`lower(${subscriptionPackagesTable.name}) = 'basic'`,
      ),
    )
    .limit(1);
  const currentFreeTerm = terms
    .filter(
      (term) =>
        term.status === "active" &&
        term.packageType === "primary" &&
        term.amountMinor === 0 &&
        term.startsAt <= now &&
        term.endsAt > now,
    )
    .sort((left, right) => right.endsAt.getTime() - left.endsAt.getTime())[0];
  const firstFreePlan = isFirstFreePlanChain(terms, currentFreeTerm);
  const paidWindows = mergeContinuousPaidWindows(
    getPaidWindows(terms),
    now,
  );
  const completedPaidMonths = completedContinuousPaidMonths(paidWindows, now);
  const { milestone: nextMilestone, requiredPaidMonths } =
    getBasicPlanMilestone(requests.length);
  const pending = requests.find((request) => request.status === "pending");
  const eligibleMilestone = isBasicPlanMilestoneEligible({
    milestone: nextMilestone,
    firstFreePlan,
    completedPaidMonths,
  });
  const basicPlanAvailable = Boolean(namedBasicPackage);
  const canRequest =
    basicPlanAvailable &&
    Boolean(currentFreeTerm) &&
    !pending &&
    eligibleMilestone;
  let message: string;
  if (!basicPlanAvailable) {
    message = "The Basic package is not currently available. Contact your administrator.";
  } else if (pending) {
    message = "Your request is awaiting a decision. If it is still pending after 72 hours, the Basic plan will be granted automatically.";
  } else if (!currentFreeTerm) {
    message = "You can apply while your Free plan is active.";
  } else if (nextMilestone === null) {
    message = "You have used all three lifetime Basic plan requests.";
  } else if (nextMilestone === 1 && !firstFreePlan) {
    message = "The first request is available only during your first uninterrupted Free plan period.";
  } else if (!eligibleMilestone) {
    message = `Your next request requires ${requiredPaidMonths} months of continuous paid-plan access. ${completedPaidMonths} complete months currently qualify.`;
  } else {
    message =
      nextMilestone === 1
        ? "You are eligible for your first one-month Basic plan request."
        : `You are eligible for Basic request ${nextMilestone} of 3.`;
  }
  const grantIds = requests
    .map((request) => request.grantSubscriptionId)
    .filter((id): id is string => Boolean(id));
  const grants = grantIds.length
    ? await executor
        .select({
          id: userSubscriptionsTable.id,
          startsAt: userSubscriptionsTable.startsAt,
          endsAt: userSubscriptionsTable.endsAt,
          packageId: userSubscriptionsTable.packageId,
        })
        .from(userSubscriptionsTable)
        .where(inArray(userSubscriptionsTable.id, grantIds))
    : [];
  const grantDatesById = new Map(
    grants.map((grant) => [
      grant.id,
      {
        grantStartsAt: grant.startsAt.toISOString(),
        grantEndsAt: grant.endsAt.toISOString(),
        freePlanResumesAt: new Date(grant.endsAt).toISOString(),
      },
    ]),
  );
  return {
    response: {
      canRequest,
      basicPlanAvailable,
      currentFreePlan: Boolean(currentFreeTerm),
      firstFreePlan,
      nextMilestone,
      requiredPaidMonths,
      completedPaidMonths: Math.min(6, completedPaidMonths),
      message,
      pendingRequest: pending
        ? serializeRequest(pending, grantDatesById.get(pending.grantSubscriptionId ?? ""))
        : null,
      history: requests.map((request) =>
        serializeRequest(
          request,
          grantDatesById.get(request.grantSubscriptionId ?? ""),
        ),
      ),
    },
    currentFreeTerm,
    basicPackageId: namedBasicPackage?.id ?? null,
    basicPackageExists: Boolean(namedBasicPackage),
    paidWindows,
  };
}

export async function getBasicPlanSupportStatus(userId: string) {
  const state = await loadSupportState(db, userId);
  return state.response;
}

export async function submitBasicPlanSupportRequest(
  userId: string,
  now = new Date(),
): Promise<
  | { kind: "created"; status: Awaited<ReturnType<typeof getBasicPlanSupportStatus>> }
  | { kind: "ineligible"; status: Awaited<ReturnType<typeof getBasicPlanSupportStatus>> }
> {
  const outcome = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, userId),
          eq(usersTable.role, "USER"),
          isNull(usersTable.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!user) return { kind: "missing" as const };
    const state = await loadSupportState(tx, userId, now);
    if (!state.response.canRequest || !state.currentFreeTerm) {
      return { kind: "ineligible" as const };
    }
    const deadline = new Date(now.getTime() + REQUEST_DECISION_WINDOW_MS);
    const paidWindow = state.response.requiredPaidMonths
      ? state.paidWindows.find(
          (window) =>
            window.endsAt >=
            addCalendarMonthsUtc(
              window.startsAt,
              state.response.requiredPaidMonths!,
            ),
        )
      : undefined;
    const [request] = await tx
      .insert(basicPlanSupportRequestsTable)
      .values({
        userId,
        milestone: state.response.nextMilestone!,
        freePackageId: state.currentFreeTerm.packageId,
        status: "pending",
        requestedAt: now,
        decisionDeadlineAt: deadline,
        paidWindowStartedAt: paidWindow?.startsAt ?? null,
      })
      .returning();
    if (!request) return { kind: "ineligible" as const };
    return { kind: "created" as const };
  });
  if (outcome.kind === "missing") {
    return { kind: "ineligible", status: await getBasicPlanSupportStatus(userId) };
  }
  return {
    kind: outcome.kind,
    status: await getBasicPlanSupportStatus(userId),
  };
}

async function addRequestNotification(
  executor: MutationExecutor,
  userId: string,
  title: string,
  message: string,
  now: Date,
): Promise<void> {
  const [notification] = await executor
    .insert(platformNotificationsTable)
    .values({
      title,
      message,
      audience: "focused",
      enabled: true,
      startsAt: now,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      createdBy: null,
    })
    .returning({ id: platformNotificationsTable.id });
  if (!notification) return;
  await executor
    .insert(platformNotificationRecipientsTable)
    .values({ notificationId: notification.id, userId })
    .onConflictDoNothing();
}

async function resolvePendingRequest(input: {
  requestId: string;
  actorId: string | null;
  decision: "approve" | "reject" | "auto_approve";
  reason?: string;
  now: Date;
}): Promise<
  | { kind: "resolved"; status: RequestStatus; userId: string }
  | { kind: "not_found" | "not_pending" | "deadline_passed" | "not_due" | "package_unavailable" }
> {
  const [requestOwner] = await db
    .select({ userId: basicPlanSupportRequestsTable.userId })
    .from(basicPlanSupportRequestsTable)
    .where(eq(basicPlanSupportRequestsTable.id, input.requestId))
    .limit(1);
  if (!requestOwner) return { kind: "not_found" };

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, requestOwner.userId))
      .limit(1)
      .for("update");
    if (!user) return { kind: "not_found" as const };
    const [request] = await tx
      .select()
      .from(basicPlanSupportRequestsTable)
      .where(eq(basicPlanSupportRequestsTable.id, input.requestId))
      .limit(1)
      .for("update");
    if (!request) return { kind: "not_found" as const };
    if (request.status !== "pending") return { kind: "not_pending" as const };
    if (
      input.decision !== "auto_approve" &&
      request.decisionDeadlineAt <= input.now
    ) {
      return { kind: "deadline_passed" as const };
    }
    if (
      input.decision === "auto_approve" &&
      request.decisionDeadlineAt > input.now
    ) {
      return { kind: "not_due" as const };
    }
    if (input.decision === "reject") {
      const reason = input.reason?.trim() ?? "";
      if (reason.length < 10 || reason.length > 1000) {
        return { kind: "not_pending" as const };
      }
      await tx
        .update(basicPlanSupportRequestsTable)
        .set({
          status: "rejected",
          resolvedAt: input.now,
          resolvedBy: input.actorId,
          rejectionReason: reason,
        })
        .where(eq(basicPlanSupportRequestsTable.id, request.id));
      await addRequestNotification(
        tx,
        user.id,
        "Basic plan request update",
        `Your Basic plan request was not approved. Reason: ${reason} You can apply again after you meet the next eligibility milestone.`,
        input.now,
      );
      return {
        kind: "resolved" as const,
        status: "rejected" as const,
        userId: user.id,
      };
    }

    const [basicPackage] = await tx
      .select()
      .from(subscriptionPackagesTable)
      .where(
        and(
          eq(subscriptionPackagesTable.packageType, "primary"),
          gt(subscriptionPackagesTable.amountMinor, 0),
          eq(subscriptionPackagesTable.active, true),
          sql`lower(${subscriptionPackagesTable.name}) = 'basic'`,
        ),
      )
      .limit(1)
      .for("update");
    const [freePackage] = await tx
      .select()
      .from(subscriptionPackagesTable)
      .where(
        and(
          eq(subscriptionPackagesTable.id, request.freePackageId),
          eq(subscriptionPackagesTable.packageType, "primary"),
          eq(subscriptionPackagesTable.amountMinor, 0),
        ),
      )
      .limit(1)
      .for("update");
    if (!basicPackage || !freePackage || freePackage.periodDays <= 0) {
      return { kind: "package_unavailable" as const };
    }

    const activeTerms = await tx
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
          gt(userSubscriptionsTable.endsAt, input.now),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .for("update");
    const scheduled = activeTerms.filter(
      ({ subscription }) => subscription.startsAt > input.now,
    );
    const current = activeTerms.find(
      ({ subscription }) =>
        subscription.startsAt <= input.now &&
        subscription.endsAt > input.now,
    );
    let grantStartsAt = input.now;
    if (scheduled.length > 0) {
      grantStartsAt = scheduled.reduce(
        (latest, { subscription }) =>
          subscription.endsAt > latest ? subscription.endsAt : latest,
        input.now,
      );
    } else if (current && current.pkg.amountMinor > 0) {
      grantStartsAt = current.subscription.endsAt;
    } else if (current && current.pkg.amountMinor === 0) {
      await tx
        .update(userSubscriptionsTable)
        .set({ status: "superseded" })
        .where(eq(userSubscriptionsTable.id, current.subscription.id));
    }
    const grantEndsAt = new Date(
      grantStartsAt.getTime() + BASIC_GRANT_DAYS * 24 * 60 * 60 * 1000,
    );
    const freePlanEndsAt = new Date(
      grantEndsAt.getTime() + freePackage.periodDays * 24 * 60 * 60 * 1000,
    );
    const [grant] = await tx
      .insert(userSubscriptionsTable)
      .values({
        userId: user.id,
        packageId: basicPackage.id,
        paymentId: null,
        status: "active",
        startsAt: grantStartsAt,
        endsAt: grantEndsAt,
      })
      .returning({ id: userSubscriptionsTable.id });
    if (!grant) return { kind: "package_unavailable" as const };
    await tx.insert(userSubscriptionsTable).values({
      userId: user.id,
      packageId: freePackage.id,
      paymentId: null,
      status: "active",
      startsAt: grantEndsAt,
      endsAt: freePlanEndsAt,
    });
    const requestStatus =
      input.decision === "auto_approve" ? "auto_approved" : "approved";
    await tx
      .update(basicPlanSupportRequestsTable)
      .set({
        status: requestStatus,
        resolvedAt: input.now,
        resolvedBy: input.actorId,
        rejectionReason: null,
        grantSubscriptionId: grant.id,
      })
      .where(eq(basicPlanSupportRequestsTable.id, request.id));
    const startText =
      grantStartsAt > input.now
        ? `It is scheduled to start on ${grantStartsAt.toLocaleString()}.`
        : `It is active through ${grantEndsAt.toLocaleDateString()}.`;
    await addRequestNotification(
      tx,
      user.id,
      "Basic plan request approved",
      `Your one-month Basic plan request was ${input.decision === "auto_approve" ? "automatically approved after the 72-hour review period" : "approved by an administrator"}. ${startText} Your Free plan is scheduled to resume after the Basic month.`,
      input.now,
    );
    return {
      kind: "resolved" as const,
      status: requestStatus as RequestStatus,
      userId: user.id,
    };
  });
}

export async function decideAdminBasicPlanRequest(input: {
  requestId: string;
  actorId: string;
  decision: "approve" | "reject";
  reason?: string;
  now?: Date;
}) {
  const result = await resolvePendingRequest({
    ...input,
    now: input.now ?? new Date(),
  });
  if (result.kind !== "resolved") return result;
  const status = await listAdminBasicPlanRequests("all", input.now);
  const request = status.items.find((item) => item.id === input.requestId);
  return { kind: "resolved" as const, request };
}

export async function listAdminBasicPlanRequests(
  status: "pending" | "all" = "pending",
  now = new Date(),
) {
  const [rows, [pendingCount]] = await Promise.all([
    db
      .select({
        request: basicPlanSupportRequestsTable,
        user: {
          id: usersTable.id,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          username: usersTable.username,
          email: usersTable.email,
        },
      })
      .from(basicPlanSupportRequestsTable)
      .innerJoin(
        usersTable,
        eq(basicPlanSupportRequestsTable.userId, usersTable.id),
      )
      .where(
        status === "pending"
          ? eq(basicPlanSupportRequestsTable.status, "pending")
          : undefined,
      )
      .orderBy(
        asc(basicPlanSupportRequestsTable.status),
        asc(basicPlanSupportRequestsTable.decisionDeadlineAt),
      )
      .limit(300),
    db
      .select({ value: count() })
      .from(basicPlanSupportRequestsTable)
      .where(eq(basicPlanSupportRequestsTable.status, "pending")),
  ]);
  const grantIds = rows
    .map(({ request }) => request.grantSubscriptionId)
    .filter((id): id is string => Boolean(id));
  const grants = grantIds.length
    ? await db
        .select({
          id: userSubscriptionsTable.id,
          startsAt: userSubscriptionsTable.startsAt,
          endsAt: userSubscriptionsTable.endsAt,
        })
        .from(userSubscriptionsTable)
        .where(inArray(userSubscriptionsTable.id, grantIds))
    : [];
  const grantsById = new Map(
    grants.map((grant) => [
      grant.id,
      {
        grantStartsAt: grant.startsAt.toISOString(),
        grantEndsAt: grant.endsAt.toISOString(),
        freePlanResumesAt: grant.endsAt.toISOString(),
      },
    ]),
  );
  return {
    pendingCount: pendingCount?.value ?? 0,
    items: rows.map(({ request, user }) => ({
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`.trim() || user.username,
      username: user.username,
      email: user.email,
      ...serializeRequest(
        request,
        grantsById.get(request.grantSubscriptionId ?? ""),
      ),
      overdue: request.status === "pending" && request.decisionDeadlineAt <= now,
    })),
  };
}

export async function processDueBasicPlanSupportRequests(
  now = new Date(),
  batchSize = AUTO_GRANT_BATCH_SIZE,
): Promise<{ checked: number; granted: number; failed: number }> {
  const candidates = await db
    .select({ id: basicPlanSupportRequestsTable.id })
    .from(basicPlanSupportRequestsTable)
    .where(
      and(
        eq(basicPlanSupportRequestsTable.status, "pending"),
        lte(basicPlanSupportRequestsTable.decisionDeadlineAt, now),
      ),
    )
    .orderBy(asc(basicPlanSupportRequestsTable.decisionDeadlineAt))
    .limit(Math.max(1, Math.floor(batchSize)));
  let granted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await resolvePendingRequest({
        requestId: candidate.id,
        actorId: null,
        decision: "auto_approve",
        now,
      });
      if (result.kind === "resolved") granted += 1;
      else if (result.kind === "package_unavailable") {
        logger.error(
          { requestId: candidate.id },
          "Basic plan support request could not be auto-granted because a package is unavailable",
        );
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      logger.error(
        {
          requestId: candidate.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Basic plan support request auto-grant failed",
      );
    }
  }
  return { checked: candidates.length, granted, failed };
}

export function startBasicPlanSupportAutoGrantWorker(): void {
  if (autoGrantWorkerStarted) return;
  autoGrantWorkerStarted = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await processDueBasicPlanSupportRequests();
      if (result.granted || result.failed) {
        logger.info(result, "Basic plan support request auto-grant sweep completed");
      }
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Basic plan support request auto-grant worker failed",
      );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), AUTO_GRANT_INTERVAL_MS);
  timer.unref();
  void tick();
}
