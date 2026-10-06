import { useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { getSearchCompaniesQueryKey, useSearchCompanies } from '@workspace/api-client-react';
import type { CompanySearchResultItem, ContactDirectoryFilters, ContactList } from '@workspace/api-client-react';

export const CONTACT_FILTER_NONE = '__none__';
export const CONTACT_FILTER_UNSET = '__unset__';
const COMPANY_SEARCH_PAGE_SIZE = 40;

export type ContactDirectoryFilterValues = ContactDirectoryFilters;

export const emptyContactDirectoryFilters: ContactDirectoryFilterValues = {
  search: '',
  status: 'all',
  listId: 'all',
  companyId: 'all',
  lifecycleStage: 'all',
  leadStatus: 'all',
  leadSource: 'all',
  addedWithin: 'any',
};

type FilterOption = { value: string; label: string };

function FilterSelect({
  label,
  value,
  options,
  testId,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  testId: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-semibold text-[#415166]">{label}</span>
      <select
        data-testid={testId}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-[#d3dce7] bg-white px-3 text-[12px] text-[#29394c] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function CompanyFilter({
  value,
  onChange,
  selectedCompanyName,
}: {
  value: string;
  onChange: (value: string, company?: CompanySearchResultItem) => void;
  selectedCompanyName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const query = search.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setPage(1);
    setActiveOptionId(null);
  }, [debouncedSearch]);
  useEffect(() => {
    setActiveOptionId(null);
  }, [page]);
  const companiesQuery = useSearchCompanies(
    { search: debouncedSearch, page, pageSize: COMPANY_SEARCH_PAGE_SIZE },
    { query: { queryKey: getSearchCompaniesQueryKey({ search: debouncedSearch, page, pageSize: COMPANY_SEARCH_PAGE_SIZE }), enabled: open, staleTime: 30_000 } },
  );
  const visible = companiesQuery.data?.companies ?? [];
  const total = companiesQuery.data?.total ?? 0;
  const pageSize = companiesQuery.data?.pageSize ?? COMPANY_SEARCH_PAGE_SIZE;
  const pageCount = Math.ceil(total / pageSize);
  const firstResult = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResult = (page - 1) * pageSize + visible.length;
  const loading = query !== debouncedSearch || companiesQuery.isLoading || (companiesQuery.isFetching && !companiesQuery.data);
  const error = companiesQuery.isError && !companiesQuery.data;
  const selectableOptions: Array<{ id: string; value: string; company?: CompanySearchResultItem }> = [
    { id: 'contact-company-option-all', value: 'all' },
    { id: 'contact-company-option-none', value: CONTACT_FILTER_NONE },
    ...(!loading && !error ? visible.map(company => ({
      id: `contact-company-option-${company.id}`,
      value: company.id,
      company,
    })) : []),
  ];
  const activeOption = selectableOptions.find(option => option.id === activeOptionId);
  const choose = (nextValue: string, company?: CompanySearchResultItem) => {
    onChange(nextValue, company);
    setSearch('');
    setDebouncedSearch('');
    setPage(1);
    setActiveOptionId(null);
    setOpen(false);
  };

  return (
    <div
      ref={containerRef}
      onBlur={event => {
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
          setActiveOptionId(null);
          setOpen(false);
        }
      }}
      className="relative min-w-0"
    >
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-[#415166]">Company</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8795a5]"/>
          <input
            ref={inputRef}
            data-testid="select-contact-company-filter"
            type="search"
            role="combobox"
            aria-label="Company"
            aria-expanded={open}
            aria-controls="contact-company-options"
            aria-activedescendant={open && activeOption ? activeOption.id : undefined}
            aria-autocomplete="list"
            value={open ? search : selectedCompanyName ?? ''}
            onFocus={() => {
              if (!open) {
                setSearch('');
                setDebouncedSearch('');
                setPage(1);
                setActiveOptionId(null);
                setOpen(true);
              }
            }}
            onChange={event => { setSearch(event.target.value); setActiveOptionId(null); setOpen(true); }}
            onKeyDown={event => {
              if (event.key === 'Escape' && open) {
                event.preventDefault();
                setActiveOptionId(null);
                setOpen(false);
                return;
              }
              if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && open) {
                event.preventDefault();
                const currentIndex = selectableOptions.findIndex(option => option.id === activeOptionId);
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                const nextIndex = currentIndex === -1
                  ? (direction > 0 ? 0 : selectableOptions.length - 1)
                  : Math.max(0, Math.min(selectableOptions.length - 1, currentIndex + direction));
                setActiveOptionId(selectableOptions[nextIndex].id);
                return;
              }
              if (event.key === 'Enter' && open && activeOption) {
                event.preventDefault();
                choose(activeOption.value, activeOption.company);
              }
            }}
            placeholder="Search companies…"
            autoComplete="off"
            className="h-10 w-full rounded-md border border-[#d3dce7] bg-white pl-9 pr-3 text-[12px] text-[#29394c] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#9aa6b4]"
          />
        </span>
      </label>
      {open && (
        <div
          id="contact-company-options"
          role="listbox"
          aria-label="Company options"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setActiveOptionId(null);
              setOpen(false);
              inputRef.current?.focus();
            }
          }}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-[#d6e0eb] bg-white p-1 shadow-lg"
        >
          <button
            id="contact-company-option-all"
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={value === 'all'}
            onMouseDown={event => event.preventDefault()}
            onClick={() => choose('all')}
            className={`block w-full rounded px-3 py-2 text-left text-[12px] font-medium text-[#354a60] hover:bg-[#f2f6fa] ${activeOptionId === 'contact-company-option-all' ? 'bg-[#f2f6fa]' : ''}`}
          >
            Any company
          </button>
          <button
            id="contact-company-option-none"
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={value === CONTACT_FILTER_NONE}
            onMouseDown={event => event.preventDefault()}
            onClick={() => choose(CONTACT_FILTER_NONE)}
            className={`block w-full rounded px-3 py-2 text-left text-[12px] font-medium text-[#354a60] hover:bg-[#f2f6fa] ${activeOptionId === 'contact-company-option-none' ? 'bg-[#f2f6fa]' : ''}`}
          >
            No company
          </button>
          <div className="my-1 border-t border-[#edf0f3]"/>
          {loading ? <p className="px-3 py-2 text-[11px] text-[#788696]">Loading companies…</p>
            : error ? <div className="px-3 py-2"><p role="alert" className="text-[11px] text-[#a84926]">Company options could not be loaded.</p><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => void companiesQuery.refetch()} className="mt-1 text-[11px] font-semibold text-[#245b9b] hover:underline">Retry</button></div>
            : visible.length ? visible.map(company => (
              <button
                key={company.id}
                type="button"
                role="option"
                id={`contact-company-option-${company.id}`}
                tabIndex={-1}
                aria-selected={value === company.id}
                data-testid={`option-contact-company-${company.id}`}
                onMouseDown={event => event.preventDefault()}
                onClick={() => choose(company.id, company)}
                className={`block w-full rounded px-3 py-2 text-left hover:bg-[#f2f6fa] ${activeOptionId === `contact-company-option-${company.id}` ? 'bg-[#f2f6fa]' : ''}`}
              >
                <span className="block truncate text-[12px] font-medium text-[#354a60]">{company.companyName}</span>
                {company.companyDomain && <span className="mt-0.5 block truncate text-[10px] text-[#8290a0]">{company.companyDomain}</span>}
              </button>
            )) : <p className="px-3 py-2 text-[11px] text-[#788696]">{query ? 'No matching companies.' : 'No company records yet.'}</p>}
          {!loading && !error && total > pageSize && (
            <div className="border-t border-[#edf0f3] px-3 py-2">
              <p className="text-[10px] text-[#8290a0]">
                Showing {firstResult.toLocaleString()}–{lastResult.toLocaleString()} of {total.toLocaleString()} matches. Refine your search or browse pages.
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="button-contact-company-previous-page"
                  disabled={page <= 1 || companiesQuery.isFetching}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    setActiveOptionId(null);
                    setPage(currentPage => Math.max(1, currentPage - 1));
                    inputRef.current?.focus();
                  }}
                  className="rounded px-2 py-1 text-[10px] font-semibold text-[#315879] hover:bg-[#f2f6fa] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Previous
                </button>
                <span aria-live="polite" className="text-[10px] text-[#718095]">Page {page} of {pageCount}</span>
                <button
                  type="button"
                  data-testid="button-contact-company-next-page"
                  disabled={page >= pageCount || companiesQuery.isFetching}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    setActiveOptionId(null);
                    setPage(currentPage => Math.min(pageCount, currentPage + 1));
                    inputRef.current?.focus();
                  }}
                  className="rounded px-2 py-1 text-[10px] font-semibold text-[#315879] hover:bg-[#f2f6fa] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {value !== 'all' && (
        <button type="button" onClick={() => choose('all')} className="mt-1 text-[10px] font-semibold text-[#58728c] hover:underline">Clear company filter</button>
      )}
    </div>
  );
}

export function ContactDirectoryFiltersPanel({
  filters,
  onChange,
  lists,
  selectedCompanyName,
  onSelectedCompanyNameChange,
  lifecycleStages,
  leadStatuses,
  leadSources,
}: {
  filters: ContactDirectoryFilterValues;
  onChange: (filters: ContactDirectoryFilterValues) => void;
  lists: ContactList[];
  selectedCompanyName: string | null;
  onSelectedCompanyNameChange: (name: string | null) => void;
  lifecycleStages: string[];
  leadStatuses: string[];
  leadSources: string[];
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const setFilter = <K extends keyof ContactDirectoryFilterValues>(
    key: K,
    value: ContactDirectoryFilterValues[K],
  ) => {
    onChange({ ...filters, [key]: value });
  };

  const activeLabels: string[] = [];
  if (filters.search.trim()) activeLabels.push(`Search: ${filters.search.trim()}`);
  if (filters.status !== 'all') activeLabels.push(`Status: ${filters.status === 'subscribed' ? 'Subscribed' : 'Unsubscribed'}`);
  if (filters.listId === CONTACT_FILTER_NONE) activeLabels.push('List: No list');
  else if (filters.listId !== 'all') activeLabels.push(`List: ${lists.find(list => list.id === filters.listId)?.name || 'Selected list'}`);
  if (filters.companyId === CONTACT_FILTER_NONE) activeLabels.push('Company: No company');
  else if (filters.companyId !== 'all') activeLabels.push(`Company: ${selectedCompanyName || 'Selected company'}`);
  if (filters.lifecycleStage === CONTACT_FILTER_UNSET) activeLabels.push('Lifecycle: Not set');
  else if (filters.lifecycleStage !== 'all') activeLabels.push(`Lifecycle: ${filters.lifecycleStage}`);
  if (filters.leadStatus === CONTACT_FILTER_UNSET) activeLabels.push('Lead status: Not set');
  else if (filters.leadStatus !== 'all') activeLabels.push(`Lead status: ${filters.leadStatus}`);
  if (filters.leadSource === CONTACT_FILTER_UNSET) activeLabels.push('Lead source: Not set');
  else if (filters.leadSource !== 'all') activeLabels.push(`Lead source: ${filters.leadSource}`);
  if (filters.addedWithin !== 'any') activeLabels.push(`Added: Last ${filters.addedWithin} days`);

  const advancedCount = [
    filters.lifecycleStage !== 'all',
    filters.leadStatus !== 'all',
    filters.leadSource !== 'all',
    filters.addedWithin !== 'any',
  ].filter(Boolean).length;

  return (
    <div
      aria-label="Contact filters"
      data-testid="contact-filter-panel"
      className="rounded-lg border border-[#dce5ef] p-4 sm:p-5"
      style={{ backgroundColor: '#f5f8fc' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mono text-[9px] font-semibold uppercase tracking-[.15em] text-[#64758a]">Filter audience</div>
          <p className="mt-1 text-[11px] text-[#718095]">Search across contact details, then combine filters to narrow results.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-live="polite" className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-[#63738a]">
            {activeLabels.length} active
          </span>
          <button
            type="button"
            data-testid="button-toggle-more-contact-filters"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(open => !open)}
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#cbd8e7] bg-white px-3 text-[11px] font-semibold text-[#3e5875] transition hover:bg-[#edf3fa]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5"/>
            {advancedOpen ? 'Fewer filters' : 'More filters'}
            {advancedCount > 0 && <span className="rounded-full bg-[#e8f0fa] px-1.5 py-0.5 text-[9px]">{advancedCount}</span>}
          </button>
          {activeLabels.length > 0 && (
            <button
              type="button"
              data-testid="button-clear-contact-filters"
              onClick={() => onChange(emptyContactDirectoryFilters)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold text-[#69798d] transition hover:bg-white hover:text-[#27384c]"
            >
              <X className="h-3.5 w-3.5"/>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block min-w-0 xl:col-span-1">
          <span className="mb-1.5 block text-[11px] font-semibold text-[#415166]">Search contacts</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8795a5]"/>
            <input
              data-testid="input-search-contacts"
              value={filters.search}
              onChange={event => setFilter('search', event.target.value)}
              placeholder="Name, email, title, company…"
              maxLength={200}
              className="h-10 w-full rounded-md border border-[#d3dce7] bg-white pl-9 pr-3 text-[12px] text-[#29394c] outline-none transition placeholder:text-[#9aa6b4] focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"
            />
          </span>
        </label>
        <FilterSelect
          label="Subscription"
          value={filters.status}
          testId="select-contact-status-filter"
          onChange={value => setFilter('status', value as ContactDirectoryFilterValues['status'])}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'subscribed', label: 'Subscribed' },
            { value: 'unsubscribed', label: 'Unsubscribed' },
          ]}
        />
        <FilterSelect
          label="List membership"
          value={filters.listId}
          testId="select-contact-list-filter"
          onChange={value => setFilter('listId', value)}
          options={[
            { value: 'all', label: 'Any list' },
            { value: CONTACT_FILTER_NONE, label: 'No list' },
            ...lists.map(list => ({ value: list.id, label: list.name })),
          ]}
        />
        <CompanyFilter
          value={filters.companyId}
          onChange={(value, company) => {
            setFilter('companyId', value);
            onSelectedCompanyNameChange(company?.companyName ?? null);
          }}
          selectedCompanyName={selectedCompanyName}
        />
      </div>

      {advancedOpen && (
        <div data-testid="contact-advanced-filters" className="mt-3 grid gap-3 border-t border-[#dce5ef] pt-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            label="Lifecycle stage"
            value={filters.lifecycleStage}
            testId="select-contact-lifecycle-filter"
            onChange={value => setFilter('lifecycleStage', value)}
            options={[
              { value: 'all', label: 'Any stage' },
              { value: CONTACT_FILTER_UNSET, label: 'Not set' },
              ...lifecycleStages.map(stage => ({ value: stage, label: stage })),
            ]}
          />
          <FilterSelect
            label="Lead status"
            value={filters.leadStatus}
            testId="select-contact-lead-status-filter"
            onChange={value => setFilter('leadStatus', value)}
            options={[
              { value: 'all', label: 'Any status' },
              { value: CONTACT_FILTER_UNSET, label: 'Not set' },
              ...leadStatuses.map(status => ({ value: status, label: status })),
            ]}
          />
          <FilterSelect
            label="Lead source"
            value={filters.leadSource}
            testId="select-contact-lead-source-filter"
            onChange={value => setFilter('leadSource', value)}
            options={[
              { value: 'all', label: 'Any source' },
              { value: CONTACT_FILTER_UNSET, label: 'Not set' },
              ...leadSources.map(source => ({ value: source, label: source })),
            ]}
          />
          <FilterSelect
            label="Added"
            value={filters.addedWithin}
            testId="select-contact-added-filter"
          onChange={value => setFilter('addedWithin', value as ContactDirectoryFilterValues['addedWithin'])}
            options={[
              { value: 'any', label: 'Any time' },
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
            ]}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#dce5ef] pt-3">
        <p className="text-[10px] text-[#718095]">All selected filters apply together. Search matches partial words across professional and CRM details.</p>
        {activeLabels.length > 0 && (
          <div data-testid="contact-active-filters" className="flex flex-wrap gap-1.5">
            {activeLabels.map((label, index) => (
              <span key={`${label}-${index}`} className="max-w-[240px] truncate rounded-full border border-[#d9e2ec] bg-white px-2.5 py-1 text-[9px] font-medium text-[#5f7086]">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
