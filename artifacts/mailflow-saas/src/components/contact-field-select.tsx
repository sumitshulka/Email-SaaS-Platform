import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetContactFieldOptionsQueryKey,
  useCreateContactFieldOption,
} from "@workspace/api-client-react";
import type {
  ContactFieldKey,
  ContactFieldOption,
} from "@workspace/api-client-react";
import { standardContactTimeZones } from "@/lib/contact-time-zones";

const labels: Record<ContactFieldKey, string> = {
  jobTitle: "job title",
  preferredLanguage: "preferred language",
  lifecycleStage: "lifecycle stage",
  leadStatus: "lead status",
  leadSource: "lead source",
};

const selectClass = "h-11 w-full rounded-lg border border-[#d8dde4] bg-white px-3.5 text-[13px] text-[#26384a] outline-none transition-colors focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]";
const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-lg border border-[#d7dfe6] bg-white px-3.5 text-[11px] font-semibold text-[#245b9b] transition-colors hover:border-[#b7cbdd] hover:bg-[#f4f8fb] disabled:cursor-not-allowed disabled:opacity-50";

export function ContactFieldSelect({
  field,
  title,
  value,
  options,
  onChange,
  testId,
}: {
  field: ContactFieldKey | "timeZone";
  title: string;
  value: string;
  options: ContactFieldOption[];
  onChange: (value: string) => void;
  testId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState("");
  const create = useCreateContactFieldOption();
  const queryClient = useQueryClient();
  const managedOptions = field === "timeZone"
    ? standardContactTimeZones.map(zone => ({ value: zone, label: zone }))
    : options.filter(option => option.field === field).map(option => ({
        value: option.value,
        label: option.value,
      }));
  const hasCurrentValue = managedOptions.some(option => option.value === value);
  const addValue = () => {
    const trimmed = newValue.trim();
    if (!trimmed || field === "timeZone") return;
    setError("");
    create.mutate({ data: { field, value: trimmed } }, {
      onSuccess: ({ option }) => {
        void queryClient.invalidateQueries({ queryKey: getGetContactFieldOptionsQueryKey() });
        onChange(option.value);
        setNewValue("");
        setAdding(false);
      },
      onError: (cause) => {
        const detail = cause && typeof cause === "object" && "data" in cause && cause.data &&
          typeof cause.data === "object" && "error" in cause.data && typeof cause.data.error === "string"
          ? cause.data.error
          : cause instanceof Error ? cause.message : "The value could not be added.";
        setError(detail);
      },
    });
  };

  return <div className="min-w-0">
    <label className="mb-1.5 block text-[11px] font-semibold tracking-[.005em] text-[#3f5266]" htmlFor={testId}>{title}</label>
    <select id={testId} aria-label={title} data-testid={testId} value={hasCurrentValue ? value : value ? `__saved__${value}` : ""}
      onChange={event => onChange(event.target.value.startsWith("__saved__") ? event.target.value.slice(9) : event.target.value)}
      className={selectClass}>
      <option value="">Choose {title.toLowerCase()}...</option>
      {!hasCurrentValue && value && <option value={`__saved__${value}`}>{value} — current saved value</option>}
      {managedOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {field !== "timeZone" && <div className="mt-2">
      {!adding
        ? <button type="button" data-testid={`${testId}-add`} onClick={() => { setError(""); setAdding(true); }}
            className="inline-flex items-center gap-1.5 rounded-md py-1 text-[11px] font-semibold text-[#245b9b] hover:text-[#143f70] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b7d1e8]"><span aria-hidden="true" className="text-[14px] leading-none">+</span>Add a {labels[field]}</button>
        : <div className="rounded-lg border border-[#e1e8ee] bg-[#f8fafc] p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.1em] text-[#718297]">Add to workspace values</div>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label={`New ${labels[field]}`} data-testid={`${testId}-new-value`} value={newValue}
              onChange={event => setNewValue(event.target.value)} onKeyDown={event => {
                if (event.key === "Enter") { event.preventDefault(); addValue(); }
              }} maxLength={200} autoFocus className="h-9 min-w-0 flex-1 rounded-md border border-[#d8dde4] bg-white px-2.5 text-[12px] text-[#26384a] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]" placeholder={`New ${labels[field]}`} />
            <button type="button" data-testid={`${testId}-save-new-value`} disabled={!newValue.trim() || create.isPending} onClick={addValue} className={buttonClass}>{create.isPending ? "Adding..." : "Add value"}</button>
            <button type="button" onClick={() => { setAdding(false); setNewValue(""); setError(""); }} className="min-h-9 rounded-md px-2 text-[11px] font-medium text-[#66717e] hover:bg-[#edf1f4] hover:text-[#344154]">Cancel</button>
          </div>
        </div>}
      {error && <p role="alert" className="mt-2 rounded-md border border-[#f0d9ca] bg-[#fff8f3] px-2.5 py-2 text-[11px] leading-4 text-[#984e28]">{error}</p>}
    </div>}
  </div>;
}
