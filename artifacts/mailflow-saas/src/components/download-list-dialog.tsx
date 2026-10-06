import { useState } from 'react';
import { CircleAlert, Download, LoaderCircle, X } from 'lucide-react';

export type DownloadScope = 'filtered' | 'all';

export type DownloadListColumn<T extends string = string> = {
  key: T;
  label: string;
  group: 'standard' | 'additional';
};

type DownloadListDialogProps<T extends string> = {
  title: string;
  description: string;
  entityLabel: string;
  currentCount: number;
  allCount: number;
  hasActiveFilters: boolean;
  filterSummary: string;
  defaultScope: DownloadScope;
  columns: DownloadListColumn<T>[];
  defaultColumns: T[];
  onDownload: (scope: DownloadScope, columns: T[]) => Promise<void>;
  onClose: () => void;
};

export function DownloadListDialog<T extends string>({
  title,
  description,
  entityLabel,
  currentCount,
  allCount,
  hasActiveFilters,
  filterSummary,
  defaultScope,
  columns,
  defaultColumns,
  onDownload,
  onClose,
}: DownloadListDialogProps<T>) {
  const [scope, setScope] = useState<DownloadScope>(defaultScope);
  const [selectedColumns, setSelectedColumns] = useState<T[]>(defaultColumns);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const standardColumns = columns.filter(column => column.group === 'standard');
  const additionalColumns = columns.filter(column => column.group === 'additional');
  const selectedCount = scope === 'all' ? allCount : currentCount;

  const toggleColumn = (key: T) => {
    setSelectedColumns(current => current.includes(key)
      ? current.filter(column => column !== key)
      : [...current, key]);
  };

  const download = async () => {
    if (!selectedColumns.length || pending) return;
    setError(null);
    setPending(true);
    try {
      await onDownload(scope, selectedColumns);
      onClose();
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'The Excel file could not be created. Try again.');
    } finally {
      setPending(false);
    }
  };

  const renderColumn = (column: DownloadListColumn<T>) => (
    <label key={column.key} className="flex min-w-0 items-start gap-2 rounded-md border border-[#e5e9ed] bg-white px-3 py-2 text-[11px] text-[#425267] hover:border-[#c6d6e7]">
      <input
        type="checkbox"
        data-testid={`checkbox-export-column-${column.key}`}
        checked={selectedColumns.includes(column.key)}
        onChange={() => toggleColumn(column.key)}
        className="mt-0.5 h-3.5 w-3.5 rounded border-[#cbd3dc] text-[#174f99] focus:ring-[#cfe0f2]"
      />
      <span className="min-w-0 break-words">{column.label}</span>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#172334]/40 p-3 backdrop-blur-[2px] sm:p-5"
      role="presentation"
      onMouseDown={event => {
        if (!pending && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-list-title"
        data-testid="dialog-download-list"
        className="my-auto flex max-h-[94dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-[#dfe4ea] bg-[#fbfcfd] shadow-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#e4e9ee] px-5 py-4 sm:px-6">
          <div>
            <div className="mono text-[9px] uppercase tracking-[.16em] text-[#788596]">WORKSPACE REPORT</div>
            <h2 id="download-list-title" className="display mt-1 text-[21px] font-bold text-[#172334]">{title}</h2>
            <p className="mt-1 text-[11px] leading-5 text-[#748090]">{description}</p>
          </div>
          <button
            type="button"
            data-testid="button-close-download-list"
            aria-label="Close download options"
            disabled={pending}
            onClick={onClose}
            className="rounded-md p-2 text-[#778291] hover:bg-[#eef2f5] disabled:opacity-50"
          >
            <X className="h-4 w-4"/>
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <fieldset>
            <legend className="text-[12px] font-semibold text-[#344154]">Which {entityLabel} should be included?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#dbe4ee] bg-white p-3">
                <input
                  type="radio"
                  name="download-list-scope"
                  data-testid="radio-download-filtered"
                  value="filtered"
                  checked={scope === 'filtered'}
                  onChange={() => setScope('filtered')}
                  className="mt-0.5 h-4 w-4 border-[#cbd3dc] text-[#174f99] focus:ring-[#cfe0f2]"
                />
                <span>
                  <span className="block text-[11px] font-semibold text-[#344154]">Current filtered view</span>
                  <span className="mt-1 block text-[10px] leading-4 text-[#7b8795]">
                    {hasActiveFilters ? filterSummary : 'No filters are active, so this includes every row.'}
                  </span>
                  <span className="mt-1.5 block text-[10px] font-semibold text-[#55708e]">{currentCount.toLocaleString()} {entityLabel}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#dbe4ee] bg-white p-3">
                <input
                  type="radio"
                  name="download-list-scope"
                  data-testid="radio-download-all"
                  value="all"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="mt-0.5 h-4 w-4 border-[#cbd3dc] text-[#174f99] focus:ring-[#cfe0f2]"
                />
                <span>
                  <span className="block text-[11px] font-semibold text-[#344154]">All {entityLabel}</span>
                  <span className="mt-1 block text-[10px] leading-4 text-[#7b8795]">Ignore the filters and include every row in this workspace.</span>
                  <span className="mt-1.5 block text-[10px] font-semibold text-[#55708e]">{allCount.toLocaleString()} {entityLabel}</span>
                </span>
              </label>
            </div>
          </fieldset>

          <section aria-labelledby="download-standard-columns">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="download-standard-columns" className="text-[12px] font-semibold text-[#344154]">Standard columns</h3>
                <p className="mt-1 text-[10px] text-[#7b8795]">Included by default. Change the selection to fit your report.</p>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{standardColumns.map(renderColumn)}</div>
          </section>

          <section aria-labelledby="download-additional-columns">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="download-additional-columns" className="text-[12px] font-semibold text-[#344154]">Add more columns</h3>
                <p className="mt-1 text-[10px] text-[#7b8795]">Select any additional fields to include in the workbook.</p>
              </div>
              <span className="text-[10px] text-[#7b8795]">{selectedColumns.length} selected</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{additionalColumns.map(renderColumn)}</div>
          </section>

          {error && <div role="alert" data-testid="status-download-list-error" className="flex items-start gap-2 rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[11px] leading-5 text-[#99501e]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0"/>{error}</div>}
          <p className="text-[10px] leading-4 text-[#86919d]">Large reports are prepared on the server. Keep this window open until the workbook downloads.</p>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-[#e5e9ed] bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span data-testid="text-download-row-count" className="text-[10px] text-[#7b8795]">{selectedCount.toLocaleString()} rows · {selectedColumns.length} columns</span>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={pending} onClick={onClose} className="min-h-9 rounded-md border border-[#d7dce3] bg-white px-3.5 text-[11px] font-semibold text-[#4d5b6b] hover:bg-[#f7f9fb] disabled:opacity-50">Cancel</button>
            <button type="button" data-testid="button-download-excel" disabled={pending || selectedColumns.length === 0} onClick={() => void download()} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-4 text-[11px] font-semibold text-white hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-55">
              {pending ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin"/>Building workbook…</> : <><Download className="h-3.5 w-3.5"/>Download Excel</>}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
