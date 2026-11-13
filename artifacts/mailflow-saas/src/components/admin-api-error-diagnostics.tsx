import {
  getListAdminApiErrorDiagnosticsQueryKey,
  useListAdminApiErrorDiagnostics,
} from "@workspace/api-client-react";
import type { AdminApiErrorDiagnostic } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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

type RemoteDiagnosticsKeyConfig = {
  role: "caller" | "verifier";
  configured: boolean;
  updatedAt: string | null;
};

async function requestRemoteDiagnosticsKeyConfig(
  method: "GET" | "PUT" | "DELETE",
  hmacSecret?: string,
): Promise<RemoteDiagnosticsKeyConfig> {
  const response = await fetch("/api/admin/remote-diagnostics/configuration", {
    method,
    credentials: "include",
    cache: "no-store",
    ...(hmacSecret ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hmacSecret }),
    } : {}),
  });
  if (response.status === 204) return { role: "verifier", configured: false, updatedAt: null };
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
    throw new Error(typeof data.error === "string" ? data.error : "The diagnostics key setting could not be updated.");
  }
  return body as RemoteDiagnosticsKeyConfig;
}

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
    return "Configure the Replit caller key in Tools → Secrets and the matching verifier key in production’s Diagnostics settings.";
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
  const queryClient = useQueryClient();
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
  const keyConfigQuery = useQuery({
    queryKey: ["admin", "remote-diagnostics-key-config"],
    queryFn: () => requestRemoteDiagnosticsKeyConfig("GET"),
    staleTime: 0,
  });
  const [hmacSecret, setHmacSecret] = useState("");
  const [removeKeyConfirmation, setRemoveKeyConfirmation] = useState(false);
  const [keySettingMessage, setKeySettingMessage] = useState<string | null>(null);
  const saveKeyMutation = useMutation({
    mutationFn: (secret: string) => requestRemoteDiagnosticsKeyConfig("PUT", secret),
    onSuccess: async () => {
      setHmacSecret("");
      setKeySettingMessage("Key saved encrypted. Its value will not be shown again.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "remote-diagnostics-key-config"] });
    },
    onError: (error: Error) => setKeySettingMessage(error.message),
  });
  const removeKeyMutation = useMutation({
    mutationFn: () => requestRemoteDiagnosticsKeyConfig("DELETE"),
    onSuccess: async () => {
      setRemoveKeyConfirmation(false);
      setKeySettingMessage("Saved key removed from this environment.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "remote-diagnostics-key-config"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "remote-production-diagnostics"] });
    },
    onError: (error: Error) => setKeySettingMessage(error.message),
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
        <div className="mb-5 rounded-md border border-[#dfe4ea] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-bold text-[#243348]">
                {keyConfigQuery.data?.role === "caller" ? "Replit diagnostics caller key" : "Production diagnostics verifier key"}
              </h3>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[#687587]">
                {keyConfigQuery.data?.role === "caller"
                  ? "The caller key is read from this Replit project’s Secrets. Save the matching verifier key in the Diagnostics settings of your self-hosted production app."
                  : "Generate one 64-character hex key and save it here, then add the same value as MAILFLOW_DIAGNOSTICS_HMAC_SECRET in your Replit project’s Secrets. The production copy is encrypted at rest and never returned after saving."}
              </p>
            </div>
            <span data-testid="status-production-diagnostics-key" className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${keyConfigQuery.data?.configured ? "bg-[#e8f4ec] text-[#38684a]" : "bg-[#f1f3f6] text-[#657286]"}`}>
              {keyConfigQuery.isLoading ? "Checking…" : keyConfigQuery.data?.configured ? "Key saved" : "Not configured"}
            </span>
          </div>
          {keyConfigQuery.data?.role === "verifier" && (
            <>
              <form
                className="mt-3 flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setKeySettingMessage(null);
                  saveKeyMutation.mutate(hmacSecret);
                }}
              >
                <label className="sr-only" htmlFor="production-diagnostics-hmac-secret">Diagnostics HMAC key</label>
                <input
                  id="production-diagnostics-hmac-secret"
                  data-testid="input-production-diagnostics-hmac-secret"
                  type="password"
                  autoComplete="new-password"
                  maxLength={64}
                  value={hmacSecret}
                  onChange={(event) => setHmacSecret(event.target.value)}
                  placeholder="Paste the 64-character hex key"
                  className="min-h-9 min-w-[260px] flex-1 rounded-md border border-[#d7dce3] bg-white px-3 text-[11px] text-[#344154] outline-none focus:border-[#467db3]"
                />
                <button
                  type="submit"
                  data-testid="button-save-production-diagnostics-key"
                  disabled={!/^[0-9a-f]{64}$/i.test(hmacSecret) || saveKeyMutation.isPending}
                  className="min-h-9 rounded-md bg-[#174f99] px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {saveKeyMutation.isPending ? "Saving…" : keyConfigQuery.data?.configured ? "Replace key" : "Save key"}
                </button>
                {keyConfigQuery.data?.configured && !removeKeyConfirmation && (
                  <button type="button" onClick={() => setRemoveKeyConfirmation(true)} className="min-h-9 rounded-md border border-[#d7dce3] px-3 text-[11px] font-semibold text-[#536174]">
                    Remove key
                  </button>
                )}
              </form>
              {removeKeyConfirmation && (
                <div role="alertdialog" aria-label="Remove diagnostics key confirmation" className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[#efd6c0] bg-[#fff8f1] px-3 py-2.5 text-[11px] text-[#81501e]">
                  <span>Removing this key disables signed diagnostics in this environment.</span>
                  <button type="button" disabled={removeKeyMutation.isPending} onClick={() => removeKeyMutation.mutate()} className="rounded bg-[#a9472d] px-2.5 py-1.5 font-semibold text-white disabled:opacity-50">
                    {removeKeyMutation.isPending ? "Removing…" : "Confirm remove"}
                  </button>
                  <button type="button" onClick={() => setRemoveKeyConfirmation(false)} className="rounded border border-[#e4c9b2] bg-white px-2.5 py-1.5 font-semibold">
                    Keep key
                  </button>
                </div>
              )}
              {keyConfigQuery.data?.updatedAt && <p className="mt-2 text-[10px] text-[#778291]">Last updated {formatDate(keyConfigQuery.data.updatedAt)}</p>}
              {keySettingMessage && <p role="status" className="mt-2 text-[11px] text-[#536174]">{keySettingMessage}</p>}
            </>
          )}
          {keyConfigQuery.data?.role === "caller" && !keyConfigQuery.data.configured && (
            <p className="mt-3 text-[11px] text-[#99501e]">Add MAILFLOW_DIAGNOSTICS_HMAC_SECRET under Tools → Secrets in this Replit project.</p>
          )}
          {keyConfigQuery.isError && <p role="alert" className="mt-2 text-[11px] text-[#99501e]">Key status could not be loaded. <button type="button" className="font-semibold underline" onClick={() => void keyConfigQuery.refetch()}>Retry</button></p>}
        </div>
        {keyConfigQuery.data?.role === "caller" && (
          <>
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
                disabled={remoteQuery.isFetching || !keyConfigQuery.data.configured}
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
          </>
        )}
      </div>
    </section>
  );
}
