import { Building2, CircleAlert, LoaderCircle } from 'lucide-react';
import { getGetAdminGlobalCompanyQueryKey, useGetAdminGlobalCompany } from '@workspace/api-client-react';
import { Link, useParams } from 'wouter';

const fields = [
  ['Business area', 'companyBusinessArea'],
  ['Industry', 'companyIndustry'],
  ['Website', 'companyWebsiteUrl'],
  ['Website domain', 'companyDomain'],
  ['Company size', 'companySize'],
  ['Revenue range', 'companyRevenueRange'],
  ['Location', 'companyLocation'],
  ['Phone', 'companyPhoneNumber'],
  ['LinkedIn', 'companyLinkedinUrl'],
] as const;

export function AdminGlobalCompanyDetailPage() {
  const { companyId = '' } = useParams<{ companyId: string }>();
  const query = useGetAdminGlobalCompany(companyId, {
    query: { enabled: !!companyId, retry: false, queryKey: getGetAdminGlobalCompanyQueryKey(companyId) },
  });
  if (query.isLoading) return <div aria-label="Loading global company details" className="mx-auto max-w-4xl space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-[#eaf1ed]"/><div className="h-48 animate-pulse rounded-xl bg-[#eaf1ed]"/></div>;
  if (query.isError || !query.data) return <section role="alert" className="mx-auto max-w-4xl rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-6"><div className="flex items-center gap-2 text-sm font-bold text-[#29443b]"><CircleAlert className="h-4 w-4 text-[#bf7043]"/>Global company details could not be loaded</div><p className="mt-2 text-xs text-[#71847a]">The profile may have been removed or the catalog could not be reached.</p><div className="mt-4 flex gap-3"><button type="button" onClick={() => void query.refetch()} className="rounded-md border border-[#cad8d0] px-3 py-2 text-xs font-semibold text-[#315c4e]">Retry</button><Link href="/admin/global-companies" className="rounded-md px-3 py-2 text-xs font-semibold text-[#315c4e] no-underline">Global companies</Link></div></section>;

  const company = query.data;
  return <main className="fade-in mx-auto max-w-4xl">
    <Link href="/admin/global-companies" className="text-xs font-semibold text-[#347765] no-underline hover:underline">← Global companies</Link>
    <header className="mt-4 flex items-start gap-4 rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-5 sm:p-7">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#edf6f0] text-[#3b7a67]"><Building2 className="h-5 w-5"/></span>
      <div className="min-w-0"><div className="mono text-[9px] uppercase tracking-[.16em] text-[#638a7b]">GLOBAL COMPANY PROFILE · SUPERADMIN VIEW</div><h1 className="display mt-1 break-words text-[25px] font-extrabold tracking-[-.03em] text-[#1e3b32]">{company.companyName}</h1><p className="mt-1 text-[11px] text-[#71847a]">Shared company information only. Workspace contacts and campaign data are not shown here.</p></div>
    </header>
    <section className="mt-4 rounded-xl border border-[#dce6e1] bg-[#fbfdfb] p-5 sm:p-7">
      <h2 className="text-[13px] font-bold text-[#29443b]">Company information</h2>
      <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">{fields.map(([label, key]) => <div key={key} className="min-w-0 border-b border-[#edf2ee] pb-3"><dt className="text-[10px] font-semibold text-[#819088]">{label}</dt><dd className="mt-1 break-words text-[12px] text-[#29443b]">{company[key] || '—'}</dd></div>)}</dl>
      <div className="mt-5"><h3 className="text-[10px] font-semibold text-[#819088]">Description</h3><p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6 text-[#29443b]">{company.companyDescription || '—'}</p></div>
    </section>
  </main>;
}
