import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.CAMPAIGN_PAUSE_RACE_TEST_DATABASE_URL;

if (process.env.CAMPAIGN_PAUSE_RACE_TEST_REQUIRED === "1" && !databaseUrl) {
  throw new Error(
    "CAMPAIGN_PAUSE_RACE_TEST_DATABASE_URL is required for this CI run.",
  );
}

test(
  "campaign pause wins a PostgreSQL claim race and due scheduled resumes do not send",
  {
    skip: databaseUrl
      ? false
      : "Set CAMPAIGN_PAUSE_RACE_TEST_DATABASE_URL to a disposable, migrated PostgreSQL database.",
  },
  async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PGAPPNAME = `mailflow-campaign-pause-race-${process.pid}`;
    process.env.SESSION_SECRET ??=
      "postgres-campaign-pause-race-test-session-secret";
    process.env.LOG_LEVEL = "silent";

    const [
      dbModule,
      emailModule,
      securityModule,
      workerModule,
      settingsModule,
    ] = await Promise.all([
      import("@workspace/db"),
      import("../src/lib/application-email.ts"),
      import("../src/lib/security.ts"),
      import("../src/lib/campaign-worker.ts"),
      import("../src/lib/platform-settings.ts"),
    ]);
    const { db, pool } = dbModule;
    const {
      contactsTable,
      emailCampaignRecipientsTable,
      emailCampaignsTable,
      emailSendAttemptsTable,
      systemConfigurationTable,
      tenantSendingConfigurationTable,
      usersTable,
    } = dbModule;
    const { defaultPlatformSettings } = settingsModule;
    const testId = randomUUID();
    const recipientEmail = `campaign-pause-race-${testId}@example.test`;
    const deliveredTo = [];
    let ownerId;
    let pauseClient;
    let processing;
    let pauseUpdatePending = false;
    let resolveClaimReached;
    let releaseClaim;
    let originalPlatformSettings;

    try {
      [originalPlatformSettings] = await db
        .select()
        .from(systemConfigurationTable)
        .where(eq(systemConfigurationTable.key, "platform"));
      await db
        .insert(systemConfigurationTable)
        .values({
          key: "platform",
          value: { ...defaultPlatformSettings, maintenanceMode: false },
        })
        .onConflictDoUpdate({
          target: systemConfigurationTable.key,
          set: {
            value: { ...defaultPlatformSettings, maintenanceMode: false },
            updatedAt: new Date(),
          },
        });

      const [owner] = await db
        .insert(usersTable)
        .values({
          username: `cpr-${testId}`,
          firstName: "Campaign",
          lastName: "Pause Race",
          email: recipientEmail,
          passwordHash: "postgres-campaign-pause-race-test",
        })
        .returning();
      ownerId = owner.id;

      const [contact] = await db
        .insert(contactsTable)
        .values({
          userId: owner.id,
          email: recipientEmail,
          firstName: "Campaign",
          lastName: "Recipient",
          subscribed: true,
        })
        .returning();
      const [sender] = await db
        .insert(tenantSendingConfigurationTable)
        .values({
          userId: owner.id,
          host: "smtp.campaign-pause-race.test",
          port: 2525,
          encryption: "none",
          usernameEncrypted: securityModule.encryptSecret("pause-race-user"),
          passwordEncrypted: securityModule.encryptSecret(
            "pause-race-password",
          ),
          fromName: "Campaign Pause Race Test",
          fromEmail: "sender@campaign-pause-race.test",
          verifiedAt: new Date(),
        })
        .returning();
      const [campaign] = await db
        .insert(emailCampaignsTable)
        .values({
          userId: owner.id,
          senderAccountId: sender.id,
          name: "Campaign pause ordering test",
          subject: "This recipient must stay queued",
          textBody: "A concurrent pause must prevent this delivery.",
          unsubscribeOrigin: "https://app.mailflow.test",
          status: "queued",
        })
        .returning();
      const [recipient] = await db
        .insert(emailCampaignRecipientsTable)
        .values({
          campaignId: campaign.id,
          userId: owner.id,
          contactId: contact.id,
          email: recipientEmail,
          firstName: contact.firstName,
          status: "queued",
          attempts: 0,
          nextAttemptAt: new Date(Date.now() - 1000),
        })
        .returning();

      emailModule.setTenantEmailTransportForTests(async (message) => {
        deliveredTo.push(message.to);
        return {
          accepted: true,
          smtpResponse: "250 2.0.0 SMTP accepted",
          smtpCode: 250,
        };
      });

      // Match the pause endpoint's campaign-row update, but hold the
      // transaction open so the worker must wait on the pause connection.
      pauseClient = await pool.connect();
      await pauseClient.query("BEGIN");
      await pauseClient.query(
        `UPDATE email_campaigns
         SET paused_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [campaign.id, owner.id],
      );
      pauseUpdatePending = true;

      const claimReached = new Promise((resolve) => {
        resolveClaimReached = resolve;
      });
      const claimGate = new Promise((resolve) => {
        releaseClaim = resolve;
      });
      workerModule.setBeforeDeliveryClaimForTests(async () => {
        resolveClaimReached();
        await claimGate;
      });
      processing = workerModule.processPendingCampaignDeliveries(1);
      await Promise.race([
        claimReached,
        delay(10_000).then(() => {
          throw new Error("The campaign worker did not reach the claim gate.");
        }),
        processing.then(() => {
          throw new Error(
            "The campaign worker completed before reaching the claim gate.",
          );
        }),
      ]);

      releaseClaim();
      await waitForBlockedCampaignPause(pauseClient, processing);
      await pauseClient.query("COMMIT");
      pauseUpdatePending = false;

      assert.equal(await processing, 0);
      assert.deepEqual(deliveredTo, []);
      const [pausedCampaign] = await db
        .select()
        .from(emailCampaignsTable)
        .where(eq(emailCampaignsTable.id, campaign.id));
      assert.ok(pausedCampaign.pausedAt);
      const [queuedRecipient] = await db
        .select()
        .from(emailCampaignRecipientsTable)
        .where(eq(emailCampaignRecipientsTable.id, recipient.id));
      assert.equal(queuedRecipient.status, "queued");
      assert.equal(queuedRecipient.attempts, 0);
      const attempts = await db
        .select()
        .from(emailSendAttemptsTable)
        .where(eq(emailSendAttemptsTable.recipientId, recipient.id));
      assert.equal(attempts.length, 0);

      const pastResumeAt = new Date(Date.now() - 1000);
      const futureResumeAt = new Date(Date.now() + 60_000);
      await db
        .update(emailCampaignsTable)
        .set({ resumeAt: pastResumeAt })
        .where(eq(emailCampaignsTable.id, campaign.id));
      const [futureCampaign] = await db
        .insert(emailCampaignsTable)
        .values({
          userId: owner.id,
          name: "Future campaign resume test",
          subject: "This campaign must stay paused",
          textBody: "A future resume deadline must not be applied early.",
          status: "sending",
          pausedAt: new Date(),
          resumeAt: futureResumeAt,
        })
        .returning();
      const [completedCampaign] = await db
        .insert(emailCampaignsTable)
        .values({
          userId: owner.id,
          name: "Completed campaign resume test",
          subject: "This campaign must stay completed",
          textBody:
            "A due resume deadline must not reactivate a completed campaign.",
          status: "completed",
          pausedAt: new Date(),
          resumeAt: pastResumeAt,
        })
        .returning();

      await workerModule.processPendingCampaignDeliveries(0);
      const [resumedCampaign] = await db
        .select()
        .from(emailCampaignsTable)
        .where(eq(emailCampaignsTable.id, campaign.id));
      assert.equal(resumedCampaign.status, "queued");
      assert.equal(resumedCampaign.pausedAt, null);
      assert.equal(resumedCampaign.resumeAt, null);
      assert.deepEqual(deliveredTo, []);
      const [stillScheduledCampaign] = await db
        .select()
        .from(emailCampaignsTable)
        .where(eq(emailCampaignsTable.id, futureCampaign.id));
      assert.ok(stillScheduledCampaign.pausedAt);
      assert.equal(
        stillScheduledCampaign.resumeAt?.getTime(),
        futureResumeAt.getTime(),
      );
      const [stillCompletedCampaign] = await db
        .select()
        .from(emailCampaignsTable)
        .where(eq(emailCampaignsTable.id, completedCampaign.id));
      assert.equal(stillCompletedCampaign.status, "completed");
      assert.ok(stillCompletedCampaign.pausedAt);
      assert.equal(
        stillCompletedCampaign.resumeAt?.getTime(),
        pastResumeAt.getTime(),
      );
      const [stillQueuedRecipient] = await db
        .select()
        .from(emailCampaignRecipientsTable)
        .where(eq(emailCampaignRecipientsTable.id, recipient.id));
      assert.equal(stillQueuedRecipient.status, "queued");
      assert.equal(stillQueuedRecipient.attempts, 0);
    } finally {
      releaseClaim?.();
      if (pauseClient) {
        if (pauseUpdatePending) {
          await pauseClient.query("COMMIT").catch(async () => {
            await pauseClient.query("ROLLBACK").catch(() => {});
          });
        } else {
          await pauseClient.query("ROLLBACK").catch(() => {});
        }
        pauseClient.release();
      }
      await processing?.catch(() => {});
      workerModule.setBeforeDeliveryClaimForTests(null);
      emailModule.setTenantEmailTransportForTests(null);
      if (ownerId) {
        await db.delete(usersTable).where(eq(usersTable.id, ownerId));
      }
      if (originalPlatformSettings) {
        await db
          .update(systemConfigurationTable)
          .set({
            value: originalPlatformSettings.value,
            updatedBy: originalPlatformSettings.updatedBy,
            updatedAt: originalPlatformSettings.updatedAt,
          })
          .where(eq(systemConfigurationTable.key, "platform"));
      } else {
        await db
          .delete(systemConfigurationTable)
          .where(eq(systemConfigurationTable.key, "platform"));
      }
      await dbModule.pool.end();
    }
  },
);

async function waitForBlockedCampaignPause(pauseClient, processing) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await pauseClient.query(
      `SELECT activity.pid
       FROM pg_stat_activity AS activity
       WHERE activity.datname = current_database()
         AND activity.pid <> pg_backend_pid()
         AND activity.wait_event_type = 'Lock'
         AND $1 = ANY(pg_blocking_pids(activity.pid))`,
      [pauseClient.processID],
    );
    if (rows.length > 0) return;
    const workerFinished = await Promise.race([
      processing.then(
        () => true,
        () => true,
      ),
      delay(10).then(() => false),
    ]);
    if (workerFinished) {
      throw new Error(
        "The campaign worker completed before waiting on the pause update.",
      );
    }
    await delay(10);
  }
  const { rows: activity } = await pauseClient.query(
    `SELECT pid, application_name, state, wait_event_type, wait_event, query
     FROM pg_stat_activity
     WHERE pid <> pg_backend_pid()`,
  );
  throw new Error(
    `The campaign worker did not block on the paused campaign row. PostgreSQL activity: ${JSON.stringify(activity)}`,
  );
}
