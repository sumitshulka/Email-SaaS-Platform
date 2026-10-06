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
  sql,
  sum,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCampaignBody,
  CreateCampaignResponse,
  CreateContactBody,
  CreateContactListBody,
  CreateContactListResponse,
  CreateContactSegmentBody,
  CreateContactSegmentResponse,
  CreateContactResponse,
  GetCampaignDashboardParams,
  GetCampaignDashboardResponse,
  GetCampaignRecipientSummaryQueryParams,
  GetCampaignRecipientSummaryResponse,
  GetContactParams,
  GetContactResponse,
  GetContactEmailHistoryParams,
  GetContactEmailHistoryResponse,
  DeleteCampaignParams,
  DeleteCampaignResponse,
  DeleteContactListParams,
  DeleteContactListResponse,
  DeleteContactSegmentParams,
  DeleteContactSegmentResponse,
  DeleteContactParams,
  DeleteContactResponse,
  GetTenantSendingSettingsResponse,
  GetUserDashboardResponse,
  ImportContactsBody,
  ImportContactsResponse,
  ListCampaignsResponse,
  ListContactListsResponse,
  ListContactSegmentsResponse,
  ListContactsResponse,
  PreviewCampaignBody,
  PreviewCampaignResponse,
  SendCampaignBody,
  SendCampaignParams,
  SendCampaignResponse,
  TestTenantSendingConnectionBody,
  TestTenantSendingConnectionResponse,
  TestTenantSendingSettingsBody,
  TestTenantSendingSettingsResponse,
  UpdateCampaignBody,
  UpdateCampaignParams,
  UpdateCampaignResponse,
  UpdateContactBody,
  UpdateContactListBody,
  UpdateContactListParams,
  UpdateContactListResponse,
  UpdateContactSegmentBody,
  UpdateContactSegmentParams,
  UpdateContactSegmentResponse,
  UpdateContactParams,
  UpdateContactResponse,
  UpdateTenantSendingSettingsBody,
  UpdateTenantSendingSettingsResponse,
} from "@workspace/api-zod";
import type { TenantSendingSettingsInput } from "@workspace/api-zod";
import {
  companiesTable,
  contactFieldKeys,
  contactFieldOptionsTable,
  contactListMembersTable,
  contactListsTable,
  contactSegmentsTable,
  contactsTable,
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  emailSendAttemptsTable,
  paymentsTable,
  subscriptionPackagesTable,
  tenantSendingConfigurationTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import type { ContactFieldKey } from "@workspace/db";
import {
  sendTenantEmail,
  verifyTenantEmailConnection,
  type TenantSendingEmailConfiguration,
} from "../lib/application-email";
import {
  renderCampaignForContact,
  sanitizeCampaignHtml,
} from "../lib/campaign-template";
import {
  summarizeCampaignAudience,
  uniqueCampaignRecipients,
} from "../lib/campaign-audience";
import { decryptSecret, encryptSecret } from "../lib/security";
import {
  estimateCampaignDeliveryAfterQueueSeconds,
  estimateCampaignQueueDeliverySeconds,
  getMinimumEmailSpacingSeconds,
  getPlatformSettings,
} from "../lib/platform-settings";
import { getCurrentSubscriptionForUser } from "../lib/billing";
import { requireUserRole } from "../lib/session";
import {
  companyDomainKey,
  companyProfileFields,
  companyProfileFrom,
  mergeCompatibleCompanyProfiles,
} from "../lib/company-profile";

const router: IRouter = Router();
const MASKED_CREDENTIAL = "••••••";
const contactEnrichmentFields = [
  "jobTitle",
  "department",
  "seniority",
  "mobilePhone",
  "websiteUrl",
  "twitterUrl",
  "facebookUrl",
  "instagramUrl",
  "location",
  "preferredLanguage",
  "timeZone",
  "lifecycleStage",
  "leadStatus",
  "leadSource",
  "interests",
  "goals",
  "painPoints",
  "personalizationContext",
  "notes",
  "companyWebsiteUrl",
  "companyDomain",
  "companyIndustry",
  "companySize",
  "companyRevenueRange",
  "companyDescription",
  "companyPhoneNumber",
  "companyLinkedinUrl",
  "companyLocation",
] as const;
const contactTextFields = [
  "email",
  "firstName",
  "lastName",
  "companyName",
  "linkedinUrl",
  "phoneNumber",
  ...contactEnrichmentFields,
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

type SendingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const normalizeContactOption = (value: string) => value.trim().toLowerCase();

async function getTenantContactOptionSet(
  tx: SendingTransaction,
  userId: string,
): Promise<Set<string>> {
  const options = await tx
    .select({
      field: contactFieldOptionsTable.fieldKey,
      normalizedValue: contactFieldOptionsTable.normalizedValue,
    })
    .from(contactFieldOptionsTable)
    .where(eq(contactFieldOptionsTable.userId, userId));
  return new Set(options.map(option => `${option.field}:${option.normalizedValue}`));
}

function isStandardTimeZone(value: string): boolean {
  if (value === "UTC") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function contactFieldValueIssue(
  input: Record<string, unknown>,
  optionSet: Set<string>,
  previous?: typeof contactsTable.$inferSelect,
  action: "save" | "import" = "save",
): { field: ContactFieldKey | "timeZone"; message: string } | null {
  for (const field of contactFieldKeys) {
    const value = input[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      return { field, message: `Choose a configured ${field} value.` };
    }
    if (previous?.[field] === value) continue;
    if (!optionSet.has(`${field}:${normalizeContactOption(value)}`)) {
      const suffix = action === "import" ? "before importing this row" : "before saving this contact";
      return {
        field,
        message: `Add "${value}" to Contact field settings ${suffix}.`,
      };
    }
  }
  const timeZone = input.timeZone;
  if (timeZone === undefined || timeZone === null || timeZone === "") return null;
  if (typeof timeZone !== "string" || (previous?.timeZone !== timeZone && !isStandardTimeZone(timeZone))) {
    return {
      field: "timeZone",
      message: "Choose a standard time zone before saving this contact.",
    };
  }
  return null;
}

function optionalContactValue(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function tenantSendingEmailConfiguration(
  userId: string,
  settings: TenantSendingSettingsInput,
  existing?: typeof tenantSendingConfigurationTable.$inferSelect,
): TenantSendingEmailConfiguration | null {
  const username =
    settings.username?.trim() ||
    (existing ? decryptSecret(existing.usernameEncrypted) : "");
  const password =
    settings.password?.trim() ||
    (existing ? decryptSecret(existing.passwordEncrypted) : "");
  if (!username || !password) return null;

  return {
    userId,
    provider: settings.provider,
    host: settings.host.trim(),
    port: settings.port,
    encryption: settings.encryption,
    usernameEncrypted:
      settings.username?.trim() || !existing
        ? encryptSecret(username)
        : existing.usernameEncrypted,
    passwordEncrypted:
      settings.password?.trim() || !existing
        ? encryptSecret(password)
        : existing.passwordEncrypted,
    fromName: settings.fromName.trim(),
    fromEmail: settings.fromEmail.trim().toLowerCase(),
    replyTo: optionalContactValue(settings.replyTo)?.toLowerCase() ?? null,
  };
}

function matchesSavedTenantSendingConfiguration(
  saved: typeof tenantSendingConfigurationTable.$inferSelect,
  tested: TenantSendingEmailConfiguration,
): boolean {
  return (
    saved.provider === tested.provider &&
    saved.host === tested.host &&
    saved.port === tested.port &&
    saved.encryption === tested.encryption &&
    decryptSecret(saved.usernameEncrypted) ===
      decryptSecret(tested.usernameEncrypted) &&
    decryptSecret(saved.passwordEncrypted) ===
      decryptSecret(tested.passwordEncrypted) &&
    saved.fromName === tested.fromName &&
    saved.fromEmail.toLowerCase() === tested.fromEmail.toLowerCase() &&
    (saved.replyTo?.toLowerCase() ?? null) ===
      (tested.replyTo?.toLowerCase() ?? null)
  );
}

function contactEnrichmentPatch(
  input: Record<string, unknown>,
  includeCompanyProfile = true,
): Partial<typeof contactsTable.$inferInsert> {
  const patch: Partial<typeof contactsTable.$inferInsert> = {};
  for (const field of contactEnrichmentFields) {
    if (!includeCompanyProfile && companyProfileFields.includes(field as (typeof companyProfileFields)[number])) continue;
    if (input[field] === undefined) continue;
    const value = input[field];
    if (value === null) {
      patch[field] = null;
    } else if (typeof value === "string") {
      patch[field] = value.trim() || null;
    }
  }
  return patch;
}

function clearLegacyCompanyProfile(): Partial<typeof contactsTable.$inferInsert> {
  return {
    companyName: null,
    companyWebsiteUrl: null,
    companyDomain: null,
    companyIndustry: null,
    companySize: null,
    companyRevenueRange: null,
    companyDescription: null,
    companyPhoneNumber: null,
    companyLinkedinUrl: null,
    companyLocation: null,
  };
}

function contactCompanyPatch(
  profile: ReturnType<typeof companyProfileFrom>,
): Partial<typeof contactsTable.$inferInsert> {
  return {
    companyName: profile.companyName,
    companyWebsiteUrl: profile.companyWebsiteUrl,
    companyDomain: profile.companyDomain,
    companyIndustry: profile.companyIndustry,
    companySize: profile.companySize,
    companyRevenueRange: profile.companyRevenueRange,
    companyDescription: profile.companyDescription,
    companyPhoneNumber: profile.companyPhoneNumber,
    companyLinkedinUrl: profile.companyLinkedinUrl,
    companyLocation: profile.companyLocation,
  };
}

function publicCompanyPayload(company: typeof companiesTable.$inferSelect) {
  const {
    userId: _userId,
    companyDomainKey: _companyDomainKey,
    ...publicCompany
  } = company;
  return publicCompany;
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
    connectionCheckStatus: config?.connectionCheckStatus ?? null,
    connectionCheckAt: config?.connectionCheckAt ?? null,
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
  const [memberships, companyRows] = await Promise.all([
    db
      .select({ listId: contactListMembersTable.listId })
      .from(contactListMembersTable)
      .where(
        and(
          eq(contactListMembersTable.userId, userId),
          eq(contactListMembersTable.contactId, contact.id),
        ),
      ),
    contact.companyId
      ? db
          .select()
          .from(companiesTable)
          .where(
            and(
              eq(companiesTable.id, contact.companyId),
              eq(companiesTable.userId, userId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    ...contact,
    company: companyRows[0] ? publicCompanyPayload(companyRows[0]) : null,
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
  activeOnly = false,
): Promise<boolean> {
  const uniqueIds = [...new Set(listIds)];
  if (uniqueIds.length !== listIds.length) return false;
  if (uniqueIds.length === 0) return true;
  const conditions = [
    eq(contactListsTable.userId, userId),
    inArray(contactListsTable.id, uniqueIds),
  ];
  if (activeOnly) conditions.push(eq(contactListsTable.active, true));
  const rows = await db
    .select({ id: contactListsTable.id })
    .from(contactListsTable)
    .where(and(...conditions));
  return rows.length === uniqueIds.length;
}

function campaignListIds(campaign: {
  listId?: string | null;
  listIds?: string[] | null;
}): string[] {
  const ids =
    campaign.listIds && campaign.listIds.length > 0
      ? campaign.listIds
      : campaign.listId
        ? [campaign.listId]
        : [];
  return [...new Set(ids)];
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
  const campaigns = await db
    .select()
    .from(emailCampaignsTable)
    .where(eq(emailCampaignsTable.userId, userId))
    .orderBy(desc(emailCampaignsTable.createdAt));
  const draftListIds = [
    ...new Set(
      campaigns
        .filter((campaign) => campaign.status === "draft")
        .flatMap(campaignListIds),
    ),
  ];
  const [recipients, eligibleMemberships, settings] = await Promise.all([
    db
      .select({
        campaignId: emailCampaignRecipientsTable.campaignId,
        status: emailCampaignRecipientsTable.status,
        nextAttemptAt: emailCampaignRecipientsTable.nextAttemptAt,
        createdAt: emailCampaignRecipientsTable.createdAt,
      })
      .from(emailCampaignRecipientsTable)
      .where(eq(emailCampaignRecipientsTable.userId, userId)),
    draftListIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            listId: contactListMembersTable.listId,
            email: contactsTable.email,
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
              inArray(contactListMembersTable.listId, draftListIds),
              eq(contactsTable.subscribed, true),
            ),
          ),
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
  return campaigns.map((campaign) => {
    const deliveryCounts = counts.get(campaign.id) ?? {
      recipients: 0,
      queued: 0,
      delivered: 0,
      bounced: 0,
      suppressed: 0,
      unknown: 0,
    };
    const listIds = campaignListIds(campaign);
    const eligibleAudience =
      campaign.status === "draft"
        ? summarizeCampaignAudience(eligibleMemberships, listIds)
        : null;
    const recipientCount =
      campaign.status === "draft"
        ? (eligibleAudience?.uniqueRecipients ?? 0)
        : deliveryCounts.recipients;
    const remainingRecipients =
      campaign.status === "draft"
        ? recipientCount
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
      listId: listIds[0] ?? campaign.listId ?? null,
      listIds,
      ...deliveryCounts,
      recipients: recipientCount,
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
    connectionCheckStatus: null,
    connectionCheckAt: null,
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
        connectionCheckStatus: null,
        connectionCheckAt: null,
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
  "/sending/settings/connection-test",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = TestTenantSendingConnectionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter valid SMTP and sender settings.",
        code: "INVALID_SENDING_SETTINGS",
      });
      return;
    }

    const userId = req.authUser!.id;
    const [existing] = await db
      .select()
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, userId));
    const config = tenantSendingEmailConfiguration(
      userId,
      parsed.data.settings,
      existing,
    );
    if (!config) {
      res.status(400).json({
        error: "Enter SMTP username and password before checking the connection.",
        code: "SMTP_CREDENTIALS_REQUIRED",
      });
      return;
    }

    const savedSettingsMatch = Boolean(
      existing && matchesSavedTenantSendingConfiguration(existing, config),
    );
    try {
      await verifyTenantEmailConnection(config);
      const checkedAt = new Date();
      if (savedSettingsMatch) {
        await db
          .update(tenantSendingConfigurationTable)
          .set({
            connectionCheckStatus: "success",
            connectionCheckAt: checkedAt,
          })
          .where(eq(tenantSendingConfigurationTable.userId, userId));
      }
      res.json(
        TestTenantSendingConnectionResponse.parse({
          message: savedSettingsMatch
            ? "Connection successful. SMTP authentication passed; no email was sent. The saved connection-check details were updated."
            : "Connection successful. SMTP authentication passed; no email was sent. Saved check details were unchanged because the tested values differ from saved settings.",
          checkedAt,
          savedSettingsUpdated: savedSettingsMatch,
        }),
      );
    } catch (error) {
      const checkedAt = new Date();
      if (savedSettingsMatch) {
        await db
          .update(tenantSendingConfigurationTable)
          .set({
            connectionCheckStatus: "failure",
            connectionCheckAt: checkedAt,
          })
          .where(eq(tenantSendingConfigurationTable.userId, userId));
      }
      req.log.warn(
        {
          userId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Tenant SMTP connection check failed",
      );
      res.status(502).json({
        error: savedSettingsMatch
          ? "Connection failed. Verify the saved SMTP host, port, encryption, and credentials. The failed check and time were recorded."
          : "Connection failed. Verify the SMTP host, port, encryption, and credentials. Saved check details were unchanged because the tested values differ from saved settings.",
        code: "SMTP_CONNECTION_TEST_FAILED",
        checkedAt,
        savedSettingsUpdated: savedSettingsMatch,
      });
    }
  },
);

router.post(
  "/sending/settings/test",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = TestTenantSendingSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter valid SMTP settings and a destination email.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const userId = req.authUser!.id;
    const [existing] = await db
      .select()
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, userId));
    const config = tenantSendingEmailConfiguration(
      userId,
      parsed.data.settings,
      existing,
    );
    if (!config) {
      res.status(400).json({
        error: "Enter SMTP username and password before sending a test email.",
        code: "SMTP_CREDENTIALS_REQUIRED",
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

      const settingsMatch =
        existing && matchesSavedTenantSendingConfiguration(existing, config);
      const verifiedAt = settingsMatch ? new Date() : null;
      if (verifiedAt) {
        await db
          .update(tenantSendingConfigurationTable)
          .set({ verifiedAt, updatedAt: verifiedAt })
          .where(eq(tenantSendingConfigurationTable.userId, userId));
      }
      res.json(
        TestTenantSendingSettingsResponse.parse({
          message: settingsMatch
            ? "The SMTP server accepted the test message; inbox delivery is not confirmed."
            : "The SMTP server accepted the test message, but saved settings were not changed or verified because they differ from the values tested.",
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
  const [contacts, quota, memberships, emailHistory, companies] = await Promise.all([
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
    db.select().from(companiesTable).where(eq(companiesTable.userId, userId)),
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
  const companiesById = new Map(companies.map((company) => [company.id, company]));
  res.json(
    ListContactsResponse.parse({
      contacts: contacts.map((contact) => ({
        ...contact,
        company: contact.companyId
          ? publicCompanyPayload(companiesById.get(contact.companyId)!)
          : null,
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
  "/contacts/:contactId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = GetContactParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Invalid contact identifier.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const userId = req.authUser!.id;
    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, params.data.contactId),
          eq(contactsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!contact) {
      res.status(404).json({
        error: "Contact not found.",
        code: "CONTACT_NOT_FOUND",
      });
      return;
    }
    res.json(GetContactResponse.parse(await getContactPayload(userId, contact)));
  },
);

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
    const optionSet = await getTenantContactOptionSet(tx, userId);
    const optionIssue = contactFieldValueIssue(
      parsed.data as Record<string, unknown>,
      optionSet,
    );
    if (optionIssue) return { kind: "invalid_contact_field" as const, issue: optionIssue };

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
        ...contactEnrichmentPatch(parsed.data),
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
  if (result.kind === "invalid_contact_field") {
    res.status(400).json({
      error: result.issue.message,
      code: "INVALID_CONTACT_FIELD_VALUE",
      field: result.issue.field,
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
      const optionSet = await getTenantContactOptionSet(tx, userId);

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
        const optionIssue = contactFieldValueIssue(
          data as Record<string, unknown>,
          optionSet,
          undefined,
          "import",
        );
        if (optionIssue) {
          invalid += 1;
          issues.push({ rowNumber: row.rowNumber, reason: optionIssue.message });
          continue;
        }
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
            ...contactEnrichmentPatch(data),
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
    if (parsed.data.replaceLegacyCompanyProfile && !parsed.data.companyId) {
      res.status(400).json({
        error: "Choose a company before confirming replacement of legacy details.",
        code: "INVALID_INPUT",
      });
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
      const [lockedUser] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)
        .for("update");
      if (!lockedUser) return { kind: "not_found" as const };
      const [existing] = await tx
        .select()
        .from(contactsTable)
        .where(
          and(
            eq(contactsTable.id, params.data.contactId),
            eq(contactsTable.userId, userId),
          ),
        )
        .for("update");
      if (!existing) return { kind: "not_found" as const };
      const optionSet = await getTenantContactOptionSet(tx, userId);
      const optionIssue = contactFieldValueIssue(
        parsed.data as Record<string, unknown>,
        optionSet,
        existing,
      );
      if (optionIssue) return { kind: "invalid_contact_field" as const, issue: optionIssue };

      // Confirmation replaces only legacy fields, never another shared association.
      if (
        parsed.data.replaceLegacyCompanyProfile &&
        existing.companyId &&
        existing.companyId !== parsed.data.companyId
      ) {
        return { kind: "company_already_linked" as const };
      }
      let nextCompanyId = parsed.data.companyId === undefined
        ? existing.companyId
        : parsed.data.companyId;
      let companyProfilePatch: Partial<typeof contactsTable.$inferInsert> = {};
      if (nextCompanyId) {
        const [company] = await tx
          .select()
          .from(companiesTable)
          .where(
            and(
              eq(companiesTable.id, nextCompanyId),
              eq(companiesTable.userId, userId),
            ),
          )
          .limit(1)
          .for("update");
        if (!company) return { kind: "company_not_found" as const };

        const mergedProfile = mergeCompatibleCompanyProfiles([
          companyProfileFrom(company),
          companyProfileFrom(parsed.data.replaceLegacyCompanyProfile ? {} : existing),
          companyProfileFrom(parsed.data),
        ]);
        if (!mergedProfile?.companyName) {
          return { kind: "company_profile_conflict" as const };
        }
        const domainKey = companyDomainKey(mergedProfile);
        if (domainKey) {
          const [duplicateCompany] = await tx
            .select({ id: companiesTable.id })
            .from(companiesTable)
            .where(
              and(
                eq(companiesTable.userId, userId),
                eq(companiesTable.companyDomainKey, domainKey),
                ne(companiesTable.id, company.id),
              ),
            )
            .limit(1);
          if (duplicateCompany) {
            return { kind: "company_domain_conflict" as const };
          }
        }
        await tx
          .update(companiesTable)
          .set({
            ...mergedProfile,
            companyName: mergedProfile.companyName,
            companyDomainKey: domainKey,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(companiesTable.id, company.id),
              eq(companiesTable.userId, userId),
            ),
          );
        companyProfilePatch = {
          ...clearLegacyCompanyProfile(),
          companyLinkSuppressed: false,
        };
      } else if (existing.companyId) {
        const [previousCompany] = await tx
          .select()
          .from(companiesTable)
          .where(
            and(
              eq(companiesTable.id, existing.companyId),
              eq(companiesTable.userId, userId),
            ),
          )
          .limit(1)
          .for("update");
        if (!previousCompany) return { kind: "company_not_found" as const };
        companyProfilePatch = {
          ...contactCompanyPatch(companyProfileFrom(previousCompany)),
          companyLinkSuppressed: true,
        };
      }

      const wasLinked = existing.companyId !== null;
      const shouldWriteLegacyProfile =
        nextCompanyId === null && !wasLinked;
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
          ...(shouldWriteLegacyProfile && parsed.data.companyName !== undefined
            ? { companyName: optionalContactValue(parsed.data.companyName) }
            : {}),
          ...(parsed.data.linkedinUrl !== undefined
            ? { linkedinUrl: optionalContactValue(parsed.data.linkedinUrl) }
            : {}),
          ...(parsed.data.phoneNumber !== undefined
            ? { phoneNumber: optionalContactValue(parsed.data.phoneNumber) }
            : {}),
          ...contactEnrichmentPatch(parsed.data, shouldWriteLegacyProfile),
          ...(parsed.data.companyId !== undefined
            ? { companyId: nextCompanyId }
            : {}),
          ...companyProfilePatch,
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
      if (!updated) return { kind: "not_found" as const };
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
        kind: "updated" as const,
        contact: updated,
        campaignIds: suppressed.map((recipient) => recipient.campaignId),
      };
    });
    if (updateResult.kind === "invalid_contact_field") {
      res.status(400).json({
        error: updateResult.issue.message,
        code: "INVALID_CONTACT_FIELD_VALUE",
        field: updateResult.issue.field,
      });
      return;
    }
    if (updateResult.kind === "company_not_found") {
      res.status(404).json({ error: "Company not found in this workspace.", code: "COMPANY_NOT_FOUND" });
      return;
    }
    if (updateResult.kind === "company_already_linked") {
      res.status(409).json({
        error: "This contact is already linked to another company. Unlink it before choosing a replacement.",
        code: "CONTACT_ALREADY_LINKED",
      });
      return;
    }
    if (updateResult.kind === "company_profile_conflict") {
      res.status(409).json({
        error: "This contact has company details that conflict with the selected company. Resolve the profile details before linking.",
        code: "COMPANY_PROFILE_CONFLICT",
      });
      return;
    }
    if (updateResult.kind === "company_domain_conflict") {
      res.status(409).json({
        error: "Another company already uses this domain.",
        code: "COMPANY_DOMAIN_EXISTS",
      });
      return;
    }
    if (updateResult.kind === "not_found") {
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

router.get("/contact-segments", requireUserRole, async (req, res): Promise<void> => {
  const segments = await db
    .select({
      id: contactSegmentsTable.id,
      name: contactSegmentsTable.name,
      filters: contactSegmentsTable.filters,
      createdAt: contactSegmentsTable.createdAt,
      updatedAt: contactSegmentsTable.updatedAt,
    })
    .from(contactSegmentsTable)
    .where(eq(contactSegmentsTable.userId, req.authUser!.id))
    .orderBy(desc(contactSegmentsTable.createdAt));
  res.json(ListContactSegmentsResponse.parse(segments));
});

router.post("/contact-segments", requireUserRole, async (req, res): Promise<void> => {
  const parsed = CreateContactSegmentBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) {
    res.status(400).json({
      error: "Enter a valid name and contact filter combination.",
      code: "INVALID_INPUT",
    });
    return;
  }
  const userId = req.authUser!.id;
  const name = parsed.data.name.trim();
  const [duplicate] = await db
    .select({ id: contactSegmentsTable.id })
    .from(contactSegmentsTable)
    .where(
      and(
        eq(contactSegmentsTable.userId, userId),
        eq(contactSegmentsTable.name, name),
      ),
    )
    .limit(1);
  if (duplicate) {
    res.status(409).json({
      error: "A saved segment with this name already exists.",
      code: "CONTACT_SEGMENT_EXISTS",
    });
    return;
  }
  const [segment] = await db
    .insert(contactSegmentsTable)
    .values({
      userId,
      name,
      filters: parsed.data.filters,
    })
    .onConflictDoNothing({
      target: [contactSegmentsTable.userId, contactSegmentsTable.name],
    })
    .returning({
      id: contactSegmentsTable.id,
      name: contactSegmentsTable.name,
      filters: contactSegmentsTable.filters,
      createdAt: contactSegmentsTable.createdAt,
      updatedAt: contactSegmentsTable.updatedAt,
    });
  if (!segment) {
    res.status(409).json({
      error: "A saved segment with this name already exists.",
      code: "CONTACT_SEGMENT_EXISTS",
    });
    return;
  }
  res.status(201).json(CreateContactSegmentResponse.parse(segment));
});

router.patch(
  "/contact-segments/:segmentId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = UpdateContactSegmentParams.safeParse(req.params);
    const parsed = UpdateContactSegmentBody.safeParse(req.body);
    if (!params.success || !parsed.success || !parsed.data.name.trim()) {
      res.status(400).json({
        error: "Enter a valid saved segment name.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const userId = req.authUser!.id;
    const [duplicate] = await db
      .select({ id: contactSegmentsTable.id })
      .from(contactSegmentsTable)
      .where(
        and(
          eq(contactSegmentsTable.userId, userId),
          eq(contactSegmentsTable.name, parsed.data.name.trim()),
          ne(contactSegmentsTable.id, params.data.segmentId),
        ),
      )
      .limit(1);
    if (duplicate) {
      res.status(409).json({
        error: "A saved segment with this name already exists.",
        code: "CONTACT_SEGMENT_EXISTS",
      });
      return;
    }
    const [segment] = await db
      .update(contactSegmentsTable)
      .set({ name: parsed.data.name.trim(), updatedAt: new Date() })
      .where(
        and(
          eq(contactSegmentsTable.id, params.data.segmentId),
          eq(contactSegmentsTable.userId, userId),
        ),
      )
      .returning({
        id: contactSegmentsTable.id,
        name: contactSegmentsTable.name,
        filters: contactSegmentsTable.filters,
        createdAt: contactSegmentsTable.createdAt,
        updatedAt: contactSegmentsTable.updatedAt,
      });
    if (!segment) {
      res.status(404).json({
        error: "Saved contact segment not found.",
        code: "CONTACT_SEGMENT_NOT_FOUND",
      });
      return;
    }
    res.json(UpdateContactSegmentResponse.parse(segment));
  },
);

router.delete(
  "/contact-segments/:segmentId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = DeleteContactSegmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Invalid saved contact segment identifier.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const [deleted] = await db
      .delete(contactSegmentsTable)
      .where(
        and(
          eq(contactSegmentsTable.id, params.data.segmentId),
          eq(contactSegmentsTable.userId, req.authUser!.id),
        ),
      )
      .returning({ id: contactSegmentsTable.id });
    if (!deleted) {
      res.status(404).json({
        error: "Saved contact segment not found.",
        code: "CONTACT_SEGMENT_NOT_FOUND",
      });
      return;
    }
    res.status(204).json(DeleteContactSegmentResponse.parse(undefined));
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
    const listIds =
      parsed.data.listIds ??
      (parsed.data.listId ? [parsed.data.listId] : []);
    if (
      listIds.length === 0 ||
      !(await isValidTenantListSelection(userId, listIds, true))
    ) {
      res.status(400).json({
        error: "Choose one or more active contact lists from your workspace.",
        code: "INVALID_CONTACT_LIST",
      });
      return;
    }

    const [requestedContact] = await db
      .select({
        email: contactsTable.email,
      })
      .from(contactListMembersTable)
      .innerJoin(
        contactsTable,
        eq(contactsTable.id, contactListMembersTable.contactId),
      )
      .where(
        and(
          eq(contactListMembersTable.userId, userId),
          inArray(contactListMembersTable.listId, listIds),
          eq(contactListMembersTable.contactId, parsed.data.contactId),
          eq(contactsTable.userId, userId),
          eq(contactsTable.subscribed, true),
        ),
      )
      .limit(1);
    if (!requestedContact) {
      res.status(404).json({
        error: "Choose a subscribed contact in at least one selected list.",
        code: "CAMPAIGN_PREVIEW_CONTACT_NOT_FOUND",
      });
      return;
    }

    const matchingMemberships = await db
      .select({
        id: contactsTable.id,
        listId: contactListMembersTable.listId,
        email: contactsTable.email,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        name: contactsTable.name,
        companyName: contactsTable.companyName,
        linkedinUrl: contactsTable.linkedinUrl,
        phoneNumber: contactsTable.phoneNumber,
        createdAt: contactsTable.createdAt,
      })
      .from(contactListMembersTable)
      .innerJoin(
        contactsTable,
        eq(contactsTable.id, contactListMembersTable.contactId),
      )
      .where(
        and(
          eq(contactListMembersTable.userId, userId),
          inArray(contactListMembersTable.listId, listIds),
          eq(contactsTable.userId, userId),
          eq(contactsTable.subscribed, true),
          sql`lower(${contactsTable.email}) = ${requestedContact.email.trim().toLowerCase()}`,
        ),
      );
    const [contact] = uniqueCampaignRecipients(matchingMemberships, listIds);
    if (!contact) {
      res.status(404).json({
        error: "Choose a subscribed contact in at least one selected list.",
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
  "/campaigns/recipient-summary",
  requireUserRole,
  async (req, res): Promise<void> => {
    const rawListIds = req.query.listIds;
    const listIds = Array.isArray(rawListIds)
      ? rawListIds.filter((value): value is string => typeof value === "string")
      : typeof rawListIds === "string"
        ? [rawListIds]
        : [];
    const parsed = GetCampaignRecipientSummaryQueryParams.safeParse({
      listIds,
    });
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose one or more valid contact lists.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const userId = req.authUser!.id;
    if (!(await isValidTenantListSelection(userId, parsed.data.listIds))) {
      res.status(400).json({
        error: "Choose contact lists from your workspace.",
        code: "INVALID_CONTACT_LIST",
      });
      return;
    }

    const memberships = await db
      .select({
        listId: contactListMembersTable.listId,
        email: contactsTable.email,
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
          inArray(contactListMembersTable.listId, parsed.data.listIds),
          eq(contactsTable.subscribed, true),
        ),
      );
    res.json(
      GetCampaignRecipientSummaryResponse.parse(
        summarizeCampaignAudience(memberships, parsed.data.listIds),
      ),
    );
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

    const [lists, totalRows, eligibleRows] = await Promise.all([
      db
        .select({
          id: contactListsTable.id,
          name: contactListsTable.name,
          active: contactListsTable.active,
        })
        .from(contactListsTable)
        .where(
          and(
            eq(contactListsTable.userId, userId),
            inArray(contactListsTable.id, campaign.listIds),
          ),
        ),
      db
        .select({
          listId: contactListMembersTable.listId,
          value: count(),
        })
        .from(contactListMembersTable)
        .where(
          and(
            eq(contactListMembersTable.userId, userId),
            inArray(contactListMembersTable.listId, campaign.listIds),
          ),
        )
        .groupBy(contactListMembersTable.listId),
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
            inArray(contactListMembersTable.listId, campaign.listIds),
            eq(contactsTable.subscribed, true),
          ),
        )
        .groupBy(contactListMembersTable.listId),
    ]);
    const listsById = new Map(lists.map((list) => [list.id, list]));
    const totalCounts = new Map(totalRows.map((row) => [row.listId, row.value]));
    const eligibleCounts = new Map(
      eligibleRows.map((row) => [row.listId, row.value]),
    );
    const targetLists = campaign.listIds.flatMap((listId) => {
      const list = listsById.get(listId);
      if (!list) return [];
      const totalContacts = totalCounts.get(listId) ?? 0;
      const eligibleContacts = eligibleCounts.get(listId) ?? 0;
      return [
        {
          ...list,
          totalContacts,
          eligibleContacts,
          unsubscribedContacts: Math.max(0, totalContacts - eligibleContacts),
        },
      ];
    });
    const targetList = targetLists[0] ?? null;

    const settings = await getPlatformSettings();
    const remainingEmails =
      campaign.status === "draft"
        ? campaign.recipients
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
        targetLists,
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
  const listIds =
    parsed.data.listIds ?? (parsed.data.listId ? [parsed.data.listId] : []);
  if (
    listIds.length === 0 ||
    !(await isValidTenantListSelection(userId, listIds, true))
  ) {
    res.status(400).json({
      error: "Choose one or more active contact lists from your workspace.",
      code: "INVALID_CONTACT_LIST",
    });
    return;
  }
  const [campaign] = await db
    .insert(emailCampaignsTable)
    .values({
      userId,
      listId: listIds[0],
      listIds,
      name: parsed.data.name.trim(),
      objective: parsed.data.objective?.trim() ?? "",
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
    const requestedListIds =
      parsed.data.listIds !== undefined
        ? parsed.data.listIds
        : parsed.data.listId !== undefined
          ? [parsed.data.listId]
          : undefined;
    if (
      requestedListIds !== undefined &&
      (requestedListIds.length === 0 ||
        !(await isValidTenantListSelection(userId, requestedListIds)))
    ) {
        res.status(400).json({
          error: "Choose one or more contact lists from your workspace.",
          code: "INVALID_CONTACT_LIST",
        });
        return;
    }
    const [updated] = await db
      .update(emailCampaignsTable)
      .set({
        ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.subject ? { subject: parsed.data.subject.trim() } : {}),
        ...(parsed.data.objective !== undefined
          ? { objective: parsed.data.objective.trim() }
          : {}),
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
        ...(requestedListIds !== undefined
          ? {
              listId: requestedListIds[0] ?? null,
              listIds: requestedListIds,
            }
          : {}),
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
    const input = SendCampaignBody.safeParse(req.body ?? {});
    if (!input.success) {
      res.status(400).json({ error: "Choose a valid campaign start date and time.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const settings = await getPlatformSettings();
    const requestedStartAt = input.data.scheduledAt;
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
      const listIds = campaignListIds(campaign);
      if (listIds.length === 0) return { error: "list_missing" as const };

      const activeLists = await tx
        .select({ id: contactListsTable.id })
        .from(contactListsTable)
        .where(
          and(
            eq(contactListsTable.userId, userId),
            inArray(contactListsTable.id, listIds),
            eq(contactListsTable.active, true),
          ),
        );
      if (activeLists.length !== listIds.length) {
        return { error: "list_missing" as const };
      }

      const now = new Date();
      const activeCampaigns = await tx
        .select({
          id: emailCampaignsTable.id,
          status: emailCampaignsTable.status,
          scheduledAt: emailCampaignsTable.scheduledAt,
        })
        .from(emailCampaignsTable)
        .where(
          and(
            eq(emailCampaignsTable.userId, userId),
            inArray(emailCampaignsTable.status, ["queued", "sending"]),
          ),
        );
      const activeCampaignIds = activeCampaigns.map((item) => item.id);
      const activeRecipients =
        activeCampaignIds.length === 0
          ? []
          : await tx
              .select({
                campaignId: emailCampaignRecipientsTable.campaignId,
                status: emailCampaignRecipientsTable.status,
                nextAttemptAt: emailCampaignRecipientsTable.nextAttemptAt,
                createdAt: emailCampaignRecipientsTable.createdAt,
              })
              .from(emailCampaignRecipientsTable)
              .where(
                and(
                  eq(emailCampaignRecipientsTable.userId, userId),
                  inArray(emailCampaignRecipientsTable.campaignId, activeCampaignIds),
                  inArray(emailCampaignRecipientsTable.status, ["queued", "sending"]),
                ),
              );
      const inProgressCampaignIds = new Set(
        activeRecipients
          .filter((recipient) => recipient.status === "sending")
          .map((recipient) => recipient.campaignId),
      );
      const queuedWorkStartAt = new Date(
        now.getTime() +
          (inProgressCampaignIds.size > 0
            ? Math.max(1, settings.queuePollingSeconds) * 1000
            : 0),
      );
      const queuedRecipients = activeRecipients
        .filter((recipient) => recipient.status === "queued")
        .map((recipient) => ({
          campaignId: recipient.campaignId,
          nextAttemptAt:
            recipient.nextAttemptAt > queuedWorkStartAt
              ? recipient.nextAttemptAt
              : queuedWorkStartAt,
          createdAt: recipient.createdAt,
        }));
      const recentAttempts =
        activeCampaignIds.length === 0
          ? []
          : await tx
              .select({ attemptedAt: emailSendAttemptsTable.attemptedAt })
              .from(emailSendAttemptsTable)
              .where(
                and(
                  eq(emailSendAttemptsTable.userId, userId),
                  gte(
                    emailSendAttemptsTable.attemptedAt,
                    new Date(now.getTime() - 24 * 60 * 60 * 1000),
                  ),
                ),
              )
              .orderBy(asc(emailSendAttemptsTable.attemptedAt));
      const queueForecast = estimateCampaignQueueDeliverySeconds(
        queuedRecipients,
        settings,
        recentAttempts.map((attempt) => attempt.attemptedAt),
        now,
      );
      const latestActiveFinishSeconds = activeCampaigns.reduce(
        (latest, activeCampaign) =>
          Math.max(
            latest,
            queueForecast.durationSecondsByCampaign.get(activeCampaign.id) ?? 0,
            inProgressCampaignIds.has(activeCampaign.id)
              ? Math.max(1, settings.queuePollingSeconds)
              : 0,
          ),
        0,
      );
      const earliestStartAt = new Date(
        now.getTime() + latestActiveFinishSeconds * 1000,
      );
      if (
        requestedStartAt &&
        requestedStartAt.getTime() < earliestStartAt.getTime()
      ) {
        return { error: "start_too_early" as const, earliestStartAt };
      }
      const scheduledAt = requestedStartAt ?? earliestStartAt;
      const activeNowCount = activeCampaigns.filter(
        (activeCampaign) =>
          activeCampaign.status === "sending" ||
          !activeCampaign.scheduledAt ||
          activeCampaign.scheduledAt.getTime() <= now.getTime(),
      ).length;
      if (
        scheduledAt.getTime() <= now.getTime() &&
        activeNowCount >= settings.maxConcurrentCampaigns
      ) {
        return { error: "concurrency_limit" as const };
      }

      const memberships = await tx
        .select({
          id: contactsTable.id,
          listId: contactListMembersTable.listId,
          email: contactsTable.email,
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
          createdAt: contactsTable.createdAt,
        })
        .from(contactListMembersTable)
        .innerJoin(
          contactsTable,
          eq(contactsTable.id, contactListMembersTable.contactId),
        )
        .where(
          and(
            eq(contactListMembersTable.userId, userId),
            inArray(contactListMembersTable.listId, listIds),
            eq(contactsTable.userId, userId),
            eq(contactsTable.subscribed, true),
          ),
        )
        .orderBy(asc(contactsTable.createdAt));
      const recipients = uniqueCampaignRecipients(memberships, listIds);
      if (recipients.length === 0) return { error: "empty_list" as const };
      if (recipients.length > settings.maxCampaignSize) {
        return { error: "campaign_size_limit" as const };
      }

      const [queuedCampaign] = await tx
        .update(emailCampaignsTable)
        .set({
          status: "queued",
          queuedAt: now,
          scheduledAt,
          updatedAt: now,
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
          nextAttemptAt: scheduledAt,
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
      } else if (outcome.error === "start_too_early") {
        res.status(409).json({
          error: `The campaign cannot start before ${outcome.earliestStartAt.toISOString()}.`,
          code: "CAMPAIGN_START_TOO_EARLY",
          earliestStartAt: outcome.earliestStartAt.toISOString(),
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
    [companyCount],
    [listCount],
    [sender],
    amountSpentRows,
    lifecycleStageRows,
    leadStatusRows,
    contactFieldOptions,
    runningCampaigns,
    recentCampaigns,
  ] = await Promise.all([
    getCurrentSubscriptionForUser(userId),
    db
      .select({ value: count() })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId)),
    db
      .select({ value: count() })
      .from(companiesTable)
      .where(eq(companiesTable.userId, userId)),
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
      .select({
        currency: paymentsTable.currency,
        amountMinor: sum(paymentsTable.amountMinor),
      })
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.userId, userId),
          eq(paymentsTable.status, "captured"),
        ),
      )
      .groupBy(paymentsTable.currency)
      .orderBy(asc(paymentsTable.currency)),
    db
      .select({
        value: contactsTable.lifecycleStage,
        count: count(),
      })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId))
      .groupBy(contactsTable.lifecycleStage),
    db
      .select({
        value: contactsTable.leadStatus,
        count: count(),
      })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId))
      .groupBy(contactsTable.leadStatus),
    db
      .select({
        fieldKey: contactFieldOptionsTable.fieldKey,
        optionValue: contactFieldOptionsTable.value,
      })
      .from(contactFieldOptionsTable)
      .where(
        and(
          eq(contactFieldOptionsTable.userId, userId),
          inArray(contactFieldOptionsTable.fieldKey, [
            "lifecycleStage",
            "leadStatus",
          ]),
        ),
      )
      .orderBy(
        asc(contactFieldOptionsTable.fieldKey),
        asc(contactFieldOptionsTable.normalizedValue),
      ),
    db
      .select({
        id: emailCampaignsTable.id,
        name: emailCampaignsTable.name,
        status: emailCampaignsTable.status,
        queuedAt: emailCampaignsTable.queuedAt,
        completedAt: emailCampaignsTable.completedAt,
        updatedAt: emailCampaignsTable.updatedAt,
      })
      .from(emailCampaignsTable)
      .where(
        and(
          eq(emailCampaignsTable.userId, userId),
          inArray(emailCampaignsTable.status, ["queued", "sending"]),
        ),
      )
      .orderBy(desc(emailCampaignsTable.updatedAt))
      .limit(20),
    db
      .select({
        id: emailCampaignsTable.id,
        name: emailCampaignsTable.name,
        status: emailCampaignsTable.status,
        queuedAt: emailCampaignsTable.queuedAt,
        completedAt: emailCampaignsTable.completedAt,
        updatedAt: emailCampaignsTable.updatedAt,
      })
      .from(emailCampaignsTable)
      .where(
        and(
          eq(emailCampaignsTable.userId, userId),
          eq(emailCampaignsTable.status, "completed"),
        ),
      )
      .orderBy(desc(emailCampaignsTable.updatedAt))
      .limit(6),
  ]);

  const contacts = contactCount?.value ?? 0;
  const companies = companyCount?.value ?? 0;
  const activeLists = listCount?.value ?? 0;
  const campaigns = [...runningCampaigns, ...recentCampaigns];
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const [campaignRecipientRows, campaignAttemptRows] =
    campaignIds.length > 0
      ? await Promise.all([
          db
            .select({
              campaignId: emailCampaignRecipientsTable.campaignId,
              status: emailCampaignRecipientsTable.status,
              value: count(),
            })
            .from(emailCampaignRecipientsTable)
            .where(
              and(
                eq(emailCampaignRecipientsTable.userId, userId),
                inArray(emailCampaignRecipientsTable.campaignId, campaignIds),
              ),
            )
            .groupBy(
              emailCampaignRecipientsTable.campaignId,
              emailCampaignRecipientsTable.status,
            ),
          db
            .select({
              campaignId: emailCampaignRecipientsTable.campaignId,
              value: count(),
            })
            .from(emailSendAttemptsTable)
            .innerJoin(
              emailCampaignRecipientsTable,
              and(
                eq(
                  emailCampaignRecipientsTable.id,
                  emailSendAttemptsTable.recipientId,
                ),
                eq(
                  emailCampaignRecipientsTable.userId,
                  emailSendAttemptsTable.userId,
                ),
              ),
            )
            .where(
              and(
                eq(emailSendAttemptsTable.userId, userId),
                gte(emailSendAttemptsTable.attemptedAt, hourStart),
                inArray(emailCampaignRecipientsTable.campaignId, campaignIds),
              ),
            )
            .groupBy(emailCampaignRecipientsTable.campaignId),
        ])
      : [[], []];
  const countsByCampaign = new Map<
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
  for (const row of campaignRecipientRows) {
    const countsForCampaign = countsByCampaign.get(row.campaignId) ?? {
      recipients: 0,
      queued: 0,
      delivered: 0,
      bounced: 0,
      suppressed: 0,
      unknown: 0,
    };
    const value = Number(row.value);
    countsForCampaign.recipients += value;
    if (row.status === "queued" || row.status === "sending") {
      countsForCampaign.queued += value;
    } else if (row.status === "delivered") {
      countsForCampaign.delivered += value;
    } else if (row.status === "bounced") {
      countsForCampaign.bounced += value;
    } else if (row.status === "suppressed") {
      countsForCampaign.suppressed += value;
    } else if (row.status === "unknown") {
      countsForCampaign.unknown += value;
    }
    countsByCampaign.set(row.campaignId, countsForCampaign);
  }
  const attemptsByCampaign = new Map(
    campaignAttemptRows.map((row) => [row.campaignId, Number(row.value)]),
  );
  const dashboardCampaigns = campaigns.map((campaign) => {
    const countsForCampaign = countsByCampaign.get(campaign.id) ?? {
      recipients: 0,
      queued: 0,
      delivered: 0,
      bounced: 0,
      suppressed: 0,
      unknown: 0,
    };
    const attemptsThisHour = attemptsByCampaign.get(campaign.id) ?? 0;
    const isActive =
      campaign.status === "queued" || campaign.status === "sending";
    return {
      ...campaign,
      ...countsForCampaign,
      attemptsThisHour,
      remainingThisHour: isActive
        ? Math.min(
            countsForCampaign.queued,
            Math.max(0, settings.defaultEmailsPerHour - attemptsThisHour),
          )
        : 0,
      hourlyLimit: settings.defaultEmailsPerHour,
    };
  });
  const buildContactSegments = (
    rows: Array<{ value: string | null; count: number }>,
    fieldKey: "lifecycleStage" | "leadStatus",
  ) => {
    const counts = new Map<string, number>();
    for (const option of contactFieldOptions) {
      if (option.fieldKey === fieldKey) counts.set(option.optionValue, 0);
    }
    counts.set("Not set", counts.get("Not set") ?? 0);
    for (const row of rows) {
      const value = row.value?.trim() || "Not set";
      counts.set(value, (counts.get(value) ?? 0) + Number(row.count));
    }
    return Array.from(counts, ([value, count]) => ({ value, count }));
  };
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
    companies,
    activeLists,
    amountSpentByCurrency: amountSpentRows.map((row) => ({
      currency: row.currency,
      amountMinor: Number(row.amountMinor ?? 0),
    })),
    lifecycleStages: buildContactSegments(
      lifecycleStageRows,
      "lifecycleStage",
    ),
    leadStatuses: buildContactSegments(leadStatusRows, "leadStatus"),
    campaigns: dashboardCampaigns,
    setupStepsCompleted,
    setupStepsTotal: 4,
  }));
});

export default router;