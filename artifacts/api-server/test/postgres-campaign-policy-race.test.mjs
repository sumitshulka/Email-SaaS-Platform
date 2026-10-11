import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.CAMPAIGN_POLICY_RACE_TEST_DATABASE_URL;

test(
  "campaign creation waits for a concurrent prohibited-keyword policy update",
  {
    skip: databaseUrl
      ? false
      : "Set CAMPAIGN_POLICY_RACE_TEST_DATABASE_URL to a disposable, migrated PostgreSQL database.",
  },
  async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PGAPPNAME = `mailflow-campaign-policy-race-${process.pid}`;
    process.env.SESSION_SECRET ??=
      "postgres-campaign-policy-race-test-session-secret";
    process.env.LOG_LEVEL = "silent";

    const [dbModule, securityModule, settingsModule, appModule] =
      await Promise.all([
        import("@workspace/db"),
        import("../src/lib/security.ts"),
        import("../src/lib/platform-settings.ts"),
        import("../src/app.ts"),
      ]);
    const { db, pool } = dbModule;
    const {
      contactListsTable,
      emailCampaignsTable,
      systemConfigurationTable,
      usersTable,
    } = dbModule;
    const { defaultPlatformSettings } = settingsModule;
    const testId = randomUUID();
    const keyword = `policy-race-${testId.replaceAll("-", "")}`;
    const password = "Campaign-policy-race-test-password-2026!";
    const email = `campaign-policy-race-${testId}@example.test`;
    const passwordHash = await securityModule.hashPassword(password);
    const server = appModule.default.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    let userId;
    let adminId;
    let client;
    let originalSettings;
    let adminUpdateRequest;
    let createRequest;

    async function api(path, { method = "GET", body, cookie } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return {
        response,
        body: text ? JSON.parse(text) : undefined,
        cookie:
          response.headers.getSetCookie?.()[0]
            ?.split(";", 1)[0] ?? undefined,
      };
    }

    try {
      [originalSettings] = await db
        .select()
        .from(systemConfigurationTable)
        .where(eq(systemConfigurationTable.key, "platform"));
      await db
        .insert(systemConfigurationTable)
        .values({ key: "platform", value: defaultPlatformSettings })
        .onConflictDoNothing();
      const [owner] = await db
        .insert(usersTable)
        .values({
          username: `cpr-${testId}`,
          firstName: "Campaign",
          lastName: "Policy Race",
          email,
          passwordHash,
          emailVerified: true,
        })
        .returning();
      userId = owner.id;
      const [admin] = await db
        .insert(usersTable)
        .values({
          username: `cpr-admin-${testId}`,
          firstName: "Campaign",
          lastName: "Policy Admin",
          email: `campaign-policy-admin-${testId}@example.test`,
          passwordHash,
          role: "SUPERADMIN",
          emailVerified: true,
        })
        .returning();
      adminId = admin.id;
      const [list] = await db
        .insert(contactListsTable)
        .values({ userId, name: "Policy race list" })
        .returning();

      const [ownerLogin, adminLogin] = await Promise.all([
        api("/auth/login", {
          method: "POST",
          body: { identifier: email, password },
        }),
        api("/auth/login", {
          method: "POST",
          body: {
            identifier: admin.email,
            password,
          },
        }),
      ]);
      assert.equal(ownerLogin.response.status, 200, JSON.stringify(ownerLogin.body));
      assert.equal(adminLogin.response.status, 200, JSON.stringify(adminLogin.body));
      assert.ok(ownerLogin.cookie, "owner login should set a session cookie");
      assert.ok(adminLogin.cookie, "admin login should set a session cookie");
      const currentSettings = await api("/admin/settings", {
        cookie: adminLogin.cookie,
      });
      assert.equal(currentSettings.response.status, 200);
      const { updatedAt: _updatedAt, ...settings } = currentSettings.body;

      client = await pool.connect();
      await client.query("BEGIN");
      await client.query(
        "SELECT key FROM system_configuration WHERE key = 'platform' FOR UPDATE",
      );

      adminUpdateRequest = api("/admin/settings", {
        method: "PUT",
        cookie: adminLogin.cookie,
        body: { ...settings, prohibitedEmailKeywords: [keyword] },
      });
      await waitForPolicyRowLock(client, () => false, 1);

      createRequest = api("/campaigns", {
        method: "POST",
        cookie: ownerLogin.cookie,
        body: {
          name: "Concurrent policy test",
          objective: "Test policy synchronization.",
          subject: `${keyword} campaign`,
          textBody: `This message contains ${keyword}.`,
          listIds: [list.id],
        },
      });
      await waitForPolicyRowLock(client, () => false, 2);
      await client.query("COMMIT");

      const updatedSettings = await adminUpdateRequest;
      assert.equal(
        updatedSettings.response.status,
        200,
        JSON.stringify(updatedSettings.body),
      );
      const created = await createRequest;
      assert.equal(created.response.status, 422, JSON.stringify(created.body));
      assert.equal(created.body.code, "PROFANITY_BLOCKED");
      assert.deepEqual(created.body.fields, ["subject", "body"]);
      assert.deepEqual(
        await db
          .select({ id: emailCampaignsTable.id })
          .from(emailCampaignsTable)
          .where(eq(emailCampaignsTable.userId, userId)),
        [],
        "rejected content must not persist a campaign",
      );
    } finally {
      if (client) {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
      await adminUpdateRequest?.catch(() => {});
      await createRequest?.catch(() => {});
      if (userId) {
        await db.delete(usersTable).where(eq(usersTable.id, userId));
      }
      if (adminId) await db.delete(usersTable).where(eq(usersTable.id, adminId));
      if (originalSettings) {
        await db
          .update(systemConfigurationTable)
          .set({
            value: originalSettings.value,
            updatedBy: originalSettings.updatedBy,
            updatedAt: originalSettings.updatedAt,
          })
          .where(eq(systemConfigurationTable.key, "platform"));
      } else {
        await db
          .delete(systemConfigurationTable)
          .where(eq(systemConfigurationTable.key, "platform"));
      }
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await pool.end();
    }
  },
);

async function waitForPolicyRowLock(client, isRequestSettled, minimumWaiters) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await client.query(
      `SELECT pid
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND query ILIKE '%system_configuration%'`,
    );
    if (rows.length >= minimumWaiters) return;
    if (isRequestSettled()) {
      throw new Error("Campaign creation completed before waiting for the policy update.");
    }
    await delay(25);
  }
  throw new Error("Campaign creation did not wait for the policy settings row.");
}
