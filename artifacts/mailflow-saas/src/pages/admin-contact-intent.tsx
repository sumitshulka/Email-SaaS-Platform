import { useEffect, useState } from "react";
import { BrainCircuit, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
type Question = { id: string; text: string };
export default function AdminContactIntentPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/admin/contact-intent/questions", { credentials: "include" }).then(async r => {
      if (!r.ok) throw new Error();
      const data = await r.json(); setQuestions(data.questions);
    }).catch(() => setNotice("Could not load the questionnaire settings."));
  }, []);
  const save = async () => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/contact-intent/questions", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questions }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save questions.");
      setQuestions(result.questions); setNotice("Questionnaire saved. Users will see it in contact details.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Could not save questions."); }
    finally { setBusy(false); }
  };
  const update = (i: number, text: string) => setQuestions(current => current.map((q, n) => n === i ? { ...q, text } : q));
  const add = () => setQuestions(current => [...current, { id: `q${Date.now()}`, text: "" }]);
  return <main className="mx-auto max-w-4xl space-y-5 p-5 md:p-8">
    <header><div className="flex items-center gap-2 text-[#174f99]"><BrainCircuit className="h-5 w-5"/><span className="text-[11px] font-semibold uppercase tracking-wider">AI intent analysis</span></div><h1 className="mt-2 text-2xl font-semibold text-[#24364b]">Contact questionnaire</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#566579]">Set 8–10 factual questions about buying process and expressed needs. Avoid personality judgments, protected traits, or leading questions. Answers are private to the user's workspace and are sent with contact notes and sent-email content to the configured AI provider only when the user clicks Analyze intent.</p></header>
    <section className="rounded-lg border border-[#e0e4e9] bg-white p-5">
      <div className="space-y-3">{questions.map((q, i) => <div key={q.id} className="flex items-start gap-2">
        <span className="pt-3 text-xs font-semibold text-[#718196]">{i + 1}.</span>
        <textarea aria-label={`Question ${i + 1}`} maxLength={240} rows={2} value={q.text} onChange={e => update(i, e.target.value)} className="w-full rounded-md border border-[#d8dde4] px-3 py-2 text-sm text-[#24364b] focus:border-[#3b73b8] focus:outline-none"/>
        <button type="button" title="Remove question" onClick={() => setQuestions(current => current.filter((_, n) => n !== i))} className="mt-2 rounded p-2 text-[#8b4b4b] hover:bg-[#fbf1f1]"><Trash2 className="h-4 w-4"/></button>
      </div>)}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={questions.length >= 10} onClick={add} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[#d8dde4] px-3 text-xs font-semibold text-[#34465b] disabled:opacity-50"><Plus className="h-4 w-4"/>Add question</button>
        <button type="button" disabled={busy || questions.length < 8 || questions.length > 10 || questions.some(q => q.text.trim().length < 8)} onClick={() => void save()} className="inline-flex min-h-9 items-center gap-1 rounded-md bg-[#174f99] px-3 text-xs font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}Save questionnaire</button>
      </div>
      <p className="mt-3 text-xs text-[#68788b]">Keep 8–10 questions. Each question must be 8–240 characters.</p>
      {notice && <p role="status" className="mt-3 text-xs text-[#365d7f]">{notice}</p>}
    </section>
  </main>;
}
