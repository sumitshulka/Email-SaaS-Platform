import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const databaseUrl = process.env.ADDON_CAPTURE_RACE_TEST_DATABASE_URL;

test(
  "simultaneous Razorpay capture callbacks grant one paid add-on entitlement in PostgreSQL",
  {
    skip: databaseUrl
      ? false
      : "Set ADDON_CAPTURE_RACE_TEST_DATABASE_URL to a disposable, migrated PostgreSQL database.",
  },
  async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PGAPPNAME = `mailflow-addon-capture-race-${process.pid}`;
    process.env.SESSION_SECRET ??=
      "postgres-addon-capture-race-test-session-secret";
    process.env.LOG_LEVEL = "silent";

    const [dbModule, securityModule, appModule, entitlementModule] =
      await Promise.all([
        import("@workspace/db"),
        import("../src/lib/security.ts"),
        import("../src/app.ts"),
        import("../src/lib/add-on-entitlements.ts"),
      ]);
    const { db, pool } = dbModule;
    const {
      addOnEntitlementsTable,
      paymentsTable,
      razorpayConfigurationTable,
      razorpayWebhookEventsTable,
      subscriptionPackagesTable,
      userSubscriptionsTable,
      usersTable,
    } = dbModule;
    const app = appModule.default;
    const testId = randomUUID();
    const webhookSecret = `addon-capture-race-webhook-${testId}`;
    const encryptedKeySecret = securityModule.encryptSecret(
      `addon-capture-race-key-${testId}`,
    );
    const encryptedWebhookSecret = securityModule.encryptSecret(webhookSecret);
    const orderId = `order_addon_capture_${testId}`;
    const providerPaymentId = `pay_addon_capture_${testId}`;
    const eventIds = [
      `addon-capture-race-${testId}-first`,
      `addon-capture-race-${testId}-second`,
    ];
    const amountMinor = 1500;
    const allowances = {
      research: 11,
      emailAssist: 7,
      mailboxes: 3,
    };
    let userId;
    let primaryPackageId;
    let addonPackageId;
    let paymentId;
    let originalConfiguration;
    let server;
    let lockClient;
    let paymentLockHeld = false;
    let callbackPromises = [];

    try {
      [originalConfiguration] = await db
        .select()
        .from(razorpayConfigurationTable)
        .where(eq(razorpayConfigurationTable.id, "platform"))
        .limit(1);
      await db
        .insert(razorpayConfigurationTable)
        .values({
          id: "platform",
          keyId: "rzp_test_addon_capture_race",
          keySecretEncrypted: encryptedKeySecret,
          webhookSecretEncrypted: encryptedWebhookSecret,
          activeEnvironment: "sandbox",
        })
        .onConflictDoUpdate({
          target: razorpayConfigurationTable.id,
          set: {
            keyId: "rzp_test_addon_capture_race",
            keySecretEncrypted: encryptedKeySecret,
            webhookSecretEncrypted: encryptedWebhookSecret,
            activeEnvironment: "sandbox",
            sandboxKeyId: null,
            sandboxKeySecretEncrypted: null,
            sandboxWebhookSecretEncrypted: null,
            productionKeyId: null,
            productionKeySecretEncrypted: null,
            productionWebhookSecretEncrypted: null,
            updatedAt: new Date(),
          },
        });

      const [user] = await db
        .insert(usersTable)
        .values({
          username: `addon-race-${testId}`,
          firstName: "Add-on",
          lastName: "Race",
          email: `addon-race-${testId}@example.test`,
          passwordHash: "postgres-addon-capture-race-test",
        })
        .returning({ id: usersTable.id });
      userId = user.id;

      const [primaryPackage] = await db
        .insert(subscriptionPackagesTable)
        .values({
          name: `Add-on race primary ${testId}`,
          description: "Paid primary fixture for capture race test.",
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
          name: `Add-on race pack ${testId}`,
          description: "Capture race fixture with all allowance types.",
          amountMinor,
          currency: "INR",
          periodDays: 0,
          contactLimit: 0,
          emailAccountLimit: 0,
          researchAllowance: allowances.research,
          aiEmailAssistAllowance: allowances.emailAssist,
          additionalMailboxCount: allowances.mailboxes,
        })
        .returning({ id: subscriptionPackagesTable.id });
      addonPackageId = addonPackage.id;

      const now = new Date();
      await db.insert(userSubscriptionsTable).values({
        userId,
        packageId: primaryPackageId,
        paymentId: null,
        status: "active",
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });

      const [payment] = await db
        .insert(paymentsTable)
        .values({
          userId,
          packageId: addonPackageId,
          receipt: `ar_${testId.replaceAll("-", "")}`,
          amountMinor,
          currency: "INR",
          status: "created",
          razorpayEnvironment: "sandbox",
          razorpayOrderId: orderId,
        })
        .returning({ id: paymentsTable.id });
      paymentId = payment.id;

      server = app.listen(0);
      await once(server, "listening");
      const webhookUrl = `http://127.0.0.1:${server.address().port}/api/webhooks/razorpay`;
      const healthResponse = await fetch(
        `http://127.0.0.1:${server.address().port}/api/healthz`,
      );
      assert.equal(healthResponse.status, 200);
      const databaseSmokeResponse = await fetch(
        `http://127.0.0.1:${server.address().port}/api/subscriptions/add-ons`,
      );
      assert.equal(databaseSmokeResponse.status, 401);
      const webhookBody = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: providerPaymentId,
              order_id: orderId,
              amount: amountMinor,
              currency: "INR",
              status: "captured",
              captured: true,
            },
          },
        },
      });
      const sendCapture = (eventId) =>
        fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-razorpay-event-id": eventId,
            "x-razorpay-signature": createHmac("sha256", webhookSecret)
              .update(webhookBody)
              .digest("hex"),
          },
          body: webhookBody,
        });

      // Hold the payment row while two distinct signed webhook events reach
      // the production capture activation transaction.
      lockClient = await pool.connect();
      await lockClient.query("BEGIN");
      paymentLockHeld = true;
      const { rows: lockedPayments } = await lockClient.query(
        "SELECT id FROM payments WHERE id = $1 FOR UPDATE",
        [paymentId],
      );
      assert.equal(lockedPayments.length, 1);
      const lockProbe = await pool.connect();
      try {
        await assert.rejects(
          lockProbe.query(
            "SELECT id FROM payments WHERE id = $1 FOR UPDATE NOWAIT",
            [paymentId],
          ),
          (error) => error.code === "55P03",
          "PostgreSQL must confirm the payment row is locked",
        );
      } finally {
        lockProbe.release();
      }

      assert.ok(
        pool.options.max >= 3,
        "the PostgreSQL pool must allow both callbacks alongside the lock holder",
      );
      callbackPromises = eventIds.map(sendCapture);
      await waitForBlockedCaptureCallbacks(
        lockClient,
        callbackPromises,
        pool,
        eventIds,
      );

      const persistedEvents = await db
        .select({
          eventId: razorpayWebhookEventsTable.eventId,
          processedAt: razorpayWebhookEventsTable.processedAt,
        })
        .from(razorpayWebhookEventsTable)
        .where(inArray(razorpayWebhookEventsTable.eventId, eventIds));
      assert.deepEqual(
        persistedEvents.map((event) => event.eventId).sort(),
        [...eventIds].sort(),
        "both distinct event IDs must reach the locked payment row",
      );
      assert.ok(
        persistedEvents.every((event) => event.processedAt === null),
        "neither callback may finish while the payment row is locked",
      );
      await lockClient.query("COMMIT");
      paymentLockHeld = false;
      const responses = await Promise.all(callbackPromises);
      const responseBodies = await Promise.all(
        responses.map((response) => response.json()),
      );
      assert.deepEqual(
        responses.map((response) => response.status),
        [200, 200],
        JSON.stringify(responseBodies),
      );

      const [savedPayment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, paymentId));
      assert.equal(savedPayment.status, "captured");
      assert.equal(savedPayment.razorpayPaymentId, providerPaymentId);

      const entitlements = await db
        .select()
        .from(addOnEntitlementsTable)
        .where(eq(addOnEntitlementsTable.paymentId, paymentId));
      assert.equal(entitlements.length, 1);
      assert.deepEqual(
        {
          research: entitlements[0].researchAllowance,
          emailAssist: entitlements[0].aiEmailAssistAllowance,
          mailboxes: entitlements[0].additionalMailboxCount,
        },
        allowances,
      );

      const processedEvents = await db
        .select({
          eventId: razorpayWebhookEventsTable.eventId,
          processedAt: razorpayWebhookEventsTable.processedAt,
        })
        .from(razorpayWebhookEventsTable)
        .where(inArray(razorpayWebhookEventsTable.eventId, eventIds));
      assert.equal(processedEvents.length, 2);
      assert.ok(processedEvents.every((event) => event.processedAt));

      const dashboard =
        await entitlementModule.getSubscriptionAddOnsDashboard(userId);
      assert.equal(dashboard.eligible, true);
      assert.deepEqual(dashboard.balances.research, {
        total: allowances.research,
        used: 0,
        remaining: allowances.research,
      });
      assert.deepEqual(dashboard.balances.emailAssist, {
        total: allowances.emailAssist,
        used: 0,
        remaining: allowances.emailAssist,
      });
      assert.deepEqual(
        {
          baseLimit: dashboard.balances.mailboxes.baseLimit,
          additionalSlots: dashboard.balances.mailboxes.additionalSlots,
          totalLimit: dashboard.balances.mailboxes.totalLimit,
        },
        {
          baseLimit: 1,
          additionalSlots: allowances.mailboxes,
          totalLimit: 1 + allowances.mailboxes,
        },
      );
    } finally {
      if (lockClient) {
        if (paymentLockHeld) {
          await lockClient.query("ROLLBACK").catch(() => {});
          paymentLockHeld = false;
        }
        lockClient.release();
      }
      await Promise.allSettled(callbackPromises);
      if (server) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }

      if (userId) {
        await db
          .delete(razorpayWebhookEventsTable)
          .where(inArray(razorpayWebhookEventsTable.eventId, eventIds));
        await db
          .delete(addOnEntitlementsTable)
          .where(eq(addOnEntitlementsTable.userId, userId));
        await db
          .delete(userSubscriptionsTable)
          .where(eq(userSubscriptionsTable.userId, userId));
        if (paymentId) {
          await db.delete(paymentsTable).where(eq(paymentsTable.id, paymentId));
        }
        await db.delete(usersTable).where(eq(usersTable.id, userId));
      }
      if (addonPackageId) {
        await db
          .delete(subscriptionPackagesTable)
          .where(eq(subscriptionPackagesTable.id, addonPackageId));
      }
      if (primaryPackageId) {
        await db
          .delete(subscriptionPackagesTable)
          .where(eq(subscriptionPackagesTable.id, primaryPackageId));
      }

      if (originalConfiguration) {
        await db
          .insert(razorpayConfigurationTable)
          .values(originalConfiguration)
          .onConflictDoUpdate({
            target: razorpayConfigurationTable.id,
            set: originalConfiguration,
          });
      } else {
        await db
          .delete(razorpayConfigurationTable)
          .where(eq(razorpayConfigurationTable.id, "platform"));
      }
      await pool.end();
    }
  },
);

async function waitForBlockedCaptureCallbacks(
  lockClient,
  callbackPromises,
  pool,
  eventIds,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows: persistedEvents } = await lockClient.query(
      "SELECT event_id FROM razorpay_webhook_events WHERE event_id = ANY($1::varchar[])",
      [eventIds],
    );
    const settled = await Promise.race([
      Promise.race(
        callbackPromises.map((promise) =>
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
        "A capture callback finished instead of blocking on the held payment row.",
      );
    }
    if (
      persistedEvents.length === eventIds.length &&
      pool.totalCount >= 3 &&
      pool.idleCount === 0 &&
      pool.waitingCount === 0
    ) {
      return;
    }
    await delay(10);
  }
  throw new Error(
    `The capture callbacks did not both wait on PostgreSQL row locks. Events: ${eventIds.length}. Pool: ${JSON.stringify({ totalCount: pool.totalCount, idleCount: pool.idleCount, waitingCount: pool.waitingCount, max: pool.options.max })}.`,
  );
}
