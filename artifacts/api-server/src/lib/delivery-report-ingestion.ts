import { createHash } from "node:crypto";
import { and, desc, eq, type SQL } from "drizzle-orm";
import {
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  emailDeliveryReportsTable,
  emailSendAttemptsTable,
  gmailMailboxConnectionsTable,
} from "@workspace/db";
import type { ParsedDeliveryReport } from "./delivery-report-parser";

export type DeliveryEvidenceVerification =
  | "user_imported"
  | "gmail_authorized";

export type DeliveryReportIngestionResult = {
  imported: number;
  duplicates: number;
  unmatched: number;
  ignored: number;
  warnings: string[];
};

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
    reportEvidenceVerification: string | null;
  },
  incomingOutcome: string,
  incomingAt: Date | null,
  incomingVerification: DeliveryEvidenceVerification,
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

  const currentOutcomePriority =
    REPORT_OUTCOME_PRIORITY[current.reportOutcome] ?? -1;
  const incomingOutcomePriority =
    REPORT_OUTCOME_PRIORITY[incomingOutcome] ?? -1;
  if (incomingOutcomePriority !== currentOutcomePriority) {
    return incomingOutcomePriority > currentOutcomePriority;
  }

  return (
    incomingVerification === "gmail_authorized" &&
    current.reportEvidenceVerification !== "gmail_authorized"
  );
}

export async function ingestDeliveryReports(options: {
  userId: string;
  reports: ParsedDeliveryReport[];
  receivedAt?: Date;
  campaignId?: string;
  verification?: DeliveryEvidenceVerification;
  gmailMailboxConnectionId?: string;
}): Promise<DeliveryReportIngestionResult> {
  const {
    userId,
    reports,
    campaignId,
    verification = "user_imported",
    gmailMailboxConnectionId = null,
  } = options;
  if (verification === "gmail_authorized" && !gmailMailboxConnectionId) {
    throw new Error("Gmail-authenticated evidence requires its mailbox connection.");
  }

  let imported = 0;
  let duplicates = 0;
  let unmatched = 0;
  let ignored = 0;
  const warnings: string[] = [];
  const receivedAt = options.receivedAt ?? new Date();

  for (const report of reports) {
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
      report.diagnostic
        ?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
        .slice(0, 4000) ?? null;
    const statusCode = report.enhancedStatus?.slice(0, 64) ?? null;
    const result = await db.transaction(async (tx) => {
      if (gmailMailboxConnectionId) {
        const [connection] = await tx
          .select({ id: gmailMailboxConnectionsTable.id })
          .from(gmailMailboxConnectionsTable)
          .where(
            and(
              eq(gmailMailboxConnectionsTable.id, gmailMailboxConnectionId),
              eq(gmailMailboxConnectionsTable.userId, userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!connection) return { status: "connection_missing" as const };
      }

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

      const { attempt, recipientId } = candidateRows[0]!;
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
      // RFC DSN timestamps have whole-second precision; a valid immediate
      // report can precede a millisecond send timestamp in the same second.
      const earliestReportTimestamp =
        report.source === "dsn"
          ? Math.floor(attempt.attemptedAt.getTime() / 1000) * 1000
          : attempt.attemptedAt.getTime();
      if (
        occurredAt &&
        (occurredAt.getTime() < earliestReportTimestamp ||
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
        verification,
        gmailMailboxConnectionId,
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
          evidenceVerification: verification,
          gmailMailboxConnectionId,
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
          verification,
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
          reportEvidenceVerification: verification,
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

    if (result.status === "unmatched" || result.status === "connection_missing") {
      unmatched += 1;
    } else if (result.status === "ignored") {
      ignored += 1;
      warnings.push(result.warning);
    } else if (result.status === "duplicate") {
      duplicates += 1;
    } else {
      imported += 1;
      if (result.warning) warnings.push(result.warning);
    }
  }

  return {
    imported,
    duplicates,
    unmatched,
    ignored,
    warnings: warnings.slice(0, 200),
  };
}