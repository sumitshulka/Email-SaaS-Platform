import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const databaseUrl = process.env.ADDON_CAPTURE_RACE_TEST_DATABASE_URL;

test(
  "Razorpay callbacks preserve add-on entitlements and reject changed event payloads in PostgreSQL",
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

    const [
      dbModule,
      securityModule,
      appModule,
      entitlementModule,
      billingModule,
    ] = await Promise.all([
      import("@workspace/db"),
      import("../src/lib/security.ts"),
      import("../src/app.ts"),
      import("../src/lib/add-on-entitlements.ts"),
      import("../src/lib/billing.ts"),
    ]);
    const { db, pool } = dbModule;
    const {
      addOnEntitlementsTable,
      paymentsTable,
      razorpayConfigurationTable,
      razorpayRefundsTable,
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
    const captureEventIds = [
      `addon-capture-race-${testId}-first`,
      `addon-capture-race-${testId}-second`,
    ];
    const refundEventIds = [
      `addon-refund-race-${testId}-first`,
      `addon-refund-race-${testId}-second`,
    ];
    const duplicateRefundEventIds = [
      `addon-refund-duplicate-${testId}-first`,
      `addon-refund-duplicate-${testId}-second`,
    ];
    const failedRefundRetryEventId = `addon-refund-update-retry-${testId}`;
    const failedRefundProviderId = `update-failure-${testId}`;
    const acknowledgementRetryEventId = `addon-capture-ack-retry-${testId}`;
    const primaryAcknowledgementRetryEventId =
      `primary-capture-ack-retry-${testId}`;
    const eventIds = [
      ...captureEventIds,
      ...refundEventIds,
      ...duplicateRefundEventIds,
      failedRefundRetryEventId,
      acknowledgementRetryEventId,
      primaryAcknowledgementRetryEventId,
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
    let reusedEventPaymentId;
    let acknowledgementRetryPaymentId;
    let primaryAcknowledgementRetryPaymentId;
    let originalConfiguration;
    let server;
    let lockClient;
    let transactionLockHeld = false;
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
        .returning();
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
        .returning();
      addonPackageId = addonPackage.id;

      const now = new Date();
      const initialPrimaryTermEnd = new Date(
        now.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      await db.insert(userSubscriptionsTable).values({
        userId,
        packageId: primaryPackageId,
        paymentId: null,
        status: "active",
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: initialPrimaryTermEnd,
      });

      const [payment] = await db
        .insert(paymentsTable)
        .values({
          userId,
          packageId: addonPackageId,
          receipt: `ar_${testId.replaceAll("-", "")}`,
          amountMinor,
          currency: "INR",
          packageSnapshot:
            billingModule.createPackageCheckoutSnapshot(addonPackage),
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
      const sendWebhook = (body, eventId) =>
        fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-razorpay-event-id": eventId,
            "x-razorpay-signature": createHmac("sha256", webhookSecret)
              .update(body)
              .digest("hex"),
          },
          body,
        });
      const sendCapture = (eventId) => sendWebhook(webhookBody, eventId);

      // Hold the payment row while two distinct signed webhook events reach
      // the production capture activation transaction.
      lockClient = await pool.connect();
      await lockClient.query("BEGIN");
      transactionLockHeld = true;
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
      callbackPromises = captureEventIds.map(sendCapture);
      await waitForBlockedCallbacks(
        lockClient,
        callbackPromises,
        pool,
        captureEventIds,
        "capture",
      );

      const persistedEvents = await db
        .select({
          eventId: razorpayWebhookEventsTable.eventId,
          processedAt: razorpayWebhookEventsTable.processedAt,
        })
        .from(razorpayWebhookEventsTable)
        .where(inArray(razorpayWebhookEventsTable.eventId, captureEventIds));
      assert.deepEqual(
        persistedEvents.map((event) => event.eventId).sort(),
        [...captureEventIds].sort(),
        "both distinct event IDs must reach the locked payment row",
      );
      assert.ok(
        persistedEvents.every((event) => event.processedAt === null),
        "neither callback may finish while the payment row is locked",
      );
      await lockClient.query("COMMIT");
      transactionLockHeld = false;
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

      const reusedEventOrderId = `order_reused_event_${testId}`;
      const reusedEventProviderPaymentId = `pay_reused_event_${testId}`;
      const [reusedEventPayment] = await db
        .insert(paymentsTable)
        .values({
          userId,
          packageId: addonPackageId,
          receipt: `re_${testId.replaceAll("-", "")}`,
          amountMinor,
          currency: "INR",
          packageSnapshot:
            billingModule.createPackageCheckoutSnapshot(addonPackage),
          status: "created",
          razorpayEnvironment: "sandbox",
          razorpayOrderId: reusedEventOrderId,
        })
        .returning({ id: paymentsTable.id });
      reusedEventPaymentId = reusedEventPayment.id;

      const changedPayloadBody = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: reusedEventProviderPaymentId,
              order_id: reusedEventOrderId,
              amount: amountMinor,
              currency: "INR",
              status: "captured",
              captured: true,
            },
          },
        },
      });
      const reusedEventId = captureEventIds[0];
      const [originalEventBeforeReuse] = await db
        .select()
        .from(razorpayWebhookEventsTable)
        .where(eq(razorpayWebhookEventsTable.eventId, reusedEventId))
        .limit(1);
      assert.ok(originalEventBeforeReuse);
      const changedPayloadResponse = await sendWebhook(
        changedPayloadBody,
        reusedEventId,
      );
      const changedPayloadResponseBody = await changedPayloadResponse.json();
      assert.equal(
        changedPayloadResponse.status,
        400,
        JSON.stringify(changedPayloadResponseBody),
      );
      assert.equal(
        changedPayloadResponseBody.code,
        "WEBHOOK_EVENT_MISMATCH",
      );

      const [originalEventAfterReuse] = await db
        .select()
        .from(razorpayWebhookEventsTable)
        .where(eq(razorpayWebhookEventsTable.eventId, reusedEventId))
        .limit(1);
      assert.deepEqual(
        originalEventAfterReuse,
        originalEventBeforeReuse,
        "a changed payload must not replace or update the original event",
      );
      const [originalPaymentAfterReuse] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, paymentId))
        .limit(1);
      assert.deepEqual(
        originalPaymentAfterReuse,
        savedPayment,
        "rejecting a changed event payload must leave the original payment unchanged",
      );
      const [reusedEventPaymentAfterRequest] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, reusedEventPaymentId))
        .limit(1);
      assert.equal(
        reusedEventPaymentAfterRequest.status,
        "created",
        "the changed payload must not activate the different payment",
      );
      assert.equal(reusedEventPaymentAfterRequest.razorpayPaymentId, null);
      const reusedEventEntitlements = await db
        .select({ id: addOnEntitlementsTable.id })
        .from(addOnEntitlementsTable)
        .where(eq(addOnEntitlementsTable.paymentId, reusedEventPaymentId));
      assert.equal(
        reusedEventEntitlements.length,
        0,
        "the changed payload must not create entitlements for the different payment",
      );

      const processedEvents = await db
        .select({
          eventId: razorpayWebhookEventsTable.eventId,
          processedAt: razorpayWebhookEventsTable.processedAt,
        })
        .from(razorpayWebhookEventsTable)
        .where(inArray(razorpayWebhookEventsTable.eventId, captureEventIds));
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

      const refundAmounts = [300, 400];
      const sendRefund = (
        eventId,
        refundAmountMinor,
        providerRefundId = eventId,
      ) => {
        const body = JSON.stringify({
          event: "refund.processed",
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
            refund: {
              entity: {
                id: `rfnd_${testId}_${providerRefundId}`,
                payment_id: providerPaymentId,
                amount: refundAmountMinor,
                currency: "INR",
                status: "processed",
              },
            },
          },
        });
        return fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-razorpay-event-id": eventId,
            "x-razorpay-signature": createHmac("sha256", webhookSecret)
              .update(body)
              .digest("hex"),
          },
          body,
        });
      };

      // Each partial refund omits the provider's cumulative amount_refunded,
      // so both callbacks must add their distinct refund amounts to the latest
      // value read after acquiring the payment row lock.
      await lockClient.query("BEGIN");
      transactionLockHeld = true;
      const { rows: refundLockedPayments } = await lockClient.query(
        "SELECT id FROM payments WHERE id = $1 FOR UPDATE",
        [paymentId],
      );
      assert.equal(refundLockedPayments.length, 1);
      const refundLockProbe = await pool.connect();
      try {
        await assert.rejects(
          refundLockProbe.query(
            "SELECT id FROM payments WHERE id = $1 FOR UPDATE NOWAIT",
            [paymentId],
          ),
          (error) => error.code === "55P03",
          "PostgreSQL must confirm the payment row is locked for refunds",
        );
      } finally {
        refundLockProbe.release();
      }

      callbackPromises = refundEventIds.map((eventId, index) =>
        sendRefund(eventId, refundAmounts[index], `partial-refund-${index}`),
      );
      await waitForBlockedCallbacks(
        lockClient,
        callbackPromises,
        pool,
        refundEventIds,
        "refund",
      );
      const pendingRefundEvents = await db
        .select({
          eventId: razorpayWebhookEventsTable.eventId,
          processedAt: razorpayWebhookEventsTable.processedAt,
        })
        .from(razorpayWebhookEventsTable)
        .where(inArray(razorpayWebhookEventsTable.eventId, refundEventIds));
      assert.deepEqual(
        pendingRefundEvents.map((event) => event.eventId).sort(),
        [...refundEventIds].sort(),
        "both distinct refund IDs must reach the locked payment row",
      );
      assert.ok(
        pendingRefundEvents.every((event) => event.processedAt === null),
        "neither refund callback may finish while the payment row is locked",
      );

      await lockClient.query("COMMIT");
      transactionLockHeld = false;
      const refundResponses = await Promise.all(callbackPromises);
      const refundResponseBodies = await Promise.all(
        refundResponses.map((response) => response.json()),
      );
      assert.deepEqual(
        refundResponses.map((response) => response.status),
        [200, 200],
        JSON.stringify(refundResponseBodies),
      );

      const [refundedPayment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, paymentId));
      assert.equal(refundedPayment.status, "captured");
      assert.equal(
        refundedPayment.refundedAmountMinor,
        refundAmounts.reduce((total, amount) => total + amount, 0),
      );

      const refundedDashboard =
        await entitlementModule.getSubscriptionAddOnsDashboard(userId);
      assert.deepEqual(refundedDashboard.balances.research, {
        total: 5,
        used: 0,
        remaining: 5,
      });
      assert.deepEqual(refundedDashboard.balances.emailAssist, {
        total: 3,
        used: 0,
        remaining: 3,
      });
      assert.deepEqual(refundedDashboard.balances.mailboxes, {
        baseLimit: 1,
        additionalSlots: 1,
        totalLimit: 2,
        used: 0,
        remaining: 2,
        active: true,
      });
      const processedRefundEvents = await db
        .select({
          eventId: razorpayWebhookEventsTable.eventId,
          processedAt: razorpayWebhookEventsTable.processedAt,
        })
        .from(razorpayWebhookEventsTable)
        .where(inArray(razorpayWebhookEventsTable.eventId, refundEventIds));
      assert.equal(processedRefundEvents.length, 2);
      assert.ok(processedRefundEvents.every((event) => event.processedAt));

      // Distinct webhook event IDs may still report the same provider refund.
      // Hold the payment row so both deliveries are in flight together, then
      // confirm only the first transaction records and applies the refund.
      const duplicateRefundAmount = 200;
      const duplicateProviderRefundId = "same-provider-refund";
      await lockClient.query("BEGIN");
      transactionLockHeld = true;
      const { rows: lockedDuplicateRefundPayments } = await lockClient.query(
        "SELECT id FROM payments WHERE id = $1 FOR UPDATE",
        [paymentId],
      );
      assert.equal(lockedDuplicateRefundPayments.length, 1);
      callbackPromises = duplicateRefundEventIds.map((eventId) =>
        sendRefund(
          eventId,
          duplicateRefundAmount,
          duplicateProviderRefundId,
        ),
      );
      await waitForBlockedCallbacks(
        lockClient,
        callbackPromises,
        pool,
        duplicateRefundEventIds,
        "duplicate refund",
      );
      const pendingDuplicateRefundEvents = await db
        .select({
          eventId: razorpayWebhookEventsTable.eventId,
          processedAt: razorpayWebhookEventsTable.processedAt,
        })
        .from(razorpayWebhookEventsTable)
        .where(inArray(razorpayWebhookEventsTable.eventId, duplicateRefundEventIds));
      assert.ok(
        pendingDuplicateRefundEvents.every((event) => event.processedAt === null),
        "both duplicate refund callbacks must wait on the payment row",
      );
      await lockClient.query("COMMIT");
      transactionLockHeld = false;
      const duplicateRefundResponses = await Promise.all(callbackPromises);
      const duplicateRefundResponseBodies = await Promise.all(
        duplicateRefundResponses.map((response) => response.json()),
      );
      assert.deepEqual(
        duplicateRefundResponses.map((response) => response.status),
        [200, 200],
        JSON.stringify(duplicateRefundResponseBodies),
      );

      const [paymentAfterDuplicateRefund] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, paymentId));
      assert.equal(
        paymentAfterDuplicateRefund.refundedAmountMinor,
        refundAmounts.reduce((total, amount) => total + amount, 0) +
          duplicateRefundAmount,
        "the repeated provider refund must contribute to the total only once",
      );
      const recordedRefunds = await db
        .select()
        .from(razorpayRefundsTable)
        .where(eq(razorpayRefundsTable.paymentId, paymentId));
      assert.equal(recordedRefunds.length, 3);
      assert.equal(
        recordedRefunds.filter(
          (refund) =>
            refund.razorpayRefundId ===
            `rfnd_${testId}_${duplicateProviderRefundId}`,
        ).length,
        1,
        "the provider refund identity must be recorded only once",
      );
      const duplicateRefundDashboard =
        await entitlementModule.getSubscriptionAddOnsDashboard(userId);
      assert.deepEqual(duplicateRefundDashboard.balances.research, {
        total: 4,
        used: 0,
        remaining: 4,
      });
      assert.deepEqual(duplicateRefundDashboard.balances.emailAssist, {
        total: 2,
        used: 0,
        remaining: 2,
      });
      assert.deepEqual(duplicateRefundDashboard.balances.mailboxes, {
        baseLimit: 1,
        additionalSlots: 1,
        totalLimit: 2,
        used: 0,
        remaining: 2,
        active: true,
      });

      // Fail the payment update only after the refund identity was inserted
      // inside the same transaction. The failed delivery must leave neither
      // write committed so the provider can safely retry the event.
      const failedRefundAmount = 125;
      const failedRefundId = `rfnd_${testId}_${failedRefundProviderId}`;
      const failedRefundBody = JSON.stringify({
        event: "refund.processed",
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
          refund: {
            entity: {
              id: failedRefundId,
              payment_id: providerPaymentId,
              amount: failedRefundAmount,
              currency: "INR",
              status: "processed",
            },
          },
        },
      });
      await failPaymentUpdateAfterRefundIdentity({
        client: lockClient,
        paymentId,
        refundId: failedRefundId,
        sendWebhook,
        eventId: failedRefundRetryEventId,
        body: failedRefundBody,
      });
      const [paymentAfterFailedRefund] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, paymentId));
      assert.equal(
        paymentAfterFailedRefund.refundedAmountMinor,
        refundAmounts.reduce((total, amount) => total + amount, 0) +
          duplicateRefundAmount,
        "a failed payment update must not change the refunded total",
      );
      const refundsAfterFailure = await db
        .select()
        .from(razorpayRefundsTable)
        .where(eq(razorpayRefundsTable.razorpayRefundId, failedRefundId));
      assert.equal(
        refundsAfterFailure.length,
        0,
        "the refund identity must roll back with the failed payment update",
      );
      const [failedRefundEvent] = await db
        .select({ processedAt: razorpayWebhookEventsTable.processedAt })
        .from(razorpayWebhookEventsTable)
        .where(
          eq(razorpayWebhookEventsTable.eventId, failedRefundRetryEventId),
        );
      assert.equal(
        failedRefundEvent.processedAt,
        null,
        "a failed refund transaction must leave its webhook eligible for retry",
      );

      const retriedRefundResponse = await sendWebhook(
        failedRefundBody,
        failedRefundRetryEventId,
      );
      const retriedRefundResponseBody = await retriedRefundResponse.json();
      assert.equal(
        retriedRefundResponse.status,
        200,
        JSON.stringify(retriedRefundResponseBody),
      );
      const [paymentAfterRefundRetry] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, paymentId));
      assert.equal(
        paymentAfterRefundRetry.refundedAmountMinor,
        refundAmounts.reduce((total, amount) => total + amount, 0) +
          duplicateRefundAmount +
          failedRefundAmount,
        "retry must apply the refund amount exactly once",
      );
      const refundsAfterRetry = await db
        .select()
        .from(razorpayRefundsTable)
        .where(eq(razorpayRefundsTable.razorpayRefundId, failedRefundId));
      assert.equal(refundsAfterRetry.length, 1);
      assert.equal(refundsAfterRetry[0].amountMinor, failedRefundAmount);

      const acknowledgementRetryOrderId = `order_addon_ack_${testId}`;
      const acknowledgementRetryProviderPaymentId = `pay_addon_ack_${testId}`;
      const [acknowledgementRetryPayment] = await db
        .insert(paymentsTable)
        .values({
          userId,
          packageId: addonPackageId,
          receipt: `aa_${testId.replaceAll("-", "")}`,
          amountMinor,
          currency: "INR",
          packageSnapshot:
            billingModule.createPackageCheckoutSnapshot(addonPackage),
          status: "created",
          razorpayEnvironment: "sandbox",
          razorpayOrderId: acknowledgementRetryOrderId,
        })
        .returning({ id: paymentsTable.id });
      acknowledgementRetryPaymentId = acknowledgementRetryPayment.id;

      const acknowledgementRetryBody = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: acknowledgementRetryProviderPaymentId,
              order_id: acknowledgementRetryOrderId,
              amount: amountMinor,
              currency: "INR",
              status: "captured",
              captured: true,
            },
          },
        },
      });
      const [pendingAcknowledgementEvent] = await db
        .insert(razorpayWebhookEventsTable)
        .values({
          eventId: acknowledgementRetryEventId,
          eventType: "payment.captured",
          razorpayOrderId: acknowledgementRetryOrderId,
          razorpayPaymentId: acknowledgementRetryProviderPaymentId,
          bodySha256: createHash("sha256")
            .update(acknowledgementRetryBody)
            .digest("hex"),
        })
        .returning({ id: razorpayWebhookEventsTable.id });
      assert.ok(pendingAcknowledgementEvent);

      await failWebhookAcknowledgementOnce({
        client: lockClient,
        eventId: acknowledgementRetryEventId,
        body: acknowledgementRetryBody,
        sendWebhook,
        suffix: `${testId.replaceAll("-", "")}_addon`,
      });
      const [stillPendingEvent] = await db
        .select({ processedAt: razorpayWebhookEventsTable.processedAt })
        .from(razorpayWebhookEventsTable)
        .where(
          eq(razorpayWebhookEventsTable.eventId, acknowledgementRetryEventId),
        );
      assert.equal(
        stillPendingEvent.processedAt,
        null,
        "failed acknowledgement must leave the webhook retryable",
      );
      const [capturedRetryPayment] = await db
        .select({ status: paymentsTable.status })
        .from(paymentsTable)
        .where(eq(paymentsTable.id, acknowledgementRetryPaymentId))
        .limit(1);
      assert.equal(capturedRetryPayment.status, "captured");
      const activatedRetryEntitlements = await db
        .select({ id: addOnEntitlementsTable.id })
        .from(addOnEntitlementsTable)
        .where(
          eq(addOnEntitlementsTable.paymentId, acknowledgementRetryPaymentId),
        );
      assert.equal(
        activatedRetryEntitlements.length,
        1,
        "the add-on activation must commit before acknowledgement fails",
      );

      const retriedAcknowledgementResponse = await sendWebhook(
        acknowledgementRetryBody,
        acknowledgementRetryEventId,
      );
      const retriedAcknowledgementBody =
        await retriedAcknowledgementResponse.json();
      assert.equal(
        retriedAcknowledgementResponse.status,
        200,
        JSON.stringify(retriedAcknowledgementBody),
      );

      const retryEntitlements = await db
        .select()
        .from(addOnEntitlementsTable)
        .where(
          eq(addOnEntitlementsTable.paymentId, acknowledgementRetryPaymentId),
        );
      assert.equal(retryEntitlements.length, 1);
      assert.deepEqual(
        {
          research: retryEntitlements[0].researchAllowance,
          emailAssist: retryEntitlements[0].aiEmailAssistAllowance,
          mailboxes: retryEntitlements[0].additionalMailboxCount,
        },
        allowances,
      );
      const [completedAcknowledgementEvent] = await db
        .select({ processedAt: razorpayWebhookEventsTable.processedAt })
        .from(razorpayWebhookEventsTable)
        .where(
          eq(razorpayWebhookEventsTable.eventId, acknowledgementRetryEventId),
        );
      assert.ok(completedAcknowledgementEvent.processedAt);

      const retryDashboard =
        await entitlementModule.getSubscriptionAddOnsDashboard(userId);
      assert.deepEqual(retryDashboard.balances.research, {
        total: 15,
        used: 0,
        remaining: 15,
      });
      assert.deepEqual(retryDashboard.balances.emailAssist, {
        total: 9,
        used: 0,
        remaining: 9,
      });
      assert.deepEqual(retryDashboard.balances.mailboxes, {
        baseLimit: 1,
        additionalSlots: 4,
        totalLimit: 5,
        used: 0,
        remaining: 5,
        active: true,
      });

      const primaryAcknowledgementRetryOrderId =
        `order_primary_ack_${testId}`;
      const primaryAcknowledgementRetryProviderPaymentId =
        `pay_primary_ack_${testId}`;
      const primaryAmountMinor = 2000;
      const [primaryAcknowledgementRetryPayment] = await db
        .insert(paymentsTable)
        .values({
          userId,
          packageId: primaryPackageId,
          receipt: `pa_${testId.replaceAll("-", "")}`,
          amountMinor: primaryAmountMinor,
          currency: "INR",
          packageSnapshot:
            billingModule.createPackageCheckoutSnapshot(primaryPackage),
          status: "created",
          razorpayEnvironment: "sandbox",
          razorpayOrderId: primaryAcknowledgementRetryOrderId,
        })
        .returning({ id: paymentsTable.id });
      primaryAcknowledgementRetryPaymentId =
        primaryAcknowledgementRetryPayment.id;

      const primaryAcknowledgementRetryBody = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: primaryAcknowledgementRetryProviderPaymentId,
              order_id: primaryAcknowledgementRetryOrderId,
              amount: primaryAmountMinor,
              currency: "INR",
              status: "captured",
              captured: true,
            },
          },
        },
      });
      await db.insert(razorpayWebhookEventsTable).values({
        eventId: primaryAcknowledgementRetryEventId,
        eventType: "payment.captured",
        razorpayOrderId: primaryAcknowledgementRetryOrderId,
        razorpayPaymentId: primaryAcknowledgementRetryProviderPaymentId,
        bodySha256: createHash("sha256")
          .update(primaryAcknowledgementRetryBody)
          .digest("hex"),
      });

      await failWebhookAcknowledgementOnce({
        client: lockClient,
        eventId: primaryAcknowledgementRetryEventId,
        body: primaryAcknowledgementRetryBody,
        sendWebhook,
        suffix: `${testId.replaceAll("-", "")}_primary`,
      });
      const [stillPendingPrimaryEvent] = await db
        .select({ processedAt: razorpayWebhookEventsTable.processedAt })
        .from(razorpayWebhookEventsTable)
        .where(
          eq(
            razorpayWebhookEventsTable.eventId,
            primaryAcknowledgementRetryEventId,
          ),
        );
      assert.equal(
        stillPendingPrimaryEvent.processedAt,
        null,
        "failed primary-plan acknowledgement must leave the event retryable",
      );

      const [capturedPrimaryPayment] = await db
        .select({ status: paymentsTable.status })
        .from(paymentsTable)
        .where(eq(paymentsTable.id, primaryAcknowledgementRetryPaymentId))
        .limit(1);
      assert.equal(
        capturedPrimaryPayment.status,
        "captured",
        "the primary payment must commit before acknowledgement fails",
      );
      const primarySubscriptionsBeforeRetry = await db
        .select({
          id: userSubscriptionsTable.id,
          startsAt: userSubscriptionsTable.startsAt,
          endsAt: userSubscriptionsTable.endsAt,
        })
        .from(userSubscriptionsTable)
        .where(
          eq(
            userSubscriptionsTable.paymentId,
            primaryAcknowledgementRetryPaymentId,
          ),
        );
      assert.equal(
        primarySubscriptionsBeforeRetry.length,
        1,
        "activation must commit exactly one primary subscription before retry",
      );
      const [subscriptionBeforePrimaryRetry] =
        primarySubscriptionsBeforeRetry;
      const expectedPrimaryEnd = new Date(
        initialPrimaryTermEnd.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      assert.equal(
        subscriptionBeforePrimaryRetry.startsAt.toISOString(),
        initialPrimaryTermEnd.toISOString(),
      );
      assert.equal(
        subscriptionBeforePrimaryRetry.endsAt.toISOString(),
        expectedPrimaryEnd.toISOString(),
      );

      const retriedPrimaryAcknowledgementResponse = await sendWebhook(
        primaryAcknowledgementRetryBody,
        primaryAcknowledgementRetryEventId,
      );
      const retriedPrimaryAcknowledgementBody =
        await retriedPrimaryAcknowledgementResponse.json();
      assert.equal(
        retriedPrimaryAcknowledgementResponse.status,
        200,
        JSON.stringify(retriedPrimaryAcknowledgementBody),
      );

      const primarySubscriptionsAfterRetry = await db
        .select({
          id: userSubscriptionsTable.id,
          startsAt: userSubscriptionsTable.startsAt,
          endsAt: userSubscriptionsTable.endsAt,
        })
        .from(userSubscriptionsTable)
        .where(
          eq(
            userSubscriptionsTable.paymentId,
            primaryAcknowledgementRetryPaymentId,
          ),
        );
      assert.equal(
        primarySubscriptionsAfterRetry.length,
        1,
        "retrying the captured primary payment must not create another subscription",
      );
      const [primarySubscriptionAfterRetry] = primarySubscriptionsAfterRetry;
      assert.equal(
        primarySubscriptionAfterRetry.startsAt.toISOString(),
        initialPrimaryTermEnd.toISOString(),
        "the paid primary term must start when the existing term expires",
      );
      assert.equal(
        primarySubscriptionAfterRetry.endsAt.toISOString(),
        expectedPrimaryEnd.toISOString(),
        "the paid primary term must retain its original 30-day end date",
      );
      assert.equal(
        primarySubscriptionAfterRetry.id,
        subscriptionBeforePrimaryRetry.id,
        "retry must leave the originally activated subscription unchanged",
      );
      assert.equal(
        primarySubscriptionAfterRetry.startsAt.toISOString(),
        subscriptionBeforePrimaryRetry.startsAt.toISOString(),
      );
      assert.equal(
        primarySubscriptionAfterRetry.endsAt.toISOString(),
        subscriptionBeforePrimaryRetry.endsAt.toISOString(),
      );

      const [completedPrimaryAcknowledgementEvent] = await db
        .select({ processedAt: razorpayWebhookEventsTable.processedAt })
        .from(razorpayWebhookEventsTable)
        .where(
          eq(
            razorpayWebhookEventsTable.eventId,
            primaryAcknowledgementRetryEventId,
          ),
        );
      assert.ok(completedPrimaryAcknowledgementEvent.processedAt);
    } finally {
      if (lockClient) {
        if (transactionLockHeld) {
          await lockClient.query("ROLLBACK").catch(() => {});
          transactionLockHeld = false;
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
        if (reusedEventPaymentId) {
          await db
            .delete(paymentsTable)
            .where(eq(paymentsTable.id, reusedEventPaymentId));
        }
        if (acknowledgementRetryPaymentId) {
          await db
            .delete(paymentsTable)
            .where(eq(paymentsTable.id, acknowledgementRetryPaymentId));
        }
        if (primaryAcknowledgementRetryPaymentId) {
          await db
            .delete(paymentsTable)
            .where(
              eq(paymentsTable.id, primaryAcknowledgementRetryPaymentId),
            );
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

async function waitForBlockedCallbacks(
  lockClient,
  callbackPromises,
  pool,
  eventIds,
  callbackType,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows: persistedEvents } = await lockClient.query(
      "SELECT event_id FROM razorpay_webhook_events WHERE event_id = ANY($1::varchar[])",
      [eventIds],
    );
    const settledCallback = await Promise.race([
      Promise.race(
        callbackPromises.map((promise) =>
          promise.then(
            (response) => ({ response }),
            (error) => ({ error }),
          ),
        ),
      ),
      delay(10).then(() => null),
    ]);
    if (settledCallback) {
      const outcome = settledCallback.response
        ? `HTTP ${settledCallback.response.status}: ${await settledCallback.response
            .clone()
            .text()}`
        : `request error: ${settledCallback.error}`;
      throw new Error(
        `A ${callbackType} callback finished instead of blocking on the held payment row (${outcome}).`,
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
    `The ${callbackType} callbacks did not both wait on PostgreSQL row locks. Events: ${eventIds.length}. Pool: ${JSON.stringify({ totalCount: pool.totalCount, idleCount: pool.idleCount, waitingCount: pool.waitingCount, max: pool.options.max })}.`,
  );
}

async function failWebhookAcknowledgementOnce({
  client,
  eventId,
  body,
  sendWebhook,
  suffix,
}) {
  const functionName = `test_fail_webhook_ack_${suffix}`;
  const triggerName = `test_fail_webhook_ack_${suffix}`;
  const { rows } = await client.query(
    "SELECT quote_literal($1) AS quoted_event_id",
    [eventId],
  );
  try {
    await client.query(
      `CREATE FUNCTION public.${functionName}() RETURNS trigger
       LANGUAGE plpgsql
       AS $ack_failure$
       BEGIN
         IF OLD.event_id = TG_ARGV[0]
            AND OLD.processed_at IS NULL
            AND NEW.processed_at IS NOT NULL THEN
           RAISE EXCEPTION 'simulated webhook acknowledgement failure';
         END IF;
         RETURN NEW;
       END;
       $ack_failure$`,
    );
    await client.query(
      `CREATE TRIGGER ${triggerName}
       BEFORE UPDATE OF processed_at ON public.razorpay_webhook_events
       FOR EACH ROW
       EXECUTE FUNCTION public.${functionName}(${rows[0].quoted_event_id})`,
    );
    const response = await sendWebhook(body, eventId);
    const responseBody = await response.text();
    assert.equal(
      response.status,
      500,
      `the database must reject the acknowledgement after activation: ${responseBody}`,
    );
  } finally {
    await client.query(
      `DROP TRIGGER IF EXISTS ${triggerName} ON public.razorpay_webhook_events`,
    );
    await client.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
  }
}

async function failPaymentUpdateAfterRefundIdentity({
  client,
  paymentId,
  refundId,
  sendWebhook,
  eventId,
  body,
}) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `test_fail_refund_update_${suffix}`;
  const triggerName = `test_fail_refund_update_${suffix}`;
  const { rows } = await client.query(
    "SELECT quote_literal($1) AS quoted_payment_id, quote_literal($2) AS quoted_refund_id",
    [paymentId, refundId],
  );
  try {
    await client.query(
      `CREATE FUNCTION public.${functionName}() RETURNS trigger
       LANGUAGE plpgsql
       AS $payment_failure$
       BEGIN
         IF OLD.id::text = TG_ARGV[0]
            AND EXISTS (
              SELECT 1
              FROM public.razorpay_refunds
              WHERE razorpay_refund_id = TG_ARGV[1]
            ) THEN
           RAISE EXCEPTION 'simulated payment update failure after refund identity insertion';
         END IF;
         RETURN NEW;
       END;
       $payment_failure$`,
    );
    await client.query(
      `CREATE TRIGGER ${triggerName}
       BEFORE UPDATE ON public.payments
       FOR EACH ROW
       EXECUTE FUNCTION public.${functionName}(${rows[0].quoted_payment_id}, ${rows[0].quoted_refund_id})`,
    );
    const response = await sendWebhook(body, eventId);
    const responseBody = await response.text();
    assert.equal(
      response.status,
      500,
      `the database must reject the payment update after the refund identity is inserted: ${responseBody}`,
    );
  } finally {
    await client.query(
      `DROP TRIGGER IF EXISTS ${triggerName} ON public.payments`,
    );
    await client.query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
  }
}
