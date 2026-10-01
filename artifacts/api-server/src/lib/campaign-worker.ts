import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  lt,
} from "drizzle-orm";
import {
  contactsTable,
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  emailSendAttemptsTable,
  tenantSendingConfigurationTable,
  type EmailCampaign,
  type EmailCampaignRecipient,
  type TenantSendingConfiguration,
} from "@workspace/db";
import { sendTenantEmail } from "./application-email";
import {
  personalizeCampaignHtml,
  personalizeCampaignText,
  type CampaignPersonalization,
} from "./campaign-template";
import { logger } from "./logger";
import {
  getMinimumEmailSpacingSeconds,
  getPlatformSettings,
} from "./platform-settings";

const MAX_DELIVERIES_PER_TICK = 100;
const STALE_DELIVERY_MINUTES = 10;

type DeliveryClaim =
  | {
      sender: TenantSendingConfiguration;
      campaign: EmailCampaign;
      recipient: EmailCampaignRecipient;
      personalization: CampaignPersonalization;
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
    });

  for (const item of interrupted) {
    await completeCampaignIfFinished(item.userId, item.campaignId);
  }
}

async function rateLimitDelay(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  now: Date,
  hourlyLimit: number,
  dailyLimit: number,
  queuePollingSeconds: number,
): Promise<Date | null> {
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [hourly] = await tx
    .select({ value: count() })
    .from(emailSendAttemptsTable)
    .where(
      and(
        eq(emailSendAttemptsTable.userId, userId),
        gte(emailSendAttemptsTable.attemptedAt, hourStart),
      ),
    );
  const [daily] = await tx
    .select({ value: count() })
    .from(emailSendAttemptsTable)
    .where(
      and(
        eq(emailSendAttemptsTable.userId, userId),
        gte(emailSendAttemptsTable.attemptedAt, dayStart),
      ),
    );

  let allowedAt: Date | null = null;
  const [latestAttempt] = await tx
    .select({ attemptedAt: emailSendAttemptsTable.attemptedAt })
    .from(emailSendAttemptsTable)
    .where(eq(emailSendAttemptsTable.userId, userId))
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
      .where(
        and(
          eq(emailSendAttemptsTable.userId, userId),
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
      .where(
        and(
          eq(emailSendAttemptsTable.userId, userId),
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
): Promise<DeliveryClaim | null> {
  const now = new Date();
  return db.transaction(async (tx) => {
    // Lock this tenant's sender row first so concurrent workers cannot race the
    // rate-limit ledger for the same workspace.
    const [sender] = await tx
      .select()
      .from(tenantSendingConfigurationTable)
      .where(eq(tenantSendingConfigurationTable.userId, userId))
      .for("update");
    if (!sender?.verifiedAt) return null;

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
        );
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
      now,
      hourlyLimit,
      dailyLimit,
      queuePollingSeconds,
    );
    if (rateDelay) {
      await tx
        .update(emailCampaignRecipientsTable)
        .set({ nextAttemptAt: rateDelay, updatedAt: now })
        .where(eq(emailCampaignRecipientsTable.id, recipient.id));
      return null;
    }

    await tx.insert(emailSendAttemptsTable).values({
      userId,
      recipientId: recipient.id,
      attemptedAt: now,
    });
    const [claimed] = await tx
      .update(emailCampaignRecipientsTable)
      .set({
        status: "sending",
        attempts: recipient.attempts + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailCampaignRecipientsTable.id, recipient.id),
          eq(emailCampaignRecipientsTable.userId, userId),
        ),
      )
      .returning();
    if (!claimed) return null;
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
    return { sender, campaign, recipient: claimed, personalization };
  });
}

async function finishDelivery(
  userId: string,
  campaignId: string,
  recipientId: string,
  result:
    | { accepted: true }
    | { accepted: false; error: string; retry: boolean; nextAttemptAt?: Date },
): Promise<void> {
  const now = new Date();
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
        status: result.retry ? "queued" : "bounced",
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
    const claimed = await claimDelivery(
      candidate.id,
      candidate.userId,
      settings.defaultEmailsPerHour,
      settings.maxEmailsPerDay,
      settings.queuePollingSeconds,
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
      result = await sendTenantEmail(
        claimed.sender,
        claimed.recipient.email,
        personalizeCampaignText(
          claimed.campaign.subject,
          claimed.personalization,
        ),
        personalizeCampaignText(
          claimed.campaign.textBody,
          claimed.personalization,
        ),
        claimed.campaign.htmlBody
          ? personalizeCampaignHtml(
              claimed.campaign.htmlBody,
              claimed.personalization,
            )
          : undefined,
      );
    } catch (error) {
      const retry = claimed.recipient.attempts <= settings.retryAttempts;
      const errorMessage = deliveryError(error);
      await finishDelivery(
        candidate.userId,
        claimed.campaign.id,
        claimed.recipient.id,
        {
          accepted: false,
          error: errorMessage,
          retry,
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
      result.accepted
        ? { accepted: true }
        : {
            accepted: false,
            error: result.error ?? "SMTP server rejected the recipient.",
            retry: false,
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