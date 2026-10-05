import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export type CompanyLinkReplacement = {
  contactId: string;
  contactName: string;
  legacyCompanyName: string | null;
  companyId: string;
  companyName: string;
  legacyProfile: CompanyProfileSnapshot;
  sharedProfile: CompanyProfileSnapshot;
};

export type CompanyProfileSnapshot = {
  companyName: string | null;
  companyWebsiteUrl: string | null;
  companyDomain: string | null;
  companyIndustry: string | null;
  companySize: string | null;
  companyRevenueRange: string | null;
  companyDescription: string | null;
  companyPhoneNumber: string | null;
  companyLinkedinUrl: string | null;
  companyLocation: string | null;
};

const comparisonFields = [
  ['companyName', 'Company name'],
  ['companyDomain', 'Domain'],
  ['companyWebsiteUrl', 'Website'],
  ['companyIndustry', 'Industry'],
  ['companySize', 'Company size'],
  ['companyRevenueRange', 'Revenue range'],
  ['companyPhoneNumber', 'Phone'],
  ['companyLocation', 'Location'],
  ['companyLinkedinUrl', 'LinkedIn URL'],
] as const;

export function isCompanyProfileConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('data' in error)) return false;
  const data = error.data;
  return !!data && typeof data === 'object' && 'code' in data && data.code === 'COMPANY_PROFILE_CONFLICT';
}

export function CompanyProfileComparison({ legacyProfile, sharedProfile, testIdPrefix }: {
  legacyProfile: CompanyProfileSnapshot;
  sharedProfile: CompanyProfileSnapshot;
  testIdPrefix: string;
}) {
  return <div data-testid={testIdPrefix} className="rounded-md border border-[#e1e7ec] bg-[#f8fafb] p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[11px] font-bold text-[#344154]">Company profile comparison</h3>
      <span className="text-[9px] text-[#7c8998]">Differences are highlighted</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {[{ key: 'legacy', title: 'Legacy contact profile', profile: legacyProfile }, { key: 'shared', title: 'Shared company profile', profile: sharedProfile }].map(({ key, title, profile }) =>
        <section key={key} className="min-w-0 rounded border border-[#e6ebef] bg-white p-3">
          <h4 className="mb-2 text-[10px] font-semibold text-[#52667b]">{title}</h4>
          <dl className="space-y-2">
            {comparisonFields.map(([field, label]) => {
              const legacyValue = legacyProfile[field] || '';
              const sharedValue = sharedProfile[field] || '';
              const value = profile[field];
              const differs = !!legacyValue && !!sharedValue && legacyValue.trim().toLowerCase() !== sharedValue.trim().toLowerCase();
              return <div key={field} data-testid={`${testIdPrefix}-${key}-${field}`} className={`min-w-0 border-b border-[#edf0f2] pb-1.5 last:border-0 last:pb-0 ${differs ? 'rounded-sm bg-[#fff8f1] px-1.5 py-1' : ''}`}>
                <dt className="text-[9px] font-semibold uppercase tracking-[.08em] text-[#8993a0]">{label}{differs && <span className="ml-1.5 normal-case tracking-normal text-[#a7632f]">Different</span>}</dt>
                <dd className="mt-0.5 break-words text-[10px] leading-4 text-[#344154]">{value || <span className="text-[#a0a8b3]">Not provided</span>}</dd>
              </div>;
            })}
          </dl>
          <div data-testid={`${testIdPrefix}-${key}-companyDescription`} className="mt-2 border-t border-[#edf0f2] pt-2">
            <div className="text-[9px] font-semibold uppercase tracking-[.08em] text-[#8993a0]">Description</div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[10px] leading-4 text-[#344154]">{profile.companyDescription || <span className="text-[#a0a8b3]">Not provided</span>}</p>
          </div>
        </section>,
      )}
    </div>
  </div>;
}

export function CompanyLinkConfirmation({ replacement, pending, onCancel, onConfirm }: {
  replacement: CompanyLinkReplacement | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (replacement: CompanyLinkReplacement) => void;
}) {
  return <AlertDialog open={!!replacement} onOpenChange={open => { if (!open && !pending) onCancel(); }}>
    <AlertDialogContent data-testid="dialog-replace-legacy-company" className="max-h-[90dvh] max-w-[min(820px,calc(100vw-32px))] overflow-y-auto rounded-lg bg-white">
      <AlertDialogHeader>
        <AlertDialogTitle>Replace legacy company details?</AlertDialogTitle>
        <AlertDialogDescription className="text-sm leading-6">
          {replacement?.contactName} has conflicting legacy company details
          {replacement?.legacyCompanyName ? ` for ${replacement.legacyCompanyName}` : ''}.
          {' '}Confirming will permanently remove that legacy company profile and link this contact to
          {' '}{replacement?.companyName}. The contact will use the selected company’s shared details instead.
          {' '}Other contact details and the selected company’s profile will not be replaced.
          {' '}Cancelling makes no changes.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {replacement && <CompanyProfileComparison
        legacyProfile={replacement.legacyProfile}
        sharedProfile={replacement.sharedProfile}
        testIdPrefix="company-link-confirmation-comparison"
      />}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending} data-testid="button-cancel-company-replacement">Cancel</AlertDialogCancel>
        <AlertDialogAction disabled={pending} data-testid="button-confirm-company-replacement"
          className="bg-[#174f99] text-white hover:bg-[#103f7e]"
          onClick={event => { event.preventDefault(); if (replacement) onConfirm(replacement); }}>
          {pending ? 'Linking…' : 'Replace legacy details and link'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}