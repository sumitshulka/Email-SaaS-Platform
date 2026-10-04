import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  gt,
  inArray,
  lte,
  max,
  ne,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCampaignBody,
  CreateCampaignResponse,
  CreateContactBody,
  CreateContactListBody,
  CreateContactListResponse,
  CreateContactResponse,
  GetCampaignDashboardParams,
  GetCampaignDashboardResponse,
  GetContactEmailHistoryParams,
  GetContactEmailHistoryResponse,
  DeleteCampaignParams,
  DeleteCampaignResponse,
  DeleteContactListParams,
  DeleteContactListResponse,
  DeleteContactParams,
  DeleteContactResponse,
  GetTenantSendingSettingsResponse,
  GetUserDashboardResponse,
  ImportContactsBody,
  ImportContactsResponse,
  ListCampaignsResponse,
  ListContactListsResponse,
  ListContactsResponse,
  PreviewCampaignBody,
  PreviewCampaignResponse,
  SendCampaignParams,
  SendCampaignResponse,
  TestTenantSendingSettingsBody,
  TestTenantSendingSettingsResponse,
  UpdateCampaignBody,
  UpdateCampaignParams,
  UpdateCampaignResponse,
  UpdateContactBody,
  UpdateContactListBody,
  UpdateContactListParams,
  UpdateContactListResponse,
  UpdateContactParams,
  UpdateContactResponse,
  UpdateTenantSendingSettingsBody,
  UpdateTenantSendingSettingsResponse,
} from "@workspace/api-zod";
import {
  contactListMembersTable,
  contactListsTable,
  contactsTable,
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  emailSendAttemptsTable,
  subscriptionPackagesTable,
  tenantSendingConfigurationTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { sendTenantEmail } from "../lib/application-email";
import {
  renderCampaignForContact,
  sanitizeCampaignHtml,
} from "../lib/campaign-template";
import { encryptSecret } from "../lib/security";
import {
  estimateCampaignDeliveryAfterQueueSeconds,
  estimateCampaignQueueDeliverySeconds,
  getMinimumEmailSpacingSeconds,
  getPlatformSettings,
} from "../lib/platform-settings";
import { getCurrentSubscriptionForUser } from "../lib/billing";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();
const MASKED_CREDENTIAL = "••••••";
const contactTextFields = [
  "email",
  "firstName",
  "lastName",
  "companyName",
  "linkedinUrl",
  "phoneNumber",
] as const;

function normalizedContactInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const normalized = { ...(input as Record<string, unknown>) };
  // `name` is retained in the contract for legacy clients, but is always derived
  // from the structured name fields.
  delete normalized.name;
  for (const field of contactTextFields) {
    if (typeof normalized[field] === "string") {
      normalized[field] = normalized[field].trim();
    }
  }
  return normalized;
}

function optionalContactValue(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sendingSettingsResponse(
  config: typeof tenantSendingConfigurationTable.$inferSelect | undefined,
) {
  return {
    provider: config?.provider ?? "other",
    host: config?.host ?? null,
    port: config?.port ?? null,
    encryption: config?.encryption ?? null,
    username: config ? MASKED_CREDENTIAL : null,
    credentialsConfigured: Boolean(config?.usernameEncrypted && config.passwordEncrypted),
    fromName: config?.fromName ?? null,
    fromEmail: config?.fromEmail ?? null,
    replyTo: config?.replyTo ?? null,
    verified: Boolean(config?.verifiedAt),
    verifiedAt: config?.verifiedAt ?? null,
    updatedAt: config?.updatedAt ?? null,
  };
}

async function getContactQuota(userId: string) {
  const [contactCount, settings, { subscription }] = await Promise.all([
    db
      .select({ value: count() })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId)),
    getPlatformSettings(),
    getCurrentSubscriptionForUser(userId),
  ]);
  const used = Number(contactCount[0]?.value ?? 0);
  const activeSubscription =
    subscription?.status === "active" ? subscription : null;
  const requiresSubscription =
    !activeSubscription && !settings.allowUserWithoutSubscription;
  const limit = requiresSubscription
    ? 0
    : Math.min(
        activeSubscription?.package.contactLimit ?? settings.maxContactsPerUser,
        settings.maxContactsPerUser,
      );
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    canAdd: !requiresSubscription && used < limit,
    requiresSubscription,
  };
}

async function getContactPayload(
  userId: string,
  contact: typeof contactsTable.$inferSelect,
) {
  const memberships = await db
    .select({ listId: contactListMembersTable.listId })
    .from(contactListMembersTable)
    .where(
      and(
        eq(contactListMembersTable.userId, userId),
        eq(contactListMembersTable.contactId, contact.id),
      ),
    );
  return {
    ...contact,
    name:
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.name,
    listIds: memberships.map((membership) => membership.listId),
  };
}

async function getTenantContactEmailHistory(userId: string, contactId?: string) {
  const filters = [
    eq(emailCampaignRecipientsTable.userId, userId),
    gt(emailCampaignRecipientsTable.attempts, 0),
    ...(contactId ? [eq(emailCampaignRecipientsTable.contactId, contactId)] : []),
  ];

  const history = await db
    .select({
      id: emailCampaignRecipientsTable.id,
      contactId: emailCampaignRecipientsTable.contactId,
      campaignId: emailCampaignRecipientsTable.campaignId,
      campaignName: emailCampaignsTable.name,
      subject: emailCampaignsTable.subject,
      status: emailCampaignRecipientsTable.status,
      attempts: emailCampaignRecipientsTable.attempts,
      lastAttemptAt: max(emailSendAttemptsTable.attemptedAt),
      deliveredAt: emailCampaignRecipientsTable.deliveredAt,
      reportOutcome: emailCampaignRecipientsTable.reportOutcome,
      reportSource: emailCampaignRecipientsTable.reportSource,
      reportEvidenceVerification:
        emailCampaignRecipientsTable.reportEvidenceVerification,
      reportDiagnostic: emailCampaignRecipientsTable.reportDiagnostic,
      reportAt: emailCampaignRecipientsTable.reportAt,
      lastError: emailCampaignRecipientsTable.lastError,
      createdAt: emailCampaignRecipientsTable.createdAt,
    })
    .from(emailCampaignRecipientsTable)
    .innerJoin(
      emailCampaignsTable,
      and(
        eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
        eq(emailCampaignsTable.userId, userId),
      ),
    )
    .innerJoin(
      emailSendAttemptsTable,
      and(
        eq(emailSendAttemptsTable.recipientId, emailCampaignRecipientsTable.id),
        eq(emailSendAttemptsTable.userId, userId),
      ),
    )
    .where(and(...filters))
    .groupBy(
      emailCampaignRecipientsTable.id,
      emailCampaignRecipientsTable.contactId,
      emailCampaignRecipientsTable.campaignId,
      emailCampaignsTable.name,
      emailCampaignsTable.subject,
      emailCampaignRecipientsTable.status,
      emailCampaignRecipientsTable.attempts,
      emailCampaignRecipientsTable.deliveredAt,
      emailCampaignRecipientsTable.reportOutcome,
      emailCampaignRecipientsTable.reportSource,
      emailCampaignRecipientsTable.reportEvidenceVerification,
      emailCampaignRecipientsTable.reportDiagnostic,
      emailCampaignRecipientsTable.reportAt,
      emailCampaignRecipientsTable.lastError,
      emailCampaignRecipientsTable.createdAt,
    )
    .orderBy(
      desc(max(emailSendAttemptsTable.attemptedAt)),
      desc(emailCampaignRecipientsTable.createdAt),
    );
  const latestAttempts = await db
    .select({
      recipientId: emailSendAttemptsTable.recipientId,
      messageId: emailSendAttemptsTable.messageId,
      smtpResponse: emailSendAttemptsTable.smtpResponse,
    })
    .from(emailSendAttemptsTable)
    .where(
      and(
        eq(emailSendAttemptsTable.userId, userId),
        inArray(
          emailSendAttemptsTable.recipientId,
          history.map((email) => email.id),
        ),
      ),
    )
    .orderBy(
      desc(emailSendAttemptsTable.attemptedAt),
      desc(emailSendAttemptsTable.id),
    );
  const latestAttemptByRecipient = new Map<
    string,
    (typeof latestAttempts)[number]
  >();
  for (const attempt of latestAttempts) {
    if (!latestAttemptByRecipient.has(attempt.recipientId)) {
      latestAttemptByRecipient.set(attempt.recipientId, attempt);
    }
  }
  return history.map((email) => {
    const latestAttempt = latestAttemptByRecipient.get(email.id);
    return {
      ...email,
      messageId: latestAttempt?.messageId ?? null,
      smtpResponse: latestAttempt?.smtpResponse ?? null,
    };
  });
}

async function isValidTenantListSelection(
  userId: string,
  listIds: string[],
): Promise<boolean> {
  const uniqueIds = [...new Set(listIds)];
  if (uniqueIds.length !== listIds.length) return false;
  if (uniqueIds.length === 0) return true;
  const rows = await db
    .select({ id: contactListsTable.id })
    .from(contactListsTable)
    .where(
      and(
        eq(contactListsTable.userId, userId),
        inArray(contactListsTable.id, uniqueIds),
      ),
    );
  return rows.length === uniqueIds.length;
}

async function contactListPayloads(userId: string) {
  const [lists, memberships] = await Promise.all([
    db
      .select()
      .from(contactListsTable)
      .where(eq(contactListsTable.userId, userId))
      .orderBy(desc(contactListsTable.createdAt)),
    db
      .select({
        listId: contactListMembersTable.listId,
        value: count(),
      })
      .from(contactListMembersTable)
      .where(eq(contactListMembersTable.userId, userId))
      .groupBy(contactListMembersTable.listId),
  ]);
  const counts = new Map(memberships.map((row) => [row.listId, row.value]));
  return lists.map((list) => ({
    ...list,
    contactCount: counts.get(list.id) ?? 0,
  }));
}

async function campaignPayloads(userId: string) {
  const [campaigns, recipients, eligibleByList, settings] = await Promise.all([
    db
      .select()
      .from(emailCampaignsTable)
      .where(eq(emailCampaignsTable.userId, userId))
      .orderBy(desc(emailCampaignsTable.createdAt)),
    db
      .select({
        campaignId: emailCampaignRecipientsTable.campaignId,
        status: emailCampaignRecipientsTable.status,
        nextAttemptAt: emailCampaignRecipientsTable.nextAttemptAt,
        createdAt: emailCampaignRecipientsTable.createdAt,
      })
      .from(emailCampaignRecipientsTable)
      .where(eq(emailCampaignRecipientsTable.userId, userId)),
    db
      .select({
        listId: contactListMembersTable.listId,
        value: count(),
      })
      .from(contactListMembersTable)
      .innerJoin(
        contactsTable,
        and(
          eq(contactsTable.id, contactListMembersTable.contactId),
          eq(contactsTable.userId, contactListMembersTable.userId),
        ),
      )
      .where(
        and(
          eq(contactListMembersTable.userId, userId),
          eq(contactsTable.subscribed, true),
        ),
      )
      .groupBy(contactListMembersTable.listId),
    getPlatformSettings(),
  ]);
  const estimateNow = new Date();
  const recentAttempts = await db
    .select({ attemptedAt: emailSendAttemptsTable.attemptedAt })
    .from(emailSendAttemptsTable)
    .where(
      and(
        eq(emailSendAttemptsTable.userId, userId),
        gte(
          emailSendAttemptsTable.attemptedAt,
          new Date(estimateNow.getTime() - 24 * 60 * 60 * 1000),
        ),
      ),
    )
    .orderBy(asc(emailSendAttemptsTable.attemptedAt));
  const activeCampaignIds = new Set(
    campaigns
      .filter(
        (campaign) =>
          campaign.status === "queued" || campaign.status === "sending",
      )
      .map((campaign) => campaign.id),
  );
  const inProgressCampaignIds = new Set(
    recipients
      .filter(
        (recipient) =>
          recipient.status === "sending" &&
          activeCampaignIds.has(recipient.campaignId),
      )
      .map((recipient) => recipient.campaignId),
  );
  const queuedWorkStartAt = new Date(
    estimateNow.getTime() +
      (inProgressCampaignIds.size > 0
        ? Math.max(1, settings.queuePollingSeconds) * 1000
        : 0),
  );
  const queuedRecipients = recipients
    .filter(
      (recipient) =>
        recipient.status === "queued" &&
        activeCampaignIds.has(recipient.campaignId),
    )
    .map((recipient) => ({
      campaignId: recipient.campaignId,
      nextAttemptAt:
        recipient.nextAttemptAt > queuedWorkStartAt
          ? recipient.nextAttemptAt
          : queuedWorkStartAt,
      createdAt: recipient.createdAt,
    }));
  const queueForecast = estimateCampaignQueueDeliverySeconds(
    queuedRecipients,
    settings,
    recentAttempts.map((attempt) => attempt.attemptedAt),
    estimateNow,
  );
  const counts = new Map<
    string,
    {
      recipients: number;
      queued: number;
      delivered: number;
      bounced: number;
      suppressed: number;
      unknown: number;
    }
  >();
  for (const recipient of recipients) {
    const total = counts.get(recipient.campaignId) ?? {
      recipients: 0,
      queued: 0,
      delivered: 0,
      bounced: 0,
      suppressed: 0,
      unknown: 0,
    };
    total.recipients += 1;
    if (recipient.status === "queued" || recipient.status === "sending") {
      total.queued += 1;
    } else if (recipient.status === "delivered") {
      total.delivered += 1;
    } else if (recipient.status === "bounced") {
      total.bounced += 1;
    } else if (recipient.status === "suppressed") {
      total.suppressed += 1;
    } else if (recipient.status === "unknown") {
      total.unknown += 1;
    }
    counts.set(recipient.campaignId, total);
  }
  const eligibleCounts = new Map(
    eligibleByList.map((row) => [row.listId, row.value]),
  );
  return campaigns.map((campaign) => {
    const deliveryCounts = counts.get(campaign.id) ?? {
      recipients: 0,
      queued: 0,
      delivered: 0,
      bounced: 0,
      suppressed: 0,
      unknown: 0,
    };
    const recipients =
      campaign.status === "draft"
        ? eligibleCounts.get(campaign.listId ?? "") ?? 0
        : deliveryCounts.recipients;
    const remainingRecipients =
      campaign.status === "draft"
        ? recipients
        : campaign.status === "completed"
          ? 0
          : deliveryCounts.queued;
    const estimatedDurationSeconds =
      campaign.status === "completed"
        ? 0
        : campaign.status === "draft"
          ? estimateCampaignDeliveryAfterQueueSeconds(
              remainingRecipients,
              settings,
              queueForecast.projectedAttemptTimes,
              recentAttempts.length > 0,
              estimateNow,
              queuedWorkStartAt,
            )
          : Math.max(
              queueForecast.durationSecondsByCampaign.get(campaign.id) ?? 0,
              inProgressCampaignIds.has(campaign.id)
                ? Math.max(1, settings.queuePollingSeconds)
                : 0,
            );
    return {
      ...campaign,
      ...deliveryCounts,
      recipients,
      estimatedDurationSeconds,
    };
  });
}

async function completeCampaignIfFinished(
  userId: string,
  campaignId: string,
): Promise<void> {
  const [unfinished] = await db
    .select({ value: count() })
    .from(emailCampaignRecipientsTable)
    .where(
      and(
        eq(emailCampaignRecipientsTable.userId, userId),
        eq(emailCampaignRecipientsTable.campaignId, campaignId),
        inArray(emailCampaignRecipientsTable.status, ["queued", "sending"]),
      ),
    );
  if ((unfinished?.value ?? 0) > 0) return;
  await db
    .update(emailCampaignsTable)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(emailCampaignsTable.userId, userId),
        eq(emailCampaignsTable.id, campaignId),
        inArray(emailCampaignsTable.status, ["queued", "sending"]),
      ),
    );
}

router.get("/sending/settings", requireUserRole, async (req, res): Promise<void> => {
  const [config] = await db
    .select()
    .from(tenantSendingConfigurationTable)
    .where(eq(tenantSendingConfigurationTable.userId, req.authUser!.id));
  res.json(GetTenantSendingSettingsResponse.parse(sendingSettingsResponse(config)));
});

router.put("/sending/settings", requireUserRole, async (req, res): Promise<void> => {
  const parsed = UpdateTenantSendingSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Some sender identity or SMTP values are invalid.",
      code: "INVALID_SENDING_SETTINGS",
    });
    return;
  }

  const userId = req.authUser!.id;
  const [existing] = await db
    .select()
    .from(tenantSendingConfigurationTable)
    .where(eq(tenantSendingConfigurationTable.userId, userId));
  const suppliedUsername = parsed.data.username?.trim();
  const suppliedPassword = parsed.data.password?.trim();
  if (!existing && (!suppliedUsername || !suppliedPassword)) {
    res.status(400).json({
      error: "Enter the SMTP username and password to configure a sender.",
      code: "SMTP_CREDENTIALS_REQUIRED",
    });
    return;
  }
  const usernameEncrypted = suppliedUsername
    ? encryptSecret(suppliedUsername)
    : existing!.usernameEncrypted;
  const passwordEncrypted = suppliedPassword
    ? encryptSecret(suppliedPassword)
    : existing!.passwordEncrypted;
  const values = {
    userId,
    provider: parsed.data.provider,
    host: parsed.data.host.trim(),
    port: parsed.data.port,
    encryption: parsed.data.encryption,
    usernameEncrypted,
    passwordEncrypted,
    fromName: parsed.data.fromName.trim(),
    fromEmail: parsed.data.fromEmail.trim().toLowerCase(),
    replyTo: parsed.data.replyTo?.trim().toLowerCase() ?? null,
    verifiedAt: null,
    updatedAt: new Date(),
  };
  await db
    .insert(tenantSendingConfigurationTable)
    .values(values)
    .onConflictDoUpdate({
      target: tenantSendingConfigurationTable.userId,
      set: {
        provider: values.provider,
        host: values.host,
        port: values.port,
        encryption: values.encryption,
        usernameEncrypted: values.usernameEncrypted,
        passwordEncrypted: values.passwordEncrypted,
        fromName: values.fromName,
        fromEmail: values.fromEmail,
        replyTo: values.replyTo,
        verifiedAt: null,
        updatedAt: values.updatedAt,
      },
    });

  const [saved] = await db
    .select()
    .from(tenantSendingConfigurationTable)
    .where(eq(tenantSendingConfigurationTable.userId, userId));
  res.json(
    UpdateTenantSendingSettingsResponse.parse(sendingSettingsResponse(saved)),
  );
});

router.post(
  "/sending/settings/test",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = TestTenantSendingSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter a valid destination email.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const userId = req.authUser!.id;
    const [config] = await db
      .select()
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, userId));
    if (!config) {
      res.status(400).json({
        error: "Save your sending settings before sending a test.",
        code: "SMTP_NOT_CONFIGURED",
      });
      return;
    }

    try {
      const result = await sendTenantEmail(
        config,
        parsed.data.toEmail,
        "Mailflow sender identity test",
        "Your tenant sending identity is working.",
      );
      if (!result.accepted) {
        res.status(502).json({
          error: result.error ?? "The SMTP server did not accept the test message.",
          code: "SMTP_TEST_FAILED",
        });
        return;
      }
      const verifiedAt = new Date();
      await db
        .update(tenantSendingConfigurationTable)
        .set({ verifiedAt, updatedAt: verifiedAt })
        .where(eq(tenantSendingConfigurationTable.userId, userId));
      res.json(
        TestTenantSendingSettingsResponse.parse({
          message:
            "The SMTP server accepted the test message; inbox delivery is not confirmed.",
          verifiedAt,
        }),
      );
    } catch (error) {
      req.log.warn(
        {
          userId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Tenant SMTP test send failed",
      );
      res.status(502).json({
        error: "The test message could not be sent. Verify your SMTP host and credentials.",
        code: "SMTP_TEST_FAILED",
      });
    }
  },
);

router.get("/contacts", requireUserRole, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;
  const [contacts, quota, memberships, emailHistory] = await Promise.all([
    db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId))
      .orderBy(desc(contactsTable.createdAt)),
    getContactQuota(userId),
    db
      .select({
        contactId: contactListMembersTable.contactId,
        listId: contactListMembersTable.listId,
      })
      .from(contactListMembersTable)
      .where(eq(contactListMembersTable.userId, userId)),
    getTenantContactEmailHistory(userId),
  ]);
  const uploadSettings = await getPlatformSettings();
  const listIdsByContact = new Map<string, string[]>();
  for (const membership of memberships) {
    const current = listIdsByContact.get(membership.contactId) ?? [];
    current.push(membership.listId);
    listIdsByContact.set(membership.contactId, current);
  }
  const lastEmailByContact = new Map<
    string,
    (typeof emailHistory)[number]
  >();
  for (const email of emailHistory) {
    if (email.contactId && !lastEmailByContact.has(email.contactId)) {
      lastEmailByContact.set(email.contactId, email);
    }
  }
  res.json(
    ListContactsResponse.parse({
      contacts: contacts.map((contact) => ({
        ...contact,
        name:
          [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
          contact.name,
        listIds: listIdsByContact.get(contact.id) ?? [],
        lastEmail: (() => {
          const email = lastEmailByContact.get(contact.id);
          if (!email) return null;
          return {
            id: email.id,
            campaignId: email.campaignId,
            campaignName: email.campaignName,
            subject: email.subject,
            status: email.status,
            attempts: email.attempts,
            lastAttemptAt: email.lastAttemptAt,
            deliveredAt: email.deliveredAt,
            reportOutcome: email.reportOutcome,
            reportSource: email.reportSource,
            reportEvidenceVerification:
              email.reportEvidenceVerification ??
              (email.reportOutcome === "unconfirmed" ? null : "user_imported"),
            reportDiagnostic: email.reportDiagnostic,
            reportAt: email.reportAt,
            lastError: email.lastError,
            messageId: email.messageId,
            smtpResponse: email.smtpResponse,
          };
        })(),
      })),
      quota,
      uploadSettings: {
        maxFileSizeMb: uploadSettings.maxUploadFileSizeMb,
        allowedFileTypes: uploadSettings.allowedContactFileTypes,
      },
    }),
  );
});

router.get(
  "/contacts/:contactId/email-history",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = GetContactEmailHistoryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid contact identifier.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const [contact] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, params.data.contactId),
          eq(contactsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "Contact not found.", code: "CONTACT_NOT_FOUND" });
      return;
    }
    const history = await getTenantContactEmailHistory(
      userId,
      params.data.contactId,
    );
    res.json(
      GetContactEmailHistoryResponse.parse(
        history.map((email) => ({
          id: email.id,
          campaignId: email.campaignId,
          campaignName: email.campaignName,
          subject: email.subject,
          status: email.status,
          attempts: email.attempts,
          lastAttemptAt: email.lastAttemptAt,
          deliveredAt: email.deliveredAt,
          reportOutcome: email.reportOutcome,
          reportSource: email.reportSource,
          reportEvidenceVerification:
            email.reportEvidenceVerification ??
            (email.reportOutcome === "unconfirmed" ? null : "user_imported"),
          reportDiagnostic: email.reportDiagnostic,
          reportAt: email.reportAt,
          lastError: email.lastError,
          messageId: email.messageId,
          smtpResponse: email.smtpResponse,
        })),
      ),
    );
  },
);

router.post("/contacts", requireUserRole, async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(normalizedContactInput(req.body));
  if (!parsed.success) {
    res.status(400).json({ error: "Some contact details are invalid.", code: "INVALID_INPUT" });
    return;
  }
  const userId = req.authUser!.id;
  const listIds = parsed.data.listIds ?? [];
  const firstName = parsed.data.firstName;
  const lastName = parsed.data.lastName;
  const name = `${firstName} ${lastName}`;
  const email = parsed.data.email.toLowerCase();
  const subscribed = parsed.data.subscribed ?? true;
  const settings = await getPlatformSettings();
  if (!(await isValidTenantListSelection(userId, listIds))) {
    res.status(400).json({
      error: "Choose only contact lists from your workspace.",
      code: "INVALID_CONTACT_LIST",
    });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [lockedUser] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)
      .for("update");
    if (!lockedUser) return { kind: "user_missing" as const };

    const now = new Date();
    const [activeSubscription] = await tx
      .select({ contactLimit: subscriptionPackagesTable.contactLimit })
      .from(userSubscriptionsTable)
      .innerJoin(
        subscriptionPackagesTable,
        eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
      )
      .where(
        and(
          eq(userSubscriptionsTable.userId, userId),
          eq(userSubscriptionsTable.status, "active"),
          lte(userSubscriptionsTable.startsAt, now),
          gt(userSubscriptionsTable.endsAt, now),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1);
    if (!activeSubscription && !settings.allowUserWithoutSubscription) {
      return { kind: "subscription_required" as const };
    }
    const contactLimit = Math.min(
      activeSubscription?.contactLimit ?? settings.maxContactsPerUser,
      settings.maxContactsPerUser,
    );
    const [duplicate] = await tx
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.userId, userId),
          eq(contactsTable.email, email),
        ),
      )
      .limit(1);
    if (duplicate) return { kind: "duplicate" as const };

    const [{ value: used }] = await tx
      .select({ value: count() })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId));
    if (Number(used) >= contactLimit) {
      return { kind: "limit_reached" as const };
    }

    const [created] = await tx
      .insert(contactsTable)
      .values({
        userId,
        name,
        email,
        firstName,
        lastName,
        companyName: optionalContactValue(parsed.data.companyName),
        linkedinUrl: optionalContactValue(parsed.data.linkedinUrl),
        phoneNumber: optionalContactValue(parsed.data.phoneNumber),
        subscribed,
      })
      .onConflictDoNothing({
        target: [contactsTable.userId, contactsTable.email],
      })
      .returning();
    if (!created) return { kind: "duplicate" as const };
    if (listIds.length > 0) {
      await tx.insert(contactListMembersTable).values(
        listIds.map((listId) => ({
          userId,
          listId,
          contactId: created.id,
        })),
      );
    }
    return { kind: "created" as const, contact: created };
  });
  if (result.kind === "user_missing") {
    res.status(401).json({
      error: "Please sign in to continue.",
      code: "UNAUTHENTICATED",
    });
    return;
  }
  if (result.kind === "subscription_required") {
    res.status(403).json({
      error: "An active subscription is required to add contacts.",
      code: "SUBSCRIPTION_REQUIRED",
    });
    return;
  }
  if (result.kind === "limit_reached") {
    res.status(409).json({
      error: "Your workspace contact limit has been reached.",
      code: "CONTACT_LIMIT_REACHED",
    });
    return;
  }
  if (result.kind === "duplicate") {
    res.status(409).json({
      error: "A contact with this email already exists in your workspace.",
      code: "CONTACT_ALREADY_EXISTS",
    });
    return;
  }
  res.status(201).json(
    CreateContactResponse.parse(
      await getContactPayload(userId, result.contact),
    ),
  );
});

router.post(
  "/contacts/import",
  requireUserRole,
  async (req, res): Promise<void> => {
    const requestBody =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? {
            ...(req.body as Record<string, unknown>),
            contacts: Array.isArray((req.body as Record<string, unknown>).contacts)
              ? ((req.body as Record<string, unknown>).contacts as unknown[]).map(
                  normalizedContactInput,
                )
              : (req.body as Record<string, unknown>).contacts,
          }
        : req.body;
    const parsed = ImportContactsBody.safeParse(requestBody);
    if (!parsed.success) {
      res.status(400).json({
        error: "Provide between 1 and 200 contact rows with valid row numbers.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const rows = parsed.data.contacts.map((row) => {
      const { rowNumber, ...contactInput } = row;
      const validated = CreateContactBody.safeParse(contactInput);
      return validated.success
        ? { valid: true as const, rowNumber, data: validated.data }
        : {
            valid: false as const,
            rowNumber,
            reason: validated.error.issues
              .map((issue) => `${issue.path.join(".") || "contact"}: ${issue.message}`)
              .join("; "),
          };
    });
    const userId = req.authUser!.id;
    const settings = await getPlatformSettings();
    const result = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)
        .for("update");
      if (!lockedUser) return { kind: "user_missing" as const };

      const now = new Date();
      const [activeSubscription] = await tx
        .select({ contactLimit: subscriptionPackagesTable.contactLimit })
        .from(userSubscriptionsTable)
        .innerJoin(
          subscriptionPackagesTable,
          eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
        )
        .where(
          and(
            eq(userSubscriptionsTable.userId, userId),
            eq(userSubscriptionsTable.status, "active"),
            lte(userSubscriptionsTable.startsAt, now),
            gt(userSubscriptionsTable.endsAt, now),
          ),
        )
        .orderBy(desc(userSubscriptionsTable.endsAt))
        .limit(1);
      if (!activeSubscription && !settings.allowUserWithoutSubscription) {
        return { kind: "subscription_required" as const };
      }

      const limit = Math.min(
        activeSubscription?.contactLimit ?? settings.maxContactsPerUser,
        settings.maxContactsPerUser,
      );
      const [{ value: initialUsed }] = await tx
        .select({ value: count() })
        .from(contactsTable)
        .where(eq(contactsTable.userId, userId));
      let used = Number(initialUsed);
      let imported = 0;
      let duplicate = 0;
      let invalid = 0;
      let limitReached = 0;
      const issues: { rowNumber: number; reason: string }[] = [];

      for (const row of rows) {
        if (!row.valid) {
          invalid += 1;
          issues.push({ rowNumber: row.rowNumber, reason: row.reason });
          continue;
        }
        const { data } = row;
        const email = data.email.toLowerCase();
        const listIds = data.listIds ?? [];
        const uniqueListIds = [...new Set(listIds)];
        if (uniqueListIds.length !== listIds.length) {
          invalid += 1;
          issues.push({
            rowNumber: row.rowNumber,
            reason: "A contact cannot be added to the same list more than once.",
          });
          continue;
        }
        if (uniqueListIds.length > 0) {
          const tenantLists = await tx
            .select({ id: contactListsTable.id })
            .from(contactListsTable)
            .where(
              and(
                eq(contactListsTable.userId, userId),
                inArray(contactListsTable.id, uniqueListIds),
              ),
            );
          if (tenantLists.length !== uniqueListIds.length) {
            invalid += 1;
            issues.push({
              rowNumber: row.rowNumber,
              reason: "Choose only contact lists from your workspace.",
            });
            continue;
          }
        }

        const [existing] = await tx
          .select({ id: contactsTable.id })
          .from(contactsTable)
          .where(
            and(
              eq(contactsTable.userId, userId),
              eq(contactsTable.email, email),
            ),
          )
          .limit(1);
        if (existing) {
          duplicate += 1;
          issues.push({
            rowNumber: row.rowNumber,
            reason: "A contact with this email already exists in your workspace.",
          });
          continue;
        }
        if (used >= limit) {
          limitReached += 1;
          issues.push({
            rowNumber: row.rowNumber,
            reason: "The workspace contact limit has been reached.",
          });
          continue;
        }

        const firstName = data.firstName;
        const lastName = data.lastName;
        const [created] = await tx
          .insert(contactsTable)
          .values({
            userId,
            name: `${firstName} ${lastName}`,
            email,
            firstName,
            lastName,
            companyName: optionalContactValue(data.companyName),
            linkedinUrl: optionalContactValue(data.linkedinUrl),
            phoneNumber: optionalContactValue(data.phoneNumber),
            subscribed: data.subscribed ?? false,
          })
          .onConflictDoNothing({
            target: [contactsTable.userId, contactsTable.email],
          })
          .returning();
        if (!created) {
          duplicate += 1;
          issues.push({
            rowNumber: row.rowNumber,
            reason: "A contact with this email already exists in your workspace.",
          });
          continue;
        }
        if (uniqueListIds.length > 0) {
          await tx.insert(contactListMembersTable).values(
            uniqueListIds.map((listId) => ({
              userId,
              listId,
              contactId: created.id,
            })),
          );
        }
        imported += 1;
        used += 1;
      }

      return {
        kind: "imported" as const,
        imported,
        duplicate,
        invalid,
        limitReached,
        issues,
        quota: {
          used,
          limit,
          remaining: Math.max(0, limit - used),
          canAdd: used < limit,
          requiresSubscription: false,
        },
      };
    });

    if (result.kind === "user_missing") {
      res.status(401).json({
        error: "Please sign in to continue.",
        code: "UNAUTHENTICATED",
      });
      return;
    }
    if (result.kind === "subscription_required") {
      res.status(403).json({
        error: "An active subscription is required to add contacts.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }
    res.json(
      ImportContactsResponse.parse({
        imported: result.imported,
        duplicate: result.duplicate,
        invalid: result.invalid,
        limitReached: result.limitReached,
        issues: result.issues,
        quota: result.quota,
      }),
    );
  },
);

router.patch(
  "/contacts/:contactId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = UpdateContactParams.safeParse(req.params);
    const parsed = UpdateContactBody.safeParse(normalizedContactInput(req.body));
    if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
      res.status(400).json({ error: "Some contact details are invalid.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    if (
      parsed.data.listIds &&
      !(await isValidTenantListSelection(userId, parsed.data.listIds))
    ) {
      res.status(400).json({
        error: "Choose only contact lists from your workspace.",
        code: "INVALID_CONTACT_LIST",
      });
      return;
    }
    if (parsed.data.email) {
      const [duplicate] = await db
        .select({ id: contactsTable.id })
        .from(contactsTable)
        .where(
          and(
            eq(contactsTable.userId, userId),
            eq(contactsTable.email, parsed.data.email.toLowerCase()),
            ne(contactsTable.id, params.data.contactId),
          ),
        )
        .limit(1);
      if (duplicate) {
        res.status(409).json({
          error: "A contact with this email already exists in your workspace.",
          code: "CONTACT_EXISTS",
        });
        return;
      }
    }

    const updateResult = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: contactsTable.id,
          name: contactsTable.name,
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
        })
        .from(contactsTable)
        .where(
          and(
            eq(contactsTable.id, params.data.contactId),
            eq(contactsTable.userId, userId),
          ),
        )
        .for("update");
      if (!existing) return null;
      const firstName = parsed.data.firstName ?? existing.firstName;
      const lastName = parsed.data.lastName ?? existing.lastName;
      const [updated] = await tx
        .update(contactsTable)
        .set({
          name: `${firstName} ${lastName}`.trim() || existing.name,
          ...(parsed.data.email
            ? { email: parsed.data.email.toLowerCase() }
            : {}),
          firstName,
          lastName,
          ...(parsed.data.companyName !== undefined
            ? { companyName: optionalContactValue(parsed.data.companyName) }
            : {}),
          ...(parsed.data.linkedinUrl !== undefined
            ? { linkedinUrl: optionalContactValue(parsed.data.linkedinUrl) }
            : {}),
          ...(parsed.data.phoneNumber !== undefined
            ? { phoneNumber: optionalContactValue(parsed.data.phoneNumber) }
            : {}),
          ...(parsed.data.subscribed !== undefined
            ? { subscribed: parsed.data.subscribed }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(contactsTable.id, params.data.contactId),
            eq(contactsTable.userId, userId),
          ),
        )
        .returning();
      if (!updated) return null;
      if (parsed.data.listIds !== undefined) {
        await tx
          .delete(contactListMembersTable)
          .where(
            and(
              eq(contactListMembersTable.userId, userId),
              eq(contactListMembersTable.contactId, updated.id),
            ),
          );
        if (parsed.data.listIds.length > 0) {
          await tx.insert(contactListMembersTable).values(
            parsed.data.listIds.map((listId) => ({
              userId,
              listId,
              contactId: updated.id,
            })),
          );
        }
      }
      const suppressed =
        parsed.data.subscribed === false
          ? await tx
              .update(emailCampaignRecipientsTable)
              .set({
                status: "suppressed",
                lastError: "Contact unsubscribed before delivery.",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(emailCampaignRecipientsTable.userId, userId),
                  eq(emailCampaignRecipientsTable.contactId, updated.id),
                  eq(emailCampaignRecipientsTable.status, "queued"),
                ),
              )
              .returning({
                campaignId: emailCampaignRecipientsTable.campaignId,
              })
          : [];
      return {
        contact: updated,
        campaignIds: suppressed.map((recipient) => recipient.campaignId),
      };
    });
    if (!updateResult) {
      res.status(404).json({ error: "Contact not found.", code: "CONTACT_NOT_FOUND" });
      return;
    }
    for (const campaignId of new Set(updateResult.campaignIds)) {
      await completeCampaignIfFinished(userId, campaignId);
    }
    res.json(
      UpdateContactResponse.parse(
        await getContactPayload(userId, updateResult.contact),
      ),
    );
  },
);

router.delete(
  "/contacts/:contactId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = DeleteContactParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid contact identifier.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const [contact] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, params.data.contactId),
          eq(contactsTable.userId, userId),
        ),
      );
    if (!contact) {
      res.status(404).json({ error: "Contact not found.", code: "CONTACT_NOT_FOUND" });
      return;
    }
    const affectedCampaignIds = await db.transaction(async (tx) => {
      const affected = await tx
        .update(emailCampaignRecipientsTable)
        .set({
          status: "suppressed",
          lastError: "The contact was deleted before this campaign could send.",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(emailCampaignRecipientsTable.userId, userId),
            eq(emailCampaignRecipientsTable.contactId, contact.id),
            eq(emailCampaignRecipientsTable.status, "queued"),
          ),
        )
        .returning({ campaignId: emailCampaignRecipientsTable.campaignId });
      await tx
        .delete(contactsTable)
        .where(
          and(
            eq(contactsTable.id, contact.id),
            eq(contactsTable.userId, userId),
          ),
        );
      return affected.map((recipient) => recipient.campaignId);
    });
    for (const campaignId of new Set(affectedCampaignIds)) {
      await completeCampaignIfFinished(userId, campaignId);
    }
    res.status(204).json(DeleteContactResponse.parse(undefined));
  },
);

router.get("/contact-lists", requireUserRole, async (req, res): Promise<void> => {
  const lists = await contactListPayloads(req.authUser!.id);
  res.json(ListContactListsResponse.parse(lists));
});

router.post("/contact-lists", requireUserRole, async (req, res): Promise<void> => {
  const parsed = CreateContactListBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid contact list name.", code: "INVALID_INPUT" });
    return;
  }
  const [list] = await db
    .insert(contactListsTable)
    .values({
      userId: req.authUser!.id,
      name: parsed.data.name.trim(),
    })
    .onConflictDoNothing({
      target: [contactListsTable.userId, contactListsTable.name],
    })
    .returning();
  if (!list) {
    res.status(409).json({
      error: "A contact list with this name already exists.",
      code: "CONTACT_LIST_EXISTS",
    });
    return;
  }
  res.status(201).json(
    CreateContactListResponse.parse({ ...list, contactCount: 0 }),
  );
});

router.patch(
  "/contact-lists/:listId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = UpdateContactListParams.safeParse(req.params);
    const parsed = UpdateContactListBody.safeParse(req.body);
    if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
      res.status(400).json({ error: "Enter valid contact list changes.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    if (parsed.data.name) {
      const [duplicate] = await db
        .select({ id: contactListsTable.id })
        .from(contactListsTable)
        .where(
          and(
            eq(contactListsTable.userId, userId),
            eq(contactListsTable.name, parsed.data.name.trim()),
            ne(contactListsTable.id, params.data.listId),
          ),
        )
        .limit(1);
      if (duplicate) {
        res.status(409).json({
          error: "A contact list with this name already exists.",
          code: "CONTACT_LIST_EXISTS",
        });
        return;
      }
    }
    const [updated] = await db
      .update(contactListsTable)
      .set({
        ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.active !== undefined
          ? { active: parsed.data.active }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contactListsTable.id, params.data.listId),
          eq(contactListsTable.userId, userId),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({
        error: "Contact list not found.",
        code: "CONTACT_LIST_NOT_FOUND",
      });
      return;
    }
    const [members] = await db
      .select({ value: count() })
      .from(contactListMembersTable)
      .where(
        and(
          eq(contactListMembersTable.userId, userId),
          eq(contactListMembersTable.listId, updated.id),
        ),
      );
    res.json(
      UpdateContactListResponse.parse({
        ...updated,
        contactCount: members?.value ?? 0,
      }),
    );
  },
);

router.delete(
  "/contact-lists/:listId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = DeleteContactListParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid contact list identifier.", code: "INVALID_INPUT" });
      return;
    }
    const [deleted] = await db
      .delete(contactListsTable)
      .where(
        and(
          eq(contactListsTable.id, params.data.listId),
          eq(contactListsTable.userId, req.authUser!.id),
        ),
      )
      .returning({ id: contactListsTable.id });
    if (!deleted) {
      res.status(404).json({
        error: "Contact list not found.",
        code: "CONTACT_LIST_NOT_FOUND",
      });
      return;
    }
    res.status(204).json(DeleteContactListResponse.parse(undefined));
  },
);

router.get("/campaigns", requireUserRole, async (req, res): Promise<void> => {
  res.json(ListCampaignsResponse.parse(await campaignPayloads(req.authUser!.id)));
});

router.post(
  "/campaigns/preview",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = PreviewCampaignBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Some campaign preview details are invalid.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const userId = req.authUser!.id;
    const [list] = await db
      .select({ id: contactListsTable.id })
      .from(contactListsTable)
      .where(
        and(
          eq(contactListsTable.id, parsed.data.listId),
          eq(contactListsTable.userId, userId),
          eq(contactListsTable.active, true),
        ),
      );
    if (!list) {
      res.status(400).json({
        error: "Choose an active contact list from your workspace.",
        code: "INVALID_CONTACT_LIST",
      });
      return;
    }

    const [contact] = await db
      .select({
        email: contactsTable.email,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        name: contactsTable.name,
        companyName: contactsTable.companyName,
        linkedinUrl: contactsTable.linkedinUrl,
        phoneNumber: contactsTable.phoneNumber,
      })
      .from(contactListMembersTable)
      .innerJoin(
        contactsTable,
        eq(contactsTable.id, contactListMembersTable.contactId),
      )
      .where(
        and(
          eq(contactListMembersTable.userId, userId),
          eq(contactListMembersTable.listId, list.id),
          eq(contactListMembersTable.contactId, parsed.data.contactId),
          eq(contactsTable.userId, userId),
          eq(contactsTable.subscribed, true),
        ),
      )
      .limit(1);
    if (!contact) {
      res.status(404).json({
        error: "Choose a subscribed contact in the selected list.",
        code: "CAMPAIGN_PREVIEW_CONTACT_NOT_FOUND",
      });
      return;
    }

    const rendered = renderCampaignForContact(
      parsed.data,
      {
        firstName: contact.firstName,
        lastName: contact.lastName,
        fullName:
          [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
          contact.name ||
          "",
        email: contact.email,
        companyName: contact.companyName ?? "",
        phoneNumber: contact.phoneNumber ?? "",
        linkedinUrl: contact.linkedinUrl ?? "",
      },
    );
    res.json(PreviewCampaignResponse.parse(rendered));
  },
);

router.get(
  "/campaigns/:campaignId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = GetCampaignDashboardParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Invalid campaign identifier.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const userId = req.authUser!.id;
    const [campaign] = (await campaignPayloads(userId)).filter(
      (item) => item.id === params.data.campaignId,
    );
    if (!campaign) {
      res.status(404).json({
        error: "Campaign not found.",
        code: "CAMPAIGN_NOT_FOUND",
      });
      return;
    }

    let targetList: {
      id: string;
      name: string;
      active: boolean;
      totalContacts: number;
      eligibleContacts: number;
      unsubscribedContacts: number;
    } | null = null;
    if (campaign.listId) {
      const [list] = await db
        .select({
          id: contactListsTable.id,
          name: contactListsTable.name,
          active: contactListsTable.active,
        })
        .from(contactListsTable)
        .where(
          and(
            eq(contactListsTable.id, campaign.listId),
            eq(contactListsTable.userId, userId),
          ),
        );
      if (list) {
        const [total, eligible] = await Promise.all([
          db
            .select({ value: count() })
            .from(contactListMembersTable)
            .where(
              and(
                eq(contactListMembersTable.userId, userId),
                eq(contactListMembersTable.listId, list.id),
              ),
            ),
          db
            .select({ value: count() })
            .from(contactListMembersTable)
            .innerJoin(
              contactsTable,
              and(
                eq(contactsTable.id, contactListMembersTable.contactId),
                eq(contactsTable.userId, contactListMembersTable.userId),
              ),
            )
            .where(
              and(
                eq(contactListMembersTable.userId, userId),
                eq(contactListMembersTable.listId, list.id),
                eq(contactsTable.subscribed, true),
              ),
            ),
        ]);
        const totalContacts = total[0]?.value ?? 0;
        const eligibleContacts = eligible[0]?.value ?? 0;
        targetList = {
          ...list,
          totalContacts,
          eligibleContacts,
          unsubscribedContacts: Math.max(0, totalContacts - eligibleContacts),
        };
      }
    }

    const settings = await getPlatformSettings();
    const remainingEmails =
      campaign.status === "draft"
        ? (targetList?.eligibleContacts ?? 0)
        : campaign.status === "completed"
          ? 0
          : campaign.queued;
    const now = new Date();
    const estimatedDurationSeconds =
      campaign.status === "completed"
        ? 0
        : campaign.estimatedDurationSeconds;
    const estimatedCompletionAt =
      remainingEmails > 0 && campaign.status !== "completed"
        ? new Date(now.getTime() + estimatedDurationSeconds * 1000)
        : null;

    res.json(
      GetCampaignDashboardResponse.parse({
        campaign,
        targetList,
        pacing: {
          emailsPerHour: settings.defaultEmailsPerHour,
          emailsPerDay: settings.maxEmailsPerDay,
          maxCampaignSize: settings.maxCampaignSize,
          minimumSpacingSeconds:
            getMinimumEmailSpacingSeconds(settings),
          remainingEmails,
          estimatedDurationSeconds,
          estimatedCompletionAt,
        },
      }),
    );
  },
);

router.post("/campaigns", requireUserRole, async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Some campaign details are invalid.", code: "INVALID_INPUT" });
    return;
  }
  const userId = req.authUser!.id;
  const [list] = await db
    .select({ id: contactListsTable.id })
    .from(contactListsTable)
    .where(
      and(
        eq(contactListsTable.id, parsed.data.listId),
        eq(contactListsTable.userId, userId),
        eq(contactListsTable.active, true),
      ),
    );
  if (!list) {
    res.status(400).json({
      error: "Choose an active contact list from your workspace.",
      code: "INVALID_CONTACT_LIST",
    });
    return;
  }
  const [campaign] = await db
    .insert(emailCampaignsTable)
    .values({
      userId,
      listId: list.id,
      name: parsed.data.name.trim(),
      subject: parsed.data.subject.trim(),
      textBody: parsed.data.textBody,
      htmlBody: parsed.data.htmlBody
        ? sanitizeCampaignHtml(parsed.data.htmlBody)
        : null,
    })
    .returning();
  const [summary] = (await campaignPayloads(userId)).filter(
    (item) => item.id === campaign.id,
  );
  res.status(201).json(CreateCampaignResponse.parse(summary));
});

router.patch(
  "/campaigns/:campaignId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = UpdateCampaignParams.safeParse(req.params);
    const parsed = UpdateCampaignBody.safeParse(req.body);
    if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
      res.status(400).json({ error: "Some campaign changes are invalid.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    if (parsed.data.listId) {
      const [list] = await db
        .select({ id: contactListsTable.id })
        .from(contactListsTable)
        .where(
          and(
            eq(contactListsTable.id, parsed.data.listId),
            eq(contactListsTable.userId, userId),
            eq(contactListsTable.active, true),
          ),
        );
      if (!list) {
        res.status(400).json({
          error: "Choose an active contact list from your workspace.",
          code: "INVALID_CONTACT_LIST",
        });
        return;
      }
    }
    const [updated] = await db
      .update(emailCampaignsTable)
      .set({
        ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.subject ? { subject: parsed.data.subject.trim() } : {}),
        ...(parsed.data.textBody !== undefined
          ? { textBody: parsed.data.textBody }
          : {}),
        ...(parsed.data.htmlBody !== undefined
          ? {
              htmlBody: parsed.data.htmlBody
                ? sanitizeCampaignHtml(parsed.data.htmlBody)
                : null,
            }
          : {}),
        ...(parsed.data.listId ? { listId: parsed.data.listId } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emailCampaignsTable.id, params.data.campaignId),
          eq(emailCampaignsTable.userId, userId),
          eq(emailCampaignsTable.status, "draft"),
        ),
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select({ id: emailCampaignsTable.id })
        .from(emailCampaignsTable)
        .where(
          and(
            eq(emailCampaignsTable.id, params.data.campaignId),
            eq(emailCampaignsTable.userId, userId),
          ),
        );
      if (!existing) {
        res.status(404).json({ error: "Campaign not found.", code: "CAMPAIGN_NOT_FOUND" });
      } else {
        res.status(409).json({
          error: "Only draft campaigns can be edited.",
          code: "CAMPAIGN_NOT_EDITABLE",
        });
      }
      return;
    }
    const [summary] = (await campaignPayloads(userId)).filter(
      (campaign) => campaign.id === updated.id,
    );
    res.json(UpdateCampaignResponse.parse(summary));
  },
);

router.delete(
  "/campaigns/:campaignId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = DeleteCampaignParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid campaign identifier.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const [deleted] = await db
      .delete(emailCampaignsTable)
      .where(
        and(
          eq(emailCampaignsTable.id, params.data.campaignId),
          eq(emailCampaignsTable.userId, userId),
          eq(emailCampaignsTable.status, "draft"),
        ),
      )
      .returning({ id: emailCampaignsTable.id });
    if (!deleted) {
      const [existing] = await db
        .select({ id: emailCampaignsTable.id })
        .from(emailCampaignsTable)
        .where(
          and(
            eq(emailCampaignsTable.id, params.data.campaignId),
            eq(emailCampaignsTable.userId, userId),
          ),
        );
      if (!existing) {
        res.status(404).json({ error: "Campaign not found.", code: "CAMPAIGN_NOT_FOUND" });
      } else {
        res.status(409).json({
          error: "Only draft campaigns can be deleted.",
          code: "CAMPAIGN_NOT_DELETABLE",
        });
      }
      return;
    }
    res.status(204).json(DeleteCampaignResponse.parse(undefined));
  },
);

router.post(
  "/campaigns/:campaignId/send",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = SendCampaignParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid campaign identifier.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const settings = await getPlatformSettings();
    const outcome = await db.transaction(async (tx) => {
      await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .for("update");
      const [campaign] = await tx
        .select()
        .from(emailCampaignsTable)
        .where(
          and(
            eq(emailCampaignsTable.id, params.data.campaignId),
            eq(emailCampaignsTable.userId, userId),
          ),
        )
        .for("update");
      if (!campaign) return { error: "not_found" as const };
      if (campaign.status !== "draft") return { error: "not_draft" as const };

      const [sender] = await tx
        .select()
        .from(tenantSendingConfigurationTable)
        .where(eq(tenantSendingConfigurationTable.userId, userId))
        .for("update");
      if (!sender?.verifiedAt) return { error: "sender_not_ready" as const };
      if (!campaign.listId) return { error: "list_missing" as const };

      const [list] = await tx
        .select()
        .from(contactListsTable)
        .where(
          and(
            eq(contactListsTable.id, campaign.listId),
            eq(contactListsTable.userId, userId),
            eq(contactListsTable.active, true),
          ),
        );
      if (!list) return { error: "list_missing" as const };

      const [running] = await tx
        .select({ value: count() })
        .from(emailCampaignsTable)
        .where(
          and(
            eq(emailCampaignsTable.userId, userId),
            inArray(emailCampaignsTable.status, ["queued", "sending"]),
          ),
        );
      if ((running?.value ?? 0) >= settings.maxConcurrentCampaigns) {
        return { error: "concurrency_limit" as const };
      }

      const recipients = await tx
        .select({
          id: contactsTable.id,
          email: contactsTable.email,
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
        })
        .from(contactListMembersTable)
        .innerJoin(
          contactsTable,
          eq(contactsTable.id, contactListMembersTable.contactId),
        )
        .where(
          and(
            eq(contactListMembersTable.userId, userId),
            eq(contactListMembersTable.listId, list.id),
            eq(contactsTable.userId, userId),
            eq(contactsTable.subscribed, true),
          ),
        )
        .orderBy(asc(contactsTable.createdAt));
      if (recipients.length === 0) return { error: "empty_list" as const };
      if (recipients.length > settings.maxCampaignSize) {
        return { error: "campaign_size_limit" as const };
      }

      const [queuedCampaign] = await tx
        .update(emailCampaignsTable)
        .set({
          status: "queued",
          queuedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(emailCampaignsTable.id, campaign.id),
            eq(emailCampaignsTable.userId, userId),
            eq(emailCampaignsTable.status, "draft"),
          ),
        )
        .returning({ id: emailCampaignsTable.id });
      if (!queuedCampaign) return { error: "not_draft" as const };

      await tx.insert(emailCampaignRecipientsTable).values(
        recipients.map((recipient) => ({
          campaignId: campaign.id,
          userId,
          contactId: recipient.id,
          email: recipient.email,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
        })),
      );
      return { campaignId: campaign.id };
    });

    if ("error" in outcome) {
      if (outcome.error === "not_found") {
        res.status(404).json({ error: "Campaign not found.", code: "CAMPAIGN_NOT_FOUND" });
      } else if (outcome.error === "not_draft") {
        res.status(409).json({
          error: "Only draft campaigns can be queued.",
          code: "CAMPAIGN_NOT_SENDABLE",
        });
      } else if (outcome.error === "sender_not_ready") {
        res.status(400).json({
          error: "Save and successfully test your sending identity before sending a campaign.",
          code: "SENDER_NOT_READY",
        });
      } else if (outcome.error === "list_missing") {
        res.status(400).json({
          error: "Choose an active contact list from your workspace.",
          code: "INVALID_CONTACT_LIST",
        });
      } else if (outcome.error === "empty_list") {
        res.status(400).json({
          error: "The selected list has no subscribed contacts.",
          code: "EMPTY_CONTACT_LIST",
        });
      } else if (outcome.error === "campaign_size_limit") {
        res.status(429).json({
          error: "This campaign exceeds the platform campaign size limit.",
          code: "CAMPAIGN_SIZE_LIMIT",
        });
      } else {
        res.status(429).json({
          error: "Your workspace already has the maximum number of active campaigns.",
          code: "CONCURRENT_CAMPAIGN_LIMIT",
        });
      }
      return;
    }
    const [campaign] = (await campaignPayloads(userId)).filter(
      (item) => item.id === outcome.campaignId,
    );
    res.status(202).json(SendCampaignResponse.parse(campaign));
  },
);

router.get("/dashboard", requireUserRole, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;
  const settings = await getPlatformSettings();
  const now = new Date();
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const [
    { subscription },
    [contactCount],
    [listCount],
    [sender],
    [deliveredCount],
    [bouncedCount],
    [unknownCount],
    [hourlyCount],
  ] = await Promise.all([
    getCurrentSubscriptionForUser(userId),
    db
      .select({ value: count() })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId)),
    db
      .select({ value: count() })
      .from(contactListsTable)
      .where(
        and(
          eq(contactListsTable.userId, userId),
          eq(contactListsTable.active, true),
        ),
      ),
    db
      .select({ verifiedAt: tenantSendingConfigurationTable.verifiedAt })
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, userId)),
    db
      .select({ value: count() })
      .from(emailCampaignRecipientsTable)
      .where(
        and(
          eq(emailCampaignRecipientsTable.userId, userId),
          eq(emailCampaignRecipientsTable.status, "delivered"),
        ),
      ),
    db
      .select({ value: count() })
      .from(emailCampaignRecipientsTable)
      .where(
        and(
          eq(emailCampaignRecipientsTable.userId, userId),
          eq(emailCampaignRecipientsTable.status, "bounced"),
        ),
      ),
    db
      .select({ value: count() })
      .from(emailCampaignRecipientsTable)
      .where(
        and(
          eq(emailCampaignRecipientsTable.userId, userId),
          eq(emailCampaignRecipientsTable.status, "unknown"),
        ),
      ),
    db
      .select({ value: count() })
      .from(emailSendAttemptsTable)
      .where(
        and(
          eq(emailSendAttemptsTable.userId, userId),
          gte(emailSendAttemptsTable.attemptedAt, hourStart),
        ),
      ),
  ]);

  const contacts = contactCount?.value ?? 0;
  const activeLists = listCount?.value ?? 0;
  const delivered = deliveredCount?.value ?? 0;
  const bounced = bouncedCount?.value ?? 0;
  const unknown = unknownCount?.value ?? 0;
  const setupStepsCompleted =
    Number(req.authUser!.emailVerified) +
    Number(Boolean(sender?.verifiedAt)) +
    Number(contacts > 0) +
    Number(activeLists > 0);
  res.json(GetUserDashboardResponse.parse({
    subscriptionStatus:
      subscription?.status === "active"
        ? "active"
        : subscription?.status === "expired"
          ? "expired"
          : "inactive",
    contacts,
    activeLists,
    emailsSent: delivered + bounced + unknown,
    delivered,
    bounced,
    remainingThisHour: Math.max(
      0,
      settings.defaultEmailsPerHour - (hourlyCount?.value ?? 0),
    ),
    setupStepsCompleted,
    setupStepsTotal: 4,
  }));
});

export default router;