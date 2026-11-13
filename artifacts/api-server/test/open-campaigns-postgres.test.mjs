import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { normalizeOpenRecipients, openCampaignPlaceholderError, openCampaignAllowance } from "../src/lib/open-campaigns.ts";

test("open uploads normalize addresses and disable unavailable name placeholders", () => {
  assert.deepEqual(normalizeOpenRecipients([
    { email: " FIRST@example.test ", firstName: " First " },
    { email: "first@example.test", firstName: "Duplicate" },
    { email: "second@example.test" },
  ]), [{ email: "first@example.test", firstName: "First", lastName: "" }, { email: "second@example.test", firstName: "", lastName: "" }]);
  assert.throws(() => normalizeOpenRecipients([]));
  assert.throws(() => normalizeOpenRecipients([{ email: "not-an-email" }]));
  assert.throws(() => normalizeOpenRecipients([{ email: "valid@example.test", firstName: "x".repeat(101) }]));
  const rows = [{ email: "a@example.test" }];
  assert.equal(openCampaignPlaceholderError(rows, "Hello {{email}}"), null);
  for (const key of ["firstName", "lastName", "fullName", "companyName", "first_name"]) {
    assert.ok(openCampaignPlaceholderError(rows, `Hello {{${key}}}`));
  }
  assert.equal(openCampaignPlaceholderError([{ email: "a@example.test", firstName: "A", lastName: "B" }], "{{firstName}} {{lastName}} {{fullName}}"), null);
});

test("open drafts queue once per term without contacts and preserve tenant-specific opt-outs",
  { skip: !process.env.RUN_OPEN_CAMPAIGNS_DB_TESTS }, async () => {
    process.env.NODE_ENV = "test";
    const { default: router } = await import("../src/routes/sending.ts");
    const { createCampaignUnsubscribeToken, applyCampaignUnsubscribeToken } = await import("../src/lib/campaign-unsubscribe.ts");
    const { encryptSecret } = await import("../src/lib/security.ts");
    const emailModule = await import("../src/lib/application-email.ts");
    const workerModule = await import("../src/lib/campaign-worker.ts");
    const realDb = drizzle(schema.pool, { schema });
    const rollback = new Error("ROLLBACK_OPEN_CAMPAIGN_FIXTURES");
    const invoke = async (path, method, userId, body = {}, params = {}) => {
      const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
      assert.ok(layer, `${method} ${path} exists`);
      let status = 200, result;
      const response = { status(value) { status = value; return this; }, json(value) { result = value; return this; } };
      await layer.route.stack.at(-1).handle({
        authUser: { id: userId, role: "USER" }, body, params, query: {},
        get: name => name === "origin" ? "https://mailflow.example.test" : undefined,
        log: { info() {}, warn() {}, error() {} },
      }, response);
      return { status, result };
    };
    try {
      await assert.rejects(realDb.transaction(async tx => {
        schema.setTestDatabase(tx);
        const users = await tx.insert(schema.usersTable).values([1, 2].map(() => {
          const suffix = randomUUID();
          return { username: `open-${suffix}`, email: `open-${suffix}@example.test`, firstName: "Open", lastName: "Fixture", passwordHash: "unused" };
        })).returning();
        const userId = users[0].id;
        const [pkg] = await tx.insert(schema.subscriptionPackagesTable).values({
          name: "Open fixture package", amountMinor: 100, periodDays: 30, contactLimit: 100, emailAccountLimit: 1,
          openCampaignAllowance: 1, openCampaignRecipientLimit: 2,
        }).returning();
        const [term] = await tx.insert(schema.userSubscriptionsTable).values({
          userId, packageId: pkg.id, startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + 30 * 86400000),
        }).returning();
        await tx.insert(schema.tenantSendingConfigurationTable).values({
          userId, host: "smtp.example.test", port: 587, encryption: "starttls", usernameEncrypted: encryptSecret("sender@example.test"),
          passwordEncrypted: encryptSecret("fixture-only-password"), fromName: "Fixture", fromEmail: "sender@example.test", verifiedAt: new Date(),
        });
        const data = {
          audienceType: "open", name: "Open fixture", subject: "First",
          subjectVariants: ["First", "Second", "Third"], greetingVariants: ["Hello", "Hi", "Greetings"],
          signatureVariants: ["Regards", "Thanks", "Best"], textBody: "Hello {{email}}",
          openRecipients: [{ email: "one@example.test" }, { email: "two@example.test" }],
        };
        let response = await invoke("/campaigns", "post", userId, { ...data, textBody: "Hello {{firstName}}" });
        assert.equal(response.status, 400);
        response = await invoke("/campaigns", "post", userId, { ...data, openRecipients: [...data.openRecipients, { email: "three@example.test" }] });
        assert.equal(response.status, 409, "oversized audiences are rejected");
        const smaller = await invoke("/campaigns", "post", userId, { ...data, openRecipients: [data.openRecipients[0]] });
        assert.equal(smaller.status, 201, "fewer recipients than the package maximum must be allowed");
        assert.equal(smaller.result.recipients, 1);
        response = await invoke("/campaigns/:campaignId", "patch", userId, {
          openRecipients: [...data.openRecipients, { email: "three@example.test" }],
        }, { campaignId: smaller.result.id });
        assert.equal(response.status, 400, "editing cannot bypass the package maximum");
        const draftOne = await invoke("/campaigns", "post", userId, data);
        assert.equal(draftOne.status, 201, JSON.stringify(draftOne.result));
        assert.equal(draftOne.result.audienceType, "open");
        assert.equal(draftOne.result.recipients, 2);
        assert.deepEqual(draftOne.result.listIds, []);
        const draftTwo = await invoke("/campaigns", "post", userId, { ...data, name: "Second draft" });
        assert.equal(draftTwo.status, 201);
        assert.equal((await openCampaignAllowance(userId)).used, 0, "drafts do not consume allowance");
        assert.equal((await tx.select().from(schema.contactsTable).where(eq(schema.contactsTable.userId, userId))).length, 0);
        const foreign = await invoke("/campaigns/:campaignId/open-audience", "get", users[1].id, {}, { campaignId: draftOne.result.id });
        assert.equal(foreign.status, 404, "another tenant cannot read uploaded recipients");
        response = await invoke("/campaigns/:campaignId/send", "post", userId, { scheduledAt: new Date(Date.now() + 2 * 86400000).toISOString() }, { campaignId: draftOne.result.id });
        assert.equal(response.status, 202, JSON.stringify(response.result));
        const quota = await openCampaignAllowance(userId);
        assert.equal(quota.used, 1);
        assert.equal(quota.remaining, 0);
        const queued = await tx.select().from(schema.emailCampaignRecipientsTable).where(eq(schema.emailCampaignRecipientsTable.campaignId, draftOne.result.id));
        assert.equal(queued.length, 2);
        assert.ok(queued.every(row => row.contactId === null && row.status === "queued"));
        assert.ok(queued.every(row => row.variantAssignment.subject && row.variantAssignment.greeting && row.variantAssignment.signature));
        response = await invoke("/campaigns/:campaignId/send", "post", userId, {}, { campaignId: draftTwo.result.id });
        assert.equal(response.status, 409);
        assert.equal(response.result.code, "OPEN_CAMPAIGN_ALLOWANCE");
        response = await invoke("/campaigns/:campaignId/send", "post", userId, {}, { campaignId: draftOne.result.id });
        assert.equal(response.status, 409, "already queued campaign cannot consume another slot");
        assert.equal((await openCampaignAllowance(userId)).used, 1);
        const token = createCampaignUnsubscribeToken({ tenantId: userId, recipientId: queued[0].id, campaignId: draftOne.result.id });
        await applyCampaignUnsubscribeToken(token);
        await applyCampaignUnsubscribeToken(token);
        assert.equal((await tx.select().from(schema.campaignEmailSuppressionsTable).where(eq(schema.campaignEmailSuppressionsTable.userId, userId))).length, 1);
        const [unsubscribed] = await tx.select().from(schema.emailCampaignRecipientsTable).where(eq(schema.emailCampaignRecipientsTable.id, queued[0].id));
        assert.equal(unsubscribed.status, "suppressed");
        assert.equal((await tx.select().from(schema.contactsTable).where(eq(schema.contactsTable.userId, userId))).length, 0, "unsubscribe never creates a saved contact");
        const delivered = [];
        emailModule.setTenantEmailTransportForTests(async message => {
          delivered.push(message);
          return { accepted: true, smtpResponse: "250 2.0.0 Fixture accepted", smtpCode: 250 };
        });
        workerModule.setCandidateRecipientIdsForTests([queued[1].id]);
        await tx.update(schema.emailCampaignsTable).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(schema.emailCampaignsTable.id, draftOne.result.id));
        await tx.update(schema.emailCampaignRecipientsTable).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(schema.emailCampaignRecipientsTable.id, queued[1].id));
        await workerModule.processPendingCampaignDeliveries(1);
        assert.equal(delivered.length, 1, "the real worker must send an eligible open recipient without a contact");
        assert.equal(delivered[0].to, queued[1].email);
        assert.match(delivered[0].text, /unsubscribe/i, "the worker adds a real unsubscribe footer");
        const [accepted] = await tx.select().from(schema.emailCampaignRecipientsTable).where(eq(schema.emailCampaignRecipientsTable.id, queued[1].id));
        assert.equal(accepted.status, "delivered");
        assert.equal((await openCampaignAllowance(userId)).used, 1, "completion does not restore allowance");
        await tx.update(schema.userSubscriptionsTable).set({ endsAt: new Date() }).where(eq(schema.userSubscriptionsTable.id, term.id));
        const [nextTerm] = await tx.insert(schema.userSubscriptionsTable).values({
          userId, packageId: pkg.id, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 30 * 86400000),
        }).returning();
        assert.equal((await openCampaignAllowance(userId)).remaining, 1, "new term restores allowance");
        response = await invoke("/campaigns/:campaignId/send", "post", userId, { scheduledAt: new Date(Date.now() + 4 * 86400000).toISOString() }, { campaignId: draftTwo.result.id });
        assert.equal(response.status, 202, JSON.stringify(response.result));
        const secondQueued = await tx.select().from(schema.emailCampaignRecipientsTable).where(eq(schema.emailCampaignRecipientsTable.campaignId, draftTwo.result.id));
        assert.equal(secondQueued.length, 1, "new upload excludes previously opted-out email");
        assert.notEqual(secondQueued[0].email, queued[0].email);
        const [counted] = await tx.select().from(schema.emailCampaignsTable).where(and(eq(schema.emailCampaignsTable.id, draftTwo.result.id), eq(schema.emailCampaignsTable.openCampaignSubscriptionId, nextTerm.id)));
        assert.ok(counted.openCampaignCountedAt);
        throw rollback;
      }), error => error === rollback);
    } finally {
      emailModule.setTenantEmailTransportForTests(null);
      workerModule.setCandidateRecipientIdsForTests(null);
      schema.setTestDatabase(realDb);
      await schema.pool.end();
    }
  });
