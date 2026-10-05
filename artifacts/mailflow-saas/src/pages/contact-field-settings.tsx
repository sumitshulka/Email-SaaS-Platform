import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BriefcaseBusiness, Check, Languages, LoaderCircle, Plus, Radio, Trash2, UserRoundCheck, UsersRound } from "lucide-react";
import {
  getGetContactFieldOptionsQueryKey,
  useCreateContactFieldOption,
  useDeleteContactFieldOption,
  useGetContactFieldOptions,
} from "@workspace/api-client-react";
import type { ContactFieldKey, ContactFieldOption } from "@workspace/api-client-react";

const fieldDetails: Array<{ field: ContactFieldKey; title: string; description: string }> = [
  { field: "lifecycleStage", title: "Lifecycle stages", description: "Where each contact is in your customer lifecycle." },
  { field: "leadStatus", title: "Lead statuses", description: "The current qualification or follow-up status of a lead." },
  { field: "leadSource", title: "Lead sources", description: "How a contact first entered your workspace." },
  { field: "jobTitle", title: "Job titles", description: "Standard job titles for your contact records." },
  { field: "preferredLanguage", title: "Preferred languages", description: "Languages your contacts may prefer for communication." },
];
const fieldIcons = {
  lifecycleStage: Radio,
  leadStatus: UserRoundCheck,
  leadSource: UsersRound,
  jobTitle: BriefcaseBusiness,
  preferredLanguage: Languages,
};
const inputClass = "h-11 w-full rounded-lg border border-[#d8dde4] bg-white px-3.5 text-[13px] text-[#182333] outline-none transition placeholder:text-[#9ba6b2] focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]";

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
  const Icon = fieldIcons[field];
  return <section data-testid={`section-master-${field}`} className="rounded-lg border border-[#e0e4e9] bg-white">
    <header className="flex items-start gap-3.5 border-b border-[#e8edf1] bg-[#fbfcfd] px-5 py-4">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#dce6ef] bg-[#eef4f9] text-[#315e88]"><Icon className="h-4 w-4" strokeWidth={1.8}/></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-[14px] font-bold tracking-[-.015em] text-[#223247]">{title}</h2>
          <span className="rounded-full bg-[#edf1f4] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[#647487]">{entries.length} {entries.length === 1 ? "value" : "values"}</span>
        </div>
        <p className="mt-1 text-[12px] leading-[1.55] text-[#788696]">{description}</p>
      </div>
    </header>
    <div className="p-5">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        void onAdd(field, trimmed).then(() => setValue("")).catch(() => undefined);
      }}>
        <input aria-label={`New ${title.toLowerCase()}`} data-testid={`input-master-${field}`} value={value}
          onChange={event => setValue(event.target.value)} maxLength={200} className={`${inputClass} min-w-0 flex-1`} placeholder={`Add a ${title.toLowerCase().replace(/s$/, "")}`} />
        <button type="submit" data-testid={`button-add-master-${field}`} disabled={!value.trim() || busy}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#174f99] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-45">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Plus className="h-4 w-4"/>}Add value
        </button>
      </form>
      {entries.length ? <ul className="mt-4 divide-y divide-[#edf0f2] rounded-lg border border-[#e6eaee]">
        {entries.map(option => <li key={option.id} data-testid={`row-master-${option.id}`} className="flex min-h-11 items-center gap-3 px-3.5 py-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#eff5f9] text-[#547895]"><Check className="h-3 w-3" strokeWidth={2.2}/></span>
          <span className="min-w-0 flex-1 break-words text-[12px] font-medium text-[#34485d]">{option.value}</span>
          <button type="button" data-testid={`button-remove-master-${option.id}`} onClick={() => onRemove(option)}
            aria-label={`Remove ${option.value}`} disabled={busy}
            className="rounded-md p-2 text-[#8995a1] transition-colors hover:bg-[#fff3ed] hover:text-[#a84926] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6b18d] disabled:opacity-40"><Trash2 className="h-4 w-4"/></button>
        </li>)}
      </ul> : <div data-testid={`empty-master-${field}`} className="mt-4 flex items-start gap-3 rounded-lg border border-dashed border-[#d9e1e8] bg-[#fafcfd] px-4 py-3.5">
        <span className="mt-0.5 shrink-0 text-[11px] font-semibold text-[#6e8193]">No values yet</span>
        <p className="text-[11px] leading-5 text-[#8491a0]">Add one above or create it while editing a contact.</p>
      </div>}
    </div>
  </section>;
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
      </section> : <div className="grid items-start gap-4 xl:grid-cols-2">
        {fieldDetails.map(item => <MasterCard key={item.field} {...item} options={options}
          busy={remove.isPending || create.isPending} onAdd={add} onRemove={removeOption}/>)}
      </div>}
    {!query.isLoading && !query.isError && <p className="mt-5 border-t border-[#e5e9ed] pt-4 text-[11px] leading-5 text-[#7c8997]">Changes are available immediately in contact forms. Existing contact values remain unchanged when a list is edited.</p>}
  </div>;
}
