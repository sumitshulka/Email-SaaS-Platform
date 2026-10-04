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
};

export function isCompanyProfileConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('data' in error)) return false;
  const data = error.data;
  return !!data && typeof data === 'object' && 'code' in data && data.code === 'COMPANY_PROFILE_CONFLICT';
}

export function CompanyLinkConfirmation({ replacement, pending, onCancel, onConfirm }: {
  replacement: CompanyLinkReplacement | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (replacement: CompanyLinkReplacement) => void;
}) {
  return <AlertDialog open={!!replacement} onOpenChange={open => { if (!open && !pending) onCancel(); }}>
    <AlertDialogContent data-testid="dialog-replace-legacy-company" className="max-w-[min(480px,calc(100vw-32px))] rounded-lg bg-white">
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