import { useMemo, useState } from 'react';
import {
  ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, CalendarDays, Check, CircleAlert, CreditCard,
  Filter, Landmark, RefreshCw, Search, ShieldCheck, SlidersHorizontal,
} from 'lucide-react';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  getListAdminFinancePaymentsQueryKey, useListAdminFinancePayments,
  useListAdminSubscriptionPackages,
} from '@workspace/api-client-react';
import type { AdminFinancePayment, ListAdminFinancePaymentsParams } from '@workspace/api-client-react';

type FinanceFilters = {
  search: string;
  packageId: string;
  fromDate: string;
  toDate: string;
  minAmountMinor: string;
  maxAmountMinor: string;
  status: 'captured' | 'refunded' | 'all';
  currency: string;
  environment: 'sandbox' | 'production' | 'unrecorded' | '';
  accountStatus: 'any' | 'active' | 'disabled' | 'deleted';
  sortBy: 'capturedAt' | 'account' | 'subscription' | 'amount';
  sortDirection: 'asc' | 'desc';
  page: number;
  pageSize: number;
};

const defaults: FinanceFilters = {
  search: '', packageId: '', fromDate: '', toDate: '', minAmountMinor: '', maxAmountMinor: '', status: 'captured',
  currency: '', environment: '', accountStatus: 'any',
  sortBy: 'capturedAt', sortDirection: 'desc', page: 1, pageSize: 25,
};

const inputClass = 'h-10 w-full rounded-md border border-[#d9e0df] bg-[#fffefa] px-3 text-[12px] text-[#263735] outline-none transition focus:border-[#32847a] focus:ring-2 focus:ring-[#dceee9]';
const smallLabel = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-[.1em] text-[#788580]';
const errorText = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The request could not be completed. Please try again.';

function formatMinor(minor: number | string, currency: string) {
  const value = Number(minor);
  try {
    const digits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value / (10 ** digits));
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function dateOnly(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function PaymentStatus({ status }: { status: AdminFinancePayment['status'] }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${status === 'captured' ? 'bg-[#e4f2e9] text-[#28664a]' : 'bg-[#fff0e8] text-[#a65232]'}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${status === 'captured' ? 'bg-[#4a9a70]' : 'bg-[#d97852]'}`}/>{status}
  </span>;
}

function AccountState({ status }: { status: AdminFinancePayment['account']['status'] }) {
  const color = status === 'active' ? 'bg-[#e4f2e9] text-[#28664a]' : status === 'disabled' ? 'bg-[#f1ece0] text-[#81683a]' : 'bg-[#f4e8e5] text-[#925446]';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ${color}`}>{status}</span>;
}

function EvidenceId({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0">
    <div className="text-[9px] font-semibold uppercase tracking-[.08em] text-[#89938e]">{label}</div>
    <div className="mono mt-1 break-all text-[10px] text-[#40524d]" title={value || undefined}>{value || 'Not recorded'}</div>
  </div>;
}

function SortControl({ label, field, active, direction, onSort, disabled = false }: {
  label: string; field: FinanceFilters['sortBy']; active: boolean; direction: FinanceFilters['sortDirection']; onSort: (field: FinanceFilters['sortBy']) => void; disabled?: boolean;
}) {
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return <button type="button" disabled={disabled} onClick={() => onSort(field)} className={`inline-flex items-center gap-1 text-left text-[10px] font-bold uppercase tracking-[.1em] transition hover:text-[#176d64] disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'text-[#176d64]' : 'text-[#77847f]'}`}>
    {label}<Icon className="h-3 w-3"/>
  </button>;
}

export default function AdminFinancePage() {
  const [filters, setFilters] = useState<FinanceFilters>(defaults);
  const [selectedPayment, setSelectedPayment] = useState<AdminFinancePayment | null>(null);
  const params = useMemo<ListAdminFinancePaymentsParams>(() => ({
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    ...(filters.packageId ? { packageId: filters.packageId } : {}),
    ...(filters.fromDate ? { fromDate: filters.fromDate } : {}),
    ...(filters.toDate ? { toDate: filters.toDate } : {}),
    ...(filters.minAmountMinor !== '' ? { minAmountMinor: Number(filters.minAmountMinor) } : {}),
    ...(filters.maxAmountMinor !== '' ? { maxAmountMinor: Number(filters.maxAmountMinor) } : {}),
    status: filters.status,
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.environment ? { environment: filters.environment } : {}),
    accountStatus: filters.accountStatus,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
    page: filters.page,
    pageSize: filters.pageSize,
  }), [filters]);
  const ledger = useListAdminFinancePayments(params, {
    query: { queryKey: getListAdminFinancePaymentsQueryKey(params) },
  });
  const packagesQuery = useListAdminSubscriptionPackages();
  const data = ledger.data;
  const packages = packagesQuery.data?.packages ?? [];
  const setFilter = <K extends keyof FinanceFilters>(key: K, value: FinanceFilters[K]) =>
    setFilters(current => ({ ...current, [key]: value, page: 1 }));
  const setCurrency = (currency: string) => setFilters(current => ({
    ...current,
    currency,
    ...(!currency ? { minAmountMinor: '', maxAmountMinor: '', ...(current.sortBy === 'amount' ? { sortBy: 'capturedAt' as const, sortDirection: 'desc' as const } : {}) } : {}),
    page: 1,
  }));
  const sortBy = (field: FinanceFilters['sortBy']) => {
    if (field === 'amount' && !filters.currency) return;
    setFilters(current => ({
    ...current, sortBy: field,
    sortDirection: current.sortBy === field && current.sortDirection === 'desc' ? 'asc' : 'desc',
    page: 1,
    }));
  };
  const resetFilters = () => setFilters(defaults);
  const hasFilters = Boolean(filters.search || filters.packageId || filters.fromDate || filters.toDate || filters.minAmountMinor || filters.maxAmountMinor || filters.currency || filters.environment || filters.accountStatus !== 'any' || filters.status !== 'captured');
  const page = data?.page ?? filters.page;
  const pageCount = data?.pageCount ?? 0;
  const firstItem = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastItem = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return <div className="fade-in space-y-6">
    <header className="relative overflow-hidden rounded-xl border border-[#cfe0d9] bg-[#f1f5ef] px-5 py-6 md:px-8 md:py-8">
      <div className="pointer-events-none absolute -right-8 -top-20 h-64 w-64 rounded-full border border-[#bfd5cb]"/>
      <div className="pointer-events-none absolute -right-1 top-[-42px] h-48 w-48 rounded-full border border-[#c9dcd2]"/>
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-2xl">
          <div className="mono mb-3 flex items-center gap-2 text-[9px] font-medium uppercase tracking-[.2em] text-[#548077]"><span className="h-px w-6 bg-[#d58953]"/>PLATFORM / FINANCE</div>
          <h1 className="display text-[31px] font-bold leading-tight text-[#203a35] md:text-[36px]">Payment ledger</h1>
          <p className="mt-2 max-w-xl text-[12px] leading-5 text-[#65756f]">Trace captured revenue from payment evidence back to the customer account and subscription term.</p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[#d0dfd7] bg-[#f9fbf7] px-3 py-2 text-[10px] font-semibold text-[#4d6e64]"><ShieldCheck className="h-4 w-4 text-[#337a68]"/>Server-sourced records</div>
      </div>
    </header>

    {data?.summaryByCurrency?.length ? <section aria-label="Finance summary by currency" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {data.summaryByCurrency.map(summary => <article key={summary.currency} data-testid={`summary-finance-${summary.currency.toLowerCase()}`} className="relative overflow-hidden rounded-lg border border-[#dbe5dd] bg-[#fbfcf8] p-4">
        <div className="flex items-center justify-between">
          <div className="mono text-[10px] font-medium tracking-[.14em] text-[#74847b]">{summary.currency} / LEDGER TOTALS</div>
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[#e6f0e9] text-[#387667]"><CreditCard className="h-4 w-4"/></span>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <div><div className="display text-[23px] font-bold tracking-[-.04em] text-[#203a35]">{formatMinor(summary.capturedAmountMinor, summary.currency)}</div><div className="mt-1 text-[10px] text-[#77847e]">Captured gross · {summary.capturedCount.toLocaleString()} payments</div></div>
          <div className="text-right"><div className="mono text-[13px] font-semibold text-[#9a5b40]">− {formatMinor(summary.refundedAmountMinor, summary.currency)}</div><div className="mt-1 text-[10px] text-[#8a817b]">{summary.refundedCount.toLocaleString()} refunded · {summary.paymentCount.toLocaleString()} total</div></div>
        </div>
      </article>)}
    </section> : null}

    <section className="rounded-lg border border-[#dfe6e1] bg-[#fffefa]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ece7] px-4 py-3.5 md:px-5">
        <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-md bg-[#eaf2ec] text-[#34786a]"><SlidersHorizontal className="h-4 w-4"/></span><div><h2 className="text-[13px] font-bold text-[#2a3e38]">Ledger filters</h2><p className="mt-0.5 text-[10px] text-[#7f8983]">Every change is applied server-side.</p></div></div>
        <button type="button" onClick={resetFilters} data-testid="button-reset-finance-filters" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#dce4de] px-2.5 text-[10px] font-semibold text-[#5d7068] transition hover:bg-[#f2f6f1]"><RefreshCw className="h-3 w-3"/>Reset filters</button>
      </div>
      <div className="space-y-5 p-4 md:p-5">
        <section aria-labelledby="finance-filter-search-heading">
          <div className="mb-3">
            <h3 id="finance-filter-search-heading" className="text-[10px] font-bold uppercase tracking-[.12em] text-[#526a60]">Search & payment</h3>
            <p className="mt-1 text-[10px] text-[#7f8983]">Find records, then narrow by package, payment, currency, gateway, or account.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="sm:col-span-2 lg:col-span-2">
              <span className={smallLabel}>Search records</span>
              <span className="relative block">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#89958e]"/>
                <input data-testid="input-finance-search" value={filters.search} onChange={event => setFilter('search', event.target.value)} placeholder="Account, plan, subscription or payment ID" className={`${inputClass} pl-9`}/>
              </span>
            </label>
            <label>
              <span className={smallLabel}>Subscription package</span>
              <select data-testid="select-finance-package" value={filters.packageId} onChange={event => setFilter('packageId', event.target.value)} className={inputClass}>
                <option value="">All packages</option>{packages.map(pkg => <option value={pkg.id} key={pkg.id}>{pkg.name}</option>)}
              </select>
            </label>
            <label>
              <span className={smallLabel}>Payment state</span>
              <select data-testid="select-finance-status" value={filters.status} onChange={event => setFilter('status', event.target.value as FinanceFilters['status'])} className={inputClass}>
                <option value="captured">Captured only</option><option value="refunded">Refunded</option><option value="all">All recorded</option>
              </select>
            </label>
            <label>
              <span className={smallLabel}>Currency</span>
              <select data-testid="select-finance-currency" value={filters.currency} onChange={event => setCurrency(event.target.value)} className={inputClass}>
                <option value="">All currencies</option>{(data?.currencies ?? []).map(currency => <option value={currency} key={currency}>{currency}</option>)}
              </select>
            </label>
            <label>
              <span className={smallLabel}>Gateway mode</span>
              <select data-testid="select-finance-environment" value={filters.environment} onChange={event => setFilter('environment', event.target.value as FinanceFilters['environment'])} className={inputClass}>
                <option value="">All environments</option><option value="sandbox">Sandbox</option><option value="production">Production</option><option value="unrecorded">Unrecorded</option>
              </select>
            </label>
            <label>
              <span className={smallLabel}>Account state</span>
              <select data-testid="select-finance-account-status" value={filters.accountStatus} onChange={event => setFilter('accountStatus', event.target.value as FinanceFilters['accountStatus'])} className={inputClass}>
                <option value="any">Any status</option><option value="active">Active</option><option value="disabled">Disabled</option><option value="deleted">Deleted</option>
              </select>
            </label>
          </div>
        </section>
        <section aria-labelledby="finance-filter-range-heading" className="border-t border-[#e8ece7] pt-4">
          <div className="mb-3">
            <h3 id="finance-filter-range-heading" className="text-[10px] font-bold uppercase tracking-[.12em] text-[#526a60]">Captured date & amount</h3>
            <p className="mt-1 text-[10px] text-[#7f8983]">Dates use UTC. Amount bounds use the selected currency’s smallest unit (for example, INR paise or USD cents).</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className={smallLabel}>Captured from (UTC)</span>
              <span className="relative block">
                <CalendarDays className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#89958e]"/>
                <input data-testid="input-finance-from-date" type="date" value={filters.fromDate} max={filters.toDate || undefined} onChange={event => setFilter('fromDate', event.target.value)} className={`${inputClass} pl-9`}/>
              </span>
            </label>
            <label>
              <span className={smallLabel}>Captured through (UTC)</span>
              <span className="relative block">
                <CalendarDays className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#89958e]"/>
                <input data-testid="input-finance-to-date" type="date" value={filters.toDate} min={filters.fromDate || undefined} onChange={event => setFilter('toDate', event.target.value)} className={`${inputClass} pl-9`}/>
              </span>
            </label>
            <label>
              <span className={smallLabel}>Minimum amount</span>
              <input data-testid="input-finance-min-amount" type="number" min="0" step="1" disabled={!filters.currency} value={filters.minAmountMinor} onChange={event => setFilter('minAmountMinor', event.target.value)} placeholder={filters.currency ? 'Minor units' : 'Select currency first'} className={inputClass}/>
            </label>
            <label>
              <span className={smallLabel}>Maximum amount</span>
              <input data-testid="input-finance-max-amount" type="number" min="0" step="1" disabled={!filters.currency} value={filters.maxAmountMinor} onChange={event => setFilter('maxAmountMinor', event.target.value)} placeholder={filters.currency ? 'Minor units' : 'Select currency first'} className={inputClass}/>
            </label>
          </div>
        </section>
      </div>
      {packagesQuery.isError && <div role="status" className="border-t border-[#eee8db] bg-[#fbf8f0] px-5 py-2 text-[10px] text-[#816c46]">Package options could not be loaded. Other ledger filters remain available.</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8ece7] bg-[#f7f9f5] px-4 py-3 md:px-5">
        <div className="flex items-center gap-2 text-[10px] text-[#6d7b74]"><Filter className="h-3.5 w-3.5 text-[#478276]"/><span>Showing <strong className="text-[#334b43]">{filters.status === 'captured' ? 'captured only' : filters.status === 'all' ? 'all recorded payments' : 'refunded payments'}</strong>; unsuccessful attempts are excluded.</span>{hasFilters && <span className="rounded-full bg-[#e7f0e9] px-2 py-0.5 font-semibold text-[#487569]">Filtered</span>}</div>
        <label className="flex items-center gap-2 text-[10px] font-semibold text-[#77847e]">Rows per page<select data-testid="select-finance-page-size" value={filters.pageSize} onChange={event => setFilter('pageSize', Number(event.target.value))} className="h-8 rounded border border-[#d8e1da] bg-white px-2 text-[11px] text-[#344b42]"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div>
    </section>

    {ledger.isLoading ? <div data-testid="loading-admin-finance" aria-label="Loading finance ledger" className="space-y-3">
      <div className="h-12 animate-pulse rounded-lg bg-[#eaf0eb]"/><div className="h-24 animate-pulse rounded-lg bg-[#f0f3ee]"/><div className="h-24 animate-pulse rounded-lg bg-[#f0f3ee]"/><div className="h-24 animate-pulse rounded-lg bg-[#f0f3ee]"/>
    </div> : ledger.isError || !data ? <section data-testid="error-admin-finance" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#ecd8cb] bg-[#fff9f4] p-5">
      <div className="flex items-center gap-3"><CircleAlert className="h-5 w-5 text-[#bd6945]"/><div><h2 className="text-[13px] font-bold text-[#624538]">Finance ledger unavailable</h2><p className="mt-1 text-[11px] text-[#927a6d]">{ledger.isError ? errorText(ledger.error) : 'No ledger response was returned.'}</p></div></div>
      <button type="button" data-testid="button-retry-finance" onClick={() => void ledger.refetch()} className="rounded-md border border-[#dfc8b9] bg-white px-3.5 py-2 text-[11px] font-semibold text-[#80583f] hover:bg-[#fff3e9]">Retry request</button>
    </section> : data.rows.length === 0 ? <section data-testid="empty-admin-finance" className="grid min-h-64 place-items-center rounded-lg border border-dashed border-[#cfdcd2] bg-[#fafbf7] px-6 py-10 text-center">
      <div><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#e9f1ea] text-[#508172]"><Landmark className="h-5 w-5"/></span><h2 className="mt-4 text-[14px] font-bold text-[#344a41]">No matching payment records</h2><p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-[#7c8981]">Try a broader date range, remove a filter, or search using an account or payment reference.</p>{hasFilters && <button type="button" onClick={resetFilters} className="mt-4 rounded-md border border-[#d7e1d8] bg-white px-3 py-2 text-[10px] font-semibold text-[#497065] hover:bg-[#f4f8f2]">Clear filters</button>}</div>
    </section> : <>
      <section className="overflow-hidden rounded-lg border border-[#dfe6e1] bg-[#fffefa]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ece7] px-4 py-3.5 md:px-5">
          <div><h2 className="text-[13px] font-bold text-[#2d423b]">Payment records</h2><p className="mt-1 text-[10px] text-[#7f8983]">Customer, subscription, and payment details open when you select a record.</p></div>
          <div data-testid="text-finance-results-count" className="mono rounded-md bg-[#eef3ee] px-2.5 py-1.5 text-[10px] text-[#566c61]">{data.total.toLocaleString()} records</div>
        </div>
        <div className="flex items-center gap-1.5 border-b border-[#e8ece7] bg-[#f5f7f2] px-4 py-2 text-[10px] text-[#78847d] md:px-5">
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-[#548077]"/>
          <span>Scroll horizontally to see all columns. Select a row to view full payment references.</span>
        </div>
        <div data-testid="finance-table-scroll" className="overflow-x-auto overscroll-x-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[900px] table-fixed text-left">
            <colgroup>
              <col style={{ width: '19%' }}/>
              <col style={{ width: '26%' }}/>
              <col style={{ width: '31%' }}/>
              <col style={{ width: '24%' }}/>
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-[#e8ece7] bg-[#f5f7f2]">
              <tr>
                <th scope="col" className="px-5 py-3"><SortControl label="Captured" field="capturedAt" active={filters.sortBy === 'capturedAt'} direction={filters.sortDirection} onSort={sortBy}/></th>
                <th scope="col" className="px-5 py-3"><SortControl label="Customer account" field="account" active={filters.sortBy === 'account'} direction={filters.sortDirection} onSort={sortBy}/></th>
                <th scope="col" className="px-5 py-3"><SortControl label="Subscription" field="subscription" active={filters.sortBy === 'subscription'} direction={filters.sortDirection} onSort={sortBy}/></th>
                <th scope="col" className="px-5 py-3 text-right"><SortControl label="Amount" field="amount" active={filters.sortBy === 'amount'} direction={filters.sortDirection} onSort={sortBy} disabled={!filters.currency}/></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0eb]">
              {data.rows.map(payment => <tr
                key={payment.id}
                data-testid="row-finance-payment"
                tabIndex={0}
                aria-label={`Open payment details for ${payment.account.email}`}
                aria-haspopup="dialog"
                title="Select to view payment details"
                onClick={() => setSelectedPayment(payment)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedPayment(payment);
                  }
                }}
                className="cursor-pointer transition-colors hover:bg-[#fbfcf8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#32847a]"
              >
                <td className="px-5 py-4 align-middle">
                  <div className="mono text-[10px] font-semibold text-[#3b544b]">{formatDate(payment.capturedAt)}</div>
                  <div className="mt-1.5 flex items-center gap-2"><PaymentStatus status={payment.status}/><span className="text-[9px] text-[#89938d]">{payment.razorpayEnvironment || 'environment unrecorded'}</span></div>
                </td>
                <td className="min-w-0 px-5 py-4 align-middle">
                  <div className="flex flex-wrap items-center gap-2"><span className="truncate text-[12px] font-bold text-[#293e37]">{payment.account.fullName || `${payment.account.firstName} ${payment.account.lastName}`}</span><AccountState status={payment.account.status}/></div>
                  <div className="mt-1 truncate text-[10px] text-[#687a71]">{payment.account.email}</div>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[9px] text-[#8b958f]"><span>@{payment.account.username}</span><span>Joined {dateOnly(payment.account.registeredAt)}</span></div>
                </td>
                <td className="min-w-0 px-5 py-4 align-middle">
                  <div className="text-[11px] font-semibold text-[#455e53]">{payment.subscriptionPackage.name}</div>
                  {payment.subscription ? <>
                    <div className="mt-1"><span className="rounded bg-[#e9f1eb] px-1.5 py-0.5 text-[9px] font-semibold capitalize text-[#527366]">{payment.subscription.status}</span></div>
                    <div className="mt-1 text-[9px] text-[#77847c]">{dateOnly(payment.subscription.startsAt)} — {dateOnly(payment.subscription.endsAt)}</div>
                  </> : <div className="mt-2 text-[9px] italic text-[#929b94]">No linked subscription</div>}
                </td>
                <td className="px-5 py-4 text-right align-middle">
                  <div className="display text-[19px] font-bold tracking-[-.04em] text-[#25473d]">{formatMinor(payment.amountMinor, payment.currency)}</div>
                  <div className="mt-1 text-[9px] text-[#829087]">{payment.currency}{payment.status === 'refunded' ? ' · refund recorded' : ' · captured'}</div>
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8ece7] bg-[#f7f9f5] px-4 py-3 md:px-5">
          <div data-testid="text-finance-page-range" className="text-[10px] text-[#77847d]">Showing <strong className="text-[#43594f]">{firstItem}–{lastItem}</strong> of {data.total.toLocaleString()} · page {page} of {Math.max(pageCount, 1)}</div>
          <div className="flex items-center gap-2">
            <button type="button" data-testid="button-finance-previous-page" disabled={page <= 1 || ledger.isFetching} onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))} className="h-8 rounded-md border border-[#d8e1da] bg-white px-3 text-[10px] font-semibold text-[#536b60] hover:bg-[#f0f5f0] disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <button type="button" data-testid="button-finance-next-page" disabled={pageCount === 0 || page >= pageCount || ledger.isFetching} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))} className="h-8 rounded-md border border-[#d8e1da] bg-white px-3 text-[10px] font-semibold text-[#536b60] hover:bg-[#f0f5f0] disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
        </footer>
      </section>
      <div className="flex items-start gap-2 px-1 text-[10px] leading-5 text-[#87918a]"><Check className="mt-0.5 h-3 w-3 shrink-0 text-[#4d8c70]"/>Amounts and dates are presented from the payment ledger response. Capture-date filters use inclusive UTC calendar dates.</div>
      <Sheet open={selectedPayment !== null} onOpenChange={open => { if (!open) setSelectedPayment(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-[#dce6de] bg-[#fffefa] p-0 sm:max-w-xl">
          {selectedPayment && <>
            <SheetHeader className="border-b border-[#e8ece7] bg-[#f5f7f2] px-6 py-5 pr-14 text-left">
              <SheetTitle className="text-[16px] font-bold text-[#2d423b]">Payment details</SheetTitle>
              <SheetDescription className="text-[11px] leading-5 text-[#748078]">Full payment, customer, and subscription references for this ledger entry.</SheetDescription>
            </SheetHeader>
            <div className="space-y-6 p-6">
              <div className="rounded-lg border border-[#dfe8df] bg-[#f8faf5] p-4">
                <div className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#89938e]">Payment amount</div>
                <div className="display mt-1 text-[25px] font-bold tracking-[-.04em] text-[#25473d]">{formatMinor(selectedPayment.amountMinor, selectedPayment.currency)}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2"><PaymentStatus status={selectedPayment.status}/><span className="text-[10px] text-[#78847d]">{selectedPayment.currency} · {selectedPayment.razorpayEnvironment || 'environment unrecorded'}</span></div>
              </div>

              <section aria-label="Customer account details">
                <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.1em] text-[#748078]">Customer account</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <EvidenceId label="Name" value={selectedPayment.account.fullName || `${selectedPayment.account.firstName} ${selectedPayment.account.lastName}`}/>
                  <EvidenceId label="Account status" value={selectedPayment.account.status}/>
                  <EvidenceId label="Email" value={selectedPayment.account.email}/>
                  <EvidenceId label="Username" value={selectedPayment.account.username ? `@${selectedPayment.account.username}` : null}/>
                  <EvidenceId label="Registered" value={dateOnly(selectedPayment.account.registeredAt)}/>
                  <EvidenceId label="Account ID" value={selectedPayment.account.id}/>
                </div>
              </section>

              <section aria-label="Subscription details">
                <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.1em] text-[#748078]">Subscription</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <EvidenceId label="Package" value={selectedPayment.subscriptionPackage.name}/>
                  <EvidenceId label="Package ID" value={selectedPayment.subscriptionPackage.id}/>
                  <EvidenceId label="Subscription status" value={selectedPayment.subscription?.status ?? 'No linked subscription'}/>
                  <EvidenceId label="Subscription ID" value={selectedPayment.subscription?.id ?? null}/>
                  <EvidenceId label="Term starts" value={selectedPayment.subscription ? dateOnly(selectedPayment.subscription.startsAt) : null}/>
                  <EvidenceId label="Term ends" value={selectedPayment.subscription ? dateOnly(selectedPayment.subscription.endsAt) : null}/>
                </div>
              </section>

              <section aria-label="Payment references">
                <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.1em] text-[#748078]">Payment references</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <EvidenceId label="Payment record ID" value={selectedPayment.id}/>
                  <EvidenceId label="Receipt" value={selectedPayment.receipt}/>
                  <EvidenceId label="Razorpay order ID" value={selectedPayment.razorpayOrderId}/>
                  <EvidenceId label="Razorpay payment ID" value={selectedPayment.razorpayPaymentId}/>
                  <EvidenceId label="Captured at" value={formatDate(selectedPayment.capturedAt)}/>
                </div>
              </section>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </>}
  </div>;
}