import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";

const databaseUrl = process.env.CAMPAIGN_SEND_LIMIT_RACE_TEST_DATABASE_URL;

test(
  "separate PostgreSQL-backed workers respect hourly and daily mailbox caps",
  {
    skip: databaseUrl
      ? false
      : "Set CAMPAIGN_SEND_LIMIT_RACE_TEST_DATABASE_URL to a disposable, migrated PostgreSQL database.",
  },
  async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PGAPPNAME = `mailflow-send-limit-race-${process.pid}`;
    process.env.SESSION_SECRET ??=
      "postgres-campaign-send-limit-race-test-session-secret";
    process.env.LOG_LEVEL = "silent";

    const [dbModule, securityModule, settingsModule] = await Promise.all([
      import("@workspace/db"),
      import("../src/lib/security.ts"),
      import("../src/lib/platform-settings.ts"),
    ]);
    const { db } = dbModule;
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
    const originalPlatformRows = await db
      .select()
      .from(systemConfigurationTable)
      .where(eq(systemConfigurationTable.key, "platform"));

    try {
      await assertConcurrentMailboxCap({
        db,
        tables: {
          contactsTable,
          emailCampaignRecipientsTable,
          emailCampaignsTable,
          emailSendAttemptsTable,
          systemConfigurationTable,
          tenantSendingConfigurationTable,
          usersTable,
        },
        securityModule,
        defaultPlatformSettings,
        cap: "hourly",
        hourlyLimit: 2,
        dailyLimit: 10,
        priorAttemptAgeMs: 31 * 60 * 1000,
      });

      await assertConcurrentMailboxCap({
        db,
        tables: {
          contactsTable,
          emailCampaignRecipientsTable,
          emailCampaignsTable,
          emailSendAttemptsTable,
          systemConfigurationTable,
          tenantSendingConfigurationTable,
          usersTable,
        },
        securityModule,
        defaultPlatformSettings,
        cap: "daily",
        hourlyLimit: 10,
        dailyLimit: 2,
        priorAttemptAgeMs: 2 * 60 * 60 * 1000,
      });

      await assertIndependentMailboxAllowance({
        db,
        tables: {
          contactsTable,
          emailCampaignRecipientsTable,
          emailCampaignsTable,
          emailSendAttemptsTable,
          systemConfigurationTable,
          tenantSendingConfigurationTable,
          usersTable,
        },
        securityModule,
        defaultPlatformSettings,
        cap: "hourly",
        hourlyLimit: 2,
        dailyLimit: 10,
        priorAttemptAgeMs: 5 * 60 * 1000,
      });

      await assertIndependentMailboxAllowance({
        db,
        tables: {
          contactsTable,
          emailCampaignRecipientsTable,
          emailCampaignsTable,
          emailSendAttemptsTable,
          systemConfigurationTable,
          tenantSendingConfigurationTable,
          usersTable,
        },
        securityModule,
        defaultPlatformSettings,
        cap: "daily",
        hourlyLimit: 10,
        dailyLimit: 2,
        priorAttemptAgeMs: 2 * 60 * 60 * 1000,
      });
    } finally {
      if (originalPlatformRows[0]) {
        await db
          .update(systemConfigurationTable)
          .set({
            value: originalPlatformRows[0].value,
            updatedBy: originalPlatformRows[0].updatedBy,
            updatedAt: originalPlatformRows[0].updatedAt,
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

async function assertConcurrentMailboxCap({
  db,
  tables,
  securityModule,
  defaultPlatformSettings,
  cap,
  hourlyLimit,
  dailyLimit,
  priorAttemptAgeMs,
}) {
  const {
    contactsTable,
    emailCampaignRecipientsTable,
    emailCampaignsTable,
    emailSendAttemptsTable,
    systemConfigurationTable,
    tenantSendingConfigurationTable,
    usersTable,
  } = tables;
  const testId = randomUUID();
  const ownerEmail = `send-limit-${cap}-${testId}@example.test`;
  const now = new Date();
  const oldAttemptAt = new Date(now.getTime() - priorAttemptAgeMs);
  let ownerId;

  await db
    .insert(systemConfigurationTable)
    .values({
      key: "platform",
      value: {
        ...defaultPlatformSettings,
        maintenanceMode: false,
        defaultEmailsPerHour: hourlyLimit,
        maxEmailsPerDay: dailyLimit,
        queuePollingSeconds: 1,
      },
    })
    .onConflictDoUpdate({
      target: systemConfigurationTable.key,
      set: {
        value: {
          ...defaultPlatformSettings,
          maintenanceMode: false,
          defaultEmailsPerHour: hourlyLimit,
          maxEmailsPerDay: dailyLimit,
          queuePollingSeconds: 1,
        },
        updatedAt: now,
      },
    });

  try {
    const [owner] = await db
      .insert(usersTable)
      .values({
        username: `sr-${cap}-${testId}`,
        firstName: "Send Limit",
        lastName: "Race",
        email: ownerEmail,
        passwordHash: "postgres-campaign-send-limit-race-test",
      })
      .returning();
    ownerId = owner.id;

    const [sender] = await db
      .insert(tenantSendingConfigurationTable)
      .values({
        userId: owner.id,
        host: "smtp.send-limit-race.test",
        port: 2525,
        encryption: "none",
        usernameEncrypted: securityModule.encryptSecret("send-limit-user"),
        passwordEncrypted: securityModule.encryptSecret("send-limit-password"),
        fromName: "Send Limit Race Test",
        fromEmail: `sender-${cap}@send-limit-race.test`,
        verifiedAt: now,
      })
      .returning();
    const [campaign] = await db
      .insert(emailCampaignsTable)
      .values({
        userId: owner.id,
        senderAccountId: sender.id,
        name: `${cap} mailbox cap race`,
        subject: "Concurrent mailbox cap test",
        textBody: "A real PostgreSQL transaction controls this delivery.",
        unsubscribeOrigin: "https://app.mailflow.test",
        status: "queued",
      })
      .returning();

    const priorContact = await createContact(
      db,
      contactsTable,
      owner.id,
      "history",
      testId,
    );
    const [priorRecipient] = await db
      .insert(emailCampaignRecipientsTable)
      .values({
        campaignId: campaign.id,
        userId: owner.id,
        contactId: priorContact.id,
        email: priorContact.email,
        firstName: priorContact.firstName,
        status: "delivered",
        attempts: 1,
        nextAttemptAt: oldAttemptAt,
      })
      .returning();
    await db.insert(emailSendAttemptsTable).values({
      userId: owner.id,
      senderAccountId: sender.id,
      recipientId: priorRecipient.id,
      messageId: `<prior-${testId}@mailflow.local>`,
      outcome: "delivered",
      smtpCode: 250,
      attemptedAt: oldAttemptAt,
      completedAt: oldAttemptAt,
    });

    const queuedRecipients = [];
    for (let index = 0; index < 4; index += 1) {
      const contact = await createContact(
        db,
        contactsTable,
        owner.id,
        `${index}`,
        testId,
      );
      const [recipient] = await db
        .insert(emailCampaignRecipientsTable)
        .values({
          campaignId: campaign.id,
          userId: owner.id,
          contactId: contact.id,
          email: contact.email,
          firstName: contact.firstName,
          status: "queued",
          attempts: 0,
          nextAttemptAt: new Date(Date.now() - 1000),
        })
        .returning();
      queuedRecipients.push(recipient);
    }

    const workerResults = await runConcurrentWorkers(
      queuedRecipients.map((recipient) => recipient.id),
    );
    assert.equal(
      workerResults.reduce((total, result) => total + result.processed, 0),
      1,
      `only one of four separate workers should claim a slot for the ${cap} cap`,
    );

    const freshRecipients = await db
      .select()
      .from(emailCampaignRecipientsTable)
      .where(
        inArray(
          emailCampaignRecipientsTable.id,
          queuedRecipients.map((recipient) => recipient.id),
        ),
      );
    const deliveredRecipients = freshRecipients.filter(
      (recipient) => recipient.status === "delivered",
    );
    const deferredRecipients = freshRecipients.filter(
      (recipient) => recipient.status === "queued",
    );
    assert.equal(deliveredRecipients.length, 1);
    assert.equal(deferredRecipients.length, 3);
    for (const recipient of deliveredRecipients) {
      assert.equal(recipient.attempts, 1);
    }
    for (const recipient of deferredRecipients) {
      assert.equal(recipient.attempts, 0);
      assert.ok(recipient.rateLimitDeferredAt);
    }

    const allAttempts = await db
      .select()
      .from(emailSendAttemptsTable)
      .where(
        and(
          eq(emailSendAttemptsTable.userId, owner.id),
          eq(emailSendAttemptsTable.senderAccountId, sender.id),
        ),
      );
    const attemptIds = new Set(allAttempts.map((attempt) => attempt.recipientId));
    assert.equal(
      allAttempts.length,
      2,
      "the prior and one new attempt are recorded",
    );
    assert.equal(attemptIds.size, allAttempts.length);
    assert.ok(attemptIds.has(priorRecipient.id));
    assert.ok(attemptIds.has(deliveredRecipients[0].id));
    for (const recipient of deferredRecipients) {
      assert.ok(!attemptIds.has(recipient.id), "deferred recipients have no attempt");
    }

    const hourlyAttempts = allAttempts.filter(
      (attempt) => attempt.attemptedAt >= new Date(Date.now() - 60 * 60 * 1000),
    );
    const dailyAttempts = allAttempts.filter(
      (attempt) =>
        attempt.attemptedAt >= new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    assert.ok(hourlyAttempts.length <= hourlyLimit);
    assert.ok(dailyAttempts.length <= dailyLimit);
    assert.equal(hourlyAttempts.length, cap === "hourly" ? hourlyLimit : 1);
    assert.equal(
      dailyAttempts.length,
      cap === "daily" ? dailyLimit : hourlyLimit,
    );
  } finally {
    if (ownerId) {
      await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    }
  }
}

async function assertIndependentMailboxAllowance({
  db,
  tables,
  securityModule,
  defaultPlatformSettings,
  cap,
  hourlyLimit,
  dailyLimit,
  priorAttemptAgeMs,
}) {
  const {
    contactsTable,
    emailCampaignRecipientsTable,
    emailCampaignsTable,
    emailSendAttemptsTable,
    systemConfigurationTable,
    tenantSendingConfigurationTable,
    usersTable,
  } = tables;
  const testId = randomUUID();
  const now = new Date();
  const priorAttemptAt = new Date(now.getTime() - priorAttemptAgeMs);
  const availablePriorAttemptAt = new Date(
    now.getTime() - Math.max(priorAttemptAgeMs, 45 * 60 * 1000),
  );
  const allowance = cap === "hourly" ? hourlyLimit : dailyLimit;
  let ownerId;

  await db
    .insert(systemConfigurationTable)
    .values({
      key: "platform",
      value: {
        ...defaultPlatformSettings,
        maintenanceMode: false,
        defaultEmailsPerHour: hourlyLimit,
        maxEmailsPerDay: dailyLimit,
        queuePollingSeconds: 1,
      },
    })
    .onConflictDoUpdate({
      target: systemConfigurationTable.key,
      set: {
        value: {
          ...defaultPlatformSettings,
          maintenanceMode: false,
          defaultEmailsPerHour: hourlyLimit,
          maxEmailsPerDay: dailyLimit,
          queuePollingSeconds: 1,
        },
        updatedAt: now,
      },
    });

  try {
    const [owner] = await db
      .insert(usersTable)
      .values({
        username: `mi-${cap}-${testId}`,
        firstName: "Mailbox Isolation",
        lastName: "Race",
        email: `mailbox-isolation-${cap}-${testId}@example.test`,
        passwordHash: "postgres-campaign-send-limit-race-test",
      })
      .returning();
    ownerId = owner.id;

    const senders = [];
    for (const mailbox of ["busy", "available"]) {
      const [sender] = await db
        .insert(tenantSendingConfigurationTable)
        .values({
          userId: owner.id,
          host: "smtp.send-limit-race.test",
          port: 2525,
          encryption: "none",
          usernameEncrypted: securityModule.encryptSecret(
            `send-limit-${mailbox}-user`,
          ),
          passwordEncrypted: securityModule.encryptSecret(
            `send-limit-${mailbox}-password`,
          ),
          fromName: "Mailbox Isolation Race Test",
          fromEmail: `${mailbox}-${cap}-${testId}@send-limit-race.test`,
          verifiedAt: now,
        })
        .returning();
      senders.push(sender);
    }

    const campaigns = [];
    for (const [index, sender] of senders.entries()) {
      const [campaign] = await db
        .insert(emailCampaignsTable)
        .values({
          userId: owner.id,
          senderAccountId: sender.id,
          name: `${cap} mailbox isolation ${index}`,
          subject: "Independent mailbox allowance test",
          textBody: "A real PostgreSQL transaction controls this delivery.",
          unsubscribeOrigin: "https://app.mailflow.test",
          status: "queued",
        })
        .returning();
      campaigns.push(campaign);
    }

    const priorRecipients = [];
    for (let index = 0; index < allowance; index += 1) {
      const contact = await createContact(
        db,
        contactsTable,
        owner.id,
        `busy-history-${index}`,
        testId,
      );
      const [recipient] = await db
        .insert(emailCampaignRecipientsTable)
        .values({
          campaignId: campaigns[0].id,
          userId: owner.id,
          contactId: contact.id,
          email: contact.email,
          firstName: contact.firstName,
          status: "delivered",
          attempts: 1,
          nextAttemptAt: priorAttemptAt,
        })
        .returning();
      priorRecipients.push(recipient);
      await db.insert(emailSendAttemptsTable).values({
        userId: owner.id,
        senderAccountId: senders[0].id,
        recipientId: recipient.id,
        messageId: `<busy-${index}-${testId}@mailflow.local>`,
        outcome: "delivered",
        smtpCode: 250,
        attemptedAt: priorAttemptAt,
        completedAt: priorAttemptAt,
      });
    }

    const availablePriorContact = await createContact(
      db,
      contactsTable,
      owner.id,
      "available-history",
      testId,
    );
    const [availablePriorRecipient] = await db
      .insert(emailCampaignRecipientsTable)
      .values({
        campaignId: campaigns[1].id,
        userId: owner.id,
        contactId: availablePriorContact.id,
        email: availablePriorContact.email,
        firstName: availablePriorContact.firstName,
        status: "delivered",
        attempts: 1,
        nextAttemptAt: availablePriorAttemptAt,
      })
      .returning();
    await db.insert(emailSendAttemptsTable).values({
      userId: owner.id,
      senderAccountId: senders[1].id,
      recipientId: availablePriorRecipient.id,
      messageId: `<available-prior-${testId}@mailflow.local>`,
      outcome: "delivered",
      smtpCode: 250,
      attemptedAt: availablePriorAttemptAt,
      completedAt: availablePriorAttemptAt,
    });

    const queuedByMailbox = [[], []];
    for (const mailboxIndex of [0, 1]) {
      const recipientCount = mailboxIndex === 0 ? 2 : allowance;
      for (let index = 0; index < recipientCount; index += 1) {
        const contact = await createContact(
          db,
          contactsTable,
          owner.id,
          `${mailboxIndex}-${index}`,
          testId,
        );
        const [recipient] = await db
          .insert(emailCampaignRecipientsTable)
          .values({
            campaignId: campaigns[mailboxIndex].id,
            userId: owner.id,
            contactId: contact.id,
            email: contact.email,
            firstName: contact.firstName,
            status: "queued",
            attempts: 0,
            nextAttemptAt: new Date(Date.now() - 1000),
          })
          .returning();
        queuedByMailbox[mailboxIndex].push(recipient);
      }
    }

    const queuedRecipients = queuedByMailbox.flat();
    const workerResults = await runConcurrentWorkers(
      queuedRecipients.map((recipient) => recipient.id),
    );
    assert.equal(
      workerResults.reduce((total, result) => total + result.processed, 0),
      1,
      `the available mailbox should use its remaining ${cap} slot despite the busy mailbox`,
    );

    const freshRecipients = await db
      .select()
      .from(emailCampaignRecipientsTable)
      .where(inArray(
        emailCampaignRecipientsTable.id,
        queuedRecipients.map((recipient) => recipient.id),
      ));
    const byId = new Map(freshRecipients.map((recipient) => [recipient.id, recipient]));
    const busyQueued = queuedByMailbox[0].map((recipient) => byId.get(recipient.id));
    const availableQueued = queuedByMailbox[1].map((recipient) => byId.get(recipient.id));
    assert.ok(busyQueued.every((recipient) => recipient.status === "queued"));
    assert.equal(
      availableQueued.filter((recipient) => recipient.status === "delivered").length,
      1,
    );
    assert.equal(
      availableQueued.filter((recipient) => recipient.status === "queued").length,
      allowance - 1,
    );

    const deferredRecipients = [
      ...busyQueued,
      ...availableQueued.filter((recipient) => recipient.status === "queued"),
    ];
    for (const recipient of deferredRecipients) {
      assert.equal(recipient.attempts, 0);
      assert.ok(recipient.rateLimitDeferredAt);
    }
    for (const recipient of availableQueued.filter(
      (recipient) => recipient.status === "delivered",
    )) {
      assert.equal(recipient.attempts, 1);
    }

    const allAttempts = await db
      .select()
      .from(emailSendAttemptsTable)
      .where(eq(emailSendAttemptsTable.userId, owner.id));
    const attemptsByRecipient = new Map(
      allAttempts.map((attempt) => [attempt.recipientId, attempt]),
    );
    assert.equal(allAttempts.length, allowance + 2);
    assert.equal(
      allAttempts.filter((attempt) => attempt.senderAccountId === senders[0].id).length,
      allowance,
      "only the seeded history is recorded for the mailbox at its cap",
    );
    assert.equal(
      allAttempts.filter((attempt) => attempt.senderAccountId === senders[1].id).length,
      2,
      "the other mailbox records its prior send and independent remaining send",
    );
    for (const recipient of priorRecipients) {
      assert.equal(attemptsByRecipient.get(recipient.id)?.senderAccountId, senders[0].id);
    }
    assert.equal(
      attemptsByRecipient.get(availablePriorRecipient.id)?.senderAccountId,
      senders[1].id,
    );
    for (const recipient of deferredRecipients) {
      assert.ok(
        !attemptsByRecipient.has(recipient.id),
        "deferred recipients remain queued without attempt rows",
      );
    }
  } finally {
    if (ownerId) {
      await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    }
  }
}

async function createContact(db, contactsTable, userId, suffix, testId) {
  const [contact] = await db
    .insert(contactsTable)
    .values({
      userId,
      email: `send-limit-${suffix}-${testId}@example.test`,
      firstName: "Send Limit",
      lastName: suffix,
      subscribed: true,
    })
    .returning();
  return contact;
}

async function runConcurrentWorkers(recipientIds) {
  const workers = recipientIds.map((recipientId, index) => {
    const child = fork(
      new URL("./postgres-campaign-send-limit-worker.mjs", import.meta.url),
      [],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
          PGAPPNAME: `mailflow-send-limit-worker-${process.pid}-${index}`,
        },
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    return {
      child,
      recipientId,
      output: () => output,
      started: false,
      result: null,
    };
  });

  try {
    return await new Promise((resolve, reject) => {
      let finished = 0;
      const timeout = setTimeout(
        () => reject(new Error("Separate send-limit workers timed out.")),
        30_000,
      );
      const fail = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
      for (const worker of workers) {
        worker.child.on("message", (message) => {
          if (message?.type === "ready") {
            worker.started = true;
            if (workers.every((item) => item.started)) {
              for (const item of workers) item.child.send({ type: "start" });
            }
          } else if (message?.type === "result") {
            worker.result = message.processed;
            finished += 1;
            if (finished === workers.length) {
              clearTimeout(timeout);
              resolve(workers.map((item) => ({ processed: item.result })));
            }
          } else if (message?.type === "error") {
            fail(
              new Error(
                `A separate send-limit worker failed: ${message.error}\n${worker.output()}`,
              ),
            );
          }
        });
        worker.child.on("error", fail);
        worker.child.on("exit", (code, signal) => {
          if (worker.result === null) {
            fail(
              new Error(
                `A separate send-limit worker exited before returning a result (${code ?? signal}).\n${worker.output()}`,
              ),
            );
          }
        });
        worker.child.send({
          type: "run",
          recipientId: worker.recipientId,
        });
      }
    });
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) {
        worker.child.kill("SIGTERM");
      }
    }
  }
}

