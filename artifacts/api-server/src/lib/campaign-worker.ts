import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  lt,
  or,
} from "drizzle-orm";
import {
  contactsTable,
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  emailSendAttemptsTable,
  systemConfigurationTable,
  tenantSendingConfigurationTable,
  usersTable,
  type EmailCampaign,
  type EmailCampaignRecipient,
  type TenantSendingConfiguration,
} from "@workspace/db";
import { sendTenantEmail } from "./application-email";
import { decryptSecret } from "./security";
import {
  createCampaignUnsubscribeUrls,
  getPublicAppOrigin,
  normalizePublicAppOrigin,
} from "./campaign-unsubscribe";
import {
  renderCampaignForContact,
  type CampaignPersonalization,
} from "./campaign-template";
import { logger } from "./logger";
import {
  defaultPlatformSettings,
  getMinimumEmailSpacingSeconds,
  getPlatformSettings,
} from "./platform-settings";

const MAX_DELIVERIES_PER_TICK = 100;
const STALE_DELIVERY_MINUTES = 10;
let beforeDeliveryClaimForTests: (() => Promise<void>) | null = null;
const tenantClaimQueues = new Map<string, Promise<void>>();

async function withTenantClaimLock<T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previousLock = tenantClaimQueues.get(userId) ?? Promise.resolve();
  let releaseLock!: () => void;
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  tenantClaimQueues.set(userId, currentLock);
  await previousLock;

  try {
    return await operation();
  } finally {
    releaseLock();
    if (tenantClaimQueues.get(userId) === currentLock) {
      tenantClaimQueues.delete(userId);
    }
  }
}

export function setBeforeDeliveryClaimForTests(
  callback: (() => Promise<void>) | null,
): void {
  beforeDeliveryClaimForTests = callback;
}

type DeliveryClaim =
  | {
      sender: TenantSendingConfiguration;
      campaign: EmailCampaign;
      recipient: EmailCampaignRecipient;
      personalization: CampaignPersonalization;
      attemptId: string;
      messageId: string;
      dsnRequested: boolean;
    }
  | { completedCampaignId: string };

function deliveryError(error: unknown): string {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";
  if (code === "EAUTH") return "SMTP authentication failed.";
  if (code === "ETIMEDOUT" || code === "ESOCKET") {
    return "The SMTP connection timed out.";
  }
  if (code.startsWith("ECONNECTION") || code === "EDNS") {
    return "Could not connect to the SMTP server.";
  }
  return "The SMTP provider could not accept this delivery.";
}

function smtpFailureEvidence(
  error: unknown,
  sender: TenantSendingConfiguration,
): {
  smtpResponse?: string;
  smtpCode?: number;
  enhancedStatus?: string;
  outcome: "smtp_rejected" | "send_failed" | "unknown";
} {
  const details =
    error && typeof error === "object"
      ? (error as {
          response?: unknown;
          responseCode?: unknown;
          statusCode?: unknown;
          command?: unknown;
        })
      : {};
  const responseCode =
    typeof details.responseCode === "number"
      ? details.responseCode
      : typeof details.statusCode === "number"
        ? details.statusCode
        : undefined;
  const errorCode =
    error && typeof error === "object" && "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";
  const command =
    typeof details.command === "string" ? details.command.trim() : "";
  const explicitPreDataCommand =
    /^(?:CONN|EHLO|HELO|STARTTLS|AUTH|MAIL FROM|RCPT TO)\b/i.test(command);
  let smtpResponse =
    typeof details.response === "string" ? details.response : undefined;
  if (smtpResponse) {
    smtpResponse = smtpResponse.replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
      " ",
    );
    for (const credential of [
      decryptSecret(sender.usernameEncrypted),
      decryptSecret(sender.passwordEncrypted),
    ]) {
      if (credential) smtpResponse = smtpResponse.split(credential).join("[redacted]");
    }
    smtpResponse = smtpResponse.slice(0, 1000);
  }
  const responsePrefixCode = Number(
    smtpResponse?.match(/^\s*(\d{3})/)?.[1],
  );
  const parsedCode = responseCode ?? (responsePrefixCode || undefined);
  const enhancedStatus =
    smtpResponse?.match(/\b([245]\.\d{1,3}\.\d{1,3})\b/)?.[1];
  return {
    ...(smtpResponse ? { smtpResponse } : {}),
    ...(parsedCode ? { smtpCode: parsedCode } : {}),
    ...(enhancedStatus ? { enhancedStatus } : {}),
    outcome:
      parsedCode && parsedCode >= 400 && parsedCode <= 599
        ? "smtp_rejected"
        : errorCode === "EAUTH" ||
            errorCode === "EDNS" ||
            explicitPreDataCommand
          ? "send_failed"
          : "unknown",
  };
}

function safeAttemptError(
  message: string,
  sender: TenantSendingConfiguration,
): string {
  let safe = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
  for (const credential of [
    decryptSecret(sender.usernameEncrypted),
    decryptSecret(sender.passwordEncrypted),
  ]) {
    if (credential) safe = safe.split(credential).join("[redacted]");
  }
  return safe.slice(0, 1000);
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

async function markInterruptedDeliveriesUnknown(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_DELIVERY_MINUTES * 60 * 1000);
  const interrupted = await db
    .update(emailCampaignRecipientsTable)
    .set({
      status: "unknown",
      lastError:
        "The worker stopped during delivery, so the SMTP outcome could not be confirmed.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailCampaignRecipientsTable.status, "sending"),
        lt(emailCampaignRecipientsTable.updatedAt, cutoff),
      ),
    )
    .returning({
      userId: emailCampaignRecipientsTable.userId,
      campaignId: emailCampaignRecipientsTable.campaignId,
      recipientId: emailCampaignRecipientsTable.id,
    });

  if (interrupted.length > 0) {
    const recipientIdsByUser = new Map<string, string[]>();
    for (const item of interrupted) {
      const ids = recipientIdsByUser.get(item.userId) ?? [];
      ids.push(item.recipientId);
      recipientIdsByUser.set(item.userId, ids);
    }
    for (const [userId, recipientIds] of recipientIdsByUser) {
      await db
        .update(emailSendAttemptsTable)
        .set({
          outcome: "unknown",
          errorMessage:
            "The worker stopped during delivery, so the SMTP outcome could not be confirmed.",
          completedAt: new Date(),
        })
        .where(
          and(
            eq(emailSendAttemptsTable.userId, userId),
            inArray(emailSendAttemptsTable.recipientId, recipientIds),
            eq(emailSendAttemptsTable.outcome, "pending"),
          ),
        );
    }
  }

  for (const item of interrupted) {
    await completeCampaignIfFinished(item.userId, item.campaignId);
  }
}

async function rateLimitDelay(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  senderAccountId: string,
  now: Date,
  hourlyLimit: number,
  dailyLimit: number,
  queuePollingSeconds: number,
): Promise<Date | null> {
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const senderAttemptScope = and(
    eq(emailSendAttemptsTable.userId, userId),
    or(
      eq(emailSendAttemptsTable.senderAccountId, senderAccountId),
      and(
        isNull(emailSendAttemptsTable.senderAccountId),
        eq(emailCampaignsTable.senderAccountId, senderAccountId),
      ),
      and(
        isNull(emailSendAttemptsTable.senderAccountId),
        isNull(emailCampaignsTable.senderAccountId),
      ),
    ),
  );
  const [hourly] = await tx
    .select({ value: count() })
    .from(emailSendAttemptsTable)
    .leftJoin(
      emailCampaignRecipientsTable,
      eq(
        emailCampaignRecipientsTable.id,
        emailSendAttemptsTable.recipientId,
      ),
    )
    .leftJoin(
      emailCampaignsTable,
      eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
    )
    .where(
      and(
        senderAttemptScope,
        gte(emailSendAttemptsTable.attemptedAt, hourStart),
      ),
    );
  const [daily] = await tx
    .select({ value: count() })
    .from(emailSendAttemptsTable)
    .leftJoin(
      emailCampaignRecipientsTable,
      eq(
        emailCampaignRecipientsTable.id,
        emailSendAttemptsTable.recipientId,
      ),
    )
    .leftJoin(
      emailCampaignsTable,
      eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
    )
    .where(
      and(
        senderAttemptScope,
        gte(emailSendAttemptsTable.attemptedAt, dayStart),
      ),
    );

  let allowedAt: Date | null = null;
  const [latestAttempt] = await tx
    .select({ attemptedAt: emailSendAttemptsTable.attemptedAt })
    .from(emailSendAttemptsTable)
    .leftJoin(
      emailCampaignRecipientsTable,
      eq(
        emailCampaignRecipientsTable.id,
        emailSendAttemptsTable.recipientId,
      ),
    )
    .leftJoin(
      emailCampaignsTable,
      eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
    )
    .where(senderAttemptScope)
    .orderBy(desc(emailSendAttemptsTable.attemptedAt))
    .limit(1);
  if (latestAttempt) {
    const spacingSeconds = getMinimumEmailSpacingSeconds({
      defaultEmailsPerHour: hourlyLimit,
      queuePollingSeconds,
    });
    const pacedAllowedAt = new Date(
      latestAttempt.attemptedAt.getTime() + spacingSeconds * 1000,
    );
    if (pacedAllowedAt > now) allowedAt = pacedAllowedAt;
  }

  if ((hourly?.value ?? 0) >= hourlyLimit) {
    const [oldest] = await tx
      .select({ attemptedAt: emailSendAttemptsTable.attemptedAt })
      .from(emailSendAttemptsTable)
      .leftJoin(
        emailCampaignRecipientsTable,
        eq(
          emailCampaignRecipientsTable.id,
          emailSendAttemptsTable.recipientId,
        ),
      )
      .leftJoin(
        emailCampaignsTable,
        eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
      )
      .where(
        and(
          senderAttemptScope,
          gte(emailSendAttemptsTable.attemptedAt, hourStart),
        ),
      )
      .orderBy(asc(emailSendAttemptsTable.attemptedAt))
      .limit(1);
    if (oldest) {
      const hourlyAllowedAt = new Date(
        oldest.attemptedAt.getTime() + 60 * 60 * 1000,
      );
      if (!allowedAt || hourlyAllowedAt > allowedAt) {
        allowedAt = hourlyAllowedAt;
      }
    }
  }

  if ((daily?.value ?? 0) >= dailyLimit) {
    const [oldest] = await tx
      .select({ attemptedAt: emailSendAttemptsTable.attemptedAt })
      .from(emailSendAttemptsTable)
      .leftJoin(
        emailCampaignRecipientsTable,
        eq(
          emailCampaignRecipientsTable.id,
          emailSendAttemptsTable.recipientId,
        ),
      )
      .leftJoin(
        emailCampaignsTable,
        eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
      )
      .where(
        and(
          senderAttemptScope,
          gte(emailSendAttemptsTable.attemptedAt, dayStart),
        ),
      )
      .orderBy(asc(emailSendAttemptsTable.attemptedAt))
      .limit(1);
    if (oldest) {
      const dailyAllowedAt = new Date(
        oldest.attemptedAt.getTime() + 24 * 60 * 60 * 1000,
      );
      if (!allowedAt || dailyAllowedAt > allowedAt) allowedAt = dailyAllowedAt;
    }
  }

  return allowedAt;
}

async function claimDelivery(
  recipientId: string,
  userId: string,
  hourlyLimit: number,
  dailyLimit: number,
  queuePollingSeconds: number,
  dsnRequested: boolean,
): Promise<DeliveryClaim | null> {
  // Serialize claims in this process as well as across instances via the
  // tenant-row lock below.
  return withTenantClaimLock(userId, () => db.transaction(async (tx) => {
    // Ensure there is a row to lock, including on a fresh install where
    // getPlatformSettings() is still serving its defaults.
    await tx
      .insert(systemConfigurationTable)
      .values({ key: "platform", value: defaultPlatformSettings })
      .onConflictDoNothing();

    // Serialize the maintenance check with settings updates. The settings row
    // lock keeps a concurrent maintenance enable from slipping between this
    // check and the queued-to-sending claim below.
    const [platformConfiguration] = await tx
      .select({ value: systemConfigurationTable.value })
      .from(systemConfigurationTable)
      .where(eq(systemConfigurationTable.key, "platform"))
      .for("update");
    const platformValue = platformConfiguration?.value;
    if (
      platformValue &&
      typeof platformValue === "object" &&
      !Array.isArray(platformValue) &&
      "maintenanceMode" in platformValue &&
      platformValue.maintenanceMode === true
    ) {
      return null;
    }

    // Keep tenant claims serialized so concurrent workers cannot overshoot
    // the independent cap for this SMTP mailbox.
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");

    // Capture claim time after acquiring the tenant lock so a worker waiting
    // behind another claim evaluates the shared attempt ledger at current time.
    const now = new Date();

    const [recipient] = await tx
      .select()
      .from(emailCampaignRecipientsTable)
      .where(
        and(
          eq(emailCampaignRecipientsTable.id, recipientId),
          eq(emailCampaignRecipientsTable.userId, userId),
        ),
      )
      .for("update", { skipLocked: true });
    if (
      !recipient ||
      recipient.status !== "queued" ||
      recipient.nextAttemptAt > now
    ) {
      return null;
    }

    const [campaign] = await tx
      .select()
      .from(emailCampaignsTable)
      .where(
        and(
          eq(emailCampaignsTable.id, recipient.campaignId),
          eq(emailCampaignsTable.userId, userId),
        ),
      )
      .limit(1);
    if (
      !campaign ||
      (campaign.status !== "queued" && campaign.status !== "sending")
    ) {
      await tx
        .update(emailCampaignRecipientsTable)
        .set({
          status: "bounced",
          lastError: "The campaign is no longer available for delivery.",
          updatedAt: now,
        })
        .where(eq(emailCampaignRecipientsTable.id, recipient.id));
      return { completedCampaignId: recipient.campaignId };
    }
    if (
      !normalizePublicAppOrigin(campaign.unsubscribeOrigin) &&
      !getPublicAppOrigin()
    ) {
      // Do not attempt a campaign send without a valid unsubscribe URL. Leave
      // the recipient queued so configuration can be corrected and retried.
      return null;
    }

    const [sender] = await tx
      .select()
      .from(tenantSendingConfigurationTable)
      .where(
        and(
          eq(tenantSendingConfigurationTable.userId, userId),
          campaign.senderAccountId
            ? eq(tenantSendingConfigurationTable.id, campaign.senderAccountId)
            : undefined,
        ),
      )
      .orderBy(
        desc(tenantSendingConfigurationTable.isPrimary),
        asc(tenantSendingConfigurationTable.createdAt),
      )
      .limit(1)
      .for("update");
    if (!sender?.verifiedAt) return null;

    let personalization: CampaignPersonalization;
    if (recipient.contactId) {
      const [contact] = await tx
        .select({ subscribed: contactsTable.subscribed })
        .from(contactsTable)
        .where(
          and(
            eq(contactsTable.id, recipient.contactId),
            eq(contactsTable.userId, userId),
          ),
        )
        .for("update");
      if (contact?.subscribed) {
        const [details] = await tx
          .select({
            firstName: contactsTable.firstName,
            lastName: contactsTable.lastName,
            name: contactsTable.name,
            companyName: contactsTable.companyName,
            linkedinUrl: contactsTable.linkedinUrl,
            phoneNumber: contactsTable.phoneNumber,
          })
          .from(contactsTable)
          .where(
            and(
              eq(contactsTable.id, recipient.contactId),
              eq(contactsTable.userId, userId),
            ),
          )
          .limit(1);
        personalization = {
          firstName: details?.firstName ?? recipient.firstName,
          lastName: details?.lastName ?? recipient.lastName,
          fullName:
            [details?.firstName, details?.lastName].filter(Boolean).join(" ") ||
            details?.name ||
            [recipient.firstName, recipient.lastName].filter(Boolean).join(" "),
          email: recipient.email,
          companyName: details?.companyName ?? "",
          phoneNumber: details?.phoneNumber ?? "",
          linkedinUrl: details?.linkedinUrl ?? "",
        };
      } else {
        await tx
          .update(emailCampaignRecipientsTable)
          .set({
            status: "suppressed",
            lastError: "Contact was unsubscribed or removed before delivery.",
            updatedAt: now,
          })
          .where(
            and(
              eq(emailCampaignRecipientsTable.id, recipient.id),
              eq(emailCampaignRecipientsTable.userId, userId),
            ),
          );
        return { completedCampaignId: recipient.campaignId };
      }
    } else {
      await tx
        .update(emailCampaignRecipientsTable)
        .set({
          status: "suppressed",
          lastError: "Contact was unsubscribed or removed before delivery.",
          updatedAt: now,
        })
        .where(
          and(
            eq(emailCampaignRecipientsTable.id, recipient.id),
            eq(emailCampaignRecipientsTable.userId, userId),
          ),
        );
      return { completedCampaignId: recipient.campaignId };
    }

    const rateDelay = await rateLimitDelay(
      tx,
      userId,
      sender.id,
      now,
      hourlyLimit,
      dailyLimit,
      queuePollingSeconds,
    );
    if (rateDelay) {
      await tx
        .update(emailCampaignRecipientsTable)
        .set({
          nextAttemptAt: rateDelay,
          rateLimitDeferredAt: now,
          updatedAt: now,
        })
        .where(eq(emailCampaignRecipientsTable.id, recipient.id));
      return null;
    }

    const attemptId = randomUUID();
    const messageId = `<${attemptId}@mailflow.local>`;
    const [claimed] = await tx
      .update(emailCampaignRecipientsTable)
      .set({
        status: "sending",
        attempts: recipient.attempts + 1,
        rateLimitDeferredAt: null,
        reportOutcome: "unconfirmed",
        reportSource: null,
        reportDiagnostic: null,
        reportStatusCode: null,
        reportAt: null,
        reportDeliveryScope: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailCampaignRecipientsTable.id, recipient.id),
          eq(emailCampaignRecipientsTable.userId, userId),
          eq(emailCampaignRecipientsTable.status, "queued"),
        ),
      )
      .returning();
    if (!claimed) return null;
    await tx.insert(emailSendAttemptsTable).values({
      id: attemptId,
      userId,
      senderAccountId: sender.id,
      recipientId: recipient.id,
      messageId,
      dsnRequested,
      attemptedAt: now,
    });
    await tx
      .update(emailCampaignsTable)
      .set({ status: "sending", updatedAt: now })
      .where(
        and(
          eq(emailCampaignsTable.id, campaign.id),
          eq(emailCampaignsTable.userId, userId),
          inArray(emailCampaignsTable.status, ["queued", "sending"]),
        ),
      );
    await tx
      .update(tenantSendingConfigurationTable)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(eq(tenantSendingConfigurationTable.id, sender.id));
    return {
      sender,
      campaign,
      recipient: claimed,
      personalization,
      attemptId,
      messageId,
      dsnRequested,
    };
  }));
}

async function finishDelivery(
  userId: string,
  campaignId: string,
  recipientId: string,
  attemptId: string,
  result:
    | {
        accepted: true;
        smtpResponse?: string;
        smtpCode?: number;
        enhancedStatus?: string;
      }
    | {
        accepted: false;
        error: string;
        retry: boolean;
        outcome: "smtp_rejected" | "send_failed" | "unknown";
        smtpResponse?: string;
        smtpCode?: number;
        enhancedStatus?: string;
        nextAttemptAt?: Date;
      },
): Promise<void> {
  const now = new Date();
  await db
    .update(emailSendAttemptsTable)
    .set({
      outcome: result.accepted ? "smtp_accepted" : result.outcome,
      smtpResponse: result.smtpResponse ?? null,
      smtpCode: result.smtpCode ?? null,
      enhancedStatus: result.enhancedStatus ?? null,
      errorMessage: result.accepted ? null : result.error,
      completedAt: now,
    })
    .where(
      and(
        eq(emailSendAttemptsTable.id, attemptId),
        eq(emailSendAttemptsTable.userId, userId),
      ),
    );
  if (result.accepted) {
    await db
      .update(emailCampaignRecipientsTable)
      .set({
        status: "delivered",
        deliveredAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailCampaignRecipientsTable.id, recipientId),
          eq(emailCampaignRecipientsTable.userId, userId),
          eq(emailCampaignRecipientsTable.status, "sending"),
        ),
      );
  } else {
    await db
      .update(emailCampaignRecipientsTable)
      .set({
        status: result.retry
          ? "queued"
          : result.outcome === "unknown"
            ? "unknown"
            : "bounced",
        nextAttemptAt: result.nextAttemptAt ?? now,
        lastError: result.error,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailCampaignRecipientsTable.id, recipientId),
          eq(emailCampaignRecipientsTable.userId, userId),
          eq(emailCampaignRecipientsTable.status, "sending"),
        ),
      );
  }
  await completeCampaignIfFinished(userId, campaignId);
}

export async function processPendingCampaignDeliveries(
  batchSize = MAX_DELIVERIES_PER_TICK,
): Promise<number> {
  const settings = await getPlatformSettings();
  if (settings.maintenanceMode) return 0;
  await markInterruptedDeliveriesUnknown();
  const now = new Date();
  const candidates = await db
    .select({
      id: emailCampaignRecipientsTable.id,
      userId: emailCampaignRecipientsTable.userId,
    })
    .from(emailCampaignRecipientsTable)
    .innerJoin(
      emailCampaignsTable,
      eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
    )
    .where(
      and(
        eq(emailCampaignRecipientsTable.status, "queued"),
        lte(emailCampaignRecipientsTable.nextAttemptAt, now),
        inArray(emailCampaignsTable.status, ["queued", "sending"]),
      ),
    )
    .orderBy(
      asc(emailCampaignRecipientsTable.nextAttemptAt),
      asc(emailCampaignRecipientsTable.createdAt),
    )
    .limit(batchSize);

  let processed = 0;
  for (const candidate of candidates) {
    if ((await getPlatformSettings()).maintenanceMode) break;
    await beforeDeliveryClaimForTests?.();
    const claimed = await claimDelivery(
      candidate.id,
      candidate.userId,
      settings.defaultEmailsPerHour,
      settings.maxEmailsPerDay,
      settings.queuePollingSeconds,
      settings.deliveryTrackingEnabled,
    );
    if (!claimed) continue;
    if ("completedCampaignId" in claimed) {
      await completeCampaignIfFinished(
        candidate.userId,
        claimed.completedCampaignId,
      );
      continue;
    }

    processed += 1;
    let result: Awaited<ReturnType<typeof sendTenantEmail>>;
    try {
      const publicOrigin =
        normalizePublicAppOrigin(claimed.campaign.unsubscribeOrigin) ??
        getPublicAppOrigin();
      if (!publicOrigin) {
        throw new Error(
          "Configure PUBLIC_APP_URL before processing campaigns so unsubscribe links remain valid.",
        );
      }
      const unsubscribeUrls = createCampaignUnsubscribeUrls(publicOrigin, {
        tenantId: claimed.campaign.userId,
        contactId: claimed.recipient.contactId!,
        campaignId: claimed.campaign.id,
      });
      const rendered = renderCampaignForContact(
        claimed.campaign,
        claimed.personalization,
        {
          variantAssignment: claimed.recipient.variantAssignment,
          unsubscribeUrl: unsubscribeUrls.browserUrl,
        },
      );
      result = await sendTenantEmail(
        claimed.sender,
        claimed.recipient.email,
        rendered.subject,
        rendered.textBody,
        rendered.htmlBody ?? undefined,
        {
          attemptId: claimed.attemptId,
          messageId: claimed.messageId,
          dsnRequested: claimed.dsnRequested,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrls.oneClickUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        },
      );
    } catch (error) {
      const evidence = smtpFailureEvidence(error, claimed.sender);
      const permanentSmtpRejection =
        evidence.smtpCode !== undefined && evidence.smtpCode >= 500;
      const recipientAttemptNumber = claimed.recipient.attempts;
      const retry =
        !permanentSmtpRejection &&
        recipientAttemptNumber <= settings.retryAttempts;
      const errorMessage = safeAttemptError(
        deliveryError(error),
        claimed.sender,
      );
      await finishDelivery(
        candidate.userId,
        claimed.campaign.id,
        claimed.recipient.id,
        claimed.attemptId,
        {
          accepted: false,
          error: errorMessage,
          retry,
          outcome: evidence.outcome,
          ...(evidence.smtpResponse ? { smtpResponse: evidence.smtpResponse } : {}),
          ...(evidence.smtpCode ? { smtpCode: evidence.smtpCode } : {}),
          ...(evidence.enhancedStatus
            ? { enhancedStatus: evidence.enhancedStatus }
            : {}),
          ...(retry
            ? {
                nextAttemptAt: new Date(
                  Date.now() + settings.retryDelaySeconds * 1000,
                ),
              }
            : {}),
        },
      );
      logger.warn(
        {
          campaignId: claimed.campaign.id,
          recipientId: claimed.recipient.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
          retry,
        },
        "Tenant email delivery attempt failed",
      );
      continue;
    }

    await finishDelivery(
      candidate.userId,
      claimed.campaign.id,
      claimed.recipient.id,
      claimed.attemptId,
      result.accepted
        ? {
            accepted: true,
            ...(result.smtpResponse ? { smtpResponse: result.smtpResponse } : {}),
            ...(result.smtpCode ? { smtpCode: result.smtpCode } : {}),
            ...(result.enhancedStatus
              ? { enhancedStatus: result.enhancedStatus }
              : {}),
          }
        : {
            accepted: false,
            error: safeAttemptError(
              result.error ?? "SMTP server rejected the recipient.",
              claimed.sender,
            ),
            retry: false,
            outcome: "smtp_rejected",
            ...(result.smtpResponse ? { smtpResponse: result.smtpResponse } : {}),
            ...(result.smtpCode ? { smtpCode: result.smtpCode } : {}),
            ...(result.enhancedStatus
              ? { enhancedStatus: result.enhancedStatus }
              : {}),
          },
    );
  }
  return processed;
}

let workerTimer: NodeJS.Timeout | undefined;
let workerStarted = false;

export function startCampaignWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  const tick = async (): Promise<void> => {
    let delay = 15_000;
    try {
      const settings = await getPlatformSettings();
      delay = Math.max(1, settings.queuePollingSeconds) * 1000;
      await processPendingCampaignDeliveries();
    } catch (error) {
      logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Campaign worker tick failed",
      );
    } finally {
      workerTimer = setTimeout(() => void tick(), delay);
      workerTimer.unref();
    }
  };

  void tick();
}

export function stopCampaignWorkerForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The campaign worker can only be stopped in test mode.");
  }
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = undefined;
  workerStarted = false;
}