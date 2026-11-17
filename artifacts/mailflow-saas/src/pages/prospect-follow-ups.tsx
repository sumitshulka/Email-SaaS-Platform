import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert,
  Clock3, Mail, MessageSquare, Pencil, Plus, RefreshCw, X,
} from 'lucide-react';
import {
  getGetProspectDashboardQueryKey, getGetProspectFollowUpsTodayQueryKey, getGetProspectQueryKey,
  getListProspectActionsQueryKey, getListProspectActionTypesQueryKey, getListProspectFollowUpsQueryKey,
  getListProspectsQueryKey, useCreateProspectFollowUp, useGetProspectFollowUpsToday,
  useListProspectActionTypes, useListProspectFollowUps, useListProspects, useUpdateProspectFollowUp,
} from '@workspace/api-client-react';
import type { CreateProspectFollowUpInput, ProspectFollowUp, UpdateProspectFollowUpInput } from '@workspace/api-client-react';

const panel = 'rounded-xl border border-[#dce4ed] bg-white shadow-[0_4px_18px_rgba(19,43,70,.035)]';
const field = 'h-10 w-full rounded-lg border border-[#d7e0e9] bg-white px-3 text-[12px] text-[#1a2b40] outline-none transition focus:border-[#4c80b8] focus:ring-2 focus:ring-[#dce9f6]';
const label = 'mb-1.5 block text-[10px] font-bold uppercase tracking-[.1em] text-[#66778a]';
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#164f91] bg-[#164f91] px-4 text-[12px] font-bold text-white transition hover:bg-[#103e76] disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#d7e0e9] bg-white px-3 text-[11px] font-semibold text-[#39516b] transition hover:bg-[#f5f8fb] disabled:opacity-50';
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fromISO = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const shift = (value: string, days: number) => { const date = fromISO(value); date.setDate(date.getDate() + days); return localDate(date); };
const niceDate = (value: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) => new Intl.DateTimeFormat(undefined, options).format(fromISO(value));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} data-testid={error ? 'status-follow-up-error' : 'status-follow-up-success'} className={`rounded-lg border px-3 py-2.5 text-[11px] leading-5 ${error ? 'border-[#efc9bf] bg-[#fff6f3] text-[#9b4837]' : 'border-[#cde2d7] bg-[#f1f8f4] text-[#35684f]'}`}>{children}</div>;
}

function useRefreshFollowUps() {
  const qc = useQueryClient();
  return (prospectId?: string) => {
    void qc.invalidateQueries({ queryKey: getGetProspectFollowUpsTodayQueryKey() });
    void qc.invalidateQueries({ queryKey: getListProspectFollowUpsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListProspectsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetProspectDashboardQueryKey() });
    if (prospectId) {
      void qc.invalidateQueries({ queryKey: getGetProspectQueryKey(prospectId) });
      void qc.invalidateQueries({ queryKey: getListProspectActionsQueryKey(prospectId) });
    }
  };
}

export function FollowUpForm({ open, onClose, prospectId, prospectName, initial, initialDate }: {
  open: boolean; onClose: () => void; prospectId?: string; prospectName?: string; initial?: ProspectFollowUp; initialDate?: string;
}) {
  const create = useCreateProspectFollowUp();
  const update = useUpdateProspectFollowUp();
  const types = useListProspectActionTypes({ query: { enabled: open, queryKey: getListProspectActionTypesQueryKey() } });
  const prospects = useListProspects({ page: 1, pageSize: 100, status: 'active' }, { query: { enabled: open && !prospectId && !initial, queryKey: getListProspectsQueryKey({ page: 1, pageSize: 100, status: 'active' }) } });
  const refresh = useRefreshFollowUps();
  const [selectedProspect, setSelectedProspect] = useState(initial?.prospectId ?? prospectId ?? '');
  const [actionTypeId, setActionTypeId] = useState(initial?.actionType.id ?? '');
  const [date, setDate] = useState(initial?.followUpDate ?? initialDate ?? localDate(new Date()));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const prospectSelectRef = useRef<HTMLSelectElement>(null);
  const actionTypeSelectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!open) return;
    setSelectedProspect(initial?.prospectId ?? prospectId ?? '');
    setActionTypeId(initial?.actionType.id ?? '');
    setDate(initial?.followUpDate ?? initialDate ?? localDate(new Date()));
    setNotes(initial?.notes ?? '');
    setError('');
    setSaved(false);
  }, [open, prospectId, initial?.id, initialDate]);
  const activeTypes = (types.data ?? []).filter(type => type.active);
  const availableTypes = initial && !activeTypes.some(type => type.id === initial.actionType.id)
    ? [...activeTypes, { ...initial.actionType, name: `${initial.actionType.name} (inactive)` }]
    : activeTypes;
  const items = prospects.data?.prospects ?? [];
  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const trimmed = notes.trim();
    if (!selectedProspect || !actionTypeId || !date || !trimmed) {
      setError('Choose a prospect, action type, date, and add a note before saving.');
      return;
    }
    if (initial) {
      const data: UpdateProspectFollowUpInput = { actionTypeId, followUpDate: date, notes: trimmed };
      update.mutate({ followUpId: initial.id, data }, {
        onSuccess: () => { setSaved(true); refresh(initial.prospectId); window.setTimeout(onClose, 700); },
        onError: reason => setError(errorText(reason)),
      });
    } else {
      const data: CreateProspectFollowUpInput = { prospectId: selectedProspect, actionTypeId, followUpDate: date, notes: trimmed };
      create.mutate({ data }, {
        onSuccess: () => { setSaved(true); refresh(selectedProspect); window.setTimeout(onClose, 700); },
        onError: reason => setError(errorText(reason)),
      });
    }
  };
  const pending = create.isPending || update.isPending;
  return <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen && !pending) onClose(); }}>
    <DialogPortal>
      <DialogOverlay className="z-[100] bg-[#13273d]/40 backdrop-blur-[2px]"/>
      <DialogPrimitive.Content
        aria-labelledby="follow-up-dialog-title"
        onOpenAutoFocus={event => {
          event.preventDefault();
          (prospectSelectRef.current ?? actionTypeSelectRef.current)?.focus();
        }}
        onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
        onPointerDownOutside={event => { if (pending) event.preventDefault(); }}
        className="fixed left-1/2 top-1/2 z-[101] max-h-[92dvh] w-[calc(100%-2rem)] max-w-[540px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[#dce4ed] bg-[#fbfcfd] shadow-[0_24px_70px_rgba(20,42,64,.22)]"
        data-testid="dialog-follow-up-form"
      >
      <header className="flex items-start justify-between border-b border-[#e3eaf0] bg-[#f1f6fa] px-5 py-4 sm:px-6">
        <div><div className="mono text-[9px] tracking-[.16em] text-[#66809a]">PROSPECT MANAGEMENT / FOLLOW-UP</div><h2 id="follow-up-dialog-title" className="display mt-1 text-[20px] font-bold text-[#1d344d]">{initial ? 'Edit follow-up' : 'Schedule a follow-up'}</h2><p className="mt-1 text-[11px] text-[#6d7f90]">A clear next step, attached to the right opportunity.</p></div>
        <button type="button" onClick={onClose} disabled={pending} aria-label="Close dialog" className="grid h-8 w-8 place-items-center rounded-lg text-[#718398] hover:bg-white" data-testid="button-close-follow-up-dialog"><X className="h-4 w-4"/></button>
      </header>
      <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
        {!prospectId && !initial && <label className="block"><span className={label}>Prospect</span><select ref={prospectSelectRef} className={field} value={selectedProspect} onChange={event => setSelectedProspect(event.target.value)} required data-testid="select-follow-up-prospect"><option value="">Choose an active prospect</option>{items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.contact.name}</option>)}</select>{prospects.isError && <span className="mt-1 flex items-center gap-2 text-[10px] text-[#a04d3b]">Prospects could not be loaded.<button type="button" onClick={() => void prospects.refetch()} className="font-bold underline">Retry</button></span>}</label>}
        {(prospectId || initial) && <div className="rounded-lg border border-[#e2e9ef] bg-white px-3.5 py-3" data-testid="text-follow-up-prospect"><div className={label}>Prospect</div><div className="text-[12px] font-bold text-[#304a63]">{initial?.prospectName ?? prospectName ?? items.find(item => item.id === prospectId)?.name ?? 'Selected prospect'}</div></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className={label}>Action type</span><select ref={actionTypeSelectRef} className={field} value={actionTypeId} onChange={event => setActionTypeId(event.target.value)} required data-testid="select-follow-up-action-type"><option value="">Choose an action</option>{availableTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <label><span className={label}>Follow-up date</span><input className={field} type="date" value={date} onChange={event => setDate(event.target.value)} required data-testid="input-follow-up-date"/></label>
        </div>
        <label className="block"><span className={label}>Note</span><textarea className="min-h-[104px] w-full resize-y rounded-lg border border-[#d7e0e9] bg-white px-3 py-2.5 text-[12px] leading-5 text-[#253b51] outline-none focus:border-[#4c80b8] focus:ring-2 focus:ring-[#dce9f6]" value={notes} onChange={event => setNotes(event.target.value)} maxLength={10000} required placeholder="What should happen next?" data-testid="input-follow-up-notes"/></label>
        {types.isError && <div role="alert" className="text-[11px] text-[#a04d3b]">Action types could not be loaded. <button type="button" onClick={() => void types.refetch()} className="font-bold underline">Retry</button></div>}
        {!initial && !types.isLoading && !types.isError && activeTypes.length === 0 && <div role="status" className="rounded-lg border border-[#eadfc9] bg-[#fff9ed] px-3 py-2.5 text-[10px] leading-4 text-[#80613a]">Add an active action type in <Link href="/prospect-actions" className="font-bold underline">Prospect Actions</Link> before scheduling follow-ups.</div>}
        {!prospectId && !initial && prospects.data && items.length === 0 && <div role="status" className="rounded-lg border border-[#e2e9ef] bg-[#f7f9fb] px-3 py-2.5 text-[10px] leading-4 text-[#718398]">There are no active prospects to schedule. <Link href="/prospects/new" className="font-bold text-[#245b91] underline">Create a prospect</Link> first.</div>}
        {error && <Notice error>{error}</Notice>}
        {saved && <Notice>Follow-up saved. The calendar and prospect history are refreshing.</Notice>}
        <div className="flex flex-col-reverse gap-2 border-t border-[#e7edf2] pt-4 sm:flex-row sm:justify-end"><button type="button" className={secondary} onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className={primary} disabled={pending || types.isLoading || (!initial && !prospectId && (!prospects.data || prospects.isLoading || prospects.isError))} data-testid="button-save-follow-up">{pending ? 'Saving follow-up…' : initial ? 'Save changes' : 'Schedule follow-up'}{pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin"/> : <ArrowRight className="h-3.5 w-3.5"/>}</button></div>
      </form>
      </DialogPrimitive.Content>
    </DialogPortal>
  </Dialog>;
}

function FollowUpRow({ item, compact = false }: { item: ProspectFollowUp; compact?: boolean }) {
  const qc = useQueryClient();
  const update = useUpdateProspectFollowUp();
  const refresh = useRefreshFollowUps();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const changeStatus = (status: 'completed' | 'cancelled') => {
    setError('');
    update.mutate({ followUpId: item.id, data: { status } }, {
      onSuccess: () => {
        refresh(item.prospectId);
        void qc.invalidateQueries({ queryKey: getListProspectActionTypesQueryKey() });
      },
      onError: reason => setError(errorText(reason)),
    });
  };
  return <article className={`group rounded-xl border border-[#e5ebf0] bg-white p-3.5 transition hover:border-[#c8d8e6] ${compact ? '' : 'sm:p-4'}`} data-testid={`card-follow-up-${item.id}`}>
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#edf4fb] text-[#346b9e]"><Clock3 className="h-4 w-4"/></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-[12px] font-bold text-[#2b435c]" data-testid={`text-follow-up-action-${item.id}`}>{item.actionType.name}</span><span className="rounded-full bg-[#edf4fb] px-2 py-0.5 text-[9px] font-semibold text-[#35678f]">{item.currentStageName}</span></div>
        <Link href={`/prospects/${encodeURIComponent(item.prospectId)}`} className="mt-1 block truncate text-[11px] font-semibold text-[#245b91] no-underline hover:underline" data-testid={`link-follow-up-prospect-${item.id}`}>{item.prospectName}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#8190a0]"><span>{item.contactName}</span>{item.contactEmail && <a href={`mailto:${item.contactEmail}`} className="inline-flex items-center gap-1 text-[#71869a] no-underline hover:text-[#245b91]"><Mail className="h-3 w-3"/>{item.contactEmail}</a>}<time>{niceDate(item.followUpDate, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div>
        <p className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-4 text-[#617487]" data-testid={`text-follow-up-notes-${item.id}`}>{item.notes}</p>
      </div>
      {item.status === 'pending' && <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
        <button type="button" title="Edit follow-up" aria-label={`Edit follow-up for ${item.prospectName}`} onClick={() => setEditing(true)} className="grid h-8 w-8 place-items-center rounded-lg text-[#66809a] hover:bg-[#f0f5f9] hover:text-[#245b91]" data-testid={`button-edit-follow-up-${item.id}`}><Pencil className="h-3.5 w-3.5"/></button>
        <button type="button" title="Mark complete" aria-label={`Complete follow-up for ${item.prospectName}`} onClick={() => changeStatus('completed')} disabled={update.isPending} className="grid h-8 w-8 place-items-center rounded-lg text-[#4c8061] hover:bg-[#edf7f0]" data-testid={`button-complete-follow-up-${item.id}`}><Check className="h-4 w-4"/></button>
        <button type="button" title="Cancel follow-up" aria-label={`Cancel follow-up for ${item.prospectName}`} onClick={() => changeStatus('cancelled')} disabled={update.isPending} className="grid h-8 w-8 place-items-center rounded-lg text-[#9a6a61] hover:bg-[#fff3ef]" data-testid={`button-cancel-follow-up-${item.id}`}><X className="h-4 w-4"/></button>
      </div>}
    </div>
    {error && <div role="alert" className="mt-3 text-[10px] text-[#a04d3b]">{error}</div>}
    {item.status !== 'pending' && <div className={`mt-3 border-t pt-2 text-[9px] font-semibold uppercase tracking-[.1em] ${item.status === 'completed' ? 'border-[#e2eee5] text-[#4e7a5a]' : 'border-[#f0e5e2] text-[#97726b]'}`} data-testid={`status-follow-up-${item.id}`}>{item.status}{item.completedAt ? ` · ${new Date(item.completedAt).toLocaleString()}` : ''}</div>}
    <FollowUpForm open={editing} onClose={() => setEditing(false)} initial={item}/>
  </article>;
}

export function FollowUpsTodayPanel() {
  const query = useGetProspectFollowUpsToday({ query: { queryKey: getGetProspectFollowUpsTodayQueryKey() } });
  return <section className={`${panel} overflow-hidden`} aria-label="Follow-ups today" data-testid="dashboard-follow-ups-today">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d6e3ef] bg-[#edf4fb] px-5 py-3.5"><div><div className="mono text-[9px] tracking-[.14em] text-[#52718f]">PROSPECT MANAGEMENT / TODAY</div><h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Follow-ups today</h2></div><Link href="/prospect-follow-ups" className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#245b91] no-underline hover:underline" data-testid="link-dashboard-follow-ups">Open calendar <ArrowRight className="h-3.5 w-3.5"/></Link></header>
    <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_160px] sm:p-5">
      <div className="min-w-0">{query.isLoading ? <div className="space-y-2" aria-label="Loading today's follow-ups"><div className="h-12 animate-pulse rounded-lg bg-[#edf2f7]"/><div className="h-12 animate-pulse rounded-lg bg-[#edf2f7]"/></div> : query.isError ? <div role="alert" className="flex items-center justify-between gap-3 text-[11px] text-[#9b4837]"><span>Today’s follow-ups could not be loaded.</span><button type="button" onClick={() => void query.refetch()} className="font-bold underline" data-testid="button-retry-today-follow-ups">Retry</button></div> : query.data?.items.length ? <div className="space-y-2">{query.data.items.filter(item => item.status === 'pending').map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#e8edf2] px-3 py-2.5" data-testid={`today-follow-up-${item.id}`}><div className="min-w-0"><Link href={`/prospects/${encodeURIComponent(item.prospectId)}`} className="block truncate text-[11px] font-bold text-[#285b8a] no-underline hover:underline" data-testid={`link-today-follow-up-prospect-${item.id}`}>{item.prospectName}</Link><div className="mt-1 truncate text-[9px] text-[#7c8b99]">{item.actionType.name} · {item.contactName}</div></div><time className="shrink-0 text-[9px] font-semibold text-[#718398]">{niceDate(item.followUpDate, { month: 'short', day: 'numeric' })}</time></div>)}</div> : <div className="rounded-lg border border-dashed border-[#dce5ec] bg-[#fbfcfd] px-4 py-5 text-center text-[11px] text-[#718398]" data-testid="empty-today-follow-ups">Nothing due today. Your next step is clear.</div>}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
        <div className="rounded-lg border border-[#dce8f2] bg-[#f2f7fb] p-3" data-testid="metric-today-follow-ups"><div className="text-[9px] font-bold uppercase tracking-[.1em] text-[#64809a]">Pending today</div><div className="display mt-1 text-[24px] font-bold text-[#274764]">{query.isLoading ? '—' : query.data?.items.filter(item => item.status === 'pending').length ?? 0}</div></div>
        <div className="rounded-lg border border-[#f0ddc6] bg-[#fff8ef] p-3" data-testid="metric-overdue-follow-ups"><div className="text-[9px] font-bold uppercase tracking-[.1em] text-[#9a7042]">Overdue</div><div className="display mt-1 text-[24px] font-bold text-[#82562e]">{query.isLoading ? '—' : query.data?.overdueCount ?? 0}</div></div>
      </div>
    </div>
  </section>;
}

export function ScheduleProspectFollowUpButton({ prospectId, prospectName, className }: { prospectId: string; prospectName: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={className ?? primary} onClick={() => setOpen(true)} data-testid="button-schedule-prospect-follow-up"><CalendarDays className="h-3.5 w-3.5"/>Schedule follow-up</button><FollowUpForm key={`${open}-${prospectId}`} open={open} onClose={() => setOpen(false)} prospectId={prospectId} prospectName={prospectName}/></>;
}

export function ProspectFollowUpsPage() {
  const browserToday = localDate(new Date());
  const [mode, setMode] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [selected, setSelected] = useState(browserToday);
  const [dialogDate, setDialogDate] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const range = useMemo(() => {
    if (mode === 'daily') return { fromDate: selected, toDate: selected };
    if (mode === 'weekly') {
      const start = fromISO(selected); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      return { fromDate: localDate(start), toDate: shift(localDate(start), 6) };
    }
    const date = fromISO(selected);
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const dayCount = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const count = Math.ceil((offset + dayCount) / 7) * 7;
    const gridStart = new Date(date.getFullYear(), date.getMonth(), 1 - offset);
    return { fromDate: localDate(gridStart), toDate: shift(localDate(gridStart), count - 1) };
  }, [mode, selected]);
  const queryParams = useMemo(() => ({ ...range, status: 'all' as const }), [range]);
  const calendar = useListProspectFollowUps(queryParams, { query: { queryKey: getListProspectFollowUpsQueryKey(queryParams) } });
  const todayQuery = useGetProspectFollowUpsToday({ query: { queryKey: getGetProspectFollowUpsTodayQueryKey() } });
  const today = todayQuery.data?.date ?? browserToday;
  useEffect(() => {
    if (todayQuery.data?.date && selected === browserToday) setSelected(todayQuery.data.date);
  }, [todayQuery.data?.date, browserToday, selected]);
  const dates = useMemo(() => {
    if (mode === 'monthly') {
      const month = fromISO(selected);
      const first = new Date(month.getFullYear(), month.getMonth(), 1);
      const offset = (first.getDay() + 6) % 7;
      const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const count = Math.ceil((offset + days) / 7) * 7;
      return Array.from({ length: count }, (_, i) => shift(range.fromDate, i));
    }
    const count = mode === 'daily' ? 1 : 7;
    return Array.from({ length: count }, (_, i) => shift(range.fromDate, i));
  }, [mode, range]);
  const items = calendar.data ?? [];
  const forDate = (date: string) => items.filter(item => item.followUpDate === date);
  const monthTitle = niceDate(selected, mode === 'weekly' ? { month: 'long', year: 'numeric' } : mode === 'monthly' ? { month: 'long', year: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' });
  const step = (direction: number) => {
    const d = fromISO(selected);
    if (mode === 'daily') d.setDate(d.getDate() + direction);
    if (mode === 'weekly') d.setDate(d.getDate() + direction * 7);
    if (mode === 'monthly') d.setMonth(d.getMonth() + direction);
    setSelected(localDate(d));
  };
  const dayItems = forDate(mode === 'daily' ? selected : dialogDate);
  return <main className="prospect-page fade-in mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-9 lg:py-8" data-testid="page-prospect-follow-ups">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link href="/prospects" className="inline-flex items-center gap-2 text-[11px] font-semibold text-[#526d86] no-underline hover:text-[#174f91]" data-testid="link-follow-ups-prospects"><ArrowLeft className="h-3.5 w-3.5"/>All prospects</Link><button type="button" className={primary} onClick={() => setFormOpen(true)} data-testid="button-new-follow-up"><Plus className="h-3.5 w-3.5"/>Schedule follow-up</button></div>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="mono mb-2 text-[9px] tracking-[.17em] text-[#66809a]">PROSPECT MANAGEMENT / DAILY WORK</div><h1 className="display text-[30px] font-bold leading-tight text-[#172b43] sm:text-[35px]">Follow-ups</h1><p className="mt-2 max-w-xl text-[12px] leading-5 text-[#6b7b8e]">Keep each opportunity moving with a visible next step.</p></div><div className="flex items-center gap-2 rounded-lg border border-[#dce4ed] bg-white px-3 py-2 text-[10px] text-[#65788b]"><CalendarDays className="h-4 w-4 text-[#4e7da7]"/>Today <strong className="text-[#34516b]">{todayQuery.isLoading ? '—' : todayQuery.data?.items.filter(item => item.status === 'pending').length ?? 0} pending</strong><span className="mx-1 h-3 w-px bg-[#dce4ed]"/><strong className="text-[#9a6837]">{todayQuery.isLoading ? '—' : todayQuery.data?.overdueCount ?? 0} overdue</strong></div></div>
    <section className={`${panel} mb-5 overflow-hidden`} aria-label="Follow-up overview">
      <div className="grid gap-0 border-b border-[#e6edf2] md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><button type="button" className={secondary} aria-label="Previous period" onClick={() => step(-1)} data-testid="button-follow-up-previous"><ChevronLeft className="h-4 w-4"/></button><button type="button" className={secondary} aria-label="Next period" onClick={() => step(1)} data-testid="button-follow-up-next"><ChevronRight className="h-4 w-4"/></button><button type="button" className={`${secondary} text-[#245b91]`} onClick={() => setSelected(today)} data-testid="button-follow-up-today">Today</button><h2 className="ml-1 text-[15px] font-bold text-[#28435d]" data-testid="text-follow-up-period">{monthTitle}</h2></div>
            <div role="tablist" aria-label="Calendar view" className="flex rounded-lg border border-[#dce4ed] bg-[#f7f9fb] p-1" data-testid="tabs-follow-up-view">{(['daily', 'weekly', 'monthly'] as const).map(view => <button type="button" role="tab" aria-selected={mode === view} key={view} onClick={() => setMode(view)} className={`min-h-8 rounded-md px-3 text-[10px] font-semibold capitalize transition ${mode === view ? 'bg-white text-[#285f91] shadow-sm' : 'text-[#758597] hover:text-[#3e5b76]'}`} data-testid={`tab-follow-up-${view}`}>{view}</button>)}</div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[#e6edf2] bg-[#f8fafc] px-4 py-3 md:border-l md:border-t-0"><div><div className="text-[9px] font-bold uppercase tracking-[.1em] text-[#76899b]">Pending in view</div><div className="display mt-1 text-[23px] font-bold text-[#294862]" data-testid="text-follow-up-visible-count">{calendar.isLoading ? '—' : items.filter(item => item.status === 'pending').length}</div></div><div className="h-10 w-px bg-[#e1e8ee]"/><div><div className="text-[9px] font-bold uppercase tracking-[.1em] text-[#76899b]">Overdue</div><div className="display mt-1 text-[23px] font-bold text-[#9a6837]" data-testid="text-follow-up-overdue-count">{todayQuery.isLoading ? '—' : todayQuery.data?.overdueCount ?? 0}</div></div></div>
      </div>
      {calendar.isError && !calendar.data ? <div className="p-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#efc9bf] bg-[#fff6f3] p-4" role="alert" data-testid="error-follow-up-calendar"><div className="flex items-center gap-2 text-[11px] text-[#9b4837]"><CircleAlert className="h-4 w-4"/>The calendar could not be loaded.</div><button type="button" className={secondary} onClick={() => void calendar.refetch()} data-testid="button-retry-follow-up-calendar"><RefreshCw className="h-3.5 w-3.5"/>Retry</button></div></div> : calendar.isLoading ? <div className="grid grid-cols-7 gap-px bg-[#e7edf2] p-px" aria-label="Loading follow-up calendar">{dates.map(date => <div key={date} className="min-h-28 animate-pulse bg-[#f5f7f9] p-3"><div className="h-3 w-8 rounded bg-[#e7edf2]"/><div className="mt-4 h-6 rounded bg-[#edf1f4]"/></div>)}</div> : mode === 'daily' ? <div className="p-4 sm:p-5"><div className="mb-4 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-[#edf4fb] text-center text-[#376b98]"><span className="text-[9px] font-bold uppercase">{niceDate(selected, { month: 'short' })}</span><strong className="text-[17px] leading-4">{fromISO(selected).getDate()}</strong></div><div><div className="text-[13px] font-bold text-[#344d65]">{niceDate(selected)}</div><div className="mt-1 text-[10px] text-[#7f8e9d]">{forDate(selected).filter(item => item.status === 'pending').length} pending follow-ups</div></div></div>
        {forDate(selected).length ? <div className="space-y-2">{forDate(selected).map(item => <FollowUpRow key={item.id} item={item}/>)}</div> : <div className="rounded-xl border border-dashed border-[#dce5ec] bg-[#fbfcfd] px-5 py-10 text-center" data-testid="empty-follow-up-day"><div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#edf4fb] text-[#477ba7]"><MessageSquare className="h-4 w-4"/></div><h3 className="mt-3 text-[13px] font-bold text-[#354e67]">A clear day ahead</h3><p className="mt-1 text-[10px] text-[#8593a0]">No follow-ups scheduled for this date.</p><button type="button" className={`${primary} mt-4`} onClick={() => setFormOpen(true)} data-testid="button-schedule-from-empty"><Plus className="h-3.5 w-3.5"/>Schedule one</button></div>}</div> : <div className={mode === 'weekly' ? 'grid grid-cols-1 divide-y divide-[#e8edf2] sm:grid-cols-7 sm:divide-x sm:divide-y-0' : 'grid grid-cols-2 divide-x divide-y divide-[#e8edf2] sm:grid-cols-4 lg:grid-cols-7'} data-testid={`grid-follow-up-${mode}`}>
        {dates.map(date => {
          const dayItems = forDate(date);
          const currentDay = date === today;
          return <button key={date} type="button" onClick={() => { if (mode === 'monthly' && fromISO(date).getMonth() !== fromISO(selected).getMonth()) setSelected(date); setDialogDate(date); }} className={`min-h-[104px] bg-white p-3 text-left transition hover:bg-[#f6f9fb] sm:min-h-[136px] ${currentDay ? 'bg-[#f2f7fb]' : ''} ${mode === 'monthly' && fromISO(date).getMonth() !== fromISO(selected).getMonth() ? 'opacity-45' : ''}`} data-testid={`button-calendar-date-${date}`}>
            <div className="flex items-center justify-between"><span className="text-[9px] font-semibold uppercase tracking-[.08em] text-[#8996a3]">{mode === 'weekly' ? niceDate(date, { weekday: 'short' }) : niceDate(date, { weekday: 'short' })}</span><span className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold ${currentDay ? 'bg-[#275f91] text-white' : 'text-[#3d5368]'}`}>{fromISO(date).getDate()}</span></div>
            <div className="mt-2 space-y-1">{dayItems.slice(0, 2).map(item => <div key={item.id} className={`truncate rounded-md px-2 py-1 text-[9px] font-semibold ${item.status === 'pending' ? 'bg-[#eaf2f9] text-[#36678f]' : item.status === 'completed' ? 'bg-[#eef6ef] text-[#4c7857]' : 'bg-[#f4f2f1] text-[#837772]'}`} data-testid={`calendar-follow-up-${item.id}`}>{item.prospectName}</div>)}{dayItems.length > 2 && <div className="px-1 text-[9px] font-semibold text-[#8190a0]">+{dayItems.length - 2} more</div>}{!dayItems.length && <div className="pt-1 text-[9px] text-[#b0bac3]">No follow-ups</div>}</div>
          </button>;
        })}
      </div>}
      {calendar.isError && calendar.data && <div role="status" className="border-t border-[#f0ddc6] bg-[#fff8ef] px-4 py-2 text-[10px] text-[#89623d]">Could not refresh this calendar. Showing the last loaded records. <button type="button" className="font-bold underline" onClick={() => void calendar.refetch()}>Retry</button></div>}
    </section>
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Follow-up guidance">
      <div className="rounded-xl border border-[#dce7f0] bg-[#f1f6fa] p-4"><div className="mono text-[9px] tracking-[.13em] text-[#66809a]">DAILY</div><p className="mt-2 text-[11px] leading-5 text-[#536a80]">A single-day agenda, with quick access to the prospect and its next action.</p></div>
      <div className="rounded-xl border border-[#d9e8df] bg-[#f1f7f3] p-4"><div className="mono text-[9px] tracking-[.13em] text-[#64806e]">WEEKLY</div><p className="mt-2 text-[11px] leading-5 text-[#5b7566]">Scan the week at a glance; choose a date to open its focused agenda.</p></div>
      <div className="rounded-xl border border-[#ede2d2] bg-[#fbf7f0] p-4"><div className="mono text-[9px] tracking-[.13em] text-[#947653]">MONTHLY</div><p className="mt-2 text-[11px] leading-5 text-[#786c5b]">Spot busy stretches and open any date for its complete follow-up list.</p></div>
    </section>
    {dialogDate && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#13273d]/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDialogDate(''); }}><section role="dialog" aria-modal="true" aria-labelledby="follow-up-day-title" className="max-h-[85dvh] w-full max-w-[620px] overflow-y-auto rounded-t-2xl border border-[#dce4ed] bg-[#fbfcfd] p-5 shadow-[0_24px_70px_rgba(20,42,64,.22)] sm:rounded-2xl sm:p-6" data-testid="dialog-follow-up-date"><div className="flex items-start justify-between"><div><div className="mono text-[9px] tracking-[.14em] text-[#71869a]">DATE AGENDA</div><h2 id="follow-up-day-title" className="display mt-1 text-[21px] font-bold text-[#263c53]">{niceDate(dialogDate)}</h2><p className="mt-1 text-[10px] text-[#7d8b99]">{dayItems.length} follow-ups · {dayItems.filter(item => item.status === 'pending').length} pending</p></div><button type="button" onClick={() => setDialogDate('')} aria-label="Close day agenda" className="grid h-8 w-8 place-items-center rounded-lg text-[#718398] hover:bg-white" data-testid="button-close-follow-up-date"><X className="h-4 w-4"/></button></div><div className="mt-5 space-y-2">{dayItems.length ? dayItems.map(item => <FollowUpRow key={item.id} item={item}/>) : <div className="rounded-lg border border-dashed border-[#dce5ec] px-4 py-8 text-center text-[11px] text-[#8190a0]">No follow-ups scheduled for this date.</div>}</div><button type="button" className={`${primary} mt-4`} onClick={() => { setFormOpen(true); }} data-testid="button-add-follow-up-on-date"><Plus className="h-3.5 w-3.5"/>Schedule for this date</button></section></div>}
    <FollowUpForm key={`${formOpen}-${selected}-${dialogDate}`} open={formOpen} onClose={() => setFormOpen(false)} initialDate={dialogDate || selected} />
  </main>;
}
