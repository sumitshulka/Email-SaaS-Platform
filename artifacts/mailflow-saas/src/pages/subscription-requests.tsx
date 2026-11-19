import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarClock,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  ShieldX,
  X,
} from "lucide-react";
import {
  getListAdminSubscriptionRequestsQueryKey,
  useApproveAdminSubscriptionRequest,
  useListAdminSubscriptionRequests,
  useRejectAdminSubscriptionRequest,
} from "@workspace/api-client-react";

type DecisionTarget = { requestId: string; userName: string };

const card = "rounded-lg border border-[#e0e5e9] bg-white";
const button =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const errText = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Please try again.";

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function stateLabel(status: string): string {
  switch (status) {
    case "auto_approved":
      return "Auto-granted";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}

export default function AdminSubscriptionRequestsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [rejectTarget, setRejectTarget] = useState<DecisionTarget | null>(null);
  const [reason, setReason] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const query = useListAdminSubscriptionRequests(
    { status: filter },
    {
      query: {
        queryKey: getListAdminSubscriptionRequestsQueryKey({ status: filter }),
        refetchInterval: filter === "pending" ? 30_000 : false,
      },
    },
  );
  const approve = useApproveAdminSubscriptionRequest();
  const reject = useRejectAdminSubscriptionRequest();
  const busy = approve.isPending || reject.isPending;
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getListAdminSubscriptionRequestsQueryKey(),
    });
  };

  const approveRequest = (requestId: string) => {
    setActionMessage(null);
    approve.mutate(
      { requestId },
      {
        onSuccess: (result) => {
          setActionMessage(result.message);
          refresh();
        },
        onError: (error) => setActionMessage(errText(error)),
      },
    );
  };

  const rejectRequest = () => {
    if (!rejectTarget || reason.trim().length < 10) return;
    setActionMessage(null);
    reject.mutate(
      { requestId: rejectTarget.requestId, data: { reason: reason.trim() } },
      {
        onSuccess: (result) => {
          setActionMessage(result.message);
          setRejectTarget(null);
          setReason("");
          refresh();
        },
        onError: (error) => setActionMessage(errText(error)),
      },
    );
  };

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-5 px-5 py-7 text-left sm:px-8">
      <header className="rounded-lg border border-[#d6e3ee] bg-[#f0f6fb] px-5 py-5 sm:px-6">
        <div className="mono text-[9px] uppercase tracking-[.16em] text-[#5f7890]">
          BILLING / CUSTOMER REQUESTS
        </div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="display text-[25px] font-bold text-[#1b3147]">
              Subscription Requests
            </h1>
            <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[#617589]">
              Review requests for a one-month Basic plan. Requests still pending after 72 hours are granted automatically.
            </p>
          </div>
          <div className="rounded-md border border-[#cedce8] bg-white px-3 py-2 text-[11px] font-semibold text-[#315d83]">
            {query.data?.pendingCount ?? 0} pending
          </div>
        </div>
      </header>

      {actionMessage && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-[#d4e4d8] bg-[#f2f8f3] px-4 py-3 text-[12px] text-[#386448]"
        >
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8edf0] px-4 py-3.5 sm:px-5">
          <div>
            <h2 className="text-[14px] font-bold text-[#28394c]">Request queue</h2>
            <p className="mt-1 text-[11px] text-[#748292]">
              Manual rejection is available only during the 72-hour review period and requires a reason.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Subscription request filter"
              data-testid="select-subscription-request-filter"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as "pending" | "all")
              }
              className="h-9 rounded-md border border-[#d8dde4] bg-white px-3 text-[11px] font-semibold text-[#405165]"
            >
              <option value="pending">Pending requests</option>
              <option value="all">All requests</option>
            </select>
            <button
              type="button"
              aria-label="Refresh subscription requests"
              data-testid="button-refresh-subscription-requests"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className={`${button} border-[#d8e1e8] bg-white text-[#425a70] hover:bg-[#f6f9fb]`}
            >
              {query.isFetching ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </button>
          </div>
        </div>

        {query.isLoading ? (
          <div role="status" className="flex items-center gap-2 px-5 py-12 text-[12px] text-[#68798a]">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading subscription requests…
          </div>
        ) : query.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-5 py-8 text-[12px] text-[#8b4a32]">
            <span>Subscription requests could not be loaded.</span>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className={`${button} border-[#e3c9bb] bg-white text-[#8b4a32]`}
            >
              Retry
            </button>
          </div>
        ) : query.data?.items.length ? (
          <div className="divide-y divide-[#edf0f2]">
            {query.data.items.map((request) => {
              const expired =
                request.status === "pending" &&
                new Date(request.decisionDeadlineAt).getTime() <= Date.now();
              return (
                <article
                  key={request.id}
                  data-testid={`row-subscription-request-${request.id}`}
                  className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-bold text-[#26394d]">
                        {request.userName}
                      </h3>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                        request.status === "pending"
                          ? "bg-[#fff3e5] text-[#955d22]"
                          : request.status === "rejected"
                            ? "bg-[#fcecee] text-[#a14454]"
                            : "bg-[#eaf5ed] text-[#397050]"
                      }`}>
                        {stateLabel(request.status)}
                      </span>
                      <span className="rounded-full bg-[#edf3f8] px-2 py-0.5 text-[9px] font-semibold text-[#456781]">
                        Request {request.milestone} of 3
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#66778a]">
                      {request.email} <span className="text-[#a5aeb7]">· @{request.username}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#788697]">
                      <span>Requested {dateTime(request.requestedAt)}</span>
                      <span className={expired ? "font-semibold text-[#a34b32]" : ""}>
                        <CalendarClock className="mr-1 inline h-3 w-3" />
                        Decision deadline {dateTime(request.decisionDeadlineAt)}
                      </span>
                    </div>
                    {request.rejectionReason && (
                      <p className="mt-2 rounded-md border border-[#f0d4d8] bg-[#fff7f8] px-3 py-2 text-[11px] leading-5 text-[#8f4350]">
                        Rejection reason: {request.rejectionReason}
                      </p>
                    )}
                    {request.grantStartsAt && request.grantEndsAt && (
                      <p className="mt-2 text-[10px] text-[#52705d]">
                        Basic term {dateTime(request.grantStartsAt)} – {dateTime(request.grantEndsAt)}. Free plan resumes afterward.
                      </p>
                    )}
                  </div>
                  {request.status === "pending" && (
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <button
                        type="button"
                        data-testid={`button-approve-subscription-request-${request.id}`}
                        disabled={busy || expired}
                        onClick={() => approveRequest(request.id)}
                        className={`${button} border-[#b8d5c0] bg-[#edf7ef] text-[#38704c] hover:bg-[#e1f0e4]`}
                      >
                        {approve.isPending ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <BadgeCheck className="h-3.5 w-3.5" />
                        )}
                        Approve
                      </button>
                      <button
                        type="button"
                        data-testid={`button-reject-subscription-request-${request.id}`}
                        disabled={busy || expired}
                        onClick={() => {
                          setReason("");
                          setRejectTarget({
                            requestId: request.id,
                            userName: request.userName,
                          });
                        }}
                        className={`${button} border-[#e8c7cb] bg-[#fff7f8] text-[#9a4855] hover:bg-[#fcecee]`}
                      >
                        <ShieldX className="h-3.5 w-3.5" />
                        Reject
                      </button>
                      {expired && (
                        <span className="basis-full text-right text-[10px] text-[#a34b32]">
                          The automatic grant is due; rejection is no longer available.
                        </span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <CircleAlert className="mx-auto h-5 w-5 text-[#8b98a5]" />
            <h3 className="mt-2 text-[13px] font-semibold text-[#46576a]">
              {filter === "pending" ? "No pending requests" : "No requests yet"}
            </h3>
            <p className="mt-1 text-[11px] text-[#7b8794]">
              {filter === "pending"
                ? "New eligible requests will appear here for 72-hour review."
                : "Subscription request history will appear here."}
            </p>
          </div>
        )}
      </section>

      {rejectTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#14202d]/55 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscription-request-reject-title"
            data-testid="dialog-reject-subscription-request"
            className="w-full max-w-lg rounded-lg border border-[#e2e7eb] bg-white p-5 shadow-xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mono text-[9px] uppercase tracking-[.15em] text-[#8a6670]">
                  MANUAL DECISION
                </div>
                <h2 id="subscription-request-reject-title" className="display mt-1 text-[20px] font-bold text-[#2d3542]">
                  Reject request
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close rejection dialog"
                onClick={() => setRejectTarget(null)}
                className="rounded p-1 text-[#6d7885] hover:bg-[#f1f4f6]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-[12px] leading-5 text-[#657385]">
              Give {rejectTarget.userName} a clear reason. The reason will be shown in their Plans page and sent as an in-app notification.
            </p>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#35475a]">
                Rejection reason <span className="font-normal text-[#7b8794]">(at least 10 characters)</span>
              </span>
              <textarea
                data-testid="textarea-subscription-request-rejection-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                rows={4}
                className="w-full rounded-md border border-[#d8dde4] px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#b96b77] focus:ring-2 focus:ring-[#fae9ec]"
                placeholder="Explain why the request cannot be approved…"
              />
            </label>
            {reject.isError && (
              <p role="alert" className="mt-2 text-[11px] text-[#a34b32]">
                The request was not rejected. {errText(reject.error)}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className={`${button} border-[#d8dde4] bg-white text-[#4f5f70]`}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="button-confirm-subscription-request-rejection"
                disabled={reason.trim().length < 10 || busy}
                onClick={rejectRequest}
                className={`${button} border-[#a84f5a] bg-[#a84f5a] text-white hover:bg-[#913f49]`}
              >
                {reject.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                Reject and notify
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
