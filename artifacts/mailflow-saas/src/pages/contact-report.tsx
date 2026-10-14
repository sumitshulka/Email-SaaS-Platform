import { useMemo, useState, type FormEvent } from 'react';
import { useGetContactReport, getGetContactReportQueryKey } from '@workspace/api-client-react';
import type { GetContactReportParams } from '@workspace/api-client-react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Mail, Search, Users, Building2, RotateCcw } from 'lucide-react';

const PAGE_SIZE = 20;

function formatSentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function ReportSkeleton() {
  return (
    <div aria-label="Loading contact report" aria-busy="true" className="overflow-hidden rounded-xl border border-[#dfe6e5] bg-white">
      <div className="h-12 animate-pulse bg-[#edf3f1]" />
      {[0, 1, 2, 3, 4].map(item => (
        <div key={item} className="grid grid-cols-1 gap-3 border-t border-[#edf0ef] px-5 py-5 sm:grid-cols-[1.3fr_1.2fr_1fr_1.7fr]">
          <div className="h-4 w-32 animate-pulse rounded bg-[#edf0ef]" />
          <div className="h-4 w-40 animate-pulse rounded bg-[#f1f3f2]" />
          <div className="h-4 w-28 animate-pulse rounded bg-[#f1f3f2]" />
          <div className="h-4 w-full max-w-[300px] animate-pulse rounded bg-[#edf0ef]" />
        </div>
      ))}
    </div>
  );
}

export default function ContactReportPage() {
  const [draft, setDraft] = useState({ contactName: '', companyName: '', fromDate: '', toDate: '' });
  const [filters, setFilters] = useState({ contactName: '', companyName: '', fromDate: '', toDate: '' });
  const [page, setPage] = useState(1);
  const params = useMemo<GetContactReportParams>(() => ({
    ...(filters.contactName.trim() ? { contactName: filters.contactName.trim() } : {}),
    ...(filters.companyName.trim() ? { companyName: filters.companyName.trim() } : {}),
    ...(filters.fromDate ? { fromDate: filters.fromDate } : {}),
    ...(filters.toDate ? { toDate: filters.toDate } : {}),
    page,
    pageSize: PAGE_SIZE,
  }), [filters, page]);
  const report = useGetContactReport(params, {
    query: { queryKey: getGetContactReportQueryKey(params) },
  });

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters(draft);
    setPage(1);
  };
  const clearFilters = () => {
    const cleared = { contactName: '', companyName: '', fromDate: '', toDate: '' };
    setDraft(cleared);
    setFilters(cleared);
    setPage(1);
  };
  const hasFilters = Object.values(filters).some(Boolean);
  const data = report.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const start = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const end = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <div className="contact-report-page fade-in">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[.17em] text-[#64827a]">
            <span className="h-px w-6 bg-[#df8b48]" /> Contact intelligence
          </div>
          <h1 className="display text-[32px] font-bold leading-tight tracking-[-.05em] text-[#1d3936] sm:text-[36px]">Contact report</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#667a74]">A clear view of who has heard from you, and when.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[#dce8e3] bg-[#f5f8f5] px-3.5 py-2.5 text-[11px] font-medium text-[#4f7267]">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
          Latest five sends per contact
        </div>
      </div>

      <form onSubmit={applyFilters} className="mb-5 rounded-xl border border-[#dce6e2] bg-[#f4f7f3] p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-bold text-[#294a43]">Refine report</h2>
            <p className="mt-0.5 text-[11px] text-[#71827c]">Date range applies to successful send history.</p>
          </div>
          {hasFilters && (
            <button type="button" data-testid="button-clear-report-filters" onClick={clearFilters} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold text-[#54766b] transition hover:bg-white hover:text-[#294a43]">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.25fr_1.25fr_1fr_1fr_auto] xl:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-[#405f57]">Contact name</span>
            <span className="relative block">
              <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#82958d]" aria-hidden="true" />
              <input data-testid="input-report-contact-name" value={draft.contactName} onChange={event => setDraft(value => ({ ...value, contactName: event.target.value }))} placeholder="Search contacts" className="h-10 w-full rounded-md border border-[#d5e0dc] bg-white pl-9 pr-3 text-[12px] text-[#243c37] outline-none transition placeholder:text-[#a1ada8] focus:border-[#548a7c] focus:ring-2 focus:ring-[#d9e8e2]" />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-[#405f57]">Company name</span>
            <span className="relative block">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#82958d]" aria-hidden="true" />
              <input data-testid="input-report-company-name" value={draft.companyName} onChange={event => setDraft(value => ({ ...value, companyName: event.target.value }))} placeholder="Search companies" className="h-10 w-full rounded-md border border-[#d5e0dc] bg-white pl-9 pr-3 text-[12px] text-[#243c37] outline-none transition placeholder:text-[#a1ada8] focus:border-[#548a7c] focus:ring-2 focus:ring-[#d9e8e2]" />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-[#405f57]">Sent from</span>
            <span className="relative block">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#82958d]" aria-hidden="true" />
              <input data-testid="input-report-from-date" type="date" value={draft.fromDate} max={draft.toDate || undefined} onChange={event => setDraft(value => ({ ...value, fromDate: event.target.value }))} className="h-10 w-full rounded-md border border-[#d5e0dc] bg-white pl-9 pr-2 text-[12px] text-[#344c46] outline-none focus:border-[#548a7c] focus:ring-2 focus:ring-[#d9e8e2]" />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-[#405f57]">Sent through</span>
            <span className="relative block">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#82958d]" aria-hidden="true" />
              <input data-testid="input-report-to-date" type="date" value={draft.toDate} min={draft.fromDate || undefined} onChange={event => setDraft(value => ({ ...value, toDate: event.target.value }))} className="h-10 w-full rounded-md border border-[#d5e0dc] bg-white pl-9 pr-2 text-[12px] text-[#344c46] outline-none focus:border-[#548a7c] focus:ring-2 focus:ring-[#d9e8e2]" />
            </span>
          </label>
          <button type="submit" data-testid="button-apply-report-filters" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#347a6d] px-4 text-[12px] font-semibold text-white transition hover:bg-[#28675d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#347a6d] focus-visible:ring-offset-2">
            <Search className="h-4 w-4" aria-hidden="true" /> Apply
          </button>
        </div>
        {draft.fromDate && draft.toDate && draft.fromDate > draft.toDate && <p role="alert" className="mt-2 text-[11px] text-[#a54e36]">The start date must be before the end date.</p>}
      </form>

      {report.isLoading ? <ReportSkeleton /> : report.isError || !data ? (
        <section role="alert" className="rounded-xl border border-[#ead8c7] bg-[#fffaf5] p-7 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#f8eadb] text-[#a96130]"><Mail className="h-5 w-5" aria-hidden="true" /></div>
          <h2 className="mt-3 text-[14px] font-bold text-[#4b3b31]">Report unavailable</h2>
          <p className="mt-1 text-[12px] text-[#807064]">We couldn’t retrieve this contact history. Your filters are still here.</p>
          <button type="button" data-testid="button-retry-contact-report" onClick={() => void report.refetch()} className="mt-4 rounded-md border border-[#ddc6b3] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#8c512e] transition hover:bg-[#fff3e8]">Try again</button>
        </section>
      ) : data.contacts.length === 0 ? (
        <section className="rounded-xl border border-dashed border-[#cfddd7] bg-[#f8faf7] px-6 py-14 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[#d9e7e1] bg-white text-[#548477]"><Search className="h-5 w-5" aria-hidden="true" /></div>
          <h2 className="mt-4 text-[14px] font-bold text-[#294a43]">{hasFilters ? 'No contacts match these filters' : 'No send history yet'}</h2>
          <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[#778680]">{hasFilters ? 'Try a broader contact or company name, or widen the sent-date range.' : 'Successful campaign sends will appear here alongside each contact.'}</p>
          {hasFilters && <button type="button" onClick={clearFilters} data-testid="button-empty-clear-filters" className="mt-4 text-[12px] font-semibold text-[#347a6d] underline decoration-[#a6c2b7] underline-offset-4">Clear all filters</button>}
        </section>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1" aria-live="polite">
            <p className="text-[12px] text-[#6c7b75]"><span className="font-semibold text-[#294a43]">{start}–{end}</span> of <span className="font-semibold text-[#294a43]">{data.total}</span> contacts</p>
            {hasFilters && <span className="rounded-full bg-[#e8f0eb] px-2.5 py-1 text-[10px] font-semibold text-[#4a7467]">Filtered view</span>}
          </div>
          <div className="overflow-hidden rounded-xl border border-[#dfe6e3] bg-white shadow-[0_2px_10px_rgba(34,72,60,.035)]">
            <div className="hidden grid-cols-[1.1fr_1.2fr_.9fr_1.65fr] gap-4 bg-[#eff4ef] px-5 py-3 text-[10px] font-bold uppercase tracking-[.11em] text-[#6c8178] sm:grid">
              <div>Contact</div><div>Email</div><div>Company</div><div>Recent send dates</div>
            </div>
            <div>
              {data.contacts.map(contact => (
                <article key={contact.contactId} data-testid={`row-contact-report-${contact.contactId}`} className="grid gap-3 border-t border-[#edf0ee] px-4 py-4 first:border-t-0 sm:grid-cols-[1.1fr_1.2fr_.9fr_1.65fr] sm:items-start sm:gap-4 sm:px-5">
                  <div className="min-w-0">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-[.12em] text-[#889790] sm:hidden">Contact</div>
                    <div className="truncate text-[13px] font-semibold text-[#263f39]" data-testid={`text-contact-name-${contact.contactId}`}>{contact.contactName || 'Unnamed contact'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-[.12em] text-[#889790] sm:hidden">Email</div>
                    <div className="flex min-w-0 items-center gap-2 text-[12px] text-[#64766f]"><Mail className="h-3.5 w-3.5 shrink-0 text-[#8ba198]" aria-hidden="true" /><span className="truncate">{contact.email}</span></div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-[.12em] text-[#889790] sm:hidden">Company</div>
                    <div className="truncate text-[12px] text-[#64766f]">{contact.companyName || <span className="text-[#a0aaa5]">No company</span>}</div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[.12em] text-[#889790] sm:hidden">Recent send dates</div>
                    {contact.sentDates.length ? (
                      <ol aria-label={`Latest ${contact.sentDates.length} send dates for ${contact.contactName}`} className="flex flex-wrap gap-1.5">
                        {contact.sentDates.slice(0, 5).map((sentAt, index) => (
                          <li key={`${sentAt}-${index}`} className="inline-flex items-center gap-1.5 rounded-md border border-[#e1ebe6] bg-[#f7faf7] px-2 py-1 text-[10px] font-medium text-[#4e7065]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#df8b48]" aria-hidden="true" />{formatSentDate(sentAt)}
                          </li>
                        ))}
                      </ol>
                    ) : <p className="text-[11px] text-[#8b9791]" aria-label="No sent email history recorded">No sent history recorded</p>}
                  </div>
                </article>
              ))}
            </div>
          </div>
          <nav aria-label="Contact report pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-[#7b8983]">Page {data.page} of {pageCount}</p>
            <div className="flex items-center gap-2">
              <button type="button" data-testid="button-report-previous-page" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={data.page <= 1 || report.isFetching} aria-label="Previous page" className="inline-flex h-9 items-center gap-1 rounded-md border border-[#dce5e1] bg-white px-3 text-[11px] font-semibold text-[#47675d] transition hover:bg-[#f3f7f4] disabled:cursor-not-allowed disabled:opacity-45"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Previous</button>
              <button type="button" data-testid="button-report-next-page" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={data.page >= pageCount || report.isFetching} aria-label="Next page" className="inline-flex h-9 items-center gap-1 rounded-md border border-[#dce5e1] bg-white px-3 text-[11px] font-semibold text-[#47675d] transition hover:bg-[#f3f7f4] disabled:cursor-not-allowed disabled:opacity-45">Next<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
