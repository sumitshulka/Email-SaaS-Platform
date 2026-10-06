import { useState } from "react";
import { useApplyCampaignUnsubscribe } from "@workspace/api-client-react";

export function CampaignUnsubscribePage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const unsubscribe = useApplyCampaignUnsubscribe();
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  const confirmUnsubscribe = () => {
    if (!token || unsubscribe.isPending || complete) return;
    setError("");
    unsubscribe.mutate(
      { params: { token } },
      {
        onSuccess: () => setComplete(true),
        onError: () =>
          setError(
            "We couldn’t process this link. It may be invalid; contact the sender if you still receive campaign emails.",
          ),
      },
    );
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f8fb] px-4 py-10">
      <section
        className="w-full max-w-lg rounded-xl border border-[#dce4ed] bg-white p-6 shadow-sm sm:p-8"
        aria-labelledby="unsubscribe-title"
      >
        <div className="mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#718197]">
          MAILFLOW PREFERENCES
        </div>
        <h1
          id="unsubscribe-title"
          className="display mt-3 text-[24px] font-bold text-[#172334]"
        >
          {complete ? "You’re unsubscribed" : "Unsubscribe from campaign emails"}
        </h1>
        {complete ? (
          <p className="mt-3 text-[14px] leading-6 text-[#536276]">
            This address will no longer receive campaign emails from this
            workspace.
          </p>
        ) : (
          <>
            <p className="mt-3 text-[14px] leading-6 text-[#536276]">
              Confirm below to stop receiving future campaign emails from this
              sender. This does not change any other account or service
              notifications.
            </p>
            {!token && (
              <p role="alert" className="mt-4 text-[13px] text-[#99501e]">
                This unsubscribe link is missing its confirmation token.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-4 text-[13px] text-[#99501e]">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={confirmUnsubscribe}
              disabled={!token || unsubscribe.isPending}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[#174f99] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {unsubscribe.isPending ? "Updating preferences…" : "Confirm unsubscribe"}
            </button>
          </>
        )}
        <p className="mt-6 border-t border-[#edf0f2] pt-4 text-[12px] leading-5 text-[#687587]">
          Mailflow is a product of Taskone Solutions Pvt Ltd.
        </p>
      </section>
    </main>
  );
}
