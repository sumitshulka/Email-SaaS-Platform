import type {
  GmailSyncDiagnosticOutcome,
  GmailSyncDiagnostics,
} from "@workspace/db";
import {
  GmailApiError,
  GmailHistoryExpiredError,
} from "./gmail-api";

type GmailSyncResult = {
  messagesChecked: number;
  candidateMessages: number;
  imported: number;
  duplicates: number;
  unmatched: number;
  warningCount: number;
};

export function gmailSyncDiagnosticsFromResult(
  result: GmailSyncResult,
): GmailSyncDiagnostics {
  let outcome: GmailSyncDiagnosticOutcome = "completed";
  if (result.unmatched > 0) {
    outcome = "unmatched_reports";
  } else if (result.warningCount > 0) {
    outcome = "parser_warning";
  } else if (result.candidateMessages === 0) {
    outcome = "no_dsn_found";
  } else if (result.imported === 0 && result.duplicates > 0) {
    outcome = "already_recorded";
  }

  return {
    messagesChecked: result.messagesChecked,
    dsnCandidates: result.candidateMessages,
    importedReports: result.imported,
    unmatchedReports: result.unmatched,
    warnings: result.warningCount,
    outcome,
  };
}

export function gmailSyncDiagnosticsFromError(
  error: unknown,
): GmailSyncDiagnostics {
  let outcome: GmailSyncDiagnosticOutcome = "sync_error";
  if (error instanceof GmailHistoryExpiredError) {
    outcome = "history_expired";
  } else if (
    error instanceof GmailApiError &&
    (error.status === 401 || error.providerCode === "invalid_grant")
  ) {
    outcome = "reauthorization_required";
  } else if (error instanceof GmailApiError) {
    outcome = "gmail_api_error";
  }

  return {
    messagesChecked: null,
    dsnCandidates: null,
    importedReports: null,
    unmatchedReports: null,
    warnings: null,
    outcome,
  };
}
