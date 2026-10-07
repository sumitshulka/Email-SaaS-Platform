import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, CircleAlert, Pencil, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import {
  getListAdminGlobalCompaniesQueryKey, useCreateGlobalCompany, useDeleteGlobalCompany,
  useListAdminGlobalCompanies, useUpdateGlobalCompany,
} from '@workspace/api-client-react';
import type { GlobalCompany, GlobalCompanyInput, GlobalCompanyUpdate, ListAdminGlobalCompaniesParams } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { CompanyIntelligencePanel, FreshnessBadge } from '@/components/company-intelligence-panel';
import { GlobalCompanyImportDialog } from '@/components/global-company-import-dialog';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const panel = 'rounded-xl border border-[#dce6e1] bg-[#fbfdfb] shadow-[0_2px_8px_rgba(33,65,54,.035)]';
const fields = [
  ['companyWebsiteUrl', 'Website URL', 'url'], ['companyDomain', 'Domain', 'text'], ['companyIndustry', 'Industry', 'text'],
  ['companySize', 'Company size', 'text'], ['companyRevenueRange', 'Revenue range', 'text'], ['companyLocation', 'Location', 'text'],
  ['companyPhoneNumber', 'Phone number', 'tel'], ['companyLinkedinUrl', 'LinkedIn URL', 'url'],
] as const;
type ProfileField = typeof fields[number][0];
type FormValues = Record<ProfileField, string> & { companyName: string; companyDescription: string };
const blank = (): FormValues => ({ companyName: '', companyWebsiteUrl: '', companyDomain: '', companyIndustry: '', companySize: '', companyRevenueRange: '', companyLocation: '', companyPhoneNumber: '', companyLinkedinUrl: '', companyDescription: '' });
const fromRecord = (record?: GlobalCompany): FormValues => record ? ({
  companyName: record.companyName, companyWebsiteUrl: record.companyWebsiteUrl ?? '', companyDomain: record.companyDomain ?? '',
  companyIndustry: record.companyIndustry ?? '', companySize: record.companySize ?? '', companyRevenueRange: record.companyRevenueRange ?? '',
  companyLocation: record.companyLocation ?? '', companyPhoneNumber: record.companyPhoneNumber ?? '', companyLinkedinUrl: record.companyLinkedinUrl ?? '',
  companyDescription: record.companyDescription ?? '',
}) : blank();
const errorText = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Please try again.';
const dateText = (value: Date | string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function GlobalCompanyForm({ record, onClose, onSaved }: { record?: GlobalCompany; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const create = useCreateGlobalCompany();
  const update = useUpdateGlobalCompany();
  const [form, setForm] = useState(() => fromRecord(record));
  const [error, setError] = useState('');
  const saving = create.isPending || update.isPending;
  const set = (key: keyof FormValues, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (record) {
      const data: GlobalCompanyUpdate = { companyName: form.companyName.trim(), ...Object.fromEntries(fields.map(([key]) => [key, form[key].trim() || null])), companyDescription: form.companyDescription.trim() || null } as GlobalCompanyUpdate;
      update.mutate({ globalCompanyId: record.id, data }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListAdminGlobalCompaniesQueryKey() }); onSaved(); }, onError: error => setError(domainError(error)) });
    } else {
      const data: GlobalCompanyInput = { companyName: form.companyName.trim(), ...Object.fromEntries(fields.map(([key]) => [key, form[key].trim() || undefined])), companyDescription: form.companyDescription.trim() || undefined } as GlobalCompanyInput;
      create.mutate({ data }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListAdminGlobalCompaniesQueryKey() }); onSaved(); }, onError: error => setError(domainError(error)) });
    }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1b352e]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="global-company-form-title" className="fade-in max-h-[94dvh] w-full max-w-[700px] overflow-y-auto rounded-t-2xl border border-[#dce6e1] bg-[#fbfdfb] shadow-2xl sm:rounded-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-[#e5ede8] bg-[#fbfdfb]/95 px-5 py-4 backdrop-blur sm:px-7"><div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#638a7b]">GLOBAL COMPANY CATALOG</div><h2 id="global-company-form-title" className="display mt-1 text-[21px] font-extrabold tracking-[-.03em] text-[#1e3b32]">{record ? 'Edit company profile' : 'Create global profile'}</h2><p className="mt-1 text-[11px] text-[#71847a]">This shared record can be added to customer workspaces.</p></div><button type="button" aria-label="Close form" onClick={onClose} className="rounded-md p-2 text-[#71847a] hover:bg-[#edf4ef]"><X className="h-4 w-4"/></button></header>
      <form onSubmit={submit} className="space-y-4 p-5 sm:p-7">
        <label className="block"><span className="mb-1.5 block text-[10px] font-bold text-[#47645a]">Company name <span className="text-[#b66d42]">*</span></span><input required maxLength={200} value={form.companyName} onChange={event => set('companyName', event.target.value)} className="h-10 w-full rounded-lg border border-[#d5e1da] bg-white px-3 text-[12px] text-[#29443b] outline-none focus:border-[#438674] focus:ring-2 focus:ring-[#dcece5]"/></label>
        <div className="grid gap-3 sm:grid-cols-2">{fields.map(([key, label, type]) => <label key={key} className="block"><span className="mb-1.5 block text-[10px] font-bold text-[#47645a]">{label}</span><input type={type} value={form[key]} onChange={event => set(key, event.target.value)} className="h-10 w-full rounded-lg border border-[#d5e1da] bg-white px-3 text-[12px] text-[#29443b] outline-none focus:border-[#438674] focus:ring-2 focus:ring-[#dcece5]"/></label>)}</div>
        <label className="block"><span className="mb-1.5 block text-[10px] font-bold text-[#47645a]">Description</span><textarea maxLength={10000} value={form.companyDescription} onChange={event => set('companyDescription', event.target.value)} className="min-h-[96px] w-full rounded-lg border border-[#d5e1da] bg-white px-3 py-2 text-[12px] leading-5 text-[#29443b] outline-none focus:border-[#438674] focus:ring-2 focus:ring-[#dcece5]"/></label>
        {error && <div role="alert" className="rounded-lg border border-[#ead2c2] bg-[#fff8f2] px-3 py-2.5 text-[11px] leading-5 text-[#945b37]">{error}</div>}
        <div className="flex flex-col-reverse gap-2 border-t border-[#e5ede8] pt-4 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={onClose} className="min-h-10 rounded-lg border border-[#d5e1da] bg-white px-4 text-[11px] font-bold text-[#506b5f]">Cancel</button><button type="submit" disabled={saving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#286d5b] px-4 text-[11px] font-bold text-white hover:bg-[#205a4b] disabled:opacity-55">{saving ? 'Saving…' : <><Check className="h-4 w-4"/>{record ? 'Save changes' : 'Create profile'}</>}</button></div>
      </form>
    </section>
  </div>;
}

function domainError(error: unknown) {
  const message = errorText(error);
  return /domain|conflict|duplicate|already exists/i.test(message) ? `A profile with this domain may already exist. Check the domain and try again. ${message}` : `The profile was not saved. ${message}`;
}

export function AdminGlobalCompaniesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formRecord, setFormRecord] = useState<GlobalCompany | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteRecord, setDeleteRecord] = useState<GlobalCompany | null>(null);
  const [notice, setNotice] = useState('');
  const [intelRecord, setIntelRecord] = useState<GlobalCompany | null>(null);
  const params = useMemo<ListAdminGlobalCompaniesParams>(() => ({ search: search.trim() || undefined, page, pageSize: 10 }), [search, page]);
  const query = useListAdminGlobalCompanies(params, { query: { queryKey: getListAdminGlobalCompaniesQueryKey(params), placeholderData: previous => previous } });
  const remove = useDeleteGlobalCompany();
  const rows = query.data?.globalCompanies ?? [];
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 10));
  const deleteCurrent = () => {
    if (!deleteRecord) return;
    remove.mutate({ globalCompanyId: deleteRecord.id }, {
      onSuccess: () => { setDeleteRecord(null); setNotice(`${deleteRecord.companyName} was removed from the global catalog.`); void qc.invalidateQueries({ queryKey: getListAdminGlobalCompaniesQueryKey() }); },
      onError: error => { setDeleteRecord(null); setNotice(`The profile was not deleted. ${errorText(error)}`); },
    });
  };
  if (query.isLoading && !query.data) return <div aria-label="Loading global catalog" className="space-y-5"><div className="h-8 w-64 animate-pulse rounded bg-[#e7efea]"/><div className="h-20 animate-pulse rounded-xl bg-[#eaf1ed]"/><div className="h-80 animate-pulse rounded-xl bg-[#eaf1ed]"/></div>;
  if (query.isError && !query.data) return <section className={`${panel} p-7`} role="alert"><div className="flex items-center gap-2 text-sm font-bold text-[#29443b]"><CircleAlert className="h-4 w-4 text-[#bf7043]"/>Global catalog could not be loaded</div><p className="mt-2 text-xs text-[#718078]">No catalog records were changed.</p><button type="button" onClick={() => void query.refetch()} className="mt-4 rounded-md border border-[#cad8d0] px-3 py-2 text-xs font-semibold text-[#315c4e]">Retry</button></section>;
  return <main className="fade-in mx-auto max-w-[1180px]">
     <header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mono mb-2 text-[9px] uppercase tracking-[.18em] text-[#598274]">PLATFORM / COMPANY CATALOG</div><h1 className="display text-[30px] font-extrabold leading-tight tracking-[-.04em] text-[#1c3832]">Global companies</h1><p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#687c73]">Maintain trusted company profiles customers can add to their own workspaces.</p></div><div className="flex flex-wrap gap-2"><Link href="/admin/company-intelligence" data-testid="link-company-intelligence" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#cddbd3] bg-white px-4 text-[11px] font-bold text-[#416b5b] no-underline hover:bg-[#f5f9f6]"><Sparkles className="h-4 w-4"/>Intelligence monitoring</Link><button type="button" onClick={() => { setNotice(''); setImportOpen(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#cddbd3] bg-white px-4 text-[11px] font-bold text-[#416b5b] hover:bg-[#f5f9f6]"><Upload className="h-4 w-4"/>Bulk upload</button><button type="button" onClick={() => { setNotice(''); setFormRecord('new'); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#286d5b] px-4 text-[11px] font-bold text-white hover:bg-[#205a4b]"><Plus className="h-4 w-4"/>New company</button></div></header>
    {notice && <div role="status" className="mb-4 rounded-lg border border-[#d3e5dc] bg-[#eff7f2] px-4 py-3 text-[11px] text-[#456e5e]">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')} className="float-right font-bold">Dismiss</button></div>}
    <section className={`${panel} overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-[#e5ede8] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h2 className="text-[13px] font-bold text-[#29443b]">Catalog records</h2><p className="mt-1 text-[10px] text-[#819088]">{(query.data?.total ?? 0).toLocaleString()} profiles · no workspace contact data</p></div><label className="relative block w-full sm:max-w-[320px]"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#80938a]"/><input aria-label="Search global company catalog" value={search} onChange={event => { setSearch(event.target.value); setPage(1); setNotice(''); }} placeholder="Search name, domain, industry…" className="h-9 w-full rounded-lg border border-[#d7e3dc] bg-[#f8fbf9] pl-9 pr-3 text-[11px] text-[#29443b] outline-none focus:border-[#488875]"/></label></div>
      {query.isFetching && query.data && <p className="px-6 pt-3 text-[10px] text-[#82938a]">Refreshing catalog…</p>}
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-[#f5f9f6]"><tr className="mono text-[9px] uppercase tracking-[.12em] text-[#819188]"><th className="px-5 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Domain</th><th className="px-4 py-3 font-medium">Industry</th><th className="px-4 py-3 font-medium">Location</th><th className="px-4 py-3 font-medium">Intelligence</th><th className="px-4 py-3 font-medium">Updated</th><th className="px-5 py-3 text-right font-medium">Actions</th></tr></thead><tbody className="divide-y divide-[#e8efeb]">{rows.map(record => <tr key={record.id} className="hover:bg-[#f7faf8]"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#edf6f0] text-[#3b7a67]"><Building2 className="h-4 w-4"/></span><div className="min-w-0"><p className="truncate text-[11px] font-bold text-[#29443b]">{record.companyName}</p>{record.companyWebsiteUrl && <p className="mt-0.5 truncate text-[9px] text-[#819088]">{record.companyWebsiteUrl}</p>}</div></div></td><td className="px-4 py-3.5 text-[10px] text-[#536d61]">{record.companyDomain || '—'}</td><td className="px-4 py-3.5 text-[10px] text-[#536d61]">{record.companyIndustry || '—'}</td><td className="px-4 py-3.5 text-[10px] text-[#536d61]">{record.companyLocation || '—'}</td><td className="px-4 py-3.5" data-testid={`status-intelligence-${record.id}`}>{record.researchSummary ? <div><FreshnessBadge freshness={record.researchSummary.freshness} status={record.researchSummary.status}/><p className="mt-1 text-[9px] text-[#82938a]">{record.researchSummary.researchedAt ? `${dateText(record.researchSummary.researchedAt)} · ${record.researchSummary.sourceCount} sources` : 'Not researched'}</p></div> : <span className="text-[10px] text-[#82938a]">Not researched</span>}</td><td className="px-4 py-3.5 text-[10px] text-[#7c8d84]">{dateText(record.updatedAt)}</td><td className="px-5 py-3.5"><div className="flex justify-end gap-1"><button type="button" data-testid={`button-intelligence-${record.id}`} aria-label={`Open intelligence for ${record.companyName}`} title="Company intelligence" onClick={() => setIntelRecord(record)} className="grid h-8 w-8 place-items-center rounded-md text-[#2d6c8f] hover:bg-[#edf4fc]"><Sparkles className="h-3.5 w-3.5"/></button><button type="button" aria-label={`Edit ${record.companyName}`} onClick={() => { setNotice(''); setFormRecord(record); }} className="grid h-8 w-8 place-items-center rounded-md text-[#58796b] hover:bg-[#edf6f0]"><Pencil className="h-3.5 w-3.5"/></button><button type="button" aria-label={`Delete ${record.companyName}`} onClick={() => setDeleteRecord(record)} className="grid h-8 w-8 place-items-center rounded-md text-[#a56848] hover:bg-[#fff3eb]"><Trash2 className="h-3.5 w-3.5"/></button></div></td></tr>)}</tbody></table></div> : <div className="px-5 py-14 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[#edf6f0] text-[#558b78]"><Building2 className="h-5 w-5"/></span><h3 className="mt-4 text-[13px] font-bold text-[#37564b]">{search ? 'No matching profiles' : 'No global companies yet'}</h3><p className="mt-1 text-[11px] text-[#829188]">{search ? 'Try another search term.' : 'Create the first catalog profile to make it available to customers.'}</p>{!search && <button type="button" onClick={() => setFormRecord('new')} className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-bold text-[#347765]"><Plus className="h-3.5 w-3.5"/>Create profile</button>}</div>}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e5ede8] bg-[#f8fbf9] px-5 py-3"><span className="text-[10px] text-[#788a81]">{query.data?.total ? `Showing ${(page - 1) * 10 + 1}–${Math.min(page * 10, query.data.total)} of ${query.data.total}` : '0 records'}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="rounded-md border border-[#d5e1da] px-3 py-1.5 text-[10px] font-semibold text-[#537365] disabled:opacity-40">Previous</button><span className="mono min-w-10 text-center text-[10px] text-[#71867c]">{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)} className="rounded-md border border-[#d5e1da] px-3 py-1.5 text-[10px] font-semibold text-[#537365] disabled:opacity-40">Next</button></div></footer>
    </section>
    {intelRecord && <Dialog open onOpenChange={open => { if (!open) setIntelRecord(null); }}>
      <DialogContent data-testid="dialog-company-intelligence" className="flex h-[calc(100dvh-2rem)] max-h-[900px] w-[calc(100%-2rem)] max-w-[1000px] flex-col overflow-hidden rounded-xl bg-[#f7f9fb] p-4 sm:p-6">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle className="display break-words text-[20px] text-[#172334]">{intelRecord.companyName}</DialogTitle>
          <DialogDescription className="text-[12px] text-[#526071]">Stored company intelligence, sources and research history.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="scroll-company-intelligence">
          <CompanyIntelligencePanel globalCompanyId={intelRecord.id}/>
        </div>
        <DialogFooter className="shrink-0 border-t border-[#dfe5ec] pt-3">
          <DialogClose asChild><button type="button" data-testid="button-close-intelligence" aria-label="Close intelligence" className="min-h-10 rounded-md border border-[#d4dce6] bg-white px-5 text-[13px] font-semibold text-[#27384c] hover:bg-[#edf3fa]">Close</button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
    {formRecord && <GlobalCompanyForm key={formRecord === 'new' ? 'new' : formRecord.id} record={formRecord === 'new' ? undefined : formRecord} onClose={() => setFormRecord(null)} onSaved={() => { setFormRecord(null); setNotice('Global company profile saved.'); }}/>}
     {importOpen && <GlobalCompanyImportDialog onClose={() => setImportOpen(false)} onChanged={() => { void qc.invalidateQueries({ queryKey: getListAdminGlobalCompaniesQueryKey() }); }}/>}
    {deleteRecord && <div className="fixed inset-0 z-50 grid place-items-center bg-[#1b352e]/35 p-4 backdrop-blur-[2px]" onMouseDown={event => { if (event.target === event.currentTarget && !remove.isPending) setDeleteRecord(null); }}><section role="alertdialog" aria-modal="true" aria-labelledby="delete-global-title" className="w-full max-w-[420px] rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-5 shadow-2xl"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#fff3eb] text-[#ad6745]"><Trash2 className="h-4 w-4"/></span><h2 id="delete-global-title" className="mt-4 text-[16px] font-extrabold text-[#29443b]">Delete {deleteRecord.companyName}?</h2><p className="mt-2 text-[11px] leading-5 text-[#72847b]">The catalog entry will be removed. Existing workspace copies keep their current company details and become private; their contact records and associations are not deleted.</p>{remove.isError && <p role="alert" className="mt-3 text-[10px] text-[#985d3b]">{errorText(remove.error)}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={remove.isPending} onClick={() => setDeleteRecord(null)} className="rounded-lg border border-[#d5e1da] px-3 py-2 text-[10px] font-bold text-[#506b5f]">Cancel</button><button type="button" disabled={remove.isPending} onClick={deleteCurrent} className="rounded-lg bg-[#a95e3b] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">{remove.isPending ? 'Deleting…' : 'Delete profile'}</button></div></section></div>}
  </main>;
}
