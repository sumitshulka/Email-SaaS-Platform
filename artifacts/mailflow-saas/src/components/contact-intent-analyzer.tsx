import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, LoaderCircle, RotateCw } from "lucide-react";

type Question = { id: string; text: string };
type Intent = { intent: string; confidence: number; evidence: string[]; suggestedNextStep: string };
type Snapshot = { questions: Question[]; noteCount: number; sentEmailCount: number; eligible: boolean; latest: { intents: Intent[]; analyzedAt: string } | null; allowance: { remaining: number; limit: number } | null; aiConfigured: boolean };
const key = (id: string) => ["contact-intent", id];

export function ContactIntentAnalyzer({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const state = useQuery({
    queryKey: key(contactId),
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${contactId}/intent`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load intent-analysis readiness.");
      return response.json() as Promise<Snapshot>;
    },
  });
  useEffect(() => { setAnswers({}); }, [state.data?.questions.map(q => q.id).join("|")]);
  const analyze = async () => {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/contacts/${contactId}/intent/analyze`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(body.error || "Intent analysis failed."); return; }
      setMessage(body.reused ? "No source information changed. Showing the saved analysis; no credit was used." : "Intent analysis completed. One company research credit was used.");
      await qc.invalidateQueries({ queryKey: key(contactId) });
      await qc.invalidateQueries({ queryKey: ["/api/company-intelligence/allowance"] });
    } catch { setMessage("Could not reach the analysis service. No analysis credit was used."); }
    finally { setPending(false); }
  };
  return <section className="mt-5 rounded-lg border border-[#dce5ef] bg-white p-5" data-testid="contact-intent-analyzer">
    <div className="flex items-start gap-3">
      <span className="rounded-lg bg-[#edf4fc] p-2 text-[#174f99]"><BrainCircuit className="h-5 w-5"/></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-[#24364b]">Buying intent</h2>
        <p className="mt-1 text-[12px] leading-5 text-[#566579]">Evidence-based analysis of your sent campaign emails, dated notes, and questionnaire answers. It does not assess personality or protected traits. A new analysis uses one shared company research credit; unchanged inputs reuse the saved result.</p>
      </div>
      <button type="button" onClick={() => void state.refetch()} aria-label="Refresh intent readiness" className="rounded-md p-2 text-[#627286] hover:bg-[#f2f5f8]"><RotateCw className="h-4 w-4"/></button>
    </div>
    {state.isLoading ? <p className="mt-4 text-sm text-slate-500">Loading analysis readiness…</p> : state.isError ? <p role="alert" className="mt-4 text-sm text-red-700">Could not load intent analysis. Refresh and try again.</p> : state.data && <>
      <div className="mt-4 rounded-md bg-[#f5f8fb] px-3 py-2 text-[12px] text-[#45566b]">
        {state.data.sentEmailCount} eligible sent emails · {state.data.noteCount} dated notes · {state.data.allowance?.remaining ?? 0} research credits remaining
      </div>
      {!state.data.eligible && <p className="mt-3 text-[12px] text-[#8a5b25]">Add at least 2 SMTP-accepted emails that were not reported bounced and 3 dated notes to enable analysis.</p>}
      {state.data.eligible && state.data.questions.map(question => <label key={question.id} className="mt-3 block">
        <span className="mb-1 block text-[12px] font-medium text-[#35465b]">{question.text}</span>
        <textarea maxLength={1000} rows={2} value={answers[question.id] ?? ""} onChange={e => setAnswers(prev => ({ ...prev, [question.id]: e.target.value }))} className="w-full rounded-md border border-[#d8dde4] px-3 py-2 text-[12px] text-[#26364a] focus:border-[#3b73b8] focus:outline-none" placeholder="Use only facts the contact shared."/>
      </label>)}
      <button type="button" disabled={pending || !state.data.eligible || !state.data.aiConfigured || !state.data.allowance?.remaining || state.data.questions.some(q => !answers[q.id]?.trim())} onClick={() => void analyze()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <BrainCircuit className="h-4 w-4"/>} {pending ? "Analyzing…" : "Analyze intent"}
      </button>
      {!state.data.aiConfigured && <p className="mt-2 text-[12px] text-amber-800">AI analysis is unavailable until the superadmin configures a provider.</p>}
      {state.data.latest && <div className="mt-5 border-t border-[#e7ebef] pt-4">
        <div className="mb-3 text-[12px] font-semibold text-[#35465b]">Latest analysis · {new Date(state.data.latest.analyzedAt).toLocaleString()}</div>
        {state.data.latest.intents.length ? <ul className="space-y-3">{state.data.latest.intents.map((intent, i) => <li key={`${intent.intent}-${i}`} className="rounded-md border border-[#e2e8ef] bg-[#fbfcfd] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-semibold text-[#24364b]">{intent.intent}</span><span className="text-[11px] text-[#566579]">{Math.round(intent.confidence * 100)}% evidence confidence</span></div>
          <p className="mt-1 text-[12px] text-[#45566b]">Suggested next step: {intent.suggestedNextStep}</p>
          <ul className="mt-2 list-disc pl-5 text-[11px] text-[#647286]">{intent.evidence.map((e, j) => <li key={j}>{e}</li>)}</ul>
        </li>)}</ul> : <p className="text-[12px] text-[#566579]">The available evidence did not support a specific buying intent.</p>}
      </div>}
      {message && <p role="status" className="mt-3 text-[12px] text-[#365d7f]">{message}</p>}
    </>}
  </section>;
}
