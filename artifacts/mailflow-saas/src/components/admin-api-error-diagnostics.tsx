import {
  getListAdminApiErrorDiagnosticsQueryKey,
  useListAdminApiErrorDiagnostics,
} from "@workspace/api-client-react";
import type { AdminApiErrorDiagnostic } from "@workspace/api-client-react";

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
  const items = query.data?.items ?? [];
  const failure = query.isError ? getDiagnosticsFailure(query.error) : null;
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
    </section>
  );
}
