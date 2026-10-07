import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowLeft, Building2, Check, CircleAlert, Globe2, Link2, MapPin, Pencil,
  Search, Trash2, Users,
} from 'lucide-react';
import {
  getGetCompanyQueryKey, getGetContactQueryKey, getListCompaniesQueryKey, getListContactOptionsQueryKey, getListContactsQueryKey,
  useDeleteCompany, useGetCompany, useListContactOptions, useUpdateContact,
} from '@workspace/api-client-react';
import type { Company, ContactOption } from '@workspace/api-client-react';
import { CompanyEditor } from '@/pages/companies';
import { LinkedGlobalProfileNotice } from '@/pages/global-company-directory';
import { CompanyLinkConfirmation, isCompanyProfileConflict, type CompanyLinkReplacement, type CompanyProfileSnapshot } from '@/components/company-link-confirmation';
import { CompanyIntelligencePanel } from '@/components/company-intelligence-panel';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';

const panel = 'rounded-lg border border-[#e0e4e9] bg-white';
const errorText = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message) : 'Something went wrong. Please try again.';
const prettyDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const profileFromContact = (contact: ContactOption): CompanyProfileSnapshot => ({
  companyName: contact.companyName,
  companyWebsiteUrl: contact.companyWebsiteUrl,
  companyDomain: contact.companyDomain,
  companyIndustry: contact.companyIndustry,
  companySize: contact.companySize,
  companyRevenueRange: contact.companyRevenueRange,
  companyDescription: contact.companyDescription,
  companyPhoneNumber: contact.companyPhoneNumber,
  companyLinkedinUrl: contact.companyLinkedinUrl,
  companyLocation: contact.companyLocation,
});
const profileFromCompany = (company: Company): CompanyProfileSnapshot => ({
  companyName: company.companyName,
  companyWebsiteUrl: company.companyWebsiteUrl,
  companyDomain: company.companyDomain,
  companyIndustry: company.companyIndustry,
  companySize: company.companySize,
  companyRevenueRange: company.companyRevenueRange,
  companyDescription: company.companyDescription,
  companyPhoneNumber: company.companyPhoneNumber,
  companyLinkedinUrl: company.companyLinkedinUrl,
  companyLocation: company.companyLocation,
});
const profileFields = [
  ['Website', 'companyWebsiteUrl'], ['Domain', 'companyDomain'], ['Industry', 'companyIndustry'],
  ['Location', 'companyLocation'], ['Company size', 'companySize'], ['Revenue range', 'companyRevenueRange'],
  ['Phone', 'companyPhoneNumber'], ['LinkedIn', 'companyLinkedinUrl'],
] as const;

export function CompanyDetailPage() {
  const { companyId = '' } = useParams<{ companyId: string }>();
  const query = useGetCompany(companyId, { query: { enabled: !!companyId, retry: false, queryKey: getGetCompanyQueryKey(companyId) } });
  const updateContact = useUpdateContact();
  const deleteCompany = useDeleteCompany();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [search, setSearch] = useState('');
  const contactOptionsParams = { companyId: '__none__', search, limit: 30 };
  const contactsQuery = useListContactOptions(contactOptionsParams, {
    query: {
      queryKey: getListContactOptionsQueryKey(contactOptionsParams),
      staleTime: 10_000,
      placeholderData: previous => previous,
    },
  });
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [replacement, setReplacement] = useState<CompanyLinkReplacement | null>(null);
  const company = query.data?.company;
  const linked = query.data?.contacts ?? [];
  const unlinked = contactsQuery.data?.contacts ?? [];
  useEffect(() => {
    if (selectedContactId && !unlinked.some(contact => contact.id === selectedContactId)) {
      setSelectedContactId('');
    }
  }, [selectedContactId, unlinked]);

  const linkContact = (target: CompanyLinkReplacement, confirmed = false) => {
    setNotice(null);
    updateContact.mutate({ contactId: target.contactId, data: {
      companyId: target.companyId,
      ...(confirmed ? { replaceLegacyCompanyProfile: true } : {}),
    } }, {
      onSuccess: contact => {
        setReplacement(null);
        void qc.invalidateQueries({ queryKey: getGetCompanyQueryKey(target.companyId) });
        void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        void qc.invalidateQueries({ queryKey: getListContactOptionsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetContactQueryKey(contact.id) });
        if (contact.companyId !== target.companyId) {
          setNotice({ type: 'error', text: 'The server did not confirm the company association. Refresh and try again.' });
          return;
        }
        setSelectedContactId('');
        setNotice({ type: 'success', text: `${contact.name} is now linked to ${target.companyName}.` });
      },
      onError: error => {
        setReplacement(!confirmed && isCompanyProfileConflict(error) ? target : null);
        setNotice({ type: 'error', text: `The contact has not been linked. ${errorText(error)}` });
      },
    });
  };
  const attach = () => {
    const contact = unlinked.find(item => item.id === selectedContactId);
    if (!contact || !company) return;
    linkContact({
      contactId: contact.id, contactName: contact.name, legacyCompanyName: contact.companyName,
      companyId: company.id, companyName: company.companyName,
      legacyProfile: profileFromContact(contact), sharedProfile: profileFromCompany(company),
    });
  };

  if (query.isLoading) return <div aria-label="Loading company details" className="space-y-5" data-testid="loading-company-detail"><div className="h-5 w-40 animate-pulse rounded bg-[#edf0f3]"/><div className="h-36 animate-pulse rounded-lg bg-[#f1f3f5]"/><div className="h-64 animate-pulse rounded-lg bg-[#f1f3f5]"/></div>;
  if (query.isError || !company) return <section className={`${panel} flex flex-col items-start gap-3 p-6`} role="alert" data-testid="error-company-detail"><div className="flex items-center gap-2 text-sm font-semibold text-[#26364a]"><CircleAlert className="h-4 w-4 text-[#c16d31]"/>Company details could not be loaded</div><p className="text-xs text-[#778291]">The record may have been removed, or your workspace data could not be reached.</p><div className="flex gap-2"><button type="button" data-testid="button-retry-company-detail" onClick={() => void query.refetch()} className="rounded-md border border-[#d7dce3] px-3 py-2 text-xs font-semibold">Retry</button><Link href="/companies" data-testid="link-back-companies-error" className="rounded-md px-3 py-2 text-xs font-semibold text-[#245b9b] no-underline">Company directory</Link></div></section>;
  const deleteCurrentCompany = () => {
    deleteCompany.mutate({ companyId: company.id }, {
      onSuccess: () => {
        setDeleteConfirmationOpen(false);
        void qc.invalidateQueries({ queryKey: getGetCompanyQueryKey(company.id) });
        void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        void qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
        void qc.invalidateQueries({ queryKey: getListContactOptionsQueryKey() });
        for (const contact of linked) {
          void qc.invalidateQueries({ queryKey: getGetContactQueryKey(contact.id) });
        }
        setLocation('/companies');
      },
      onError: error => {
        setDeleteConfirmationOpen(false);
        setNotice({ type: 'error', text: `${company.globalCompanyId ? 'The workspace link was not removed.' : 'The company was not deleted.'} ${errorText(error)}` });
      },
    });
  };

  return <div className="fade-in">
    <ConfirmActionDialog
      open={deleteConfirmationOpen}
      onOpenChange={setDeleteConfirmationOpen}
      onConfirm={deleteCurrentCompany}
      title={company.globalCompanyId ? `Remove ${company.companyName} from your workspace?` : `Delete ${company.companyName}?`}
      description={company.globalCompanyId
        ? `The global catalog profile will remain available. ${linked.length ? `${linked.length} ${linked.length === 1 ? 'contact association will' : 'contact associations will'} be unlinked from this workspace company; their private contact records will stay in your workspace and will not be deleted.` : 'Any contact associations will be unlinked; contact records will stay in your workspace and will not be deleted.'}`
        : linked.length
          ? `${linked.length} ${linked.length === 1 ? 'contact is' : 'contacts are'} linked to this company. Their contact records will stay, be unlinked, and keep the shared company profile details. The company and its associations will be permanently removed.`
          : 'This company and its profile will be permanently removed. Any contacts still linked when you confirm will remain as contact records, be unlinked, and keep the shared company profile details.'}
      confirmLabel={company.globalCompanyId ? 'Remove workspace link' : 'Delete company'}
      pending={deleteCompany.isPending}
      testId="dialog-delete-company"
    >
      {linked.length > 0 && (
        <div data-testid="list-delete-company-contacts" className="max-h-36 overflow-y-auto rounded-md border border-[#e4e9ee] bg-[#f8fafb] px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold text-[#667586]">Affected contacts</p>
          <ul className="space-y-1.5">
            {linked.map(contact => (
              <li key={contact.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
                <span className="font-semibold text-[#344154]">{contact.name}</span>
                <span className="text-[#7d8997]">{contact.email}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ConfirmActionDialog>
    <CompanyLinkConfirmation replacement={replacement} pending={updateContact.isPending}
      onCancel={() => setReplacement(null)} onConfirm={target => linkContact(target, true)} />
    <Link href="/companies" data-testid="link-back-companies" className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-[#55708e] no-underline hover:text-[#174f99]"><ArrowLeft className="h-4 w-4"/>Company directory</Link>
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-[#d7e3ef] bg-[#edf4fc] text-[#245b9b]"><Building2 className="h-5 w-5"/></span><div className="min-w-0"><div className="mono mb-1 text-[9px] uppercase tracking-[.16em] text-[#7d8794]">{company.globalCompanyId ? 'GLOBAL CATALOG LINK' : 'PRIVATE COMPANY'} / {company.id.slice(0, 8)}</div><h1 data-testid="text-company-name" className="display break-words text-[28px] font-bold leading-tight text-[#172334]">{company.companyName}</h1><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#758394]"><span className="inline-flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5"/>{company.companyDomain || 'Domain not provided'}</span>{company.companyLocation && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5"/>{company.companyLocation}</span>}</div></div></div>
      {!company.globalCompanyId && <button type="button" data-testid="button-edit-company" onClick={() => setEditorOpen(true)} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#dce2e8] bg-white px-3 text-[11px] font-semibold text-[#536477] hover:bg-[#f4f7fa]"><Pencil className="h-3.5 w-3.5"/>Edit profile</button>}
    </header>
    {notice && <div role={notice.type === 'error' ? 'alert' : 'status'} data-testid="status-company-detail" className={`mb-5 rounded-md border px-4 py-3 text-[12px] ${notice.type === 'error' ? 'border-[#f0d5bd] bg-[#fff8f1] text-[#99501e]' : 'border-[#cfe4d8] bg-[#f1f8f4] text-[#31674b]'}`}>{notice.text}</div>}
    {company.globalCompanyId && <LinkedGlobalProfileNotice companyName={company.companyName}/>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,.92fr)_minmax(0,1.08fr)]">
      <section className={`${panel} overflow-hidden`} data-testid="panel-company-profile">
        <header className="border-b border-[#e8edf1] bg-[#fbfcfd] px-5 py-4"><div className="mono text-[9px] uppercase tracking-[.14em] text-[#8a96a4]">{company.globalCompanyId ? 'GLOBAL CATALOG PROFILE' : 'COMPANY PROFILE'}</div><h2 className="mt-1 text-[15px] font-bold text-[#223247]">Organization details</h2></header>
        <div className="p-5">
          <dl className="grid gap-x-5 sm:grid-cols-2">{profileFields.map(([label, key]) => <div key={key} className="min-w-0 border-b border-[#edf0f2] py-3"><dt className="mono text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">{label}</dt><dd data-testid={`text-company-${key}`} className="mt-1 break-words text-[11px] leading-5 text-[#3b4d61]">{company[key] || <span className="text-[#9aa4af]">Not provided</span>}</dd></div>)}</dl>
          <div className="mt-4"><div className="mono mb-1.5 text-[9px] uppercase tracking-[.1em] text-[#8a96a4]">DESCRIPTION</div><p data-testid="text-company-description" className="whitespace-pre-wrap text-[11px] leading-5 text-[#637285]">{company.companyDescription || 'No description provided.'}</p></div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#e8edf1] pt-4"><span data-testid="text-company-updated-at" className="text-[10px] text-[#8994a1]">{company.globalCompanyId ? 'Catalog profile updated' : 'Updated'} {prettyDate(company.updatedAt)}</span><button type="button" data-testid="button-delete-company" disabled={deleteCompany.isPending} title={company.globalCompanyId ? 'Remove the workspace link; the global catalog profile remains and tenant contact records are not deleted' : 'Delete company and restore its profile to linked contacts'} onClick={() => { setNotice(null); setDeleteConfirmationOpen(true); }} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[10px] font-semibold text-[#a35c31] hover:bg-[#fff5ec] disabled:cursor-not-allowed disabled:text-[#b8b0aa]"><Trash2 className="h-3.5 w-3.5"/>{deleteCompany.isPending ? (company.globalCompanyId ? 'Removing…' : 'Deleting…') : (company.globalCompanyId ? 'Remove workspace link' : 'Delete company')}</button></div>
        </div>
      </section>
      <div className="space-y-5">
        <section className={`${panel} overflow-hidden`} data-testid="panel-linked-contacts">
          <header className="flex items-center justify-between border-b border-[#e8edf1] bg-[#fbfcfd] px-5 py-4"><div><div className="mono text-[9px] uppercase tracking-[.14em] text-[#8a96a4]">CONTACT RELATIONSHIPS</div><h2 className="mt-1 text-[15px] font-bold text-[#223247]">Associated contacts <span data-testid="text-linked-contact-count" className="ml-1 text-[11px] font-medium text-[#8793a0]">({linked.length})</span></h2></div><Users className="h-4 w-4 text-[#8a96a4]"/></header>
          {linked.length ? <div className="divide-y divide-[#edf0f2]">{linked.map(contact => <Link key={contact.id} href={`/contacts/${contact.id}`} data-testid={`link-company-contact-${contact.id}`} className="flex items-center gap-3 px-5 py-3 no-underline hover:bg-[#f8fafb]"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#edf2f7] text-[10px] font-bold text-[#526a82]">{(contact.name[0] || '?').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-[#36495d]">{contact.name}</span><span className="mt-0.5 block truncate text-[10px] text-[#8793a0]">{contact.email}{contact.jobTitle ? ` · ${contact.jobTitle}` : ''}</span></span><span className="text-[10px] font-semibold text-[#55708e]">View</span></Link>)}</div> : <div data-testid="empty-company-contacts" className="px-5 py-8 text-center"><p className="text-[12px] font-semibold text-[#45566a]">No contacts associated</p><p className="mt-1 text-[10px] text-[#8995a2]">Attach an existing unlinked contact below.</p></div>}
        </section>
        <section className={`${panel} overflow-hidden`} data-testid="panel-attach-contact">
          <header className="border-b border-[#e8edf1] bg-[#fbfcfd] px-5 py-4"><div className="mono text-[9px] uppercase tracking-[.14em] text-[#8a96a4]">SAFE ASSOCIATION</div><h2 className="mt-1 text-[15px] font-bold text-[#223247]">Attach an existing contact</h2><p className="mt-1 text-[11px] text-[#7f8b99]">Only unlinked contacts are eligible. Compatible legacy details merge into this profile. Conflicting legacy details can be replaced only after you confirm.</p></header>
          <div className="p-5">
            {contactsQuery.isLoading ? <div aria-label="Loading unlinked contacts" data-testid="loading-unlinked-contacts" className="space-y-3"><div className="h-9 animate-pulse rounded bg-[#f1f3f5]"/><div className="h-9 animate-pulse rounded bg-[#f1f3f5]"/></div> : contactsQuery.isError ? <div role="alert" data-testid="error-unlinked-contacts" className="flex items-center justify-between gap-3 text-[11px] text-[#99501e]"><span>Contacts could not be loaded.</span><button type="button" data-testid="button-retry-unlinked-contacts" onClick={() => void contactsQuery.refetch()} className="font-semibold text-[#245b9b]">Retry</button></div> : <>
              <label className="relative mb-3 block"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8b96a3]"/><input aria-label="Search unlinked contacts" data-testid="input-search-unlinked-contacts" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find by name, email, or title" className="h-9 w-full rounded-md border border-[#dce2e8] bg-white pl-9 pr-3 text-[11px] outline-none focus:border-[#3b73b8]"/></label>
              {contactsQuery.isFetching && <p className="-mt-1 mb-2 text-[10px] text-[#8793a0]">Updating matches…</p>}
              {unlinked.length ? <>
                <div className="max-h-[220px] divide-y divide-[#edf0f2] overflow-y-auto rounded-md border border-[#e6eaee]">{unlinked.map(contact => <label key={contact.id} data-testid={`row-unlinked-contact-${contact.id}`} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-[#f8fafb]"><input type="radio" name="attach-contact" value={contact.id} checked={selectedContactId === contact.id} onChange={() => setSelectedContactId(contact.id)} data-testid={`radio-attach-contact-${contact.id}`} className="accent-[#174f99]"/><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-[#3c4e62]">{contact.name}</span><span className="block truncate text-[10px] text-[#8994a1]">{contact.email}{contact.jobTitle ? ` · ${contact.jobTitle}` : ''}</span></span></label>)}</div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span data-testid="text-unlinked-contact-count" className="text-[10px] text-[#8793a0]">{unlinked.length} shown of {(contactsQuery.data?.total ?? 0).toLocaleString()} matching unlinked contacts</span><button type="button" data-testid="button-attach-contact" disabled={!unlinked.some(contact => contact.id === selectedContactId) || updateContact.isPending} onClick={attach} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#174f99] bg-[#174f99] px-3.5 text-[11px] font-semibold text-white hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-50">{updateContact.isPending ? 'Attaching…' : <><Link2 className="h-3.5 w-3.5"/>Attach contact</>}</button></div>
              </> : <div data-testid="empty-unlinked-contacts" className="rounded-md border border-dashed border-[#dfe5eb] bg-[#fbfcfd] px-4 py-6 text-center"><p className="text-[11px] font-semibold text-[#45566a]">{search ? 'No unlinked contacts match' : 'No unlinked contacts available'}</p><p className="mt-1 text-[10px] text-[#8995a2]">{search ? 'Try another search term.' : 'Contacts already associated with a shared company are not shown here.'}</p></div>}
            </>}
          </div>
        </section>
      </div>
    </div>
    {company.globalCompanyId ? <div className="mt-6" data-testid="section-company-intelligence"><CompanyIntelligencePanel globalCompanyId={company.globalCompanyId}/></div> : <p data-testid="text-private-no-research" className="mt-6 rounded-md border border-dashed border-[#dfe5eb] bg-[#fbfcfd] px-4 py-3 text-[11px] text-[#7f8b99]">Company intelligence is available for global catalog companies only. This private company is not shared or researched.</p>}
    {editorOpen && !company.globalCompanyId && <CompanyEditor company={company as Company} onClose={() => setEditorOpen(false)} onSaved={() => { setEditorOpen(false); setNotice({ type: 'success', text: 'Company profile saved.' }); void qc.invalidateQueries({ queryKey: getGetCompanyQueryKey(company.id) }); void qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() }); }}/>}
  </div>;
}