import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Layers3, LoaderCircle, Plus, Settings2, Trash2 } from "lucide-react";
import {
  getGetContactFieldOptionsQueryKey,
  useCreateContactFieldOption,
  useDeleteContactFieldOption,
  useGetContactFieldOptions,
} from "@workspace/api-client-react";
import type { ContactFieldKey, ContactFieldOption } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const fieldDetails: Array<{ field: ContactFieldKey; title: string; description: string }> = [
  { field: "lifecycleStage", title: "Lifecycle stages", description: "Where each contact is in your customer lifecycle." },
  { field: "leadStatus", title: "Lead statuses", description: "The current qualification or follow-up status of a lead." },
  { field: "leadSource", title: "Lead sources", description: "How a contact first entered your workspace." },
  { field: "jobTitle", title: "Job titles", description: "Standard job titles for your contact records." },
  { field: "preferredLanguage", title: "Preferred languages", description: "Languages your contacts may prefer for communication." },
];
const valueNames: Record<ContactFieldKey, string> = {
  lifecycleStage: "lifecycle stage",
  leadStatus: "lead status",
  leadSource: "lead source",
  jobTitle: "job title",
  preferredLanguage: "preferred language",
};
const panelClass = "rounded-xl border border-[#dce4ed] bg-white shadow-[0_4px_18px_rgba(19,43,70,.035)]";
const inputClass = "h-10 w-full rounded-lg border border-[#d7e0e9] bg-white px-3 text-[12px] text-[#1a2b40] outline-none transition placeholder:text-[#9ba6b2] focus:border-[#4c80b8] focus:ring-2 focus:ring-[#dce9f6]";

function MasterCard({
  field,
  title,
  description,
  options,
  onAdd,
  onRemove,
  busy,
}: {
  field: ContactFieldKey;
  title: string;
  description: string;
  options: ContactFieldOption[];
  onAdd: (field: ContactFieldKey, value: string) => Promise<void>;
  onRemove: (option: ContactFieldOption) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  const entries = options.filter(option => option.field === field);
  const valueName = valueNames[field];
  return <div data-testid={`section-master-${field}`} className="grid items-start gap-5 xl:grid-cols-[minmax(290px,.7fr)_minmax(0,1.3fr)]">
    <section className={`${panelClass} p-5`}>
      <div className="mono text-[9px] tracking-[.14em] text-[#71869a]">NEW CONTACT FIELD VALUE</div>
      <h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Add a {valueName}</h2>
      <p className="mt-1 text-[10px] leading-5 text-[#8290a0]">{description}</p>
      <form onSubmit={event => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        void onAdd(field, trimmed).then(() => setValue("")).catch(() => undefined);
      }} className="mt-5 space-y-5">
        <label className="block space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#66778a]">Value</span>
          <input aria-label={`New ${valueName}`} data-testid={`input-master-${field}`} value={value}
            onChange={event => setValue(event.target.value)} maxLength={200} className={inputClass} placeholder="Enter a value"/>
        </label>
        <button type="submit" data-testid={`button-add-master-${field}`} disabled={!value.trim() || busy}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#164f91] bg-[#164f91] px-4 text-[12px] font-bold text-white transition hover:-translate-y-px hover:bg-[#103e76] disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <Plus className="h-3.5 w-3.5"/>}
          {busy ? "Adding…" : "Add value"}
        </button>
      </form>
    </section>
    <section className={`${panelClass} overflow-hidden`}>
      <header className="flex items-center justify-between gap-3 border-b border-[#e8edf2] bg-[#fbfcfd] px-5 py-4">
        <div>
          <div className="mono text-[9px] tracking-[.14em] text-[#71869a]">SAVED SETTINGS</div>
          <h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Configured {title.toLowerCase()}</h2>
        </div>
        <span className="shrink-0 rounded-full bg-[#edf1f4] px-2 py-1 text-[10px] font-semibold tabular-nums text-[#647487]">{entries.length} {entries.length === 1 ? "value" : "values"}</span>
      </header>
      {entries.length ? <ul className="divide-y divide-[#edf1f4]">
        {entries.map(option => <li key={option.id} data-testid={`row-master-${option.id}`} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#eff5f9] text-[#547895]"><Check className="h-3 w-3" strokeWidth={2.2}/></span>
            <span className="min-w-0 break-words text-[11px] font-semibold text-[#34485d]">{option.value}</span>
          </div>
          <button type="button" data-testid={`button-remove-master-${option.id}`} onClick={() => onRemove(option)}
            aria-label={`Remove ${option.value}`} disabled={busy}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#9a5245] transition-colors hover:bg-[#fff0ec] disabled:opacity-40"><Trash2 className="h-3.5 w-3.5"/></button>
        </li>)}
      </ul> : <div data-testid={`empty-master-${field}`} className="px-5 py-12 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f0f4f7] text-[#69839b]"><Layers3 className="h-4 w-4"/></div>
        <p className="mt-3 text-[11px] text-[#8290a0]">No {title.toLowerCase()} configured yet.</p>
        <p className="mt-1 text-[10px] text-[#8996a3]">Add a value using the form.</p>
      </div>}
    </section>
  </div>;
}

export default function ContactFieldSettingsPage() {
  const query = useGetContactFieldOptions();
  const create = useCreateContactFieldOption();
  const remove = useDeleteContactFieldOption();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const options = query.data?.options ?? [];
  const add = async (field: ContactFieldKey, value: string) => {
    setNotice(null);
    try {
      const result = await create.mutateAsync({ data: { field, value } });
      void qc.invalidateQueries({ queryKey: getGetContactFieldOptionsQueryKey() });
      setNotice({ error: false, text: `${result.option.value} added to ${fieldDetails.find(item => item.field === field)?.title.toLowerCase()}.` });
    } catch (cause) {
      const data = cause && typeof cause === "object" && "data" in cause && cause.data && typeof cause.data === "object"
        ? cause.data as { error?: unknown }
        : null;
      const message = typeof data?.error === "string" ? data.error : cause instanceof Error ? cause.message : "The value could not be added.";
      setNotice({ error: true, text: message });
      throw cause;
    }
  };
  const removeOption = (option: ContactFieldOption) => {
    setNotice(null);
    remove.mutate({ optionId: option.id }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetContactFieldOptionsQueryKey() });
        setNotice({ error: false, text: `${option.value} removed from the contact field master.` });
      },
      onError: error => {
        const data = error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object"
          ? error.data as { error?: unknown }
          : null;
        setNotice({ error: true, text: typeof data?.error === "string" ? data.error : error instanceof Error ? error.message : "The value could not be removed." });
      },
    });
  };

  return <div className="fade-in">
    <header className="mb-7">
      <div className="mono mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]"><span className="text-[#d4813d]">WORKSPACE</span><span className="text-[#b8c0c8]">/</span>CONTACT DATA</div>
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <h1 className="display text-[30px] font-bold leading-tight tracking-[-.04em] text-[#172334] sm:text-[34px]">Contact field settings</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#687484]">Manage the approved values your team uses to describe and qualify contacts.</p>
        </div>
        <div className="flex max-w-[330px] items-start gap-3 rounded-lg border border-[#dce6ee] bg-[#f4f8fb] px-3.5 py-3">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#58826f]"/>
          <p className="text-[11px] leading-[1.6] text-[#53697d]"><span className="font-semibold text-[#34536c]">Workspace only.</span> These lists are private to your team and won’t affect other workspaces.</p>
        </div>
      </div>
    </header>
    {notice && <div role={notice.error ? "alert" : "status"} data-testid="status-contact-field-settings"
      className={`mb-5 rounded-lg border px-4 py-3 text-[12px] ${notice.error ? "border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]" : "border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]"}`}>{notice.text}</div>}
    {query.isLoading ? <div aria-label="Loading contact field settings" className="grid animate-pulse gap-4 md:grid-cols-2"><div className="h-56 rounded-lg bg-[#edf2f5]"/><div className="h-56 rounded-lg bg-[#edf2f5]"/><div className="h-56 rounded-lg bg-[#edf2f5]"/></div>
      : query.isError ? <section role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-[#f0d5bd] bg-[#fff8f1] p-5 text-[12px] text-[#99501e]">
        <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4"/>Contact field settings could not be loaded.</span>
        <button type="button" onClick={() => void query.refetch()} className="rounded-md px-3 py-2 font-semibold text-[#245b9b] hover:bg-[#edf4fc]">Retry</button>
      </section> : <Tabs defaultValue={fieldDetails[0].field} className="w-full" data-testid="contact-field-tabs">
        <TabsList aria-label="Contact field categories" className="mb-4 flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          {fieldDetails.map(item => <TabsTrigger key={item.field} value={item.field} data-testid={`tab-contact-field-${item.field}`}
            className="min-h-0 min-w-0 rounded-lg border border-[#dce4ed] bg-white px-3 py-2 text-[10px] font-semibold text-[#64788c] shadow-none transition-colors hover:bg-[#f7f9fb] data-[state=active]:border-[#a8c1d9] data-[state=active]:bg-[#edf4fb] data-[state=active]:text-[#235687] data-[state=active]:shadow-none">
            {item.title}
          </TabsTrigger>)}
        </TabsList>
        {fieldDetails.map(item => <TabsContent key={item.field} value={item.field} forceMount className="mt-0 data-[state=inactive]:hidden">
          <MasterCard {...item} options={options}
            busy={remove.isPending || create.isPending} onAdd={add} onRemove={removeOption}/>
        </TabsContent>)}
      </Tabs>}
    {!query.isLoading && !query.isError && <p className="mt-5 border-t border-[#e5e9ed] pt-4 text-[11px] leading-5 text-[#7c8997]">Changes are available immediately in contact forms. Existing contact values remain unchanged when a list is edited.</p>}
  </div>;
}
