import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const databaseUrl = process.env.AI_CREDIT_RECOVERY_RACE_TEST_DATABASE_URL;

test(
  "concurrent PostgreSQL cleanup recovers a stale AI credit backlog without changing active or consumed usage",
  {
    skip: databaseUrl
      ? false
      : "Set AI_CREDIT_RECOVERY_RACE_TEST_DATABASE_URL to a disposable, migrated PostgreSQL database.",
  },
  async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PGAPPNAME = `mailflow-ai-credit-recovery-race-${process.pid}`;

    const [dbModule, entitlementModule] = await Promise.all([
      import("@workspace/db"),
      import("../src/lib/add-on-entitlements.ts"),
    ]);
    const { db, pool } = dbModule;
    const { getAiEmailAssistReservationTimeoutMs } = entitlementModule;
    const {
      addOnEntitlementsTable,
      aiEmailAssistUsagesTable,
      subscriptionPackagesTable,
      userSubscriptionsTable,
      usersTable,
    } = dbModule;

    const testId = randomUUID();
    let userId;
    let primaryPackageId;
    let addonPackageId;
    let backlogPackageId;
    let entitlementId;
    let backlogEntitlementId;
    let lockClient;
    let transactionLockHeld = false;
    let cleanupPromises = [];

    try {
      const [user] = await db
        .insert(usersTable)
        .values({
          username: `aicr-${testId}`,
          firstName: "AI Credit",
          lastName: "Race",
          email: `ai-credit-race-${testId}@example.test`,
          passwordHash: "postgres-ai-credit-recovery-race-test",
        })
        .returning({ id: usersTable.id });
      userId = user.id;

      const [primaryPackage] = await db
        .insert(subscriptionPackagesTable)
        .values({
          packageType: "primary",
          name: `AI credit race primary ${testId}`,
          description: "Paid primary fixture for AI credit cleanup race test.",
          amountMinor: 2000,
          currency: "INR",
          periodDays: 30,
          contactLimit: 500,
          emailAccountLimit: 1,
        })
        .returning({ id: subscriptionPackagesTable.id });
      primaryPackageId = primaryPackage.id;

      const [addonPackage] = await db
        .insert(subscriptionPackagesTable)
        .values({
          packageType: "addon",
          name: `AI credit race add-on ${testId}`,
          description: "One AI Email Assist credit for recovery race test.",
          amountMinor: 0,
          currency: "INR",
          periodDays: 0,
          contactLimit: 0,
          emailAccountLimit: 0,
          aiEmailAssistAllowance: 1,
        })
        .returning({ id: subscriptionPackagesTable.id });
      addonPackageId = addonPackage.id;

      const [backlogPackage] = await db
        .insert(subscriptionPackagesTable)
        .values({
          packageType: "addon",
          name: `AI credit backlog add-on ${testId}`,
          description: "AI Email Assist allowance for recovery backlog test.",
          amountMinor: 0,
          currency: "INR",
          periodDays: 0,
          contactLimit: 0,
          emailAccountLimit: 0,
          aiEmailAssistAllowance: 12,
        })
        .returning({ id: subscriptionPackagesTable.id });
      backlogPackageId = backlogPackage.id;

      const now = new Date();
      await db.insert(userSubscriptionsTable).values({
        userId,
        packageId: primaryPackageId,
        status: "active",
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });

      const [entitlement] = await db
        .insert(addOnEntitlementsTable)
        .values({
          userId,
          packageId: addonPackageId,
          aiEmailAssistAllowance: 1,
        })
        .returning({ id: addOnEntitlementsTable.id });
      entitlementId = entitlement.id;

      const cleanupNow = new Date();
      const staleCreatedAt = new Date(cleanupNow.getTime() - 60 * 60_000);
      const [staleReservation] = await db
        .insert(aiEmailAssistUsagesTable)
        .values({
          userId,
          entitlementId,
          status: "reserved",
          createdAt: staleCreatedAt,
        })
        .returning({ id: aiEmailAssistUsagesTable.id });

      assert.ok(
        pool.options.max >= 3,
        "the PostgreSQL pool must allow two cleanup calls alongside the lock holder",
      );
      lockClient = await pool.connect();
      await lockClient.query("BEGIN");
      transactionLockHeld = true;
      const { rows: lockedReservations } = await lockClient.query(
        "SELECT id FROM ai_email_assist_usages WHERE id = $1 FOR UPDATE",
        [staleReservation.id],
      );
      assert.equal(lockedReservations.length, 1);

      const lockProbe = await pool.connect();
      try {
        await assert.rejects(
          lockProbe.query(
            "SELECT id FROM ai_email_assist_usages WHERE id = $1 FOR UPDATE NOWAIT",
            [staleReservation.id],
          ),
          (error) => error.code === "55P03",
          "PostgreSQL must confirm the stale reservation row is locked",
        );
      } finally {
        lockProbe.release();
      }

      const activeClientsBeforeCleanups = pool.totalCount - pool.idleCount;
      assert.ok(
        activeClientsBeforeCleanups + 2 <= pool.options.max,
        "the PostgreSQL pool must have room for both cleanup operations",
      );
      cleanupPromises = [
        entitlementModule.releaseStaleAiEmailAssistReservations(
          cleanupNow,
          userId,
        ),
        entitlementModule.releaseStaleAiEmailAssistReservations(
          cleanupNow,
          userId,
        ),
      ];
      await waitForBlockedCleanupQueries(
        cleanupPromises,
        pool,
        activeClientsBeforeCleanups,
      );

      await lockClient.query("COMMIT");
      transactionLockHeld = false;
      const cleanupResults = await Promise.all(cleanupPromises);
      cleanupPromises = [];
      assert.deepEqual(
        [...cleanupResults].sort(),
        [0, 1],
        "only one overlapping cleanup operation may release the stale reservation",
      );

      const [releasedReservation] = await db
        .select({ status: aiEmailAssistUsagesTable.status })
        .from(aiEmailAssistUsagesTable)
        .where(eq(aiEmailAssistUsagesTable.id, staleReservation.id));
      assert.equal(releasedReservation.status, "released");

      const [successfulReservation] = await db
        .insert(aiEmailAssistUsagesTable)
        .values({
          userId,
          entitlementId,
          status: "reserved",
          createdAt: new Date(
            cleanupNow.getTime() - getAiEmailAssistReservationTimeoutMs() + 1,
          ),
        })
        .returning({ id: aiEmailAssistUsagesTable.id });
      const successfulReservationCutoff = new Date(cleanupNow.getTime() + 1);
      const [nearCutoffCleanupCount] = await Promise.all([
        entitlementModule.releaseStaleAiEmailAssistReservations(
          successfulReservationCutoff,
          userId,
        ),
        entitlementModule.finishAiEmailAssistCredit(
          userId,
          successfulReservation.id,
          true,
        ),
      ]);
      assert.equal(
        nearCutoffCleanupCount,
        0,
        "cleanup at the exact provider-timeout-plus-grace boundary must not release the pending draft",
      );
      await Promise.all([
        entitlementModule.finishAiEmailAssistCredit(
          userId,
          successfulReservation.id,
          true,
        ),
      ]);

      const [completedReservation] = await db
        .select()
        .from(aiEmailAssistUsagesTable)
        .where(eq(aiEmailAssistUsagesTable.id, successfulReservation.id));
      assert.equal(completedReservation.status, "consumed");
      assert.ok(completedReservation.completedAt);

      const timeoutMs = getAiEmailAssistReservationTimeoutMs();
      const [expiredReservation] = await db
        .insert(aiEmailAssistUsagesTable)
        .values({
          userId,
          entitlementId,
          status: "reserved",
          createdAt: new Date(cleanupNow.getTime() - timeoutMs),
        })
        .returning({ id: aiEmailAssistUsagesTable.id });
      assert.equal(
        await entitlementModule.releaseStaleAiEmailAssistReservations(
          cleanupNow,
          userId,
        ),
        0,
        "recovery must retain an expired request at the exact timeout boundary",
      );
      assert.equal(
        await entitlementModule.releaseStaleAiEmailAssistReservations(
          new Date(cleanupNow.getTime() + 1),
          userId,
        ),
        1,
        "recovery releases an expired request only after timeout plus settle grace",
      );
      const [releasedExpiredReservation] = await db
        .select({ status: aiEmailAssistUsagesTable.status })
        .from(aiEmailAssistUsagesTable)
        .where(eq(aiEmailAssistUsagesTable.id, expiredReservation.id));
      assert.equal(releasedExpiredReservation.status, "released");

      const completionCleanupResults = await Promise.all([
        entitlementModule.releaseStaleAiEmailAssistReservations(
          cleanupNow,
          userId,
        ),
        entitlementModule.releaseStaleAiEmailAssistReservations(
          cleanupNow,
          userId,
        ),
      ]);
      assert.deepEqual(
        completionCleanupResults,
        [0, 0],
        "cleanup must not release a successfully completed stale reservation",
      );

      const [stillCompletedReservation] = await db
        .select()
        .from(aiEmailAssistUsagesTable)
        .where(eq(aiEmailAssistUsagesTable.id, successfulReservation.id));
      assert.equal(stillCompletedReservation.status, "consumed");
      assert.equal(
        stillCompletedReservation.completedAt?.toISOString(),
        completedReservation.completedAt?.toISOString(),
        "repeated success callbacks must preserve the original completion time",
      );
      const usages = await db
        .select({ status: aiEmailAssistUsagesTable.status })
        .from(aiEmailAssistUsagesTable)
        .where(eq(aiEmailAssistUsagesTable.userId, userId));
      assert.equal(
        usages.filter((usage) => usage.status === "consumed").length,
        1,
        "duplicate successful completion must count the credit only once",
      );
      const dashboard =
        await entitlementModule.getSubscriptionAddOnsDashboard(userId);
      assert.equal(dashboard.balances.emailAssist.used, 1);
      assert.equal(dashboard.balances.emailAssist.remaining, 0);

      const [backlogEntitlement] = await db
        .insert(addOnEntitlementsTable)
        .values({
          userId,
          packageId: backlogPackageId,
          aiEmailAssistAllowance: 12,
        })
        .returning({ id: addOnEntitlementsTable.id });
      backlogEntitlementId = backlogEntitlement.id;

      const staleBacklogSize = 1024;
      const backlogStaleCreatedAt = new Date(
        cleanupNow.getTime() - getAiEmailAssistReservationTimeoutMs() - 60_000,
      );
      const activeCreatedAt = new Date(cleanupNow.getTime() - 30_000);
      const consumedCompletedAt = new Date(cleanupNow.getTime() - 20_000);
      const staleBacklogRows = Array.from({ length: staleBacklogSize }, () => ({
        userId,
        entitlementId: backlogEntitlementId,
        status: "reserved",
        createdAt: backlogStaleCreatedAt,
      }));
      const activeRows = Array.from({ length: 3 }, () => ({
        userId,
        entitlementId: backlogEntitlementId,
        status: "reserved",
        createdAt: activeCreatedAt,
      }));
      const consumedRows = Array.from({ length: 4 }, () => ({
        userId,
        entitlementId: backlogEntitlementId,
        status: "consumed",
        createdAt: backlogStaleCreatedAt,
        completedAt: consumedCompletedAt,
      }));
      const backlogUsages = await db
        .insert(aiEmailAssistUsagesTable)
        .values([...staleBacklogRows, ...activeRows, ...consumedRows])
        .returning({
          id: aiEmailAssistUsagesTable.id,
          status: aiEmailAssistUsagesTable.status,
          completedAt: aiEmailAssistUsagesTable.completedAt,
          createdAt: aiEmailAssistUsagesTable.createdAt,
        });
      const staleBacklogIds = backlogUsages
        .filter(
          (usage) =>
            usage.status === "reserved" &&
            usage.createdAt.getTime() <
              cleanupNow.getTime() - getAiEmailAssistReservationTimeoutMs(),
        )
        .map((usage) => usage.id);
      const activeUsageFixtures = backlogUsages.filter(
        (usage) =>
          usage.status === "reserved" &&
          usage.createdAt.getTime() >=
            cleanupNow.getTime() - getAiEmailAssistReservationTimeoutMs(),
      );
      const activeUsageIds = activeUsageFixtures.map((usage) => usage.id);
      const consumedUsageFixtures = backlogUsages.filter(
        (usage) => usage.status === "consumed",
      );
      assert.equal(staleBacklogIds.length, staleBacklogSize);
      assert.equal(activeUsageIds.length, activeRows.length);
      assert.equal(consumedUsageFixtures.length, consumedRows.length);

      await lockClient.query("BEGIN");
      transactionLockHeld = true;
      const { rows: lockedBacklogRows } = await lockClient.query(
        "SELECT id FROM ai_email_assist_usages WHERE id = $1 FOR UPDATE",
        [staleBacklogIds[0]],
      );
      assert.equal(lockedBacklogRows.length, 1);

      const activeClientsBeforeBacklogCleanups =
        pool.totalCount - pool.idleCount;
      assert.ok(
        activeClientsBeforeBacklogCleanups + 2 <= pool.options.max,
        "the PostgreSQL pool must allow both cleanup calls alongside the backlog lock",
      );
      cleanupPromises = [
        entitlementModule.releaseStaleAiEmailAssistReservations(
          cleanupNow,
          userId,
        ),
        entitlementModule.releaseStaleAiEmailAssistReservations(
          cleanupNow,
          userId,
        ),
      ];
      await waitForBlockedCleanupQueries(
        cleanupPromises,
        pool,
        activeClientsBeforeBacklogCleanups,
      );

      await lockClient.query("COMMIT");
      transactionLockHeld = false;
      const backlogCleanupResults = await Promise.all(cleanupPromises);
      cleanupPromises = [];
      assert.equal(
        backlogCleanupResults.reduce((total, released) => total + released, 0),
        staleBacklogSize,
        "overlapping cleanup calls must release every stale reservation exactly once",
      );

      const persistedBacklogUsages = await db
        .select({
          id: aiEmailAssistUsagesTable.id,
          status: aiEmailAssistUsagesTable.status,
          completedAt: aiEmailAssistUsagesTable.completedAt,
          createdAt: aiEmailAssistUsagesTable.createdAt,
        })
        .from(aiEmailAssistUsagesTable)
        .where(
          inArray(aiEmailAssistUsagesTable.id, [
            ...staleBacklogIds,
            ...activeUsageIds,
            ...consumedUsageFixtures.map((usage) => usage.id),
          ]),
        );
      const persistedUsageById = new Map(
        persistedBacklogUsages.map((usage) => [usage.id, usage]),
      );
      assert.equal(persistedBacklogUsages.length, staleBacklogSize + 7);
      for (const id of staleBacklogIds) {
        assert.equal(
          persistedUsageById.get(id)?.status,
          "released",
          "every stale backlog reservation must be released",
        );
      }
      for (const fixture of activeUsageFixtures) {
        const usage = persistedUsageById.get(fixture.id);
        assert.equal(usage?.status, "reserved");
        assert.equal(usage?.completedAt, null);
        assert.equal(
          usage?.createdAt?.toISOString(),
          fixture.createdAt.toISOString(),
          "cleanup must preserve each active reservation creation time",
        );
      }
      for (const fixture of consumedUsageFixtures) {
        const usage = persistedUsageById.get(fixture.id);
        assert.equal(usage?.status, "consumed");
        assert.equal(
          usage?.createdAt?.toISOString(),
          fixture.createdAt.toISOString(),
          "cleanup must preserve each consumed usage creation time",
        );
        assert.equal(
          usage?.completedAt?.toISOString(),
          fixture.completedAt?.toISOString(),
          "cleanup must preserve each consumed usage completion time",
        );
      }

      const persistedStatuses = await db
        .select({ status: aiEmailAssistUsagesTable.status })
        .from(aiEmailAssistUsagesTable)
        .where(eq(aiEmailAssistUsagesTable.userId, userId));
      const persistedUsedCount = persistedStatuses.filter(
        (usage) => usage.status === "reserved" || usage.status === "consumed",
      ).length;
      const backlogDashboard =
        await entitlementModule.getSubscriptionAddOnsDashboard(userId);
      assert.equal(
        backlogDashboard.balances.emailAssist.total,
        13,
        "the dashboard allowance must include both persisted entitlements",
      );
      assert.equal(
        backlogDashboard.balances.emailAssist.used,
        persistedUsedCount,
        "dashboard usage must match persisted reserved and consumed rows",
      );
      assert.equal(
        backlogDashboard.balances.emailAssist.remaining,
        Math.max(0, 13 - persistedUsedCount),
        "the remaining balance must match the persisted usage states",
      );
    } finally {
      if (lockClient) {
        if (transactionLockHeld) {
          await lockClient.query("ROLLBACK").catch(() => {});
          transactionLockHeld = false;
        }
        lockClient.release();
      }
      await Promise.allSettled(cleanupPromises);

      if (userId) {
        await db
          .delete(aiEmailAssistUsagesTable)
          .where(eq(aiEmailAssistUsagesTable.userId, userId));
        const entitlementIds = [entitlementId, backlogEntitlementId].filter(
          Boolean,
        );
        if (entitlementIds.length) {
          await db
            .delete(addOnEntitlementsTable)
            .where(inArray(addOnEntitlementsTable.id, entitlementIds));
        }
        await db
          .delete(userSubscriptionsTable)
          .where(eq(userSubscriptionsTable.userId, userId));
        await db.delete(usersTable).where(eq(usersTable.id, userId));
      }
      const packageIds = [
        primaryPackageId,
        addonPackageId,
        backlogPackageId,
      ].filter(Boolean);
      if (packageIds.length) {
        await db
          .delete(subscriptionPackagesTable)
          .where(inArray(subscriptionPackagesTable.id, packageIds));
      }
      await pool.end();
    }
  },
);

async function waitForBlockedCleanupQueries(
  cleanupPromises,
  pool,
  activeClientsBeforeCleanups,
) {
  const deadline = Date.now() + 10_000;
  const requiredActiveClients =
    activeClientsBeforeCleanups + cleanupPromises.length;

  while (Date.now() < deadline) {
    const settled = await Promise.race([
      Promise.race(
        cleanupPromises.map((promise) =>
          promise.then(
            () => true,
            () => true,
          ),
        ),
      ),
      delay(10).then(() => false),
    ]);
    if (settled) {
      throw new Error(
        "An AI credit cleanup finished before the held PostgreSQL row lock was released.",
      );
    }

    if (
      pool.totalCount - pool.idleCount >= requiredActiveClients &&
      pool.waitingCount === 0
    ) {
      return;
    }
    await delay(10);
  }

  throw new Error(
    `Both cleanup queries did not reach PostgreSQL while the reservation was locked. Pool: ${JSON.stringify({ totalCount: pool.totalCount, idleCount: pool.idleCount, waitingCount: pool.waitingCount, max: pool.options.max })}.`,
  );
}
