import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useRoute } from 'wouter';
import {
  ArrowDown, ArrowDownUp, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, Download,
  FilePlus2, Filter, Layers3, ListFilter, Plus, Save, Search, Trash2, X,
} from 'lucide-react';
import {
  getGetReportWorkareaCatalogQueryKey, getListSavedReportsQueryKey,
  useCreateSavedReport, useDeleteSavedReport, useExportReportWorkareaCsv,
  useExportReportWorkareaXlsx, useGetReportWorkareaCatalog, useListSavedReports,
  useRunReportWorkareaQuery, useUpdateSavedReport,
} from '@workspace/api-client-react';
import type {
  ReportDefinition, ReportEntityMetadata, ReportFieldMetadata, ReportWorkareaRunResult,
} from '@workspace/api-client-react';
import {
  BackLink, cx, DataTypeMark, EmptyPanel, ErrorPanel, LoadingRows, PendingLabel,
  ReportButton, SectionLabel, WorkareaFrame,
} from '@/components/report-workarea/report-ui';
import type { ReactNode } from 'react';

type Condition = { kind: 'condition'; fieldId: string; operator: string; value?: unknown; values?: unknown[] };
type Group = { kind: 'group'; logic: 'and' | 'or'; children: Array<Group | Condition> };
type FilterGroup = NonNullable<ReportDefinition['filters']>;
type Definition = ReportDefinition;
type Entity = ReportEntityMetadata;

const newDefinition = (entityId: string): Definition => ({ version: 1, baseEntityId: entityId, columns: [] });
const tableDefinition = (definition: Definition): Definition => ({
  version: 1,
  baseEntityId: definition.baseEntityId,
  columns: definition.columns.map(column => ({ fieldId: column.fieldId, ...(column.label ? { label: column.label } : {}) })),
  ...(definition.filters ? { filters: definition.filters } : {}),
  ...(definition.sorting?.length ? { sorting: definition.sorting.map(item => ({ fieldId: item.fieldId, direction: item.direction })) } : {}),
  ...(definition.groupBy?.length ? { groupBy: definition.groupBy.map(item => ({ fieldId: item.fieldId, ...(item.interval ? { interval: item.interval } : {}) })) } : {}),
  ...(definition.aggregates?.length ? { aggregates: definition.aggregates.map(item => ({ ...item })) } : {}),
  ...(definition.subtotals !== undefined ? { subtotals: definition.subtotals } : {}),
  ...(definition.grandTotal !== undefined ? { grandTotal: definition.grandTotal } : {}),
});
const readable = (value: string) => value.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const getErrorText = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
const fieldMapFor = (entity?: Entity) => new Map((entity?.fields ?? []).map(field => [field.id, field]));
const filterLogic = (filters?: FilterGroup): 'and' | 'or' => (filters as unknown as Group | undefined)?.logic ?? 'and';
const filterConditions = (group?: FilterGroup): Condition[] => {
  if (!group || !Array.isArray(group.children)) return [];
  return group.children.flatMap(child => child.kind === 'condition' ? [child as Condition] : filterConditions(child as FilterGroup));
};
const conditionEntries = (group?: FilterGroup, path: number[] = []): Array<{ condition: Condition; path: number[]; logic: 'and' | 'or'; depth: number }> => {
  const node = group as unknown as Group | undefined;
  if (!node || !Array.isArray(node.children)) return [];
  return node.children.flatMap((child, index) => child.kind === 'condition'
    ? [{ condition: child, path: [...path, index], logic: node.logic, depth: path.length }]
    : conditionEntries(child as FilterGroup, [...path, index]));
};
function mutateConditionTree(group: Group, path: number[], transform: (condition: Condition) => Condition | null): Group {
  const [index, ...rest] = path;
  const children = [...group.children];
  const child = children[index];
  if (!child) return group;
  if (rest.length === 0 && child.kind === 'condition') {
    const changed = transform(child as Condition);
    if (changed) children[index] = changed;
    else children.splice(index, 1);
  } else if (child.kind === 'group') {
    const changed = mutateConditionTree(child as Group, rest, transform);
    if (changed.children.length) children[index] = changed;
    else children.splice(index, 1);
  }
  return { ...group, children };
}

function InputClass(props: { value: string; onChange: (value: string) => void; placeholder?: string; type?: string; testId: string; maxLength?: number }) {
  return <input data-testid={props.testId} type={props.type ?? 'text'} maxLength={props.maxLength} value={props.value} onChange={event => props.onChange(event.target.value)} placeholder={props.placeholder} className="h-10 w-full rounded-lg border border-[#d8dfd6] bg-[#fffefa] px-3 text-[13px] text-[#2d443c] outline-none transition focus:border-[#71998c] focus:ring-2 focus:ring-[#dfebe2] placeholder:text-[#a3afa6]" />;
}

function Select({ value, onChange, children, testId, className = '', disabled = false }: { value: string; onChange: (value: string) => void; children: ReactNode; testId: string; className?: string; disabled?: boolean }) {
  return <select data-testid={testId} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className={cx('h-10 min-w-0 rounded-lg border border-[#d8dfd6] bg-[#fffefa] px-3 text-[13px] text-[#334a40] outline-none focus:border-[#71998c] focus:ring-2 focus:ring-[#dfebe2] disabled:cursor-not-allowed disabled:opacity-55', className)}>{children}</select>;
}

export function ReportGalleryPage() {
  const catalogQuery = useGetReportWorkareaCatalog({ query: { queryKey: getGetReportWorkareaCatalogQueryKey() } });
  const [search, setSearch] = useState('');
  const templates = catalogQuery.data?.templates ?? [];
  const filtered = templates.filter(template => `${template.name} ${template.description} ${template.category}`.toLowerCase().includes(search.toLowerCase()));
  const entities = catalogQuery.data?.entities ?? [];
  return <WorkareaFrame section="Catalogue" title="Start with a report" description="Choose a starting point, then make the fields and filters your own."
    action={<Link href="/my-reports" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#cbd9d1] bg-[#fffefa] px-3.5 text-[13px] font-semibold text-[#35584e] no-underline transition hover:bg-[#f1f5f1]"><Layers3 className="h-4 w-4" /> My reports</Link>}>
    <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_auto]">
      <div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#829188]" /><input data-testid="input-template-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a report by name or topic" className="h-11 w-full rounded-lg border border-[#d8dfd6] bg-[#fffefa] pl-10 pr-4 text-[13px] outline-none focus:border-[#71998c] focus:ring-2 focus:ring-[#dfebe2]" /></div>
      <Link href="/report-builder" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#285c54] bg-[#285c54] px-4 text-[13px] font-semibold text-white no-underline transition hover:bg-[#1e4a44]"><FilePlus2 className="h-4 w-4" /> Build from scratch</Link>
    </div>
    {catalogQuery.isLoading || catalogQuery.isFetching ? <LoadingRows rows={6} /> : catalogQuery.isError ? <ErrorPanel message={getErrorText(catalogQuery.error)} retry={() => { void catalogQuery.refetch(); }} /> : templates.length === 0 ? <EmptyPanel title="No report templates available" detail="Templates appear here when they are available for your workspace. You can still build a report from your CRM fields." action={<Link href="/report-builder" className="text-sm font-semibold text-[#285c54] no-underline">Build a report</Link>} /> : filtered.length === 0 ? <EmptyPanel title="No matching reports" detail="Try another search term, or start with a blank report." /> : <div className="space-y-7">
      {Array.from(new Set(filtered.map(template => template.category))).map(category => <section key={category}>
        <SectionLabel aside={<span className="font-mono text-[10px] text-[#8b988f]">{filtered.filter(template => template.category === category).length} options</span>}>{category}</SectionLabel>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.filter(template => template.category === category).map((template, index) => {
            const entity = entities.find(item => item.id === template.baseEntityId);
            return <Link key={template.id} href={`/report-builder?template=${encodeURIComponent(template.id)}`} data-testid={`card-report-template-${template.id}`} className="group relative flex min-h-[178px] flex-col overflow-hidden rounded-xl border border-[#dce3d9] bg-[#fffefa] p-5 text-left no-underline transition duration-200 hover:-translate-y-0.5 hover:border-[#aac4b5] hover:shadow-[0_10px_24px_rgba(47,74,57,.08)]">
              <span className="absolute right-0 top-0 h-[3px] w-16 bg-[#c17b50] transition-all group-hover:w-28" />
              <div className="flex items-start justify-between gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#edf3ec] text-[#416e60]"><ListFilter className="h-4 w-4" /></div><span className="font-mono text-[10px] tracking-widest text-[#a2aca3]">{String(index + 1).padStart(2, '0')}</span></div>
              <h3 className="mt-5 text-[15px] font-semibold text-[#2b443b] group-hover:text-[#285c54]">{template.name}</h3>
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-[#738178]">{template.description}</p>
              <div className="mt-auto flex items-center justify-between gap-3 pt-4"><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[#8a978e]">{entity?.label ?? template.baseEntityId}</span><span className="text-[11px] font-semibold text-[#58786b]">Use template <span aria-hidden="true">→</span></span></div>
            </Link>;
          })}
        </div>
      </section>)}
    </div>}
  </WorkareaFrame>;
}

export function SavedReportsPage() {
  const reportsQuery = useListSavedReports({ query: { queryKey: getListSavedReportsQueryKey() } });
  const catalogQuery = useGetReportWorkareaCatalog({ query: { queryKey: getGetReportWorkareaCatalogQueryKey() } });
  const deleteReport = useDeleteSavedReport();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const reports = reportsQuery.data?.reports ?? [];
  const filtered = reports.filter(report => `${report.name} ${report.description} ${report.category}`.toLowerCase().includes(search.toLowerCase()));
  const entityLabel = (id: string) => catalogQuery.data?.entities.find(entity => entity.id === id)?.label ?? id;
  const deleteItem = (reportId: string) => deleteReport.mutate({ reportId }, { onSuccess: () => { setConfirmId(null); void queryClient.invalidateQueries({ queryKey: getListSavedReportsQueryKey() }); } });
  return <WorkareaFrame section="Saved" title="My reports" description="Your team's saved report definitions, ready to run again or refine."
    action={<Link href="/report-gallery" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#285c54] bg-[#285c54] px-3.5 text-[13px] font-semibold text-white no-underline transition hover:bg-[#1e4a44]"><Plus className="h-4 w-4" /> New report</Link>}>
    {reportsQuery.isLoading || reportsQuery.isFetching ? <LoadingRows rows={5} /> : reportsQuery.isError ? <ErrorPanel message={getErrorText(reportsQuery.error)} retry={() => { void reportsQuery.refetch(); }} /> : reports.length === 0 ? <EmptyPanel title="Nothing saved yet" detail="Save a report definition from the builder and it will be available here for your workspace." action={<Link href="/report-gallery" className="font-semibold text-[#285c54] no-underline">Browse report templates</Link>} /> : <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#829188]" /><input data-testid="input-saved-report-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search saved reports" className="h-10 w-full rounded-lg border border-[#d8dfd6] bg-[#fffefa] pl-10 pr-3 text-[13px] outline-none focus:border-[#71998c] focus:ring-2 focus:ring-[#dfebe2]" /></div><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[#87948b]">{filtered.length} {filtered.length === 1 ? 'report' : 'reports'}</span></div>
      {filtered.length === 0 ? <EmptyPanel title="No saved reports match" detail="Change the search text to see more saved reports." /> : <div className="overflow-hidden rounded-xl border border-[#dce3d9] bg-[#fffefa]">
        <div className="hidden grid-cols-[minmax(220px,1.5fr)_minmax(110px,.7fr)_minmax(120px,.8fr)_minmax(150px,1fr)_auto] gap-4 border-b border-[#e6eae2] bg-[#f8f9f4] px-5 py-3 font-mono text-[9px] uppercase tracking-[.15em] text-[#87948b] md:grid"><span>Report</span><span>Category</span><span>Source</span><span>Last run</span><span className="text-right">Actions</span></div>
        {filtered.map((report, index) => <div key={report.id} data-testid={`row-saved-report-${report.id}`} className={cx('grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(220px,1.5fr)_minmax(110px,.7fr)_minmax(120px,.8fr)_minmax(150px,1fr)_auto] md:items-center md:gap-4', index > 0 && 'border-t border-[#edf0e9]')}>
          <div className="min-w-0"><Link href={`/report-builder/${encodeURIComponent(report.id)}`} className="truncate text-[14px] font-semibold text-[#2a453b] no-underline hover:text-[#285c54]">{report.name}</Link><p className="mt-1 truncate text-[11px] text-[#849087]">{report.description || 'No description'}</p></div>
          <span className="w-fit rounded-md bg-[#f0f3ed] px-2 py-1 text-[11px] text-[#62766a]">{report.category || 'Uncategorized'}</span>
          <span className="text-[12px] text-[#62736a]">{entityLabel(report.baseEntityId)}</span>
          <span className="text-[12px] text-[#77847b]">{report.lastRunAt ? new Date(report.lastRunAt).toLocaleString() : 'Not run yet'}</span>
           <div className="flex items-center gap-1 md:justify-end">
             {confirmId === report.id ? <><span className="mr-1 text-[11px] text-[#916149]">Delete?</span><ReportButton variant="danger" disabled={deleteReport.isPending} onClick={() => deleteItem(report.id)} testId={`button-confirm-delete-report-${report.id}`}>Confirm</ReportButton><ReportButton variant="quiet" onClick={() => setConfirmId(null)} testId={`button-cancel-delete-report-${report.id}`}>Cancel</ReportButton></> : <><Link href={`/report-builder/${encodeURIComponent(report.id)}`} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[#426b5c] no-underline hover:bg-[#edf3ec]">Edit</Link><Link href={`/report-builder?duplicate=${encodeURIComponent(report.id)}`} data-testid={`button-duplicate-report-${report.id}`} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[#426b5c] no-underline hover:bg-[#edf3ec]">Duplicate</Link><ReportButton variant="quiet" onClick={() => setConfirmId(report.id)} testId={`button-delete-report-${report.id}`} className="min-h-9 px-2.5 text-[#9e5c48]"><Trash2 className="h-4 w-4" /><span className="sr-only">Delete {report.name}</span></ReportButton></>}
          </div>
        </div>)}
      </div>}
      {deleteReport.isError && <p role="alert" className="mt-3 text-[12px] text-[#a24f3a]">Could not delete this report: {getErrorText(deleteReport.error)}</p>}
    </>}
  </WorkareaFrame>;
}

export function ReportBuilderPage() {
  const [isSavedRoute, savedParams] = useRoute('/report-builder/:reportId');
  const reportId = isSavedRoute ? savedParams?.reportId : undefined;
  const [, setLocation] = useLocation();
  const templateId = useMemo(() => new URLSearchParams(window.location.search).get('template'), []);
  const duplicateId = useMemo(() => new URLSearchParams(window.location.search).get('duplicate'), []);
  const catalogQuery = useGetReportWorkareaCatalog({ query: { queryKey: getGetReportWorkareaCatalogQueryKey() } });
  const reportsQuery = useListSavedReports({ query: { queryKey: getListSavedReportsQueryKey() } });
  const runReport = useRunReportWorkareaQuery();
  const createReport = useCreateSavedReport();
  const updateReport = useUpdateSavedReport();
  const exportCsv = useExportReportWorkareaCsv();
  const exportXlsx = useExportReportWorkareaXlsx();
  const queryClient = useQueryClient();
  const [definition, setDefinition] = useState<Definition>(() => newDefinition(''));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<ReportWorkareaRunResult | null>(null);
  const [exportIssue, setExportIssue] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const initialized = useRef('');
  const entities = catalogQuery.data?.entities ?? [];
  const currentEntity = entities.find(entity => entity.id === definition.baseEntityId);
  const fields = currentEntity?.fields ?? [];
  const fieldMap = useMemo(() => fieldMapFor(currentEntity), [currentEntity]);
  const templates = catalogQuery.data?.templates ?? [];
  const selectedTemplate = templates.find(template => template.id === templateId);
  const savedReports = reportsQuery.data?.reports ?? [];
  const savedReport = savedReports.find(report => report.id === reportId);
  const duplicateReport = savedReports.find(report => report.id === duplicateId);
  const summaryMode = Boolean(definition.aggregates?.length || definition.groupBy?.length);
  const missingFields = useMemo(() => {
    const refs = new Set<string>(definition.columns.map(col => col.fieldId));
    filterConditions(definition.filters).forEach(condition => refs.add(condition.fieldId));
    (definition.sorting ?? []).forEach(sort => refs.add(sort.fieldId));
    (definition.groupBy ?? []).forEach(group => refs.add(group.fieldId));
    (definition.aggregates ?? []).forEach(aggregate => {
      if (aggregate.fieldId) refs.add(aggregate.fieldId);
    });
    return [...refs].filter(fieldId => !fieldMap.has(fieldId));
  }, [definition, fieldMap]);

  useEffect(() => {
    if (!catalogQuery.data) return;
    const initKey = reportId
      ? `saved:${reportId}`
      : duplicateId
        ? `duplicate:${duplicateId}`
        : templateId
          ? `template:${templateId}`
          : 'new';
    if (initialized.current === initKey) return;
    if (reportId) {
      if (reportsQuery.isLoading || reportsQuery.isFetching) return;
      if (savedReport) {
        setDefinition(tableDefinition(savedReport.definition));
        setName(savedReport.name);
        setDescription(savedReport.description);
        setCategory(savedReport.category);
      }
      initialized.current = initKey;
    } else if (duplicateId) {
      if (reportsQuery.isLoading || reportsQuery.isFetching) return;
      if (duplicateReport) {
        setDefinition(tableDefinition(duplicateReport.definition));
        setName(`${duplicateReport.name} copy`);
        setDescription(duplicateReport.description);
        setCategory(duplicateReport.category);
      }
      initialized.current = initKey;
    } else if (templateId) {
      if (templates.length && !selectedTemplate) { initialized.current = initKey; return; }
      if (selectedTemplate) {
        setDefinition(tableDefinition(selectedTemplate.definition));
        setName(selectedTemplate.name);
        setDescription(selectedTemplate.description);
        setCategory(selectedTemplate.category);
      } else if (templates.length) setDefinition(newDefinition(entities[0]?.id ?? ''));
      initialized.current = initKey;
    } else {
      const entityId = entities[0]?.id ?? '';
      setDefinition(newDefinition(entityId));
      initialized.current = initKey;
    }
  }, [catalogQuery.data, duplicateId, duplicateReport, entities, reportId, reportsQuery.isLoading, reportsQuery.isFetching, savedReport, selectedTemplate, templates.length, templateId]);

  const updateEntity = (baseEntityId: string) => {
    setDefinition({ version: 1, baseEntityId, columns: [] });
    setResult(null);
    setSaveNotice('');
  };
  const addColumn = (fieldId: string) => setDefinition(current => current.columns.some(col => col.fieldId === fieldId) || current.columns.length >= 30 ? current : ({ ...current, columns: [...current.columns, { fieldId }] }));
  const removeColumn = (fieldId: string) => setDefinition(current => ({ ...current, columns: current.columns.filter(col => col.fieldId !== fieldId) }));
  const updateColumn = (index: number, patch: Partial<{ fieldId: string; label: string }>) => setDefinition(current => ({
    ...current,
    columns: current.columns.map((column, columnIndex) => columnIndex === index ? { ...column, ...patch } : column),
  }));
  const moveColumn = (index: number, direction: -1 | 1) => setDefinition(current => {
    const next = [...current.columns];
    const target = index + direction;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    return { ...current, columns: next };
  });
  const startSummary = () => {
    setDefinition(current => ({
      ...current,
      columns: [],
      sorting: [],
      groupBy: [],
      aggregates: current.aggregates?.length
        ? current.aggregates
        : [{ id: 'records', label: 'Record count', operation: 'count' }],
      subtotals: false,
      grandTotal: true,
    }));
    setResult(null);
  };
  const startDetailed = () => {
    setDefinition(current => ({
      ...current,
      groupBy: undefined,
      aggregates: undefined,
      subtotals: undefined,
      grandTotal: undefined,
      sorting: [],
    }));
    setResult(null);
  };
  const addGroup = () => {
    const currentGroups = definition.groupBy ?? [];
    const field = fields.find(candidate => candidate.groupable && !currentGroups.some(group => group.fieldId === candidate.id));
    if (!field) return;
    setDefinition(current => ({
      ...current,
      groupBy: [...(current.groupBy ?? []), {
        fieldId: field.id,
        ...(field.dateIntervals.length ? { interval: 'month' } : {}),
      }],
      aggregates: current.aggregates?.length
        ? current.aggregates
        : [{ id: 'records', label: 'Record count', operation: 'count' }],
    }));
  };
  const updateGroup = (index: number, fieldId: string) => {
    const field = fieldMap.get(fieldId);
    setDefinition(current => {
      const groupBy = (current.groupBy ?? []).map((group, groupIndex) => groupIndex === index
        ? { fieldId, ...(field?.dateIntervals.length ? { interval: group.interval ?? 'month' } : {}) }
        : group);
      return {
        ...current,
        groupBy,
        sorting: (current.sorting ?? []).filter(sort => groupBy.some(group => group.fieldId === sort.fieldId)),
      };
    });
  };
  const updateGroupInterval = (index: number, interval: string) => setDefinition(current => ({
    ...current,
    groupBy: (current.groupBy ?? []).map((group, groupIndex) => groupIndex === index
      ? { ...group, interval: interval as NonNullable<typeof group.interval> }
      : group),
  }));
  const addAggregate = () => {
    const currentAggregates = definition.aggregates ?? [];
    if (currentAggregates.length >= 8) return;
    const nextNumber = currentAggregates.length + 1;
    setDefinition(current => ({
      ...current,
      columns: [],
      aggregates: [
        ...(current.aggregates ?? []),
        { id: `measure${nextNumber}`, label: 'New measure', operation: 'count' },
      ],
    }));
  };
  const updateAggregate = (index: number, patch: Partial<{ id: string; label: string; operation: NonNullable<Definition['aggregates']>[number]['operation']; fieldId?: string }>) => setDefinition(current => ({
    ...current,
    aggregates: (current.aggregates ?? []).map((aggregate, aggregateIndex) => aggregateIndex === index
      ? { ...aggregate, ...patch }
      : aggregate),
  }));
  const removeAggregate = (index: number) => {
    const next = (definition.aggregates ?? []).filter((_, aggregateIndex) => aggregateIndex !== index);
    if (!next.length) {
      startDetailed();
      return;
    }
    setDefinition(current => ({ ...current, aggregates: next }));
  };
  const hasReportData = summaryMode
    ? Boolean(definition.aggregates?.length)
    : definition.columns.length > 0;
  const addCondition = () => {
    const field = fields.find(item => item.operators.length > 0);
    if (!field) return;
    const root = definition.filters as unknown as Group | undefined;
    const group: Group = { kind: 'group', logic: filterLogic(definition.filters), children: [...(root?.children ?? []), { kind: 'condition', fieldId: field.id, operator: field.operators[0] }] };
    setDefinition(current => ({ ...current, filters: group as FilterGroup }));
  };
  const updateCondition = (index: number, patch: Partial<Condition>) => {
    const entry = conditionEntries(definition.filters)[index];
    if (!entry) return;
    setDefinition(current => {
      const root = current.filters as unknown as Group | undefined;
      if (!root) return current;
      return { ...current, filters: mutateConditionTree(root, entry.path, condition => ({ ...condition, ...patch })) as FilterGroup };
    });
  };
  const removeCondition = (index: number) => {
    const entry = conditionEntries(definition.filters)[index];
    if (!entry) return;
    setDefinition(current => {
      const root = current.filters as unknown as Group | undefined;
      if (!root) return current;
      const updated = mutateConditionTree(root, entry.path, () => null);
      return { ...current, filters: updated.children.length ? updated as FilterGroup : undefined };
    });
  };
  const updateSort = (index: number, patch: Partial<{ fieldId: string; direction: 'asc' | 'desc' }>) => setDefinition(current => ({
    ...current,
    sorting: (current.sorting ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
  }));
  const addSort = () => {
    const existing = definition.sorting ?? [];
    const allowedSortFields = summaryMode
      ? fields.filter(field => (definition.groupBy ?? []).some(group => group.fieldId === field.id))
      : fields;
    const nextField = allowedSortFields.find(field => !existing.some(item => item.fieldId === field.id));
    if (nextField && existing.length < 4) setDefinition(current => ({ ...current, sorting: [...(current.sorting ?? []), { fieldId: nextField.id, direction: 'asc' }] }));
  };
  const removeGroup = (index: number) => setDefinition(current => {
    const groupBy = (current.groupBy ?? []).filter((_, groupIndex) => groupIndex !== index);
    return {
      ...current,
      groupBy,
      sorting: (current.sorting ?? []).filter(sort => groupBy.some(group => group.fieldId === sort.fieldId)),
    };
  });
  const runAtPage = (page: number, size = pageSize) => {
    if (missingFields.length || !hasReportData) return;
    runReport.mutate({ data: { definition: tableDefinition(definition), ...(reportId ? { savedReportId: reportId } : {}), page, pageSize: size } }, { onSuccess: data => {
      setResult(data);
      if (reportId) void queryClient.invalidateQueries({ queryKey: getListSavedReportsQueryKey() });
    } });
  };
  const save = () => {
    setSaveNotice('');
    if (!name.trim() || !hasReportData || missingFields.length) return;
    const body = { name: name.trim(), description, category, definition: tableDefinition(definition) };
    if (reportId) updateReport.mutate({ reportId, data: body }, { onSuccess: () => { setSaveNotice('Saved changes.'); void queryClient.invalidateQueries({ queryKey: getListSavedReportsQueryKey() }); } });
    else createReport.mutate({ data: body }, { onSuccess: report => { setSaveNotice('Report saved.'); void queryClient.invalidateQueries({ queryKey: getListSavedReportsQueryKey() }); setLocation(`/report-builder/${encodeURIComponent(report.id)}`); } });
  };
  const downloadExport = (format: 'csv' | 'xlsx') => {
    setExportIssue('');
    const mutation = format === 'csv' ? exportCsv : exportXlsx;
    mutation.mutate({ data: { definition: tableDefinition(definition) } }, { onSuccess: blob => {
      if (!(blob instanceof Blob)) { setExportIssue('The export file could not be prepared. Try a smaller report.'); return; }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(name || 'mailflow-report').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, onError: error => {
      const message = getErrorText(error);
      setExportIssue(/limit|large|maximum|too many|size/i.test(message) ? `Export limit reached. ${message}` : `Export unavailable. ${message}`);
    } });
  };

  if (catalogQuery.isLoading || catalogQuery.isFetching || ((reportId || duplicateId) && reportsQuery.isLoading)) return <WorkareaFrame section="Builder" title="Report builder" description="Choose the records and fields you want to inspect."><LoadingRows rows={4} /></WorkareaFrame>;
  if (catalogQuery.isError) return <WorkareaFrame section="Builder" title="Report builder" description="Choose the records and fields you want to inspect."><ErrorPanel message={getErrorText(catalogQuery.error)} retry={() => { void catalogQuery.refetch(); }} /></WorkareaFrame>;
  if ((reportId || duplicateId) && reportsQuery.isError) return <WorkareaFrame section="Builder" title="Report builder" description="Choose the records and fields you want to inspect."><ErrorPanel message={getErrorText(reportsQuery.error)} retry={() => { void reportsQuery.refetch(); }} /></WorkareaFrame>;
  if (!entities.length) return <WorkareaFrame section="Builder" title="Report builder" description="Choose the records and fields you want to inspect."><EmptyPanel title="No reportable records available" detail="There are no reportable record sources available in this workspace yet." /></WorkareaFrame>;
  if (reportId && !savedReport && !reportsQuery.isLoading) return <WorkareaFrame section="Builder" title="Report not found" description="This saved report is not available in the current workspace."><EmptyPanel title="Report unavailable" detail="It may have been removed or you may no longer have access." action={<BackLink href="/my-reports" />} /></WorkareaFrame>;
  if (duplicateId && !duplicateReport && !reportsQuery.isLoading) return <WorkareaFrame section="Builder" title="Report not found" description="This saved report is not available in the current workspace."><EmptyPanel title="Report unavailable" detail="It may have been removed or you may no longer have access." action={<BackLink href="/my-reports" />} /></WorkareaFrame>;

  return <WorkareaFrame section="Builder" title={reportId ? 'Edit report' : 'Build a report'} description="A precise table of your CRM records. Choose a source, shape the fields, then run it against current data."
    action={<div className="flex flex-wrap items-center gap-2"><ReportButton variant={summaryMode ? 'outline' : 'primary'} onClick={startDetailed} testId="button-report-mode-detailed" className="min-h-9 px-3 text-[11px]">Detailed</ReportButton><ReportButton variant={summaryMode ? 'primary' : 'outline'} onClick={startSummary} testId="button-report-mode-summary" className="min-h-9 px-3 text-[11px]">Summary</ReportButton><BackLink href={reportId ? '/my-reports' : '/report-gallery'}>{reportId ? 'My reports' : 'Report gallery'}</BackLink></div>}>
    {templateId && !selectedTemplate && templates.length > 0 && <div role="status" className="mb-4 rounded-lg border border-[#e8d8bf] bg-[#fff9ef] p-3 text-[12px] text-[#8d6946]">This template is no longer available. Continue with the report builder or choose another template.</div>}
    {savedReport?.definitionVersion !== undefined && savedReport.definitionVersion !== catalogQuery.data?.definitionVersion && <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-[#ead8bd] bg-[#fff9ef] px-4 py-3 text-[12px] leading-5 text-[#856741]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />This saved report uses an earlier definition version. Review its fields before running it.</div>}

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
      <div className="space-y-5">
        <section className="rounded-xl border border-[#dce3d9] bg-[#fffefa] p-5 sm:p-6">
          <SectionLabel aside={<span className="font-mono text-[10px] text-[#91a096]">01 / DATA</span>}>Choose the record source</SectionLabel>
          <div className="grid gap-4 md:grid-cols-[minmax(200px,.85fr)_1.15fr]">
            <label className="space-y-1.5"><span className="text-[11px] font-semibold text-[#52685d]">Base record</span><Select testId="select-report-entity" value={definition.baseEntityId} onChange={updateEntity}>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.label}</option>)}</Select></label>
            <div className="rounded-lg bg-[#f5f7f1] px-4 py-3"><div className="font-mono text-[9px] uppercase tracking-[.14em] text-[#8a988e]">Report grain</div><p className="mt-1 text-[12px] leading-5 text-[#63746a]">{currentEntity?.grain || currentEntity?.description || 'Records are returned at the source entity grain.'}</p></div>
          </div>
        </section>

        {!summaryMode && <section className="rounded-xl border border-[#dce3d9] bg-[#fffefa] p-5 sm:p-6">
          <SectionLabel aside={<span className="font-mono text-[10px] text-[#91a096]">02 / COLUMNS</span>}>Select fields</SectionLabel>
          <p className="mb-4 text-[12px] text-[#77847b]">Choose the columns to include in your table. Up to 30 fields.</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {fields.filter(field => !definition.columns.some(column => column.fieldId === field.id)).map(field => <button key={field.id} type="button" data-testid={`button-add-field-${field.id}`} onClick={() => addColumn(field.id)} disabled={definition.columns.length >= 30} title={field.description} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#dce3d9] bg-[#fafbf7] px-3 text-[11px] font-medium text-[#60736a] transition hover:border-[#a8c2b3] hover:bg-[#eff5ef] disabled:opacity-50"><Plus className="h-3.5 w-3.5 text-[#608a77]" />{field.label}</button>)}
            {fields.length === 0 && <span className="text-[12px] text-[#8a958d]">No fields are available for this source.</span>}
          </div>
          {definition.columns.length ? <div className="space-y-2">
            {definition.columns.map((column, index) => {
              const field = fieldMap.get(column.fieldId);
              return <div key={`${column.fieldId}-${index}`} className="grid gap-2 rounded-lg border border-[#e5e9e1] bg-[#fbfcf8] px-3 py-2.5 sm:grid-cols-[auto_auto_minmax(140px,1fr)_auto] sm:items-center">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#edf2eb] font-mono text-[10px] text-[#769084]">{String(index + 1).padStart(2, '0')}</span>
                <DataTypeMark type={field?.dataType ?? 'text'} />
                <div className="min-w-0"><div className="truncate text-[10px] text-[#929d94]">{field?.label ?? column.fieldId}</div><InputClass testId={`input-column-alias-${index}`} value={column.label ?? ''} onChange={label => updateColumn(index, { label })} maxLength={120} placeholder={field?.label ?? column.fieldId} /></div>
                <div className="flex items-center justify-end gap-1"><button type="button" aria-label="Move column up" disabled={index === 0} data-testid={`button-move-column-up-${index}`} onClick={() => moveColumn(index, -1)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#839087] transition hover:bg-[#edf3ec] hover:text-[#426b5c] disabled:opacity-35"><ChevronUp className="h-4 w-4" /></button><button type="button" aria-label="Move column down" disabled={index === definition.columns.length - 1} data-testid={`button-move-column-down-${index}`} onClick={() => moveColumn(index, 1)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#839087] transition hover:bg-[#edf3ec] hover:text-[#426b5c] disabled:opacity-35"><ChevronDown className="h-4 w-4" /></button><button type="button" aria-label={`Remove ${field?.label ?? column.fieldId}`} data-testid={`button-remove-field-${column.fieldId}`} onClick={() => removeColumn(column.fieldId)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#839087] transition hover:bg-[#f5eae5] hover:text-[#a45a45]"><X className="h-4 w-4" /></button></div>
              </div>;
            })}
          </div> : <div className="rounded-lg border border-dashed border-[#ced9cf] bg-[#f9faf6] px-4 py-6 text-center text-[12px] text-[#859188]">No columns selected. Add at least one field to build a report.</div>}
        </section>}

        {summaryMode && <section className="rounded-xl border border-[#dce3d9] bg-[#fffefa] p-5 sm:p-6">
          <SectionLabel aside={<span className="font-mono text-[10px] text-[#91a096]">02 / SUMMARY</span>}>Group and measure</SectionLabel>
          <p className="mb-4 text-[12px] leading-5 text-[#77847b]">Summaries use only supported fields and functions. Currency measures are automatically kept separate by currency.</p>
          <div className="space-y-2">
            {(definition.groupBy ?? []).map((group, index) => {
              const selectedField = fieldMap.get(group.fieldId);
              return <div key={`${group.fieldId}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_170px_auto]">
                <Select testId={`select-group-field-${index}`} value={group.fieldId} onChange={fieldId => updateGroup(index, fieldId)}><option value="">Choose grouping field</option>{fields.filter(field => field.groupable && (field.id === group.fieldId || !(definition.groupBy ?? []).some(item => item.fieldId === field.id))).map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</Select>
                {selectedField?.dateIntervals.length ? <Select testId={`select-group-interval-${index}`} value={group.interval ?? 'month'} onChange={value => updateGroupInterval(index, value)}>{selectedField.dateIntervals.map(interval => <option key={interval} value={interval}>{readable(interval)}</option>)}</Select> : <span className="hidden sm:block" />}
                <button type="button" data-testid={`button-remove-group-${index}`} onClick={() => removeGroup(index)} aria-label="Remove grouping field" className="grid h-10 w-10 place-items-center rounded-lg text-[#829087] hover:bg-[#f5eae5] hover:text-[#a45a45]"><X className="h-4 w-4" /></button>
              </div>;
            })}
            <ReportButton variant="outline" onClick={addGroup} disabled={(definition.groupBy?.length ?? 0) >= 4 || !fields.some(field => field.groupable && !(definition.groupBy ?? []).some(group => group.fieldId === field.id))} testId="button-add-report-group" className="min-h-9"><Plus className="h-3.5 w-3.5" /> Add grouping field</ReportButton>
          </div>

          <div className="mt-5 border-t border-[#e6eae2] pt-4">
            <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-[12px] font-semibold text-[#40584c]">Measures</h3><p className="mt-1 text-[11px] text-[#849087]">Counts, distinct counts, sums, averages, minimums, and maximums.</p></div><ReportButton variant="outline" onClick={addAggregate} disabled={(definition.aggregates?.length ?? 0) >= 8} testId="button-add-report-measure" className="min-h-9"><Plus className="h-3.5 w-3.5" /> Add measure</ReportButton></div>
            <div className="space-y-2">
              {(definition.aggregates ?? []).map((aggregate, index) => {
                const measureField = fieldMap.get(aggregate.fieldId ?? '');
                const allowedFields = fields.filter(field => field.aggregations.includes(aggregate.operation));
                const needsField = aggregate.operation !== 'count';
                return <div key={aggregate.id} className="grid gap-2 rounded-lg border border-[#e5e9e1] bg-[#fbfcf8] p-3 md:grid-cols-[1fr_1fr_1.3fr_auto]">
                  <InputClass testId={`input-measure-label-${index}`} value={aggregate.label} onChange={label => updateAggregate(index, { label })} maxLength={100} placeholder="Measure name" />
                  <Select testId={`select-measure-operation-${index}`} value={aggregate.operation} onChange={operation => {
                    const nextOperation = operation as typeof aggregate.operation;
                    const fieldId = nextOperation === 'count' ? undefined : fields.find(field => field.aggregations.includes(nextOperation))?.id;
                    updateAggregate(index, { operation: nextOperation, fieldId });
                  }}>{(['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'win_rate'] as const).filter(operation => operation === 'count' || fields.some(field => field.aggregations.includes(operation))).map(operation => <option key={operation} value={operation}>{operation === 'win_rate' ? 'Win rate' : readable(operation)}</option>)}</Select>
                  <Select testId={`select-measure-field-${index}`} value={aggregate.fieldId ?? ''} onChange={fieldId => updateAggregate(index, { fieldId: fieldId || undefined })} disabled={!needsField}><option value="">{aggregate.operation === 'count' ? 'All records' : 'Choose field'}</option>{allowedFields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</Select>
                  <button type="button" data-testid={`button-remove-measure-${index}`} onClick={() => removeAggregate(index)} aria-label="Remove measure" className="grid h-10 w-10 place-items-center rounded-lg text-[#829087] hover:bg-[#f5eae5] hover:text-[#a45a45]"><X className="h-4 w-4" /></button>
                </div>;
              })}
            </div>
            {definition.aggregates?.some(aggregate => aggregate.fieldId && fieldMap.get(aggregate.fieldId)?.dataType === 'currency') && <div role="status" className="mt-3 rounded-lg border border-[#d4e0d4] bg-[#eff5ed] px-3 py-2 text-[11px] leading-5 text-[#587565]">Currency is included automatically in the grouping. Totals are never combined across currencies.</div>}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-[#e6eae2] pt-4">
            <label className="flex items-center gap-2 text-[11px] text-[#62736a]"><input data-testid="checkbox-report-subtotals" type="checkbox" checked={definition.subtotals ?? false} onChange={event => setDefinition(current => ({ ...current, subtotals: event.target.checked }))} />Show grouped subtotals</label>
            <label className="flex items-center gap-2 text-[11px] text-[#62736a]"><input data-testid="checkbox-report-grand-total" type="checkbox" checked={definition.grandTotal !== false} onChange={event => setDefinition(current => ({ ...current, grandTotal: event.target.checked }))} />Show grand total</label>
          </div>
        </section>}

        <section className="rounded-xl border border-[#dce3d9] bg-[#fffefa] p-5 sm:p-6">
          <SectionLabel aside={<span className="font-mono text-[10px] text-[#91a096]">03 / FILTERS</span>}>Narrow the records</SectionLabel>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[12px] text-[#77847b]">Conditions apply to source records before they are returned.</p><ReportButton variant="outline" onClick={addCondition} disabled={!fields.some(field => field.operators.length)} testId="button-add-report-filter" className="min-h-9"><Filter className="h-3.5 w-3.5" /> Add condition</ReportButton></div>
          {filterConditions(definition.filters).length > 0 && <div className="mb-3 flex items-center gap-2 rounded-lg bg-[#f4f7f2] px-3 py-2"><span className="font-mono text-[9px] uppercase tracking-wider text-[#809087]">Match</span><Select testId="select-filter-logic" value={filterLogic(definition.filters)} onChange={logic => setDefinition(current => ({ ...current, filters: { ...(current.filters as Group), logic: logic as 'and' | 'or' } as FilterGroup }))} className="h-8"><option value="and">All conditions (AND)</option><option value="or">Any condition (OR)</option></Select></div>}
          <div className="space-y-2">
            {conditionEntries(definition.filters).map(({ condition, depth, logic }, index) => {
              const field = fieldMap.get(condition.fieldId);
              const operators = field?.operators ?? [];
              return <div key={`${condition.fieldId}-${index}`} className="grid gap-2 rounded-lg border border-[#e5e9e1] bg-[#fbfcf8] p-3 sm:grid-cols-[1.1fr_1fr_1.25fr_auto]">
                <div className="relative"><Select testId={`select-filter-field-${index}`} value={condition.fieldId} onChange={fieldId => { const nextField = fieldMap.get(fieldId); updateCondition(index, { fieldId, operator: nextField?.operators[0] ?? '' }); }} className={depth ? 'w-full pl-5' : 'w-full'}><option value="">Choose field</option>{fields.filter(candidate => candidate.operators.length > 0).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</Select>{depth > 0 && <span title={`Nested group: ${logic.toUpperCase()}`} className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 font-mono text-[8px] text-[#9b7a5f]">↳</span>}</div>
                <Select testId={`select-filter-operator-${index}`} value={condition.operator} onChange={operator => updateCondition(index, { operator, value: undefined, values: undefined })}>{operators.map(operator => <option key={operator} value={operator}>{readable(operator)}</option>)}</Select>
                {!['is_empty', 'is_not_empty'].includes(condition.operator) ? <InputClass testId={`input-filter-value-${index}`} value={Array.isArray(condition.values) ? condition.values.join(', ') : String(condition.value ?? '')} type={field?.dataType === 'date' ? 'date' : field?.dataType === 'number' || field?.dataType === 'currency' ? 'number' : 'text'} placeholder={condition.operator === 'in' || condition.operator === 'not_in' ? 'Separate values with commas' : 'Enter a value'} onChange={value => updateCondition(index, condition.operator === 'in' || condition.operator === 'not_in' ? { values: value.split(',').map(item => item.trim()).filter(Boolean), value: undefined } : { value, values: undefined })} /> : <div className="flex h-10 items-center px-2 text-[11px] text-[#859188]">No value needed</div>}
                <button type="button" data-testid={`button-remove-filter-${index}`} onClick={() => removeCondition(index)} aria-label="Remove condition" className="grid h-10 w-10 place-items-center rounded-lg text-[#829087] hover:bg-[#f5eae5] hover:text-[#a45a45]"><X className="h-4 w-4" /></button>
              </div>;
            })}
          </div>
          {filterConditions(definition.filters).length === 0 && <div className="rounded-lg border border-dashed border-[#e0e6dd] px-4 py-5 text-[12px] text-[#89958c]">No filters. Your report will include all available records in this source.</div>}
        </section>

        <section className="rounded-xl border border-[#dce3d9] bg-[#fffefa] p-5 sm:p-6">
          <SectionLabel aside={<span className="font-mono text-[10px] text-[#91a096]">04 / ORDER</span>}>Sort the result</SectionLabel>
          <div className="space-y-2">
            {(definition.sorting ?? []).map((sort, index) => <div key={`${sort.fieldId}-${index}`} className="flex flex-wrap items-center gap-2">
              <span className="w-14 font-mono text-[9px] uppercase tracking-wider text-[#839087]">{index === 0 ? 'Sort by' : 'Then by'}</span>
              <Select testId={`select-sort-field-${index}`} value={sort.fieldId} onChange={fieldId => updateSort(index, { fieldId })} className="flex-1"><option value="">Choose field</option>{(summaryMode ? fields.filter(field => (definition.groupBy ?? []).some(group => group.fieldId === field.id)) : fields).filter(field => field.id === sort.fieldId || !(definition.sorting ?? []).some(item => item.fieldId === field.id)).map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</Select>
              <Select testId={`select-sort-direction-${index}`} value={sort.direction} onChange={direction => updateSort(index, { direction: direction as 'asc' | 'desc' })}><option value="asc">Ascending</option><option value="desc">Descending</option></Select>
              <button type="button" data-testid={`button-remove-sort-${index}`} onClick={() => setDefinition(current => ({ ...current, sorting: (current.sorting ?? []).filter((_, itemIndex) => itemIndex !== index) }))} aria-label="Remove sort order" className="grid h-9 w-9 place-items-center rounded-lg text-[#829087] hover:bg-[#f5eae5] hover:text-[#a45a45]"><X className="h-4 w-4" /></button>
            </div>)}
            <ReportButton variant="outline" onClick={addSort} disabled={(definition.sorting?.length ?? 0) >= 4 || (definition.sorting?.length ?? 0) >= (summaryMode ? definition.groupBy?.length ?? 0 : fields.length)} testId="button-add-sort-order" className="min-h-9"><Plus className="h-3.5 w-3.5" /> Add sort field</ReportButton>
          </div>
        </section>

        <section className="rounded-xl border border-[#dce3d9] bg-[#fffefa] p-5 sm:p-6">
          <SectionLabel aside={<span className="font-mono text-[10px] text-[#91a096]">SAVE FOR LATER</span>}>Report details</SectionLabel>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5"><span className="text-[11px] font-semibold text-[#52685d]">Report name</span><InputClass testId="input-report-name" value={name} onChange={setName} maxLength={160} placeholder="A name your team will recognize" /></label>
            <label className="space-y-1.5"><span className="text-[11px] font-semibold text-[#52685d]">Category</span><InputClass testId="input-report-category" value={category} onChange={setCategory} maxLength={80} placeholder="Optional" /></label>
            <label className="space-y-1.5 md:col-span-2"><span className="text-[11px] font-semibold text-[#52685d]">Description</span><textarea data-testid="input-report-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={1000} rows={2} placeholder="What is this report for?" className="w-full resize-y rounded-lg border border-[#d8dfd6] bg-[#fffefa] px-3 py-2.5 text-[13px] outline-none focus:border-[#71998c] focus:ring-2 focus:ring-[#dfebe2] placeholder:text-[#a3afa6]" /></label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ReportButton onClick={save} disabled={!name.trim() || !hasReportData || !!missingFields.length || createReport.isPending || updateReport.isPending} testId="button-save-report"><Save className="h-4 w-4" />{createReport.isPending || updateReport.isPending ? 'Saving…' : reportId ? 'Save changes' : 'Save report'}</ReportButton>
            {saveNotice && <span role="status" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#4f7965]"><Check className="h-3.5 w-3.5" />{saveNotice}</span>}
            {(createReport.isError || updateReport.isError) && <span role="alert" className="text-[12px] text-[#a4513d]">Could not save: {getErrorText(createReport.error ?? updateReport.error)}</span>}
          </div>
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-5">
        <section className="overflow-hidden rounded-xl border border-[#d3dfd4] bg-[#eaf1e9]">
          <div className="border-b border-[#d6e1d6] px-5 py-4"><div className="font-mono text-[9px] uppercase tracking-[.16em] text-[#71877b]">Ready when you are</div><h2 className="mt-1 text-[16px] font-semibold text-[#29443a]">Run your report</h2><p className="mt-1 text-[11px] leading-5 text-[#6c7d72]">Live records, returned as a table.</p></div>
          <div className="p-5">
            {missingFields.length > 0 && <div role="alert" className="mb-4 rounded-lg border border-[#e7cebb] bg-[#fff8f1] p-3"><div className="text-[11px] font-semibold text-[#86573b]">Some fields are unavailable</div><p className="mt-1 text-[10px] leading-4 text-[#927762]">Remove or replace these fields before running or saving: {missingFields.map(id => fieldMap.get(id)?.label ?? id).join(', ')}.</p></div>}
            <div className="mb-4 flex items-center justify-between text-[11px] text-[#62776b]"><span>{summaryMode ? `${definition.aggregates?.length ?? 0} measures` : `${definition.columns.length} columns selected`}</span><span className="font-mono">{filterConditions(definition.filters).length} filters</span></div>
            <ReportButton onClick={() => runAtPage(1)} disabled={!hasReportData || !!missingFields.length || runReport.isPending} testId="button-run-report" className="w-full">{runReport.isPending ? 'Running report…' : 'Run report'}<ArrowDown className="h-4 w-4" /></ReportButton>
            {runReport.isError && <p role="alert" className="mt-3 text-[11px] leading-5 text-[#a4513d]">Could not run report: {getErrorText(runReport.error)}</p>}
            <div className="mt-4 border-t border-[#d5e0d5] pt-4">
              <div className="mb-2 font-mono text-[9px] uppercase tracking-[.14em] text-[#839187]">Export current definition</div>
              <div className="grid grid-cols-2 gap-2"><ReportButton variant="outline" onClick={() => downloadExport('csv')} disabled={!hasReportData || !!missingFields.length || exportCsv.isPending || exportXlsx.isPending} testId="button-export-csv" className="min-h-9 px-2 text-[11px]"><Download className="h-3.5 w-3.5" /> CSV</ReportButton><ReportButton variant="outline" onClick={() => downloadExport('xlsx')} disabled={!hasReportData || !!missingFields.length || exportCsv.isPending || exportXlsx.isPending} testId="button-export-xlsx" className="min-h-9 px-2 text-[11px]"><Download className="h-3.5 w-3.5" /> XLSX</ReportButton></div>
              {exportCsv.isPending || exportXlsx.isPending ? <div className="mt-2"><PendingLabel>Preparing export</PendingLabel></div> : null}
              {exportIssue && <p role="alert" className="mt-2 rounded-md bg-[#fff8f1] px-2.5 py-2 text-[10px] leading-4 text-[#92583c]">{exportIssue}</p>}
            </div>
          </div>
        </section>
        {result && <div className="rounded-xl border border-[#dce3d9] bg-[#fffefa] p-4"><div className="font-mono text-[9px] uppercase tracking-[.14em] text-[#829087]">Latest run</div><div className="mt-2 text-[21px] font-semibold tracking-[-.04em] text-[#315648]">{result.totalRows.toLocaleString()}</div><div className="text-[11px] text-[#77847b]">records · {result.grain}</div></div>}
      </aside>
    </div>

    <section className="mt-7 rounded-xl border border-[#dce3d9] bg-[#fffefa]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6eae2] px-5 py-4 sm:px-6">
        <div><SectionLabel aside={<span className="font-mono text-[10px] text-[#91a096]">RESULTS</span>}>Report preview</SectionLabel><p className="text-[11px] text-[#7c8980]">{result ? `${result.totalRows.toLocaleString()} rows · ${result.grain}` : 'Run the report to retrieve matching records.'}</p></div>
        {result && <label className="flex items-center gap-2 text-[11px] text-[#758279]">Rows per page <Select testId="select-report-page-size" value={String(pageSize)} onChange={value => { const nextSize = Number(value); setPageSize(nextSize); runAtPage(1, nextSize); }} className="h-8 py-0"><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></Select></label>}
      </div>
      {runReport.isPending && !result ? <div className="p-5"><LoadingRows rows={5} /></div> : !result ? <div className="px-5 py-12 text-center"><div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-[#edf3ec] text-[#618071]"><ArrowDownUp className="h-4 w-4" /></div><h3 className="text-[13px] font-semibold text-[#40594d]">Your report will appear here</h3><p className="mt-1 text-[11px] text-[#89958c]">Choose fields or measures, then run the report.</p></div> : result.rows.length === 0 ? <div className="px-5 py-12 text-center"><h3 className="text-[13px] font-semibold text-[#40594d]">No records match these conditions</h3><p className="mt-1 text-[11px] text-[#89958c]">Adjust the filters and run the report again.</p></div> : <>
        <div className="max-w-full overflow-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead><tr className="bg-[#f7f8f3]">{result.columns.map(column => <th key={column.fieldId} className="whitespace-nowrap border-b border-[#e5e9e1] px-4 py-3 font-mono text-[9px] font-medium uppercase tracking-[.12em] text-[#7b8980]">{column.label}</th>)}</tr></thead>
            <tbody>{result.rows.map((row, index) => {
              const rowType = typeof row._rowType === 'string' ? row._rowType : 'detail';
              const rowClass = rowType === 'grand_total'
                ? 'bg-[#eaf1e9] font-semibold'
                : rowType === 'currency_total'
                  ? 'bg-[#f0f4ed] font-semibold'
                  : rowType === 'subtotal'
                    ? 'bg-[#fbf7ec] font-medium'
                    : 'transition-colors hover:bg-[#f9faf6]';
              return <tr key={`${result.page}-${index}`} data-row-type={rowType} className={rowClass}>{result.columns.map((column, columnIndex) => {
                const isGroupColumn = column.fieldId.startsWith('group:');
                let value = row[column.fieldId];
                if (isGroupColumn && value == null) {
                  if (rowType === 'grand_total' && columnIndex === 0) value = 'Grand total';
                  else if (rowType === 'subtotal' && columnIndex === 0) value = 'Subtotal';
                }
                const noGroupDimensions = !result.columns.some(resultColumn => resultColumn.fieldId.startsWith('group:'));
                const cell = formatValue(value, column.dataType);
                return <td key={column.fieldId} className="max-w-[340px] border-b border-[#edf0e9] px-4 py-3 text-[12px] text-[#43594e]">{summaryMode && noGroupDimensions && columnIndex === 0 && rowType === 'grand_total' ? <div><span className="mb-1 block font-mono text-[8px] uppercase tracking-wider text-[#71877b]">Grand total</span>{formatValue(row[column.fieldId], column.dataType)}</div> : cell}</td>;
              })}</tr>;
            })}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <span className="font-mono text-[10px] text-[#829087]">Page {result.page} of {Math.max(result.totalPages, 1)} · {result.totalRows.toLocaleString()} records</span>
          <div className="flex items-center gap-2"><ReportButton variant="outline" testId="button-report-previous-page" disabled={result.page <= 1 || runReport.isPending} onClick={() => runAtPage(result.page - 1)} className="min-h-8 px-2.5 text-[11px]"><ChevronLeft className="h-3.5 w-3.5" />Previous</ReportButton><ReportButton variant="outline" testId="button-report-next-page" disabled={result.page >= result.totalPages || runReport.isPending} onClick={() => runAtPage(result.page + 1)} className="min-h-8 px-2.5 text-[11px]">Next<ChevronRight className="h-3.5 w-3.5" /></ReportButton></div>
        </div>
      </>}
      {runReport.isError && result && <div role="alert" className="border-t border-[#ead3c4] bg-[#fff8f2] px-5 py-3 text-[11px] text-[#92583c]">Could not load this page of results: {getErrorText(runReport.error)}</div>}
    </section>
  </WorkareaFrame>;
}

function formatValue(value: unknown, dataType: string) {
  if (value === null || value === undefined || value === '') return <span className="text-[#a1aaa1]">—</span>;
  if (typeof value === 'boolean') return <span className={cx('inline-flex rounded-md px-2 py-1 text-[10px] font-semibold', value ? 'bg-[#eaf2e9] text-[#47735d]' : 'bg-[#f0f1ed] text-[#79847d]')}>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'object') return <span className="block truncate" title={JSON.stringify(value)}>{JSON.stringify(value)}</span>;
  if (dataType === 'date' || dataType === 'datetime') {
    const date = new Date(String(value));
    return <span className="whitespace-nowrap">{Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()}</span>;
  }
  return <span className="block truncate" title={String(value)}>{String(value)}</span>;
}

export default function ReportWorkareaPage() {
  const [isGallery] = useRoute('/report-gallery');
  const [isBuilder] = useRoute('/report-builder');
  const [isSavedList] = useRoute('/my-reports');
  if (isGallery) return <ReportGalleryPage />;
  if (isSavedList) return <SavedReportsPage />;
  if (isBuilder || window.location.pathname.startsWith('/report-builder/')) return <ReportBuilderPage />;
  return <ReportGalleryPage />;
}
