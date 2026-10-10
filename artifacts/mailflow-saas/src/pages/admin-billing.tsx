import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, CircleAlert, CreditCard, Gift, KeyRound, LoaderCircle, PencilLine, Plus, Save, ShieldCheck, X,
} from 'lucide-react';
import {
  getGetOnlinePaymentSettingsQueryKey, getGetRazorpaySettingsQueryKey, getListAdminAddOnGiftEntitlementsQueryKey, getListAdminSubscriptionPackagesQueryKey, getListAdminUsersQueryKey,
  getListAvailableSubscriptionPackagesQueryKey,
  useCorrectAdminAddOnGift, useCreateSubscriptionPackage, useGetOnlinePaymentSettings, useGetRazorpaySettings, useGiftAdminSubscription, useListAdminAddOnGiftEntitlements, useListAdminSubscriptionPackages,
  useListAdminUsers,
  useSetActiveRazorpayEnvironment, useTestRazorpayConnection,
  useUpdateOnlinePaymentSettings, useUpdateRazorpaySettings, useUpdateSubscriptionPackage,
} from '@workspace/api-client-react';
import type { AdminUser, SubscriptionPackage, SubscriptionPackageInput } from '@workspace/api-client-react';

type GatewayEnvironment = 'sandbox' | 'production';
type GatewayDraft = { keyId: string; keySecret: string; webhookSecret: string };
const gatewayEnvironments: GatewayEnvironment[] = ['sandbox', 'production'];
const gatewayLabels: Record<GatewayEnvironment, string> = {
  sandbox: 'Sandbox / Test',
  production: 'Production / Live',
};

type PackageDraft = {
  packageType: 'primary' | 'addon';
  name: string;
  description: string;
  amount: string;
  free: boolean;
  currency: string;
  periodDays: string;
  contactLimit: string;
  emailAccountLimit: string;
  researchAllowance: string;
  aiEmailAssistAllowance: string;
  additionalMailboxCount: string;
  preferred: boolean;
  active: boolean;
};

const blankDraft: PackageDraft = {
  packageType: 'primary', name: '', description: '', amount: '', free: false, currency: 'INR', periodDays: '30', contactLimit: '5000', emailAccountLimit: '1', researchAllowance: '0', aiEmailAssistAllowance: '0', additionalMailboxCount: '0', preferred: false, active: true,
};

const errorText = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The request could not be completed. Please try again.';

function Panel({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <section data-testid={testId} className={`rounded-lg border border-[#e1e6eb] bg-white ${className}`}>{children}</section>;
}

function Field({
  label, value, onChange, testId, type = 'text', placeholder, hint, step, min, max, disabled = false,
}: {
  label: string; value: string; onChange: (value: string) => void; testId: string;
  type?: string; placeholder?: string; hint?: string; step?: string;
  min?: number; max?: number; disabled?: boolean;
}) {
  return <label className="block min-w-0 space-y-1.5">
    <span className="text-[12px] font-semibold text-[#35445a]">{label}</span>
    <input data-testid={testId} type={type} step={step} min={min} max={max} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}
      placeholder={placeholder} className={`h-10 w-full rounded-md border border-[#d8dfe6] px-3 text-[13px] outline-none transition focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8] ${disabled ? 'cursor-not-allowed bg-[#f1f4f6] text-[#87919b]' : 'bg-[#fcfdfe] text-[#1b2b3d]'}`}/>
    {hint && <span className="block text-[11px] text-[#85909c]">{hint}</span>}
  </label>;
}

function formatMinor(amountMinor: number, currency: string) {
  const digits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amountMinor / (10 ** digits));
}

function giftEligibilityLabel(user: AdminUser) {
  switch (user.addOnGiftEligibility) {
    case 'eligible': return 'Eligible for add-on gifts';
    case 'free': return 'Ineligible · Free Primary plan';
    case 'expired': return 'Ineligible · Primary plan expired';
    case 'inactive': return 'Ineligible · Primary plan not active';
    case 'missing': return 'Ineligible · No Primary plan';
  }
}

function primaryPlanSummary(user: AdminUser) {
  if (!user.primaryPackageName) return 'No Primary plan on record';
  const price = user.primaryPackageAmountMinor === 0
    ? 'Free'
    : user.primaryPackageAmountMinor !== null && user.primaryPackageCurrency
      ? formatMinor(user.primaryPackageAmountMinor, user.primaryPackageCurrency)
      : 'Price unavailable';
  const termEnd = user.primaryEndsAt
    ? ` · term ends ${new Date(user.primaryEndsAt).toLocaleDateString()}`
    : '';
  return `Primary: ${user.primaryPackageName} · ${price}${termEnd}`;
}

function inputMinor(amount: string, currency: string) {
  try {
    const digits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const amountNumber = Number(amount);
    return Number.isFinite(amountNumber) ? Math.round(amountNumber * (10 ** digits)) : 0;
  } catch {
    return 0;
  }
}

function isIntegerWithin(value: string, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max;
}

export default function AdminBillingPage({ page = 'billing' }: { page?: 'billing' | 'packages' } = {}) {
  const isPackagesPage = page === 'packages';
  const isBillingPage = !isPackagesPage;
  const queryClient = useQueryClient();
  const onlinePaymentsQuery = useGetOnlinePaymentSettings({ query: {
    enabled: isBillingPage,
    queryKey: getGetOnlinePaymentSettingsQueryKey(),
  } });
  const settingsQuery = useGetRazorpaySettings({ query: {
    enabled: isBillingPage,
    queryKey: getGetRazorpaySettingsQueryKey(),
  } });
  const packagesQuery = useListAdminSubscriptionPackages({ query: {
    enabled: isPackagesPage,
    queryKey: getListAdminSubscriptionPackagesQueryKey(),
  } });
  const updateOnlinePayments = useUpdateOnlinePaymentSettings();
  const saveSettings = useUpdateRazorpaySettings();
  const testConnection = useTestRazorpayConnection();
  const activateEnvironment = useSetActiveRazorpayEnvironment();
  const createPackage = useCreateSubscriptionPackage();
  const updatePackage = useUpdateSubscriptionPackage();
  const giftSubscription = useGiftAdminSubscription();
  const correctAddOnGift = useCorrectAdminAddOnGift();
  const settings = settingsQuery.data;
  const onlinePaymentsEnabled = onlinePaymentsQuery.data?.enabled ?? true;
  const onlinePaymentsUpdatedAt = onlinePaymentsQuery.data?.updatedAt ?? null;
  const packages = packagesQuery.data?.packages ?? [];
  const sendingLimits = packagesQuery.data?.sendingLimits;
  const [giftSearch, setGiftSearch] = useState('');
  const [giftRecipient, setGiftRecipient] = useState<AdminUser | null>(null);
  const [giftPackageId, setGiftPackageId] = useState('');
  const selectedGiftPackage = packages.find(pkg => pkg.id === giftPackageId);
  const giftIsAddon = selectedGiftPackage?.packageType === 'addon';
  const [giftConfirmed, setGiftConfirmed] = useState(false);
  const [giftNotice, setGiftNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const giftUserSearchParams = {
    search: giftSearch.trim(),
    status: 'all',
    page: 1,
    pageSize: 8,
  } as const;
  const giftUsersQuery = useListAdminUsers(giftUserSearchParams, {
    query: {
      enabled: giftSearch.trim().length >= 2 && !giftRecipient,
      queryKey: getListAdminUsersQueryKey(giftUserSearchParams),
    },
  });
  const [correctionSearch, setCorrectionSearch] = useState('');
  const [correctionRecipient, setCorrectionRecipient] = useState<AdminUser | null>(null);
  const [correctionReviewId, setCorrectionReviewId] = useState<string | null>(null);
  const [correctionNotice, setCorrectionNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const correctionUserSearchParams = {
    search: correctionSearch.trim(),
    status: 'all',
    page: 1,
    pageSize: 8,
  } as const;
  const correctionUsersQuery = useListAdminUsers(correctionUserSearchParams, {
    query: {
      enabled: isPackagesPage && correctionSearch.trim().length >= 2 && !correctionRecipient,
      queryKey: getListAdminUsersQueryKey(correctionUserSearchParams),
    },
  });
  const correctionGiftsQuery = useListAdminAddOnGiftEntitlements(correctionRecipient?.id ?? '', {
    query: {
      enabled: isPackagesPage && Boolean(correctionRecipient),
      queryKey: getListAdminAddOnGiftEntitlementsQueryKey(correctionRecipient?.id ?? ''),
    },
  });
  const [gatewayDrafts, setGatewayDrafts] = useState<Record<GatewayEnvironment, GatewayDraft>>({
    sandbox: { keyId: '', keySecret: '', webhookSecret: '' },
    production: { keyId: '', keySecret: '', webhookSecret: '' },
  });
  const [draft, setDraft] = useState<PackageDraft>(blankDraft);
  const [editing, setEditing] = useState<SubscriptionPackage | null>(null);
  const [packageFormOpen, setPackageFormOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const hasOtherFreePackage = draft.packageType === 'primary' && packages.some(pkg => pkg.packageType === 'primary' && pkg.amountMinor === 0 && pkg.id !== editing?.id);
  const busy = createPackage.isPending || updatePackage.isPending;
  const packageFormValid =
    draft.name.trim().length >= 2 &&
    /^[A-Z]{3}$/.test(draft.currency) &&
    (draft.free || inputMinor(draft.amount, draft.currency) >= 1) &&
    isIntegerWithin(draft.researchAllowance, 0, 10000) &&
    (draft.packageType === 'primary'
      ? isIntegerWithin(draft.periodDays, 1, 3660) &&
        isIntegerWithin(draft.contactLimit, 0, 10000000) &&
        isIntegerWithin(draft.emailAccountLimit, 0, 100)
      : isIntegerWithin(draft.aiEmailAssistAllowance, 0, 10000) &&
        isIntegerWithin(draft.additionalMailboxCount, 0, 100) &&
        (Number(draft.researchAllowance) > 0 ||
          Number(draft.aiEmailAssistAllowance) > 0 ||
          Number(draft.additionalMailboxCount) > 0));

  const announce = (text: string) => setNotice({ text });
  const refreshPackages = () => {
    void queryClient.invalidateQueries({ queryKey: getListAdminSubscriptionPackagesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAvailableSubscriptionPackagesQueryKey() });
  };
  const openEdit = (pkg: SubscriptionPackage) => {
    setEditing(pkg);
    setPackageFormOpen(true);
    setDraft({
      packageType: pkg.packageType,
      name: pkg.name, description: pkg.description,
      amount: pkg.amountMinor === 0 ? '0' : (pkg.amountMinor / (10 ** (new Intl.NumberFormat(undefined, { style: 'currency', currency: pkg.currency }).resolvedOptions().maximumFractionDigits ?? 2))).toString(),
      free: pkg.amountMinor === 0,
      currency: pkg.currency, periodDays: String(pkg.periodDays),
      contactLimit: String(pkg.contactLimit), emailAccountLimit: String(pkg.emailAccountLimit),
      researchAllowance: String(pkg.researchAllowance),
      aiEmailAssistAllowance: String(pkg.aiEmailAssistAllowance),
      additionalMailboxCount: String(pkg.additionalMailboxCount),
      preferred: pkg.preferred, active: pkg.active,
    });
    setNotice(null);
  };
  const resetPackageForm = () => { setEditing(null); setDraft(blankDraft); setPackageFormOpen(false); };
  const submitPackage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currency = draft.currency.trim().toUpperCase();
    const isAddon = draft.packageType === 'addon';
    const payload: SubscriptionPackageInput = {
      packageType: draft.packageType,
      name: draft.name.trim(), description: draft.description.trim(),
      amountMinor: draft.free ? 0 : inputMinor(draft.amount, currency), currency,
      periodDays: isAddon ? 0 : Number(draft.periodDays),
      contactLimit: isAddon ? 0 : Number(draft.contactLimit),
      emailAccountLimit: isAddon ? 0 : Number(draft.emailAccountLimit),
      researchAllowance: Number(draft.researchAllowance),
      aiEmailAssistAllowance: isAddon ? Number(draft.aiEmailAssistAllowance) : 0,
      additionalMailboxCount: isAddon ? Number(draft.additionalMailboxCount) : 0,
      preferred: !isAddon && draft.preferred, active: draft.active,
    };
    const isFree = draft.free;
    if (editing) {
      const { packageType: _immutablePackageType, ...updatePayload } = payload;
      updatePackage.mutate({ packageId: editing.id, data: updatePayload }, {
        onSuccess: () => { void refreshPackages(); announce(isFree ? 'Free package saved. It will not use Razorpay Checkout.' : 'Package changes saved.'); resetPackageForm(); },
      });
    } else {
      createPackage.mutate({ data: payload }, {
        onSuccess: () => { void refreshPackages(); announce(isFree ? 'Free package created. It will not use Razorpay Checkout.' : 'Subscription package created.'); resetPackageForm(); },
      });
    }
  };

  const submitGift = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!giftRecipient || !giftPackageId || !giftConfirmed) return;
    const recipient = giftRecipient;
    giftSubscription.mutate({
      data: { userId: recipient.id, packageId: giftPackageId },
    }, {
      onSuccess: result => {
        void queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        if (result.kind === 'primary') {
          const startsOn = new Date(result.subscription.startsAt).toLocaleDateString();
          const endsOn = new Date(result.subscription.endsAt).toLocaleDateString();
          setGiftNotice({
            text: `Primary subscription granted to ${recipient.email}. Term: ${startsOn}–${endsOn}.`,
          });
        } else {
          const allowances = [
            result.researchAllowance > 0 ? `${result.researchAllowance} company research runs` : null,
            result.aiEmailAssistAllowance > 0 ? `${result.aiEmailAssistAllowance} AI email drafts` : null,
            result.additionalMailboxCount > 0 ? `${result.additionalMailboxCount} SMTP mailbox slots` : null,
          ].filter(Boolean);
          setGiftNotice({
            text: `Add-on ${result.packageName} granted to ${recipient.email}${allowances.length ? `: ${allowances.join(', ')}.` : '.'}`,
          });
        }
        setGiftRecipient(null);
        setGiftSearch('');
        setGiftPackageId('');
        setGiftConfirmed(false);
      },
      onError: error => setGiftNotice({ text: errorText(error), bad: true }),
    });
  };

  const reviewCorrection = (entitlementId: string) => {
    setCorrectionReviewId(current => current === entitlementId ? null : entitlementId);
    setCorrectionNotice(null);
  };

  const submitCorrection = (entitlementId: string) => {
    if (!correctionRecipient) return;
    correctAddOnGift.mutate({
      entitlementId,
      data: { userId: correctionRecipient.id },
    }, {
      onSuccess: result => {
        void queryClient.invalidateQueries({
          queryKey: getListAdminAddOnGiftEntitlementsQueryKey(correctionRecipient.id),
        });
        setCorrectionReviewId(null);
        setCorrectionNotice({
          text: `Corrected ${result.packageName}: removed ${result.removed.researchAllowance} research credits, ${result.removed.aiEmailAssistAllowance} AI-assist credits, and ${result.removed.additionalMailboxCount} unused mailbox slots. Usage and configured mailbox access were retained.`,
        });
      },
      onError: error => {
        setCorrectionReviewId(null);
        setCorrectionNotice({ text: errorText(error), bad: true });
        void queryClient.invalidateQueries({
          queryKey: getListAdminAddOnGiftEntitlementsQueryKey(correctionRecipient.id),
        });
      },
    });
  };

  const updateGatewayDraft = (
    environment: GatewayEnvironment,
    field: keyof GatewayDraft,
    value: string,
  ) => setGatewayDrafts(current => ({
    ...current,
    [environment]: { ...current[environment], [field]: value },
  }));

  const submitGateway = (event: FormEvent<HTMLFormElement>, environment: GatewayEnvironment) => {
    event.preventDefault();
    setNotice(null);
    const draft = gatewayDrafts[environment];
    const saved = settings?.[environment];
    saveSettings.mutate({
      data: {
        environment,
        keyId: draft.keyId.trim() || saved?.keyId || '',
        ...(draft.keySecret ? { keySecret: draft.keySecret } : {}),
        ...(draft.webhookSecret ? { webhookSecret: draft.webhookSecret } : {}),
      },
    }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetRazorpaySettingsQueryKey() });
        setGatewayDrafts(current => ({
          ...current,
          [environment]: { ...current[environment], keySecret: '', webhookSecret: '' },
        }));
        announce(`${gatewayLabels[environment]} credentials saved securely.`);
      },
    });
  };

  const setOnlinePaymentsEnabled = (enabled: boolean) => {
    setNotice(null);
    updateOnlinePayments.mutate({ data: { enabled } }, {
      onSuccess: result => {
        queryClient.setQueryData(getGetOnlinePaymentSettingsQueryKey(), result);
        announce(result.enabled
          ? 'Online payments are enabled for new paid checkouts.'
          : 'New paid checkouts are disabled. Free plan activation remains available.');
      },
      onError: error => setNotice({ text: errorText(error), bad: true }),
    });
  };

  if ((isBillingPage && (onlinePaymentsQuery.isLoading || settingsQuery.isLoading)) || (isPackagesPage && packagesQuery.isLoading)) {
    return <div className="space-y-5" aria-label={`Loading ${isPackagesPage ? 'package' : 'billing'} administration`} data-testid={isPackagesPage ? 'loading-admin-packages' : 'loading-admin-billing'}>
      <div className="h-8 w-60 animate-pulse rounded bg-[#e9eef2]"/>
      <div className="h-56 animate-pulse rounded-lg bg-[#edf1f4]"/>
      <div className="h-72 animate-pulse rounded-lg bg-[#edf1f4]"/>
    </div>;
  }
  if ((isBillingPage && (onlinePaymentsQuery.isError || settingsQuery.isError)) || (isPackagesPage && packagesQuery.isError)) {
    return <Panel className="flex flex-wrap items-center justify-between gap-4 p-6" testId={isPackagesPage ? 'error-admin-packages' : 'error-admin-billing'}>
      <div className="flex items-center gap-3"><CircleAlert className="h-5 w-5 text-[#bd692d]"/><div><h1 className="font-semibold text-[#1b2b3d]">{isPackagesPage ? 'Package data is unavailable' : 'Billing data is unavailable'}</h1><p className="mt-1 text-sm text-[#728092]">No changes were made. Retry loading {isPackagesPage ? 'subscription packages' : 'billing controls'}.</p></div></div>
      <button data-testid={isPackagesPage ? 'button-retry-admin-packages' : 'button-retry-admin-billing'} onClick={() => {
        if (isPackagesPage) void packagesQuery.refetch();
        else { void onlinePaymentsQuery.refetch(); void settingsQuery.refetch(); }
      }} className="rounded-md border border-[#d6dfe7] px-4 py-2 text-sm font-semibold text-[#294d70]">Retry</button>
    </Panel>;
  }

  return <div className="fade-in space-y-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#75869a]">{isPackagesPage ? 'PLATFORM / PACKAGES' : 'PLATFORM / BILLING'}</div>
        <h1 className="display text-[32px] font-bold leading-tight text-[#192a3d]">{isPackagesPage ? 'Subscription packages' : 'Billing & PG setup'}</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#6c7b8b]">{isPackagesPage ? 'Create and manage the plans customers can purchase, and grant packages to user accounts.' : 'Configure Razorpay and control whether customers can start paid checkouts.'}</p>
      </div>
      {isBillingPage && <div className="flex items-center gap-2 rounded-md border border-[#dfe7ed] bg-[#f6f9fb] px-3 py-2 text-[11px] text-[#53677b]"><ShieldCheck className="h-4 w-4 text-[#3374a9]"/>Secrets stay server-side</div>}
    </header>

    {isPackagesPage && <Panel className="overflow-hidden" testId="gift-subscription-panel">
      <div className="flex items-center gap-3 border-b border-[#e9edf1] px-5 py-4 md:px-6">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-[#edf4fa] text-[#265e91]"><Gift className="h-[17px] w-[17px]"/></span>
        <div>
          <h2 className="text-[15px] font-bold text-[#1d2d40]">Gift a subscription or add-on</h2>
          <p className="mt-0.5 text-[11px] text-[#788696]">Grant a primary package term or add-on allowances without collecting or recording a payment.</p>
        </div>
      </div>
      <form onSubmit={submitGift} className="space-y-4 p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="gift-account-search" className="block text-[12px] font-semibold text-[#35445a]">Tenant account</label>
            {giftRecipient ? <div className="flex min-h-10 items-start justify-between gap-3 rounded-md border border-[#d8dfe6] bg-[#f8fafb] px-3 py-2" data-testid="selected-gift-recipient">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-[#23364b]">{giftRecipient.firstName} {giftRecipient.lastName}</div>
                <div className="truncate text-[11px] text-[#748292]">{giftRecipient.email}</div>
                <div className="mt-1 text-[10px] text-[#627387]">{primaryPlanSummary(giftRecipient)}</div>
                <div className={`mt-1 text-[10px] font-semibold ${giftRecipient.addOnGiftEligibility === 'eligible' ? 'text-[#397451]' : 'text-[#a84926]'}`} data-testid="selected-gift-recipient-eligibility">{giftEligibilityLabel(giftRecipient)}</div>
              </div>
              <button type="button" data-testid="button-clear-gift-recipient" aria-label="Choose a different account" onClick={() => { setGiftRecipient(null); setGiftConfirmed(false); setGiftNotice(null); }} className="grid h-8 w-8 shrink-0 place-items-center rounded text-[#718093] hover:bg-white hover:text-[#294d70]"><X className="h-4 w-4"/></button>
            </div> : <>
              <input
                id="gift-account-search"
                data-testid="input-gift-account-search"
                type="search"
                value={giftSearch}
                onChange={event => { setGiftSearch(event.target.value); setGiftConfirmed(false); setGiftNotice(null); }}
                placeholder="Search by name, email, or username"
                autoComplete="off"
                className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] text-[#1b2b3d] outline-none transition focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"
              />
              {giftSearch.trim().length >= 2 && <div className="max-h-52 overflow-y-auto rounded-md border border-[#e1e6eb] bg-white" data-testid="gift-account-results">
                {giftUsersQuery.isLoading || giftUsersQuery.isFetching ? <p className="px-3 py-2.5 text-[11px] text-[#788696]">Searching accounts…</p>
                  : giftUsersQuery.isError ? <p role="alert" className="px-3 py-2.5 text-[11px] text-[#a84926]">{errorText(giftUsersQuery.error)}</p>
                    : giftUsersQuery.data?.items.length ? giftUsersQuery.data.items.map(user => <button
                      type="button"
                      key={user.id}
                      data-testid={`button-gift-account-${user.id}`}
                      onClick={() => { setGiftRecipient(user); setGiftSearch(''); setGiftConfirmed(false); setGiftNotice(null); }}
                      className="block w-full border-b border-[#edf0f2] px-3 py-2.5 text-left last:border-0 hover:bg-[#f7f9fa]"
                    >
                      <span className="block text-[12px] font-semibold text-[#26374a]">{user.firstName} {user.lastName}</span>
                      <span className="mt-0.5 block text-[11px] text-[#788696]">{user.email}</span>
                      <span className="mt-1 block text-[10px] text-[#627387]">{primaryPlanSummary(user)}</span>
                      <span className={`mt-1 block text-[10px] font-semibold ${user.addOnGiftEligibility === 'eligible' ? 'text-[#397451]' : 'text-[#a84926]'}`} data-testid={`gift-eligibility-${user.id}`}>{giftEligibilityLabel(user)}</span>
                    </button>) : <p className="px-3 py-2.5 text-[11px] text-[#788696]">No matching tenant accounts.</p>}
              </div>}
              <p className="text-[10px] text-[#85909c]">Search includes active, disabled, and pending tenant accounts.</p>
            </>}
          </div>
          <label className="block min-w-0 space-y-1.5">
            <span className="text-[12px] font-semibold text-[#35445a]">Subscription package</span>
            <select
              data-testid="select-gift-package"
              value={giftPackageId}
              onChange={event => { setGiftPackageId(event.target.value); setGiftConfirmed(false); setGiftNotice(null); }}
              className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] text-[#1b2b3d] outline-none transition focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"
            >
              <option value="">Choose a package</option>
              {packages.map(pkg => <option key={pkg.id} value={pkg.id}>
                {pkg.packageType === 'addon' ? 'Add-on' : 'Primary'} · {pkg.name} · {pkg.packageType === 'addon' ? 'allowances' : `${pkg.periodDays} days`} · {formatMinor(pkg.amountMinor, pkg.currency)}{pkg.active ? '' : ' · hidden'}
              </option>)}
            </select>
            <span className="block text-[10px] leading-4 text-[#85909c]">
              {giftIsAddon
                ? 'Add-on gifts require an active paid-priced Primary plan. A previously gifted paid plan qualifies; free Primary plans do not.'
                : 'Hidden Primary packages can also be gifted. The configured term and contact limit apply; a new term starts after any current active term.'}
            </span>
          </label>
        </div>
        {giftRecipient && giftIsAddon && giftRecipient.addOnGiftEligibility !== 'eligible' && <p data-testid="status-gift-addon-ineligible" role="status" className="rounded-md border border-[#efd8c7] bg-[#fff8f2] px-3 py-2.5 text-[11px] leading-5 text-[#985120]">
          This account is not currently eligible for an add-on gift. {giftEligibilityLabel(giftRecipient)}. The server checks eligibility again when a gift is submitted.
        </p>}
        {giftRecipient && giftPackageId && (!giftIsAddon || giftRecipient.addOnGiftEligibility === 'eligible') && <label className="flex cursor-pointer items-start gap-2 rounded-md border border-[#e1e6eb] bg-[#f8fafb] p-3 text-[11px] leading-5 text-[#53677b]">
          <input data-testid="checkbox-confirm-gift" type="checkbox" checked={giftConfirmed} onChange={event => setGiftConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#174f99]"/>
          <span>
            {giftIsAddon
              ? `I confirm adding this add-on's allowances to ${giftRecipient.email}. They pause if paid-Primary access ends and resume when paid access returns.`
              : `I confirm granting this package to ${giftRecipient.email}. Any current subscription term will finish first.`}
          </span>
        </label>}
        {giftNotice && <p data-testid="status-gift-subscription" role={giftNotice.bad ? 'alert' : 'status'} className={`rounded-md border px-3 py-2.5 text-[11px] ${giftNotice.bad ? 'border-[#efd8c7] bg-[#fff8f2] text-[#985120]' : 'border-[#d8e9df] bg-[#f2f8f4] text-[#3e7252]'}`}>{giftNotice.text}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] pt-4">
          <p className="max-w-xl text-[10px] leading-5 text-[#788696]">Primary gifts grant a package term; add-on gifts add the package's allowances to the user's balance. Gifts do not create a payment or revenue entry.</p>
          <button data-testid="button-grant-gift-subscription" type="submit" disabled={!giftRecipient || !giftPackageId || !giftConfirmed || giftSubscription.isPending || (giftIsAddon && giftRecipient?.addOnGiftEligibility !== 'eligible')} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white hover:bg-[#103f7e] disabled:cursor-not-allowed disabled:opacity-50">
            {giftSubscription.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Gift className="h-4 w-4"/>}
            {giftSubscription.isPending ? 'Granting subscription…' : 'Grant subscription'}
          </button>
        </div>
      </form>
    </Panel>}

    {isPackagesPage && <Panel className="overflow-hidden" testId="correct-add-on-gift-panel">
      <div className="flex items-center gap-3 border-b border-[#e9edf1] px-5 py-4 md:px-6">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-[#fff3e8] text-[#9b5a25]"><PencilLine className="h-[17px] w-[17px]"/></span>
        <div>
          <h2 className="text-[15px] font-bold text-[#1d2d40]">Correct an add-on gift</h2>
          <p className="mt-0.5 text-[11px] text-[#788696]">Find the recipient and remove only unused allowances from a specific admin gift. Payment history is not changed.</p>
        </div>
      </div>
      <div className="space-y-4 p-5 md:p-6">
        <div className="max-w-xl space-y-1.5">
          <label htmlFor="correction-account-search" className="block text-[12px] font-semibold text-[#35445a]">Tenant account</label>
          {correctionRecipient ? <div className="flex min-h-10 items-start justify-between gap-3 rounded-md border border-[#d8dfe6] bg-[#f8fafb] px-3 py-2" data-testid="selected-correction-recipient">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-[#23364b]">{correctionRecipient.firstName} {correctionRecipient.lastName}</div>
              <div className="truncate text-[11px] text-[#748292]">{correctionRecipient.email}</div>
            </div>
            <button type="button" data-testid="button-clear-correction-recipient" aria-label="Choose a different account" onClick={() => { setCorrectionRecipient(null); setCorrectionReviewId(null); setCorrectionNotice(null); }} className="grid h-8 w-8 shrink-0 place-items-center rounded text-[#718093] hover:bg-white hover:text-[#294d70]"><X className="h-4 w-4"/></button>
          </div> : <>
            <input
              id="correction-account-search"
              data-testid="input-correction-account-search"
              type="search"
              value={correctionSearch}
              onChange={event => { setCorrectionSearch(event.target.value); setCorrectionNotice(null); }}
              placeholder="Search by name, email, or username"
              autoComplete="off"
              className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] text-[#1b2b3d] outline-none transition focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"
            />
            {correctionSearch.trim().length >= 2 && <div className="max-h-52 overflow-y-auto rounded-md border border-[#e1e6eb] bg-white" data-testid="correction-account-results">
              {correctionUsersQuery.isLoading || correctionUsersQuery.isFetching ? <p className="px-3 py-2.5 text-[11px] text-[#788696]">Searching accounts…</p>
                : correctionUsersQuery.isError ? <p role="alert" className="px-3 py-2.5 text-[11px] text-[#a84926]">{errorText(correctionUsersQuery.error)}</p>
                  : correctionUsersQuery.data?.items.length ? correctionUsersQuery.data.items.map(user => <button
                    type="button"
                    key={user.id}
                    data-testid={`button-correction-account-${user.id}`}
                    onClick={() => { setCorrectionRecipient(user); setCorrectionSearch(''); setCorrectionReviewId(null); setCorrectionNotice(null); }}
                    className="block w-full border-b border-[#edf0f2] px-3 py-2.5 text-left last:border-0 hover:bg-[#f7f9fa]"
                  >
                    <span className="block text-[12px] font-semibold text-[#26374a]">{user.firstName} {user.lastName}</span>
                    <span className="mt-0.5 block text-[11px] text-[#788696]">{user.email}</span>
                  </button>) : <p className="px-3 py-2.5 text-[11px] text-[#788696]">No matching tenant accounts.</p>}
            </div>}
            <p className="text-[10px] text-[#85909c]">Search includes active, disabled, and pending tenant accounts.</p>
          </>}
        </div>

        {correctionRecipient && <div className="space-y-3" data-testid="admin-addon-gift-results">
          {correctionGiftsQuery.isLoading || correctionGiftsQuery.isFetching
            ? <p className="rounded-md border border-[#e1e6eb] bg-[#f8fafb] px-3 py-3 text-[11px] text-[#788696]">Loading add-on gifts…</p>
            : correctionGiftsQuery.isError
              ? <p role="alert" className="rounded-md border border-[#efd8c7] bg-[#fff8f2] px-3 py-3 text-[11px] text-[#a84926]">{errorText(correctionGiftsQuery.error)}</p>
              : correctionGiftsQuery.data?.length
                ? correctionGiftsQuery.data.map(gift => {
                  const removable = gift.removable.researchAllowance > 0 ||
                    gift.removable.aiEmailAssistAllowance > 0 ||
                    gift.removable.additionalMailboxCount > 0;
                  const reviewing = correctionReviewId === gift.entitlementId;
                  return <article key={gift.entitlementId} data-testid={`admin-addon-gift-${gift.entitlementId}`} className="rounded-md border border-[#e1e6eb] bg-[#fcfdfe] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[12px] font-semibold text-[#26374a]">{gift.packageName}</h3>
                        <p className="mt-0.5 text-[10px] text-[#788696]">Gifted {new Date(gift.createdAt).toLocaleString()}</p>
                        <p className="mt-2 text-[11px] leading-5 text-[#53677b]">
                          Research: {gift.researchUsed} used / {gift.researchAllowance} granted · AI assist: {gift.aiEmailAssistUsed} used or reserved / {gift.aiEmailAssistAllowance} granted · Mailbox slots: {gift.additionalMailboxCount} granted
                        </p>
                        <p className="mt-1 text-[10px] text-[#788696]">
                          Removable now: {gift.removable.researchAllowance} research · {gift.removable.aiEmailAssistAllowance} AI assist · {gift.removable.additionalMailboxCount} mailbox slots
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid={`button-review-correction-${gift.entitlementId}`}
                        disabled={!removable || correctAddOnGift.isPending}
                        onClick={() => reviewCorrection(gift.entitlementId)}
                        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#d8dfe6] px-3 text-[11px] font-semibold text-[#294d70] hover:bg-[#f1f6fa] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {reviewing ? 'Hide review' : removable ? 'Review correction' : 'No unused allowance'}
                      </button>
                    </div>
                    {reviewing && <div className="mt-3 rounded-md border border-[#efd8c7] bg-[#fff8f2] p-3">
                      <p className="text-[11px] leading-5 text-[#80501f]">
                        This will remove {gift.removable.researchAllowance} unused research credits, {gift.removable.aiEmailAssistAllowance} unused AI-assist credits, and {gift.removable.additionalMailboxCount} mailbox slots not needed by currently configured mailboxes. Consumed or reserved usage is preserved. The server rechecks balances before saving.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-testid={`button-confirm-correction-${gift.entitlementId}`}
                          disabled={correctAddOnGift.isPending}
                          onClick={() => submitCorrection(gift.entitlementId)}
                          className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#9b4a28] px-3 text-[11px] font-semibold text-white hover:bg-[#813c20] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {correctAddOnGift.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin"/>}
                          Confirm correction
                        </button>
                        <button type="button" onClick={() => setCorrectionReviewId(null)} className="min-h-9 rounded-md border border-[#e3d5c8] px-3 text-[11px] font-semibold text-[#80501f]">Cancel</button>
                      </div>
                    </div>}
                  </article>;
                })
                : <p className="rounded-md border border-[#e1e6eb] bg-[#f8fafb] px-3 py-3 text-[11px] text-[#788696]">No admin-gifted add-ons were found for this account.</p>}
        </div>}
        {correctionNotice && <p data-testid="status-addon-gift-correction" role={correctionNotice.bad ? 'alert' : 'status'} className={`rounded-md border px-3 py-2.5 text-[11px] leading-5 ${correctionNotice.bad ? 'border-[#efd8c7] bg-[#fff8f2] text-[#a84926]' : 'border-[#d8e9df] bg-[#f2f8f4] text-[#3e7252]'}`}>{correctionNotice.text}</p>}
        <p className="border-t border-[#edf0f2] pt-3 text-[10px] leading-5 text-[#788696]">Each correction is recorded in the admin audit log with its package and allowance changes. Payments and revenue records are never edited.</p>
      </div>
    </Panel>}

    {isBillingPage && <>
    <Panel className="overflow-hidden" testId="online-payment-settings-panel">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e9edf1] px-5 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-[#edf4fa] text-[#265e91]"><CreditCard className="h-[17px] w-[17px]"/></span>
          <div>
            <h2 className="text-[15px] font-bold text-[#1d2d40]">Online payment availability</h2>
            <p className="mt-0.5 text-[11px] text-[#788696]">Control whether customers can start paid subscription checkouts.</p>
          </div>
        </div>
        <span data-testid="status-online-payment-setting" className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${onlinePaymentsEnabled ? 'bg-[#eaf5ef] text-[#347452]' : 'bg-[#fff3e8] text-[#a85c21]'}`}>
          {onlinePaymentsEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div className="space-y-3 p-5 md:p-6">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[#dfe7ed] bg-[#f8fafb] p-4">
          <input
            data-testid="checkbox-enable-online-payments"
            type="checkbox"
            checked={onlinePaymentsEnabled}
            disabled={updateOnlinePayments.isPending}
            onChange={event => setOnlinePaymentsEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#245b9b] disabled:cursor-not-allowed"
          />
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-[#2b3d50]">Enable Online Payments</span>
            <span className="mt-1 block text-[11px] leading-5 text-[#687b8d]">
              When off, users cannot create new paid checkouts and will see the superadmin contact email on their Plans page. Free plan activation and confirmation of existing payments continue to work.
            </span>
          </span>
          {updateOnlinePayments.isPending && <LoaderCircle aria-label="Saving online payment setting" className="ml-auto mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#456d91]"/>}
        </label>
        {onlinePaymentsUpdatedAt && <p data-testid="text-online-payment-updated" className="text-[10px] text-[#8994a0]">Availability last changed {new Date(onlinePaymentsUpdatedAt).toLocaleString()}</p>}
      </div>
    </Panel>

    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e9edf1] px-5 py-4 md:px-6">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-md bg-[#edf4fa] text-[#265e91]"><KeyRound className="h-[17px] w-[17px]"/></span><div><h2 className="text-[15px] font-bold text-[#1d2d40]">Razorpay gateway</h2><p className="mt-0.5 text-[11px] text-[#788696]">Store separate test and live credentials; select one mode for new orders.</p></div></div>
        <span data-testid="status-gateway-config" className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${settings?.activeEnvironment ? 'bg-[#eaf5ef] text-[#347452]' : 'bg-[#fff3e8] text-[#a85c21]'}`}>{settings?.activeEnvironment ? `Active · ${gatewayLabels[settings.activeEnvironment]}` : 'No active environment'}</span>
      </div>
      <div className="border-b border-[#e9edf1] bg-[#f8fafb] px-5 py-3 text-[11px] leading-5 text-[#687b8d] md:px-6">
        Only the active environment is used for new payments. Existing orders continue to use the environment and credentials saved when they were created.
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2 md:p-6">
        {gatewayEnvironments.map(environment => {
          const saved = settings?.[environment];
          const draft = gatewayDrafts[environment];
          const active = settings?.activeEnvironment === environment;
          const complete = Boolean(saved?.configured);
          return <section key={environment} data-testid={`section-razorpay-${environment}`} className="min-w-0 rounded-lg border border-[#e1e6eb] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9edf1] px-4 py-3.5">
              <div><h3 className="text-[13px] font-bold text-[#1d2d40]">{gatewayLabels[environment]}</h3><p className="mt-1 text-[10px] text-[#788696]">{environment === 'sandbox' ? 'For test transactions' : 'For customer payments'}</p></div>
              <span data-testid={`status-razorpay-${environment}`} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${complete ? 'bg-[#eaf5ef] text-[#347452]' : 'bg-[#fff3e8] text-[#a85c21]'}`}>{complete ? 'Ready' : 'Setup required'}</span>
            </div>
            <form onSubmit={event => submitGateway(event, environment)} className="space-y-4 p-4">
              <Field label="Public key ID" value={draft.keyId || saved?.keyId || ''} onChange={value => updateGatewayDraft(environment, 'keyId', value)} testId={`input-razorpay-${environment}-key-id`} placeholder={environment === 'sandbox' ? 'rzp_test_…' : 'rzp_live_…'} hint="Used by Razorpay Standard Checkout."/>
              <Field label="Key secret" value={draft.keySecret} onChange={value => updateGatewayDraft(environment, 'keySecret', value)} type="password" testId={`input-razorpay-${environment}-key-secret`} placeholder={saved?.keySecretConfigured ? 'Saved — enter only to rotate' : 'Enter key secret'} hint={saved?.keySecretConfigured ? 'Leave blank to keep the saved secret.' : 'Required for server-side order creation.'}/>
              <Field label="Webhook secret" value={draft.webhookSecret} onChange={value => updateGatewayDraft(environment, 'webhookSecret', value)} type="password" testId={`input-razorpay-${environment}-webhook-secret`} placeholder={saved?.webhookSecretConfigured ? 'Saved — enter only to rotate' : 'Enter webhook secret'} hint={saved?.webhookSecretConfigured ? 'Leave blank to keep the saved secret.' : 'Required for signed payment notifications.'}/>
              <div className="flex flex-wrap gap-2 pt-1">
                <button data-testid={`button-save-razorpay-${environment}`} type="submit" disabled={saveSettings.isPending || !(draft.keyId.trim() || saved?.keyId)} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#174f99] px-3.5 text-[11px] font-semibold text-white transition hover:bg-[#103f7e] disabled:opacity-55">
                  {saveSettings.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <Save className="h-3.5 w-3.5"/>}{saveSettings.isPending ? 'Saving' : 'Save credentials'}
                </button>
                <button data-testid={`button-test-razorpay-${environment}`} type="button" onClick={() => { setNotice(null); testConnection.mutate({ data: { environment } }, { onSuccess: result => setNotice({ text: `${gatewayLabels[environment]}: ${result.message}`, bad: !result.success }), onError: error => setNotice({ text: errorText(error), bad: true }) }); }} disabled={testConnection.isPending || !complete} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d8e0e7] px-3.5 text-[11px] font-semibold text-[#344c63] hover:bg-[#f7f9fa] disabled:opacity-50">
                  {testConnection.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <Activity className="h-3.5 w-3.5"/>}{testConnection.isPending ? 'Testing' : 'Test connection'}
                </button>
                <button data-testid={`button-activate-razorpay-${environment}`} type="button" onClick={() => { setNotice(null); activateEnvironment.mutate({ data: { environment } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetRazorpaySettingsQueryKey() }); announce(`${gatewayLabels[environment]} is now active for new orders.`); }, onError: error => setNotice({ text: errorText(error), bad: true }) }); }} disabled={active || !complete || activateEnvironment.isPending} className={`inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-[11px] font-semibold disabled:opacity-50 ${active ? 'border-[#cee4d6] bg-[#f2f8f4] text-[#397451]' : 'border-[#d8e0e7] text-[#344c63] hover:bg-[#f7f9fa]'}`}>
                  {activateEnvironment.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : <ShieldCheck className="h-3.5 w-3.5"/>}{active ? 'Active' : 'Set active'}
                </button>
              </div>
              {saved?.updatedAt && <p data-testid={`text-razorpay-${environment}-updated`} className="text-[10px] text-[#8994a0]">Credentials last saved {new Date(saved.updatedAt).toLocaleString()}</p>}
            </form>
          </section>;
        })}
      </div>
      {(saveSettings.isError || testConnection.isError || activateEnvironment.isError) && <p role="alert" data-testid="status-gateway-error" className="px-5 pb-4 text-[12px] text-[#a84926]">{errorText(saveSettings.error || testConnection.error || activateEnvironment.error)}</p>}
      <div className="grid gap-3 border-t border-[#e9edf1] bg-[#fbfcfd] px-5 py-4 text-[11px] leading-5 text-[#6f7f8f] md:grid-cols-[1fr_1fr] md:px-6">
        <p>In both Razorpay dashboards, set the webhook endpoint to your published app URL followed by <code className="rounded bg-[#eef2f5] px-1.5 py-0.5 text-[#344c63]">/api/webhooks/razorpay</code>.</p>
        <p>Enable <code className="rounded bg-[#eef2f5] px-1.5 py-0.5 text-[#344c63]">order.paid</code> and <code className="rounded bg-[#eef2f5] px-1.5 py-0.5 text-[#344c63]">payment.captured</code> for each mode, and save that mode's matching webhook secret here.</p>
      </div>
    </Panel>
    </>}

    {notice && <div data-testid={isPackagesPage ? 'status-package-notice' : 'status-billing-notice'} role="status" className={`rounded-md border px-4 py-3 text-[12px] ${notice.bad ? 'border-[#efd8c7] bg-[#fff8f2] text-[#985120]' : 'border-[#d8e9df] bg-[#f2f8f4] text-[#3e7252]'}`}>{notice.text}</div>}

    {isPackagesPage && <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><div className="mono mb-1 text-[10px] uppercase tracking-[.17em] text-[#8290a0]">SUBSCRIPTION CATALOG</div><h2 className="display text-[22px] font-bold text-[#1d2d40]">Packages</h2><p className="mt-1 text-[12px] text-[#748292]">Set the exact price and access term customers will see at checkout.</p></div>
        <button data-testid="button-new-subscription-package" onClick={() => { resetPackageForm(); setPackageFormOpen(true); setNotice(null); }} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white hover:bg-[#103f7e]"><Plus className="h-4 w-4"/>New package</button>
      </div>

      {packageFormOpen && <Panel className="mb-4 p-5 md:p-6">
        <div className="mb-4 flex items-center justify-between"><h3 className="text-[14px] font-bold text-[#23364b]">{editing ? `Edit ${editing.name}` : 'Create a package'}</h3>
          <button data-testid="button-close-package-form" onClick={resetPackageForm} className="rounded px-2 py-1 text-[11px] font-semibold text-[#6f7e8e] hover:bg-[#f1f4f6]">Close</button></div>
        <form onSubmit={submitPackage} className="space-y-4">
          {sendingLimits && <div data-testid="text-admin-package-sending-limits" className="rounded-md border border-[#d7e4ef] bg-[#f3f8fc] px-3.5 py-3 text-[11px] leading-5 text-[#47627b]">
            Platform settings apply the same independent allowance to each SMTP mailbox for every package: {sendingLimits.emailsPerHourPerSmtp.toLocaleString()} campaign attempts per rolling hour and {sendingLimits.emailsPerDayPerSmtp.toLocaleString()} per rolling 24 hours. Package SMTP slots determine how many mailboxes customers can configure; retries count toward the limits.
          </div>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <label className="block min-w-0 space-y-1.5">
              <span className="text-[12px] font-semibold text-[#35445a]">Package type</span>
              <select data-testid="select-package-type" disabled={Boolean(editing)} value={draft.packageType} onChange={event => {
                const packageType = event.target.value as PackageDraft['packageType'];
                setDraft(d => ({
                  ...d,
                  packageType,
                  periodDays: packageType === 'addon' ? '0' : d.periodDays === '0' ? '30' : d.periodDays,
                  contactLimit: packageType === 'addon' ? '0' : d.contactLimit === '0' ? '5000' : d.contactLimit,
                  emailAccountLimit: packageType === 'addon' ? '0' : d.emailAccountLimit === '0' ? '1' : d.emailAccountLimit,
                  preferred: packageType === 'primary' && d.preferred,
                }));
              }} className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] text-[#1b2b3d] disabled:bg-[#f1f4f6]">
                <option value="primary">Primary plan</option><option value="addon">Add-on</option>
              </select>
            </label>
            <Field label="Package name" value={draft.name} onChange={name => setDraft(d => ({ ...d, name }))} testId="input-package-name" placeholder="e.g. Team monthly"/>
             <Field label="Price" value={draft.amount} onChange={amount => setDraft(d => ({ ...d, amount }))} testId="input-package-amount" type="number" step="any" min={0} placeholder="0.00" disabled={draft.free} hint={draft.free ? 'Free packages activate without Razorpay Checkout.' : undefined}/>
            <Field label="Currency code" value={draft.currency} onChange={currency => setDraft(d => ({ ...d, currency: currency.toUpperCase() }))} testId="input-package-currency" placeholder="INR" hint="Three-letter ISO 4217 code."/>
            {draft.packageType === 'primary' && <>
              <Field label="Term length (days)" value={draft.periodDays} onChange={periodDays => setDraft(d => ({ ...d, periodDays }))} testId="input-package-period-days" type="number" step="1" min={1} placeholder="30"/>
              <Field label="Contacts" value={draft.contactLimit} onChange={contactLimit => setDraft(d => ({ ...d, contactLimit }))} testId="input-package-contact-limit" type="number" step="1" min={0} max={10000000} hint="Maximum contacts saved on this package."/>
              <Field label="SMTP sender accounts" value={draft.emailAccountLimit} onChange={emailAccountLimit => setDraft(d => ({ ...d, emailAccountLimit }))} testId="input-package-email-account-limit" type="number" step="1" min={0} max={100} hint="Maximum base SMTP senders; eligible add-ons add mailbox slots."/>
              <Field label="Company research runs per term" value={draft.researchAllowance} onChange={researchAllowance => setDraft(d => ({ ...d, researchAllowance }))} testId="input-package-research-allowance" type="number" step="1" min={0} max={10000} hint="Each queued run, including retries, is used. Resets in a new term; unused runs expire at term end."/>
            </>}
            {draft.packageType === 'addon' && <>
              <Field label="Company research credits" value={draft.researchAllowance} onChange={researchAllowance => setDraft(d => ({ ...d, researchAllowance }))} testId="input-package-research-allowance" type="number" step="1" min={0} max={10000} hint="Unused credits pause when the primary plan ends and resume on a later paid plan."/>
              <Field label="AI Email Assist credits" value={draft.aiEmailAssistAllowance} onChange={aiEmailAssistAllowance => setDraft(d => ({ ...d, aiEmailAssistAllowance }))} testId="input-package-ai-email-assist-allowance" type="number" step="1" min={0} max={10000} hint="One credit is used for each successfully generated or revised draft."/>
              <Field label="Additional SMTP mailboxes" value={draft.additionalMailboxCount} onChange={additionalMailboxCount => setDraft(d => ({ ...d, additionalMailboxCount }))} testId="input-package-additional-mailboxes" type="number" step="1" min={0} max={100} hint="Adds sender slots while a paid primary plan is active; configured accounts are not removed when the plan expires."/>
            </>}
          </div>
          <label className={`flex w-fit items-center gap-2 rounded-md border border-[#e1e6eb] bg-[#f8fafb] px-3 py-2 text-[11px] font-medium text-[#43566b] ${hasOtherFreePackage ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}><input data-testid="input-package-free" type="checkbox" checked={draft.free} disabled={hasOtherFreePackage} onChange={event => setDraft(d => ({ ...d, free: event.target.checked, amount: event.target.checked ? '0' : d.amount }))} className="h-4 w-4 accent-[#174f99]"/>{draft.packageType === 'addon' ? 'Free add-on · available to paid-primary customers' : 'Free package · 0 price, no Razorpay order'}</label>
          {hasOtherFreePackage && <p className="-mt-2 text-[11px] text-[#7b8793]">A free primary package already exists. Edit it or change its price before creating another.</p>}
          {draft.packageType === 'primary' && <div className="space-y-1">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] font-medium text-[#43566b]">
              <input data-testid="input-package-preferred" type="checkbox" checked={draft.preferred} onChange={event => setDraft(d => ({ ...d, preferred: event.target.checked }))} className="h-4 w-4 accent-[#174f99]"/>
              Preferred package
            </label>
            <p className="text-[11px] text-[#718192]">Only one package can be preferred. Selecting this automatically moves the badge from the current package.</p>
          </div>}
          <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#35445a]">Description</span><textarea data-testid="input-package-description" value={draft.description} onChange={event => setDraft(d => ({ ...d, description: event.target.value }))} rows={3} maxLength={2000} placeholder="What this package includes" className="w-full resize-y rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 py-2.5 text-[13px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"/></label>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] font-medium text-[#43566b]"><input data-testid="input-package-active" type="checkbox" checked={draft.active} onChange={event => setDraft(d => ({ ...d, active: event.target.checked }))} className="h-4 w-4 accent-[#174f99]"/>Available to customers</label>
          {(createPackage.isError || updatePackage.isError) && <p role="alert" data-testid="status-package-form-error" className="text-[12px] text-[#a84926]">{errorText(createPackage.error || updatePackage.error)}</p>}
            <button data-testid="button-submit-subscription-package" type="submit" disabled={busy || !packageFormValid} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}{busy ? 'Saving package' : editing ? 'Save changes' : 'Create package'}
          </button>
        </form>
      </Panel>}

      {packages.length === 0 ? <Panel className="grid min-h-52 place-items-center p-8 text-center" data-testid="empty-subscription-packages"><div><CreditCard className="mx-auto h-7 w-7 text-[#8396a8]"/><h3 className="mt-3 text-[14px] font-semibold text-[#2b3c4e]">No subscription packages yet</h3><p className="mt-1 text-[12px] text-[#788796]">Create the first package to make billing available to customers.</p><button data-testid="button-create-first-package" onClick={() => { resetPackageForm(); setPackageFormOpen(true); setNotice(null); }} className="mt-4 rounded-md border border-[#d8e0e7] px-3 py-2 text-[11px] font-semibold text-[#315d84]">Create first package</button></div></Panel> :
        <Panel className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(180px,1.4fr)_minmax(170px,1.2fr)_110px_100px_115px] gap-4 border-b border-[#e7ecf0] bg-[#f7f9fa] px-5 py-3 mono text-[9px] uppercase tracking-[.15em] text-[#83909d] md:grid"><span>Package</span><span>Rate & term</span><span>Visibility</span><span>Last updated</span><span className="text-right">Actions</span></div>
          <div className="divide-y divide-[#edf0f2]">{packages.map(pkg => <article key={pkg.id} data-testid={`row-subscription-package-${pkg.id}`} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(180px,1.4fr)_minmax(170px,1.2fr)_110px_100px_115px] md:items-center md:gap-4">
            <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-[13px] font-semibold text-[#26374a]">{pkg.name}</h3><span className="rounded-full bg-[#f0f4f8] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#536a80]">{pkg.packageType === 'primary' ? 'Primary' : 'Add-on'}</span></div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#758394]">{pkg.description || 'No description provided.'}</p></div>
            <div data-testid={`text-package-price-${pkg.id}`}>
              <div className="text-[14px] font-bold text-[#20354a]">{pkg.amountMinor === 0 ? 'Free' : formatMinor(pkg.amountMinor, pkg.currency)}</div>
              <div className="mt-0.5 text-[10px] text-[#7e8b99]">{pkg.packageType === 'addon' ? (pkg.amountMinor === 0 ? 'Free add-on' : `One-time · ${pkg.currency}`) : pkg.amountMinor === 0 ? `Free access · ${pkg.periodDays} days` : `per ${pkg.periodDays} days · ${pkg.currency}`}</div>
              {pkg.packageType === 'primary' ? <>
                <div data-testid={`text-package-contact-limit-${pkg.id}`} className="mt-0.5 text-[10px] text-[#7e8b99]">{pkg.contactLimit.toLocaleString()} contacts · {pkg.emailAccountLimit} base SMTP sender account{pkg.emailAccountLimit === 1 ? '' : 's'}</div>
                <div data-testid={`text-admin-package-research-allowance-${pkg.id}`} className="mt-0.5 text-[10px] text-[#7e8b99]">{pkg.researchAllowance} company research run{pkg.researchAllowance === 1 ? '' : 's'} per term</div>
                {sendingLimits && <div data-testid={`text-admin-package-send-limits-${pkg.id}`} className="mt-1 text-[10px] leading-4 text-[#597086]">{sendingLimits.emailsPerHourPerSmtp.toLocaleString()}/hour and {sendingLimits.emailsPerDayPerSmtp.toLocaleString()}/24h per SMTP mailbox</div>}
              </> : <>
                <div data-testid={`text-admin-package-research-allowance-${pkg.id}`} className="mt-0.5 text-[10px] text-[#7e8b99]">{pkg.researchAllowance} company research credit{pkg.researchAllowance === 1 ? '' : 's'}</div>
                <div className="mt-0.5 text-[10px] text-[#7e8b99]">{pkg.aiEmailAssistAllowance} AI Email Assist credit{pkg.aiEmailAssistAllowance === 1 ? '' : 's'}</div>
                <div className="mt-0.5 text-[10px] text-[#7e8b99]">{pkg.additionalMailboxCount} additional SMTP mailbox slot{pkg.additionalMailboxCount === 1 ? '' : 's'}</div>
              </>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">{pkg.packageType === 'primary' && pkg.preferred && <span data-testid={`badge-preferred-admin-${pkg.id}`} className="inline-flex rounded-full border border-[#d4e2ef] bg-[#eff5fa] px-2.5 py-1 text-[10px] font-semibold text-[#315c82]">Preferred</span>}<span data-testid={`status-package-${pkg.id}`} className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${pkg.active ? 'bg-[#eaf5ef] text-[#397451]' : 'bg-[#f0f2f4] text-[#717e8a]'}`}>{pkg.active ? 'Available' : 'Hidden'}</span></div>
            <div className="text-[11px] text-[#788695] md:text-[10px]">{new Date(pkg.updatedAt).toLocaleDateString()}</div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button data-testid={`button-edit-package-${pkg.id}`} onClick={() => openEdit(pkg)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#dce3e8] px-2.5 text-[10px] font-semibold text-[#415970] hover:bg-[#f7f9fa]"><PencilLine className="h-3.5 w-3.5"/>Edit</button>
              <button data-testid={`button-toggle-package-${pkg.id}`} disabled={updatePackage.isPending} onClick={() => updatePackage.mutate({ packageId: pkg.id, data: { active: !pkg.active } }, { onSuccess: () => { void refreshPackages(); announce(pkg.active ? 'Package is now hidden from customers.' : 'Package is now available to customers.'); }, onError: error => setNotice({ text: errorText(error), bad: true }) })} className="h-8 rounded border border-[#dce3e8] px-2.5 text-[10px] font-semibold text-[#415970] hover:bg-[#f7f9fa] disabled:opacity-50">{pkg.active ? 'Hide' : 'Publish'}</button>
            </div>
          </article>)}</div>
        </Panel>}
    </section>}
  </div>;
}

export function AdminPackagesPage() {
  return <AdminBillingPage page="packages"/>;
}