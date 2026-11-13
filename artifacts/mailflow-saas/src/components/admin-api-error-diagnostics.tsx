import {
  getListAdminApiErrorDiagnosticsQueryKey,
  useListAdminApiErrorDiagnostics,
} from "@workspace/api-client-react";
import type { AdminApiErrorDiagnostic } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";

type RemoteFailure = {
  errorName: string;
  rootErrorName: string | null;
  errorCode: string | null;
  databaseSchema: string | null;
  databaseTable: string | null;
  databaseColumn: string | null;
  databaseConstraint: string | null;
  errorMessage: string | null;
};

type RemoteDiagnosticsReport = {
  checkedAt: string;
  status: "ok" | "degraded";
  database: { reachable: boolean; failure: RemoteFailure | null };
  diagnostics: {
    captureEnabled: boolean;
    tablePresent: boolean | null;
    readable: boolean | null;
    failure: RemoteFailure | null;
    recentErrors: AdminApiErrorDiagnostic[];
  };
  issues: string[];
};

type RemoteRequestError = Error & {
  status?: number;
  code?: string;
  upstreamStatus?: number;
};

async function fetchRemoteDiagnostics(): Promise<RemoteDiagnosticsReport> {
  const response = await fetch("/api/admin/remote-diagnostics", {
    credentials: "include",
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const error = new Error(
      typeof data.error === "string" ? data.error : "Production diagnostics could not be loaded.",
    ) as RemoteRequestError;
    error.status = response.status;
    error.code = typeof data.code === "string" ? data.code : undefined;
    error.upstreamStatus = typeof data.upstreamStatus === "number" ? data.upstreamStatus : undefined;
    throw error;
  }
  return body as RemoteDiagnosticsReport;
}

function remoteFailureText(error: RemoteRequestError): string {
  if (error.code === "REMOTE_DIAGNOSTICS_NOT_CONFIGURED") {
    return "Configure the production origin and matching HMAC secret on the Replit API, and set the same secret on production.";
  }
  if (error.code === "REMOTE_DIAGNOSTICS_UPSTREAM_ERROR") {
    return `Production rejected the signed request (HTTP ${error.upstreamStatus ?? "unknown"}). Confirm both services use the same secret and the updated API is deployed.`;
  }
  if (error.code === "REMOTE_DIAGNOSTICS_UNREACHABLE") {
    return "The production diagnostics endpoint could not be reached. Confirm the production API is online and deployed.";
  }
  return error.message;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getDiagnosticsFailure(error: unknown): {
  status: number | null;
  code: string | null;
  incidentId: string | null;
} {
  if (!error || typeof error !== "object") {
    return { status: null, code: null, incidentId: null };
  }
  const record = error as Record<string, unknown>;
  const data = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : null;
  const headers = record.headers;
  const headerIncidentId = headers && typeof headers === "object" && "get" in headers &&
      typeof headers.get === "function"
    ? headers.get("x-error-id")
    : null;
  return {
    status: typeof record.status === "number" ? record.status : null,
    code: typeof data?.code === "string" ? data.code : null,
    incidentId: typeof data?.incidentId === "string"
      ? data.incidentId
      : typeof headerIncidentId === "string"
        ? headerIncidentId
        : null,
  };
}

function DiagnosticRecord({ item }: { item: AdminApiErrorDiagnostic }) {
  return (
    <details
      data-testid={`diagnostic-record-${item.id}`}
      className="rounded-md border border-[#e2e7ed] bg-white"
    >
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[11px]">
        <span className="font-semibold text-[#27364a]">
          {item.method} {item.path}
        </span>
        <span className="mono text-[10px] text-[#647286]">
          {item.errorCode ? `${item.errorCode} · ` : ""}{item.errorName}
        </span>
        <span className="text-[10px] text-[#778291]">{formatDate(item.occurredAt)}</span>
        <span className="mono w-full break-all text-[9px] text-[#87919d]">
          Reference {item.id}
        </span>
      </summary>
      <div className="space-y-3 border-t border-[#e8ebef] bg-[#fafbfd] p-3 text-[11px]">
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <div><dt className="font-semibold text-[#536174]">Root error</dt><dd className="mt-0.5 text-[#344154]">{item.rootErrorName || "Not available"}</dd></div>
          <div><dt className="font-semibold text-[#536174]">Database location</dt><dd className="mt-0.5 break-all text-[#344154]">{[item.databaseSchema, item.databaseTable, item.databaseColumn].filter(Boolean).join(".") || "Not available"}</dd></div>
          <div className="sm:col-span-2"><dt className="font-semibold text-[#536174]">Sanitized error</dt><dd className="mt-0.5 break-words font-mono text-[#344154]">{item.errorMessage || "No message was recorded."}</dd></div>
        </dl>
        {item.databaseConstraint && <p><span className="font-semibold text-[#536174]">Constraint: </span><span className="font-mono">{item.databaseConstraint}</span></p>}
        <div>
          <h3 className="font-semibold text-[#536174]">Stack frames</h3>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-[#e2e7ed] bg-white p-2 font-mono text-[10px] leading-4 text-[#46556a]">{item.stackTrace || "No stack frames were recorded."}</pre>
        </div>
      </div>
    </details>
  );
}

export function AdminApiErrorDiagnosticsPanel({ enabled }: { enabled: boolean }) {
  const query = useListAdminApiErrorDiagnostics({
    query: {
      queryKey: getListAdminApiErrorDiagnosticsQueryKey(),
      staleTime: 0,
      refetchOnMount: "always",
    },
  });
  const remoteQuery = useQuery<RemoteDiagnosticsReport, RemoteRequestError>({
    queryKey: ["admin", "remote-production-diagnostics"],
    queryFn: fetchRemoteDiagnostics,
    enabled: false,
    retry: false,
    staleTime: 0,
  });
  const items = query.data?.items ?? [];
  const failure = query.isError ? getDiagnosticsFailure(query.error) : null;
  const remoteFailure = remoteQuery.isError ? remoteQuery.error : null;
  const remoteReport = remoteQuery.data;
  const failureMessage = failure?.status === 401
    ? "Your session may have expired. Sign in again as a superadmin."
    : failure?.status === 403
      ? "Superadmin access is required to view these reports."
      : failure?.status === 404
        ? "The API serving this page does not have the diagnostics endpoint. Deploy the updated API service."
        : "The API could not return diagnostic records. Check its logs using the reference ID and confirm the migration ran against the database used by this API.";

  return (
    <section
      data-testid="panel-admin-api-error-diagnostics"
      className="mt-8 rounded-lg border border-[#dfe4ea] bg-[#f8fafc] p-5 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">SUPERADMIN ONLY</div>
          <h2 className="display mt-2 text-[20px] font-bold text-[#243348]">Recent API error diagnostics</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[#687587]">
            Only unexpected server errors are captured. Request bodies, cookies, authorization headers, query values, and account identifiers are not stored. Messages are redacted; records older than 14 days are trimmed when capture runs or this panel loads, with a 500-record cap.
          </p>
        </div>
        <button
          type="button"
          data-testid="button-refresh-api-error-diagnostics"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="min-h-9 rounded-md border border-[#d7dce3] bg-white px-3 text-[11px] font-semibold text-[#344154] disabled:opacity-55"
        >
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {!enabled && (
        <p data-testid="status-api-error-diagnostics-disabled" className="mt-4 rounded-md border border-[#e7dcbf] bg-[#fffaf0] px-3 py-2.5 text-[11px] leading-5 text-[#70592c]">
          Detailed capture is off. Turn it on under Error diagnostics above and save platform settings before reproducing an error. Existing records remain visible until they expire.
        </p>
      )}
      {query.isLoading ? (
        <p className="mt-4 rounded-md bg-white px-3 py-5 text-center text-[11px] text-[#778291]">Loading diagnostics…</p>
      ) : query.isError ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-3 text-[11px] text-[#99501e]">
          <span className="space-y-1">
            <span className="block">{failureMessage}</span>
            {failure && (failure.status !== null || failure.code) && (
              <span data-testid="diagnostics-request-status" className="block font-mono text-[10px]">
                {failure.status !== null ? `HTTP ${failure.status}` : ""}
                {failure.status !== null && failure.code ? " · " : ""}
                {failure.code || ""}
              </span>
            )}
            {failure?.incidentId && (
              <span data-testid="diagnostics-request-incident-id" className="mono block break-all text-[10px]">
                Reference ID: {failure.incidentId}
              </span>
            )}
          </span>
          <button type="button" onClick={() => void query.refetch()} className="rounded border border-[#e7c9ac] bg-white px-3 py-1.5 font-semibold">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <p data-testid="empty-api-error-diagnostics" className="mt-4 rounded-md border border-dashed border-[#dce2e9] bg-white px-3 py-8 text-center text-[11px] text-[#778291]">
          No captured server errors. Enable capture, reproduce the problem, then refresh this panel.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => <DiagnosticRecord key={item.id} item={item}/>)}
        </div>
      )}
      <div className="mt-7 border-t border-[#dfe4ea] pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-bold text-[#243348]">Self-hosted production check</h3>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[#687587]">
              Runs a read-only, signed check against the configured production API. It reports database reachability, diagnostics-table readiness, capture status, and recent sanitized errors.
            </p>
          </div>
          <button
            type="button"
            data-testid="button-check-production-diagnostics"
            onClick={() => void remoteQuery.refetch()}
            disabled={remoteQuery.isFetching}
            className="min-h-9 rounded-md border border-[#d7dce3] bg-white px-3 text-[11px] font-semibold text-[#344154] disabled:opacity-55"
          >
            {remoteQuery.isFetching ? "Checking…" : "Check production"}
          </button>
        </div>
        {remoteFailure && (
          <div role="alert" data-testid="status-production-diagnostics-error" className="mt-3 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-3 text-[11px] leading-5 text-[#99501e]">
            <p>{remoteFailureText(remoteFailure)}</p>
            <p className="mono mt-1 text-[10px]">
              {remoteFailure.status ? `HTTP ${remoteFailure.status}` : ""}
              {remoteFailure.status && remoteFailure.code ? " · " : ""}
              {remoteFailure.code || ""}
            </p>
            <button type="button" onClick={() => void remoteQuery.refetch()} className="mt-2 rounded border border-[#e7c9ac] bg-white px-2.5 py-1 font-semibold">Retry</button>
          </div>
        )}
        {remoteReport && (
          <div data-testid="panel-production-diagnostics-report" className="mt-3 space-y-3">
            <div className={`rounded-md border px-3 py-3 text-[11px] ${remoteReport.status === "ok" ? "border-[#c8e2d3] bg-[#eff8f2] text-[#315b42]" : "border-[#f0d5bd] bg-[#fff8f1] text-[#81501e]"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{remoteReport.status === "ok" ? "Production checks passed" : "Production needs attention"}</strong>
                <span className="text-[10px]">Checked {formatDate(remoteReport.checkedAt)}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <span>Database: <strong>{remoteReport.database.reachable ? "reachable" : "unavailable"}</strong></span>
                <span>Diagnostics table: <strong>{remoteReport.diagnostics.tablePresent === null ? "not checked" : remoteReport.diagnostics.tablePresent ? remoteReport.diagnostics.readable ? "ready" : "not readable" : "missing"}</strong></span>
                <span>Error capture: <strong>{remoteReport.diagnostics.captureEnabled ? "on" : "off"}</strong></span>
              </div>
            </div>
            {remoteReport.issues.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md border border-[#e2e7ed] bg-white px-4 py-3 pl-7 text-[11px] text-[#536174]">
                {remoteReport.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            )}
            {remoteReport.database.failure && (
              <p className="break-words rounded-md border border-[#e2e7ed] bg-white px-3 py-2 text-[10px] text-[#536174]">
                Database error: <span className="mono">{remoteReport.database.failure.errorCode || remoteReport.database.failure.rootErrorName || remoteReport.database.failure.errorName}</span>
                {remoteReport.database.failure.errorMessage && <span className="mt-1 block font-mono">{remoteReport.database.failure.errorMessage}</span>}
              </p>
            )}
            {remoteReport.diagnostics.failure && (
              <p className="break-words rounded-md border border-[#e2e7ed] bg-white px-3 py-2 text-[10px] text-[#536174]">
                Diagnostics query error: <span className="mono">{remoteReport.diagnostics.failure.errorCode || remoteReport.diagnostics.failure.rootErrorName || remoteReport.diagnostics.failure.errorName}</span>
                {remoteReport.diagnostics.failure.errorMessage && <span className="mt-1 block font-mono">{remoteReport.diagnostics.failure.errorMessage}</span>}
              </p>
            )}
            {remoteReport.diagnostics.recentErrors.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-[#536174]">Recent production errors</h4>
                {remoteReport.diagnostics.recentErrors.map((item) => <DiagnosticRecord key={`production-${item.id}`} item={item}/>)}
              </div>
            ) : (
              remoteReport.diagnostics.tablePresent && remoteReport.diagnostics.readable && (
                <p className="rounded-md border border-dashed border-[#dce2e9] bg-white px-3 py-5 text-center text-[11px] text-[#778291]">
                  No captured production errors are available.
                </p>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}
