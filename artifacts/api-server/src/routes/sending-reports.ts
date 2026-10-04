import {
  and,
  asc,
  desc,
  eq,
  inArray,
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
  emailSendAttemptsTable,
} from "@workspace/db";
import { parseDeliveryReports } from "../lib/delivery-report-parser";
import { ingestDeliveryReports } from "../lib/delivery-report-ingestion";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();

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
            recipient.reportEvidenceVerification ??
            (recipient.reportOutcome === "unconfirmed"
              ? null
              : "user_imported"),
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
        error:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "The report could not be parsed in the selected format.",
        code: "INVALID_DELIVERY_REPORT",
      });
      return;
    }

    const result = await ingestDeliveryReports({
      userId,
      reports: parsed.reports,
      receivedAt: new Date(),
      ...(campaignId ? { campaignId } : {}),
      verification: "user_imported",
    });

    res.json(
      ImportDeliveryReportResponse.parse({
        ...result,
        warnings: [
          ...parsed.warnings.map((warning) => warning.slice(0, 500)),
          ...result.warnings,
        ].slice(0, 200),
        message:
          "Reports were processed as user-imported evidence. Mailflow does not authenticate these as provider events.",
      }),
    );
  },
);

export default router;