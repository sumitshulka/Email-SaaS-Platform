import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.MAINTENANCE_RACE_TEST_DATABASE_URL;

test(
  "maintenance enable wins a PostgreSQL race with a campaign recipient claim",
  {
    skip: databaseUrl
      ? false
      : "Set MAINTENANCE_RACE_TEST_DATABASE_URL to a disposable, migrated PostgreSQL database.",
  },
  async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PGAPPNAME = `mailflow-maintenance-race-${process.pid}`;
    process.env.SESSION_SECRET ??=
      "postgres-maintenance-race-test-session-secret";

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
    const recipientEmail = `maintenance-race-${testId}@example.test`;
    const deliveredTo = [];
    let ownerId;
    let maintenanceClient;
    let processing;
    let maintenanceUpdatePending = false;
    let resolveClaimReached;
    let originalPlatformSettings;

    try {
      const [savedSettings] = await db
        .select()
        .from(systemConfigurationTable)
        .where(eq(systemConfigurationTable.key, "platform"));
      originalPlatformSettings = savedSettings;
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
          username: `maint-race-${testId}`,
          firstName: "Maintenance",
          lastName: "Race",
          email: recipientEmail,
          passwordHash: "postgres-maintenance-race-test",
        })
        .returning();
      ownerId = owner.id;

      const [contact] = await db
        .insert(contactsTable)
        .values({
          userId: owner.id,
          email: recipientEmail,
          firstName: "Maintenance",
          lastName: "Recipient",
          subscribed: true,
        })
        .returning();
      const [sender] = await db
        .insert(tenantSendingConfigurationTable)
        .values({
          userId: owner.id,
          host: "smtp.maintenance-race.test",
          port: 2525,
          encryption: "none",
          usernameEncrypted: securityModule.encryptSecret("maintenance-user"),
          passwordEncrypted: securityModule.encryptSecret(
            "maintenance-password",
          ),
          fromName: "Maintenance Race Test",
          fromEmail: "sender@maintenance-race.test",
          verifiedAt: new Date(),
        })
        .returning();
      const [campaign] = await db
        .insert(emailCampaignsTable)
        .values({
          userId: owner.id,
          senderAccountId: sender.id,
          name: "Maintenance ordering test",
          subject: "Queued until maintenance ends",
          textBody: "The delivery should wait until maintenance ends.",
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

      // This client holds the settings-row lock while the real campaign worker
      // claims through another pool connection.
      maintenanceClient = await pool.connect();
      await maintenanceClient.query("BEGIN");
      await maintenanceClient.query(
        `UPDATE system_configuration
         SET value = $1::jsonb, updated_at = now()
         WHERE key = 'platform'`,
        [
          JSON.stringify({
            ...defaultPlatformSettings,
            maintenanceMode: true,
          }),
        ],
      );
      maintenanceUpdatePending = true;

      const claimReached = new Promise((resolve) => {
        resolveClaimReached = resolve;
      });
      workerModule.setBeforeDeliveryClaimForTests(async () => {
        resolveClaimReached();
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
      await waitForBlockedMaintenanceRead(maintenanceClient, processing);
      await maintenanceClient.query("COMMIT");
      maintenanceUpdatePending = false;

      assert.equal(await processing, 0);
      assert.deepEqual(deliveredTo, []);
      const [pausedRecipient] = await db
        .select()
        .from(emailCampaignRecipientsTable)
        .where(eq(emailCampaignRecipientsTable.id, recipient.id));
      assert.equal(pausedRecipient.status, "queued");
      assert.equal(pausedRecipient.attempts, 0);
      const attemptsDuringMaintenance = await db
        .select()
        .from(emailSendAttemptsTable)
        .where(eq(emailSendAttemptsTable.recipientId, recipient.id));
      assert.equal(attemptsDuringMaintenance.length, 0);

      await db
        .update(systemConfigurationTable)
        .set({
          value: { ...defaultPlatformSettings, maintenanceMode: false },
          updatedAt: new Date(),
        })
        .where(eq(systemConfigurationTable.key, "platform"));
      assert.equal(
        await workerModule.processPendingCampaignDeliveries(1),
        1,
      );
      assert.deepEqual(deliveredTo, [recipientEmail]);
      const [resumedRecipient] = await db
        .select()
        .from(emailCampaignRecipientsTable)
        .where(eq(emailCampaignRecipientsTable.id, recipient.id));
      assert.equal(resumedRecipient.status, "delivered");
      assert.equal(resumedRecipient.attempts, 1);
      const attemptsAfterResume = await db
        .select()
        .from(emailSendAttemptsTable)
        .where(eq(emailSendAttemptsTable.recipientId, recipient.id));
      assert.equal(attemptsAfterResume.length, 1);
    } finally {
      if (maintenanceClient) {
        if (maintenanceUpdatePending) {
          await maintenanceClient.query("COMMIT").catch(async () => {
            await maintenanceClient.query("ROLLBACK").catch(() => {});
          });
          maintenanceUpdatePending = false;
        } else {
          await maintenanceClient.query("ROLLBACK").catch(() => {});
        }
        maintenanceClient.release();
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

async function waitForBlockedMaintenanceRead(maintenanceClient, processing) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await maintenanceClient.query(
      `SELECT activity.pid
       FROM pg_stat_activity AS activity
       WHERE activity.datname = current_database()
         AND activity.pid <> pg_backend_pid()
         AND activity.wait_event_type = 'Lock'
         AND $1 = ANY(pg_blocking_pids(activity.pid))`,
      [maintenanceClient.processID],
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
        "The campaign worker completed before waiting on the maintenance update.",
      );
    }
    await delay(10);
  }
  const { rows: activity } = await maintenanceClient.query(
    `SELECT pid, application_name, state, wait_event_type, wait_event, query
     FROM pg_stat_activity
     WHERE pid <> pg_backend_pid()`,
  );
  throw new Error(
    `The campaign worker did not block on the maintenance settings row. PostgreSQL activity: ${JSON.stringify(activity)}`,
  );
}
