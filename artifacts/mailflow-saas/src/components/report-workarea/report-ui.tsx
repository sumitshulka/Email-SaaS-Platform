import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, Database, FileSpreadsheet, FileText, LoaderCircle, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export function ReportButton({ children, onClick, type = 'button', variant = 'primary', disabled, className = '', testId }: {
  children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; variant?: 'primary' | 'outline' | 'quiet' | 'danger';
  disabled?: boolean; className?: string; testId: string;
}) {
  const styles = {
    primary: 'bg-[#285c54] text-white border-[#285c54] hover:bg-[#1e4a44] shadow-[0_2px_5px_rgba(25,61,55,.12)]',
    outline: 'bg-[#fffefa] text-[#294640] border-[#cbd9d1] hover:bg-[#f1f5f1]',
    quiet: 'border-transparent bg-transparent text-[#65736b] hover:bg-[#eef2ed] hover:text-[#263d36]',
    danger: 'border-[#e8c8bd] bg-[#fff9f6] text-[#9f4d37] hover:bg-[#fff0e9]',
  }[variant];
  return <button data-testid={testId} type={type} onClick={onClick} disabled={disabled} className={cx('inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3.5 text-[13px] font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76a79a] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px', styles, className)}>{children}</button>;
}

export function WorkareaFrame({ children, section, title, description, action }: {
  children: ReactNode; section: string; title: string; description: string; action?: ReactNode;
}) {
  return <main className="min-h-[100dvh] bg-[#f4f5ef] px-4 py-7 text-[#263b35] sm:px-7 lg:px-10 lg:py-9">
    <div className="mx-auto max-w-[1440px]">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-5 border-b border-[#dce2d8] pb-6">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.19em] text-[#74867c]">
            <span className="h-px w-5 bg-[#c17b50]" /> Mailflow <span className="text-[#b5c1b7]">/</span> Reports <span className="text-[#b5c1b7]">/</span> {section}
          </div>
          <h1 className="display text-[30px] font-bold leading-tight tracking-[-.04em] text-[#203a33] sm:text-[36px]">{title}</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#68776f]">{description}</p>
        </div>
        {action}
      </div>
      {children}
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#dce2d8] pt-4 font-mono text-[10px] uppercase tracking-[.12em] text-[#829087]">
        <span>Mailflow reporting</span><span>Records from your workspace · no rollups</span>
      </footer>
    </div>
  </main>;
}

export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-mono text-[10px] font-medium uppercase tracking-[.16em] text-[#74867c]">{children}</h2>{aside}</div>;
}

export function EmptyPanel({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-[#cbd7cc] bg-[#fafbf7] px-6 py-14 text-center">
    <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl border border-[#d9e3da] bg-[#edf3ec] text-[#54796d]"><Database className="h-5 w-5" /></div>
    <h3 className="text-[15px] font-semibold text-[#2a433b]">{title}</h3>
    <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-[#77837b]">{detail}</p>
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>;
}

export function ErrorPanel({ message, retry }: { message?: string; retry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#ead3c4] bg-[#fff8f2] p-5">
    <div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#b56a43]" /><div><div className="text-[14px] font-semibold text-[#754832]">This report area could not load</div><p className="mt-1 text-[12px] leading-5 text-[#8d6d5d]">{message || 'Your saved work is unchanged. Please try again.'}</p></div></div>
    <ReportButton variant="outline" onClick={retry} testId="button-report-retry"><RefreshCw className="h-3.5 w-3.5" /> Retry</ReportButton>
  </div>;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return <div aria-label="Loading report data" className="space-y-2 rounded-xl border border-[#e1e5dc] bg-[#fffefa] p-5">
    <div className="mb-4 h-4 w-36 animate-pulse rounded bg-[#e8ede6]" />
    {Array.from({ length: rows }, (_, i) => <div key={i} className="grid grid-cols-3 gap-3"><div className="h-9 animate-pulse rounded bg-[#f0f2ec]" /><div className="h-9 animate-pulse rounded bg-[#f0f2ec]" /><div className="h-9 animate-pulse rounded bg-[#f0f2ec]" /></div>)}
  </div>;
}

export function BackLink({ href, children = 'Back to reports' }: { href: string; children?: ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#58756a] no-underline hover:text-[#285c54]"><ArrowLeft className="h-3.5 w-3.5" />{children}</Link>;
}

export function DataTypeMark({ type }: { type: string }) {
  const Icon = type === 'number' || type === 'currency' ? FileSpreadsheet : type === 'date' || type === 'datetime' ? FileText : Database;
  return <Icon aria-hidden="true" className="h-3.5 w-3.5 text-[#819087]" />;
}

export function PendingLabel({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-2 text-[12px] text-[#64766d]"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{children}</span>;
}

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#285c54] no-underline hover:underline">{children}<ArrowRight className="h-3 w-3" /></Link>;
}
