import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  type SQL,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetCampaignDeliveryReportParams,
  GetCampaignDeliveryReportQueryParams,
  GetCampaignDeliveryReportResponse,
  ImportDeliveryReportBody,
  ImportDeliveryReportResponse,
} from "@workspace/api-zod";
import {
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  emailDeliveryReportsTable,
  emailSendAttemptsTable,
} from "@workspace/db";
import { parseDeliveryReports } from "../lib/delivery-report-parser";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();
const TERMINAL_REPORT_OUTCOMES = new Set(["delivered", "bounced", "failed"]);
const REPORT_OUTCOME_PRIORITY: Record<string, number> = {
  unconfirmed: 0,
  delayed: 1,
  delivered: 2,
  failed: 3,
  bounced: 4,
};

function shouldApplyReportProjection(
  current: {
    reportOutcome: string;
    reportAt: Date | null;
  },
  incomingOutcome: string,
  incomingAt: Date | null,
): boolean {
  if (current.reportOutcome === "unconfirmed") return true;
  if (
    TERMINAL_REPORT_OUTCOMES.has(current.reportOutcome) &&
    incomingOutcome === "delayed"
  ) {
    return false;
  }

  if (current.reportAt && !incomingAt) return false;
  if (!current.reportAt && incomingAt) return true;
  if (current.reportAt && incomingAt) {
    if (incomingAt < current.reportAt) return false;
    if (incomingAt > current.reportAt) return true;
  }

  return (
    (REPORT_OUTCOME_PRIORITY[incomingOutcome] ?? -1) >
    (REPORT_OUTCOME_PRIORITY[current.reportOutcome] ?? -1)
  );
}

router.get(
  "/campaigns/:campaignId/delivery-report",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = GetCampaignDeliveryReportParams.safeParse(req.params);
    const query = GetCampaignDeliveryReportQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({
        error: "Campaign or pagination parameters are invalid.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const userId = req.authUser!.id;
    const [campaign] = await db
      .select({ id: emailCampaignsTable.id })
      .from(emailCampaignsTable)
      .where(
        and(
          eq(emailCampaignsTable.id, params.data.campaignId),
          eq(emailCampaignsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!campaign) {
      res.status(404).json({
        error: "Campaign not found.",
        code: "CAMPAIGN_NOT_FOUND",
      });
      return;
    }

    const allRecipients = await db
      .select()
      .from(emailCampaignRecipientsTable)
      .where(
        and(
          eq(emailCampaignRecipientsTable.userId, userId),
          eq(emailCampaignRecipientsTable.campaignId, campaign.id),
        ),
      )
      .orderBy(
        asc(emailCampaignRecipientsTable.email),
        asc(emailCampaignRecipientsTable.createdAt),
        asc(emailCampaignRecipientsTable.id),
      );

    const recipientsById = new Map(
      allRecipients.map((recipient) => [recipient.id, recipient]),
    );
    const latestAttemptByRecipient = new Map<
      string,
      (typeof emailSendAttemptsTable.$inferSelect)[]
    >();
    if (allRecipients.length > 0) {
      const attempts = await db
        .select()
        .from(emailSendAttemptsTable)
        .where(
          and(
            eq(emailSendAttemptsTable.userId, userId),
            inArray(
              emailSendAttemptsTable.recipientId,
              allRecipients.map((recipient) => recipient.id),
            ),
          ),
        )
        .orderBy(
          desc(emailSendAttemptsTable.attemptedAt),
          desc(emailSendAttemptsTable.id),
        );
      for (const attempt of attempts) {
        if (!latestAttemptByRecipient.has(attempt.recipientId)) {
          latestAttemptByRecipient.set(attempt.recipientId, [attempt]);
        }
      }
    }

    const summary = {
      smtpAccepted: 0,
      sendFailed: 0,
      reportedDelivered: 0,
      reportedBounced: 0,
      reportedDelayed: 0,
      reportedFailed: 0,
      unconfirmed: 0,
    };
    for (const recipient of recipientsById.values()) {
      if (recipient.status === "delivered") summary.smtpAccepted += 1;
      if (recipient.status === "bounced") summary.sendFailed += 1;
      if (recipient.reportOutcome === "delivered") summary.reportedDelivered += 1;
      else if (recipient.reportOutcome === "bounced") summary.reportedBounced += 1;
      else if (recipient.reportOutcome === "delayed") summary.reportedDelayed += 1;
      else if (recipient.reportOutcome === "failed") summary.reportedFailed += 1;
      else summary.unconfirmed += 1;
    }

    const { limit, offset } = query.data;
    const pageRecipients = allRecipients.slice(offset, offset + limit);
    const payload = {
      campaignId: campaign.id,
      summary,
      total: allRecipients.length,
      limit,
      offset,
      recipients: pageRecipients.map((recipient) => {
        const latestAttempt =
          latestAttemptByRecipient.get(recipient.id)?.[0] ?? null;
        return {
          id: recipient.id,
          email: recipient.email,
          status: recipient.status,
          attempts: recipient.attempts,
          smtpAcceptedAt: recipient.deliveredAt,
          lastError: recipient.lastError,
          reportOutcome: recipient.reportOutcome,
          reportSource: recipient.reportSource,
          reportDiagnostic: recipient.reportDiagnostic,
          reportStatusCode: recipient.reportStatusCode,
          reportAt: recipient.reportAt,
          reportDeliveryScope: recipient.reportDeliveryScope,
          latestMessageId: latestAttempt?.messageId ?? null,
          latestSmtpResponse: latestAttempt?.smtpResponse ?? null,
          latestSmtpCode: latestAttempt?.smtpCode ?? null,
          dsnRequested: latestAttempt?.dsnRequested ?? false,
          evidenceVerification:
            recipient.reportOutcome === "unconfirmed" ? null : "user_imported",
        };
      }),
    };
    res.json(GetCampaignDeliveryReportResponse.parse(payload));
  },
);

router.post(
  "/sending/reports/import",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsedBody = ImportDeliveryReportBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: "Provide a supported report format and non-empty content.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const { format, content, campaignId } = parsedBody.data;
    if (Buffer.byteLength(content, "utf8") > 1_000_000) {
      res.status(413).json({
        error: "The delivery report must be no larger than 1 MB.",
        code: "REPORT_TOO_LARGE",
      });
      return;
    }

    const userId = req.authUser!.id;
    if (campaignId) {
      const [campaign] = await db
        .select({ id: emailCampaignsTable.id })
        .from(emailCampaignsTable)
        .where(
          and(
            eq(emailCampaignsTable.id, campaignId),
            eq(emailCampaignsTable.userId, userId),
          ),
        )
        .limit(1);
      if (!campaign) {
        res.status(404).json({
          error: "Campaign not found.",
          code: "CAMPAIGN_NOT_FOUND",
        });
        return;
      }
    }

    let parsed;
    try {
      parsed = parseDeliveryReports(format, content);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error
          ? error.message.slice(0, 300)
          : "The report could not be parsed in the selected format.",
        code: "INVALID_DELIVERY_REPORT",
      });
      return;
    }

    let imported = 0;
    let duplicates = 0;
    let unmatched = 0;
    let ignored = 0;
    const warnings = parsed.warnings.map((warning) => warning.slice(0, 500));
    const receivedAt = new Date();
    for (const report of parsed.reports) {
      const recipientEmail = report.recipientEmail.trim().toLowerCase();
      const identifiers: SQL[] = [];
      const messageId = report.messageId?.trim() || null;
      const envelopeId = report.envelopeId?.trim() || null;
      const hasEnvelopeId = envelopeId !== null;
      const validEnvelopeId =
        envelopeId !== null &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          envelopeId,
        );
      if (hasEnvelopeId && !validEnvelopeId) {
        unmatched += 1;
        warnings.push(
          `Ignored a report for ${recipientEmail} with an invalid envelope ID.`,
        );
        continue;
      }
      if (messageId) {
        identifiers.push(eq(emailSendAttemptsTable.messageId, messageId));
      }
      if (validEnvelopeId && envelopeId) {
        identifiers.push(
          eq(emailSendAttemptsTable.id, envelopeId.toLowerCase()),
        );
      }
      if (!recipientEmail || identifiers.length === 0) {
        unmatched += 1;
        continue;
      }

      const diagnostic =
        report.diagnostic?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").slice(0, 4000) ??
        null;
      const statusCode = report.enhancedStatus?.slice(0, 64) ?? null;
      const result = await db.transaction(async (tx) => {
        const identifierCondition =
          identifiers.length === 2
            ? and(identifiers[0], identifiers[1])
            : identifiers[0];
        const candidateRows = await tx
          .select({
            attempt: emailSendAttemptsTable,
            recipientId: emailCampaignRecipientsTable.id,
          })
          .from(emailSendAttemptsTable)
          .innerJoin(
            emailCampaignRecipientsTable,
            and(
              eq(emailCampaignRecipientsTable.id, emailSendAttemptsTable.recipientId),
              eq(emailCampaignRecipientsTable.userId, emailSendAttemptsTable.userId),
            ),
          )
          .innerJoin(
            emailCampaignsTable,
            and(
              eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
              eq(emailCampaignsTable.userId, userId),
            ),
          )
          .where(
            and(
              eq(emailSendAttemptsTable.userId, userId),
              eq(emailCampaignRecipientsTable.email, recipientEmail),
              ...(campaignId
                ? [eq(emailCampaignRecipientsTable.campaignId, campaignId)]
                : []),
              identifierCondition,
            ),
          )
          .limit(2);
        if (candidateRows.length !== 1) return { status: "unmatched" as const };

        const { attempt, recipientId } = candidateRows[0];
        const [recipient] = await tx
          .select()
          .from(emailCampaignRecipientsTable)
          .where(
            and(
              eq(emailCampaignRecipientsTable.id, recipientId),
              eq(emailCampaignRecipientsTable.userId, userId),
              eq(emailCampaignRecipientsTable.email, recipientEmail),
              ...(campaignId
                ? [eq(emailCampaignRecipientsTable.campaignId, campaignId)]
                : []),
            ),
          )
          .for("update")
          .limit(1);
        if (!recipient) return { status: "unmatched" as const };

        const occurredAt = report.occurredAt;
        const now = new Date();
        // RFC DSN dates have whole-second precision; a valid immediate report
        // can precede our millisecond timestamp within the same second.
        const attemptStartSecond =
          Math.floor(attempt.attemptedAt.getTime() / 1000) * 1000;
        if (
          occurredAt &&
          (occurredAt.getTime() < attemptStartSecond ||
            occurredAt.getTime() > now.getTime() + 5 * 60_000)
        ) {
          return {
            status: "ignored" as const,
            warning: `Ignored a report for ${recipientEmail} with a timestamp outside the send-attempt window.`,
          };
        }

        const canonical = JSON.stringify({
          attemptId: attempt.id,
          recipientEmail,
          messageId,
          envelopeId: envelopeId?.toLowerCase() ?? null,
          outcome: report.outcome,
          source: report.source,
          diagnostic,
          statusCode,
          occurredAt: occurredAt?.toISOString() ?? null,
          deliveryScope: report.deliveryScope,
        });
        const fingerprint = createHash("sha256").update(canonical).digest("hex");
        const [existingEvent] = await tx
          .select({ id: emailDeliveryReportsTable.id })
          .from(emailDeliveryReportsTable)
          .where(
            and(
              eq(emailDeliveryReportsTable.userId, userId),
              eq(emailDeliveryReportsTable.fingerprint, fingerprint),
            ),
          )
          .limit(1);
        if (existingEvent) return { status: "duplicate" as const };

        const [storedEvent] = await tx
          .insert(emailDeliveryReportsTable)
          .values({
            userId,
            recipientId: recipient.id,
            attemptId: attempt.id,
            fingerprint,
            outcome: report.outcome,
            source: report.source,
            diagnostic,
            statusCode,
            occurredAt,
            receivedAt,
            deliveryScope: report.deliveryScope,
          })
          .onConflictDoNothing({
            target: [
              emailDeliveryReportsTable.userId,
              emailDeliveryReportsTable.fingerprint,
            ],
          })
          .returning({ id: emailDeliveryReportsTable.id });
        if (!storedEvent) return { status: "duplicate" as const };

        const [latestAttempt] = await tx
          .select({ id: emailSendAttemptsTable.id })
          .from(emailSendAttemptsTable)
          .where(
            and(
              eq(emailSendAttemptsTable.userId, userId),
              eq(emailSendAttemptsTable.recipientId, recipient.id),
            ),
          )
          .orderBy(
            desc(emailSendAttemptsTable.attemptedAt),
            desc(emailSendAttemptsTable.id),
          )
          .limit(1);
        if (latestAttempt?.id !== attempt.id) {
          return {
            status: "imported" as const,
            warning:
              "Stored historical report evidence without changing the latest-attempt summary.",
          };
        }
        if (
          !shouldApplyReportProjection(
            recipient,
            report.outcome,
            occurredAt,
          )
        ) {
          return {
            status: "imported" as const,
            warning:
              "Stored report evidence without changing the summary because newer or higher-priority evidence is already present.",
          };
        }

        await tx
          .update(emailCampaignRecipientsTable)
          .set({
            reportOutcome: report.outcome,
            reportSource: report.source,
            reportDiagnostic: diagnostic,
            reportStatusCode: statusCode,
            reportAt: occurredAt,
            reportDeliveryScope: report.deliveryScope,
            updatedAt: now,
          })
          .where(
            and(
              eq(emailCampaignRecipientsTable.id, recipient.id),
              eq(emailCampaignRecipientsTable.userId, userId),
            ),
          );
        return { status: "imported" as const };
      });

      if (result.status === "unmatched") unmatched += 1;
      else if (result.status === "ignored") {
        ignored += 1;
        warnings.push(result.warning);
      } else if (result.status === "duplicate") duplicates += 1;
      else {
        imported += 1;
        if (result.warning) warnings.push(result.warning);
      }
    }

    res.json(
      ImportDeliveryReportResponse.parse({
        imported,
        duplicates,
        unmatched,
        ignored,
        warnings: warnings.slice(0, 200),
        message:
          "Reports were processed as user-imported evidence. Mailflow does not authenticate these as provider events.",
      }),
    );
  },
);

export default router;