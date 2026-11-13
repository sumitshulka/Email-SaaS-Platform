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
        const exhaustedDraft = await invoke("/campaigns", "post", userId, { ...data, name: "Saved after exhaustion" });
        assert.equal(exhaustedDraft.status, 201, JSON.stringify(exhaustedDraft.result));
        response = await invoke("/campaigns/:campaignId", "patch", userId, { name: "Edited after exhaustion" }, { campaignId: exhaustedDraft.result.id });
        assert.equal(response.status, 200, "exhaustion must not prevent editing a draft");
        response = await invoke("/campaigns/:campaignId/send", "post", userId, {
          scheduledAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        }, { campaignId: exhaustedDraft.result.id });
        assert.equal(response.status, 409, "a future schedule must not bypass exhausted allowance");
        assert.equal(response.result.code, "OPEN_CAMPAIGN_ALLOWANCE");
        const [unscheduled] = await tx.select().from(schema.emailCampaignsTable).where(eq(schema.emailCampaignsTable.id, exhaustedDraft.result.id));
        assert.equal(unscheduled.status, "draft");
        assert.equal(unscheduled.openCampaignCountedAt, null);
        assert.equal((await openCampaignAllowance(userId)).used, 1);
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
        const followUp = await invoke("/campaigns/:campaignId/follow-ups", "post", userId, {}, { campaignId: draftOne.result.id });
        assert.equal(followUp.status, 201, JSON.stringify(followUp.result));
        const originalFollowUp = await invoke("/campaigns/:campaignId/open-audience", "get", userId, {}, { campaignId: followUp.result.id });
        assert.equal(originalFollowUp.result.length, 2, "follow-up starts with the parent snapshot");
        response = await invoke("/campaigns/:campaignId", "patch", userId, {
          openRecipients: [{ email: "new-person@example.test" }],
        }, { campaignId: followUp.result.id });
        assert.equal(response.status, 400, "API replacements cannot introduce new recipients");
        assert.match(response.result.error, /only target recipients from the original campaign/);
        response = await invoke("/campaigns/:campaignId", "patch", userId, {
          openRecipients: [{ email: queued[1].email.toUpperCase() }],
        }, { campaignId: followUp.result.id });
        assert.equal(response.status, 200, "original-recipient subsets are valid, including normalized email case");
        const [foreignParent] = await tx.insert(schema.emailCampaignsTable).values({
          userId: users[1].id, name: "Other tenant campaign", subject: "Other tenant", textBody: "Other tenant",
        }).returning();
        await tx.insert(schema.emailCampaignRecipientsTable).values({
          campaignId: foreignParent.id, userId: users[1].id, email: "new-person@example.test",
        });
        await tx.update(schema.subscriptionPackagesTable).set({ openCampaignAllowance: 2 }).where(eq(schema.subscriptionPackagesTable.id, pkg.id));
        const [legacyAudienceRow] = await tx.insert(schema.openCampaignAudienceTable).values({
          userId, campaignId: followUp.result.id, email: "new-person@example.test",
        }).returning();
        response = await invoke("/campaigns/:campaignId/send", "post", userId, {
          scheduledAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        }, { campaignId: followUp.result.id });
        assert.equal(response.status, 409, "queue must revalidate legacy audience data, not trust prior saves");
        assert.equal(response.result.code, "FOLLOW_UP_AUDIENCE_INVALID");
        assert.equal((await openCampaignAllowance(userId)).used, 1, "invalid audience cannot consume allowance");
        await tx.delete(schema.openCampaignAudienceTable).where(eq(schema.openCampaignAudienceTable.id, legacyAudienceRow.id));
        response = await invoke("/campaigns/:campaignId/send", "post", userId, {
          scheduledAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        }, { campaignId: followUp.result.id });
        assert.equal(response.status, 202, "opening up allowance permits scheduling an original-audience follow-up");
        const childRecipients = await tx.select().from(schema.emailCampaignRecipientsTable).where(eq(schema.emailCampaignRecipientsTable.campaignId, followUp.result.id));
        assert.deepEqual(childRecipients.map(row => row.email), [queued[1].email]);
        const [legacyRecipient] = await tx.insert(schema.emailCampaignRecipientsTable).values({
          userId, campaignId: followUp.result.id, email: "new-person@example.test",
          status: "queued", nextAttemptAt: new Date(Date.now() - 1000),
        }).returning();
        await tx.update(schema.emailCampaignsTable).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(schema.emailCampaignsTable.id, followUp.result.id));
        workerModule.setCandidateRecipientIdsForTests([legacyRecipient.id]);
        await workerModule.processPendingCampaignDeliveries(1);
        const [suppressedLegacyRecipient] = await tx.select().from(schema.emailCampaignRecipientsTable).where(eq(schema.emailCampaignRecipientsTable.id, legacyRecipient.id));
        assert.equal(suppressedLegacyRecipient.status, "suppressed", "worker must not send non-original legacy recipients");
        assert.equal(delivered.length, 1, "legacy audience protection must prevent any transport call");
        const earlierAttempt = new Date(Date.now() - 2 * 86400000);
        await tx.update(schema.emailSendAttemptsTable).set({
          attemptedAt: earlierAttempt, completedAt: earlierAttempt,
        }).where(eq(schema.emailSendAttemptsTable.userId, userId));
        await tx.update(schema.emailCampaignRecipientsTable).set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(schema.emailCampaignRecipientsTable.id, childRecipients[0].id));
        workerModule.setCandidateRecipientIdsForTests([childRecipients[0].id]);
        await workerModule.processPendingCampaignDeliveries(1);
        assert.equal(delivered.length, 2, "an eligible original recipient must still receive the follow-up");
        assert.equal(delivered[1].to, queued[1].email);
        await tx.update(schema.subscriptionPackagesTable).set({ openCampaignAllowance: 1 }).where(eq(schema.subscriptionPackagesTable.id, pkg.id));
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
        await tx.update(schema.subscriptionPackagesTable).set({ openCampaignAllowance: 4 }).where(eq(schema.subscriptionPackagesTable.id, pkg.id));
        const fallbackValues = { firstName: "there", lastName: "<friend & colleague>", fullName: "reader" };
        const fallbackDraft = await invoke("/campaigns", "post", userId, {
          ...data, subject: "Hello {{firstName}}", subjectVariants: ["Hello {{firstName}}"],
          greetingVariants: ["Dear {{fullName}},"], signatureVariants: ["Regards"],
          textBody: "Hi {{firstName}} {{lastName}}", htmlBody: "<p>Hello {{firstName}} {{lastName}}</p>",
          placeholderFallbacks: fallbackValues,
          openRecipients: [{ email: "missing-name@example.test" }, { email: "named@example.test", firstName: "Ada", lastName: "Lovelace" }],
        });
        assert.equal(fallbackDraft.status, 201, JSON.stringify(fallbackDraft.result));
        assert.deepEqual(fallbackDraft.result.placeholderFallbacks, fallbackValues);
        response = await invoke("/campaigns/:campaignId", "patch", userId, { name: "Retains fallbacks" }, { campaignId: fallbackDraft.result.id });
        assert.equal(response.status, 200);
        assert.deepEqual(response.result.placeholderFallbacks, fallbackValues, "unrelated edits preserve saved defaults");
        response = await invoke("/campaigns/:campaignId", "patch", userId, { placeholderFallbacks: {} }, { campaignId: fallbackDraft.result.id });
        assert.equal(response.status, 400, "cannot remove defaults required by missing uploaded names");
        response = await invoke("/campaigns/:campaignId/send", "post", userId, {
          scheduledAt: new Date(Date.now() + 8 * 86400000).toISOString(),
        }, { campaignId: fallbackDraft.result.id });
        assert.equal(response.status, 202, JSON.stringify(response.result));
        const fallbackQueued = await tx.select().from(schema.emailCampaignRecipientsTable).where(eq(schema.emailCampaignRecipientsTable.campaignId, fallbackDraft.result.id));
        await tx.update(schema.emailCampaignsTable).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(schema.emailCampaignsTable.id, fallbackDraft.result.id));
        for (const row of fallbackQueued) {
          const old = new Date(Date.now() - 2 * 86400000);
          await tx.update(schema.emailSendAttemptsTable).set({ attemptedAt: old, completedAt: old }).where(eq(schema.emailSendAttemptsTable.userId, userId));
          await tx.update(schema.emailCampaignRecipientsTable).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(schema.emailCampaignRecipientsTable.id, row.id));
          workerModule.setCandidateRecipientIdsForTests([row.id]);
          const before = delivered.length;
          await workerModule.processPendingCampaignDeliveries(1);
          assert.equal(delivered.length, before + 1);
          const message = delivered.at(-1);
          assert.equal(message.subject, row.firstName ? "Hello Ada" : "Hello there");
          assert.match(message.text, row.firstName ? /Dear Ada Lovelace/ : /Dear reader/);
          if (!row.firstName) assert.match(message.html, /&lt;friend &amp; colleague&gt;/);
        }
        const copied = await invoke("/campaigns/:campaignId/follow-ups", "post", userId, {}, { campaignId: fallbackDraft.result.id });
        assert.equal(copied.status, 201);
        assert.deepEqual(copied.result.placeholderFallbacks, fallbackValues, "follow-ups inherit defaults");
        const [standardDraft] = await tx.insert(schema.emailCampaignsTable).values({
          userId, name: "Legacy standard draft", subject: "Hello {{firstName}}", textBody: "Hello {{firstName}}",
        }).returning();
        response = await invoke("/campaigns/:campaignId/send", "post", userId, {}, { campaignId: standardDraft.id });
        assert.equal(response.status, 400);
        assert.equal(response.result.code, "PLACEHOLDER_FALLBACK_REQUIRED", "standard campaigns also require explicit defaults");
        const [previewList] = await tx.insert(schema.contactListsTable).values({ userId, name: "Personalization preview" }).returning();
        const [previewContact] = await tx.insert(schema.contactsTable).values({
          userId, name: "Unnamed contact", firstName: "", lastName: "", email: "preview-fallback@example.test",
        }).returning();
        await tx.insert(schema.contactListMembersTable).values({ userId, listId: previewList.id, contactId: previewContact.id });
        const previewData = {
          listIds: [previewList.id], contactId: previewContact.id,
          subject: "Hello {{firstName}}", textBody: "At {{companyName}}", htmlBody: "<p>At {{companyName}}</p>",
          placeholderFallbacks: { firstName: "there", companyName: "our & team" },
        };
        response = await invoke("/campaigns/preview", "post", userId, previewData);
        assert.equal(response.status, 200, JSON.stringify(response.result));
        assert.equal(response.result.subject, "Hello there");
        assert.equal(response.result.textBody, "At our & team\n\nUnsubscribe: https://mailflow.invalid/unsubscribe?token=preview");
        assert.match(response.result.htmlBody, /our &amp; team/);
        await tx.update(schema.contactsTable).set({ firstName: "Ada", companyName: "Acme" }).where(eq(schema.contactsTable.id, previewContact.id));
        response = await invoke("/campaigns/preview", "post", userId, previewData);
        assert.equal(response.status, 200);
        assert.equal(response.result.subject, "Hello Ada");
        assert.match(response.result.textBody, /At Acme/);
        throw rollback;
      }), error => error === rollback);
    } finally {
      emailModule.setTenantEmailTransportForTests(null);
      workerModule.setCandidateRecipientIdsForTests(null);
      schema.setTestDatabase(realDb);
      await schema.pool.end();
    }
  });
