import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, Check, CircleAlert, CreditCard, KeyRound, LoaderCircle, PencilLine, Plus, Save, ShieldCheck,
} from 'lucide-react';
import {
  getGetRazorpaySettingsQueryKey, getListAdminSubscriptionPackagesQueryKey,
  getListAvailableSubscriptionPackagesQueryKey,
  useCreateSubscriptionPackage, useGetRazorpaySettings, useListAdminSubscriptionPackages,
  useTestRazorpayConnection, useUpdateRazorpaySettings, useUpdateSubscriptionPackage,
} from '@workspace/api-client-react';
import type { SubscriptionPackage, SubscriptionPackageInput } from '@workspace/api-client-react';

type PackageDraft = {
  name: string;
  description: string;
  amount: string;
  currency: string;
  periodDays: string;
  active: boolean;
};

const blankDraft: PackageDraft = {
  name: '', description: '', amount: '', currency: 'INR', periodDays: '30', active: true,
};

const errorText = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The request could not be completed. Please try again.';

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-[#e1e6eb] bg-white ${className}`}>{children}</section>;
}

function Field({
  label, value, onChange, testId, type = 'text', placeholder, hint, step,
}: {
  label: string; value: string; onChange: (value: string) => void; testId: string;
  type?: string; placeholder?: string; hint?: string; step?: string;
}) {
  return <label className="block min-w-0 space-y-1.5">
    <span className="text-[12px] font-semibold text-[#35445a]">{label}</span>
    <input data-testid={testId} type={type} step={step} value={value} onChange={event => onChange(event.target.value)}
      placeholder={placeholder} className="h-10 w-full rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 text-[13px] text-[#1b2b3d] outline-none transition focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"/>
    {hint && <span className="block text-[11px] text-[#85909c]">{hint}</span>}
  </label>;
}

function formatMinor(amountMinor: number, currency: string) {
  const digits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amountMinor / (10 ** digits));
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

export default function AdminBillingPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useGetRazorpaySettings();
  const packagesQuery = useListAdminSubscriptionPackages();
  const saveSettings = useUpdateRazorpaySettings();
  const testConnection = useTestRazorpayConnection();
  const createPackage = useCreateSubscriptionPackage();
  const updatePackage = useUpdateSubscriptionPackage();
  const settings = settingsQuery.data;
  const packages = packagesQuery.data?.packages ?? [];
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [draft, setDraft] = useState<PackageDraft>(blankDraft);
  const [editing, setEditing] = useState<SubscriptionPackage | null>(null);
  const [packageFormOpen, setPackageFormOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const busy = createPackage.isPending || updatePackage.isPending;

  const announce = (text: string) => setNotice({ text });
  const refreshPackages = () => {
    void queryClient.invalidateQueries({ queryKey: getListAdminSubscriptionPackagesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAvailableSubscriptionPackagesQueryKey() });
  };
  const openEdit = (pkg: SubscriptionPackage) => {
    setEditing(pkg);
    setPackageFormOpen(true);
    setDraft({
      name: pkg.name, description: pkg.description,
      amount: (pkg.amountMinor / (10 ** (new Intl.NumberFormat(undefined, { style: 'currency', currency: pkg.currency }).resolvedOptions().maximumFractionDigits ?? 2))).toString(),
      currency: pkg.currency, periodDays: String(pkg.periodDays), active: pkg.active,
    });
    setNotice(null);
  };
  const resetPackageForm = () => { setEditing(null); setDraft(blankDraft); setPackageFormOpen(false); };
  const submitPackage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currency = draft.currency.trim().toUpperCase();
    const payload: SubscriptionPackageInput = {
      name: draft.name.trim(), description: draft.description.trim(),
      amountMinor: inputMinor(draft.amount, currency), currency,
      periodDays: Number(draft.periodDays), active: draft.active,
    };
    if (editing) {
      updatePackage.mutate({ packageId: editing.id, data: payload }, {
        onSuccess: () => { void refreshPackages(); announce('Package changes saved.'); resetPackageForm(); },
      });
    } else {
      createPackage.mutate({ data: payload }, {
        onSuccess: () => { void refreshPackages(); announce('Subscription package created.'); resetPackageForm(); },
      });
    }
  };

  const submitGateway = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    saveSettings.mutate({
      data: {
        keyId: keyId.trim() || settings?.keyId || '',
        ...(keySecret ? { keySecret } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
      },
    }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetRazorpaySettingsQueryKey() });
        setKeySecret(''); setWebhookSecret('');
        announce('Razorpay credentials saved securely.');
      },
    });
  };

  if (settingsQuery.isLoading || packagesQuery.isLoading) {
    return <div className="space-y-5" aria-label="Loading billing administration" data-testid="loading-admin-billing">
      <div className="h-8 w-60 animate-pulse rounded bg-[#e9eef2]"/>
      <div className="h-56 animate-pulse rounded-lg bg-[#edf1f4]"/>
      <div className="h-72 animate-pulse rounded-lg bg-[#edf1f4]"/>
    </div>;
  }
  if (settingsQuery.isError || packagesQuery.isError) {
    return <Panel className="flex flex-wrap items-center justify-between gap-4 p-6" data-testid="error-admin-billing">
      <div className="flex items-center gap-3"><CircleAlert className="h-5 w-5 text-[#bd692d]"/><div><h1 className="font-semibold text-[#1b2b3d]">Billing data is unavailable</h1><p className="mt-1 text-sm text-[#728092]">No changes were made. Retry loading the billing controls.</p></div></div>
      <button data-testid="button-retry-admin-billing" onClick={() => { void settingsQuery.refetch(); void packagesQuery.refetch(); }} className="rounded-md border border-[#d6dfe7] px-4 py-2 text-sm font-semibold text-[#294d70]">Retry</button>
    </Panel>;
  }

  return <div className="fade-in space-y-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#75869a]">PLATFORM / BILLING</div>
        <h1 className="display text-[32px] font-bold leading-tight text-[#192a3d]">Billing controls</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#6c7b8b]">Configure the Razorpay connection and keep customer subscription terms precise.</p>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-[#dfe7ed] bg-[#f6f9fb] px-3 py-2 text-[11px] text-[#53677b]"><ShieldCheck className="h-4 w-4 text-[#3374a9]"/>Secrets stay server-side</div>
    </header>

    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e9edf1] px-5 py-4 md:px-6">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-md bg-[#edf4fa] text-[#265e91]"><KeyRound className="h-[17px] w-[17px]"/></span><div><h2 className="text-[15px] font-bold text-[#1d2d40]">Razorpay gateway</h2><p className="mt-0.5 text-[11px] text-[#788696]">Use test keys first, then switch to live credentials when ready.</p></div></div>
        <span data-testid="status-gateway-config" className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${settings?.keyId && settings.keySecretConfigured && settings.webhookSecretConfigured ? 'bg-[#eaf5ef] text-[#347452]' : 'bg-[#fff3e8] text-[#a85c21]'}`}>{settings?.keyId && settings.keySecretConfigured && settings.webhookSecretConfigured ? 'Credentials configured' : 'Setup required'}</span>
      </div>
      <form onSubmit={submitGateway} className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
        <Field label="Public key ID" value={keyId || settings?.keyId || ''} onChange={setKeyId} testId="input-razorpay-key-id" placeholder="rzp_live_…" hint="The public key ID is used by Standard Checkout."/>
        <Field label="Key secret" value={keySecret} onChange={setKeySecret} type="password" testId="input-razorpay-key-secret" placeholder={settings?.keySecretConfigured ? 'Saved — enter only to rotate' : 'Enter key secret'} hint={settings?.keySecretConfigured ? 'A blank value keeps the currently saved secret.' : 'Required to authorize server-side order creation.'}/>
        <Field label="Webhook secret" value={webhookSecret} onChange={setWebhookSecret} type="password" testId="input-razorpay-webhook-secret" placeholder={settings?.webhookSecretConfigured ? 'Saved — enter only to rotate' : 'Enter webhook secret'} hint={settings?.webhookSecretConfigured ? 'A blank value keeps the saved webhook secret.' : 'Required for signed payment notifications. Never displayed after saving.'}/>
        <div className="flex flex-wrap items-end gap-2">
          <button data-testid="button-save-razorpay-settings" type="submit" disabled={saveSettings.isPending || !keyId.trim() && !settings?.keyId} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white transition hover:bg-[#103f7e] disabled:opacity-55">
            {saveSettings.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}{saveSettings.isPending ? 'Saving credentials' : 'Save credentials'}
          </button>
          <button data-testid="button-test-razorpay-connection" type="button" onClick={() => { setNotice(null); testConnection.mutate(undefined, { onSuccess: result => setNotice({ text: result.message, bad: !result.success }), onError: error => setNotice({ text: errorText(error), bad: true }) }); }} disabled={testConnection.isPending || !settings?.keyId || !settings.keySecretConfigured} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#d8e0e7] px-4 text-[12px] font-semibold text-[#344c63] hover:bg-[#f7f9fa] disabled:opacity-50">
            {testConnection.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Activity className="h-4 w-4"/>}{testConnection.isPending ? 'Testing' : 'Test connection'}
          </button>
        </div>
        {(saveSettings.isError || testConnection.isError) && <p role="alert" data-testid="status-gateway-error" className="text-[12px] text-[#a84926]">{errorText(saveSettings.error || testConnection.error)}</p>}
        {settings?.updatedAt && <p data-testid="text-gateway-updated" className="self-end text-[11px] text-[#8994a0]">Last saved {new Date(settings.updatedAt).toLocaleString()}</p>}
      </form>
      <div className="grid gap-px border-t border-[#e9edf1] bg-[#e9edf1] sm:grid-cols-2">
        {[['Key secret', settings?.keySecretConfigured], ['Webhook secret', settings?.webhookSecretConfigured]].map(([label, configured]) =>
          <div key={String(label)} className="flex items-center justify-between bg-[#fbfcfd] px-5 py-3.5 text-[12px]">
            <span className="text-[#647487]">{label}</span><span className="flex items-center gap-1.5 font-medium text-[#43586b]">{configured ? <><Check className="h-3.5 w-3.5 text-[#3b7c59]"/>Configured</> : 'Not configured'}</span>
          </div>)}
      </div>
      <div className="grid gap-3 border-t border-[#e9edf1] bg-[#fbfcfd] px-5 py-4 text-[11px] leading-5 text-[#6f7f8f] md:grid-cols-[1fr_1fr] md:px-6">
        <p>In the Razorpay dashboard, set the webhook endpoint to your published app URL followed by <code className="rounded bg-[#eef2f5] px-1.5 py-0.5 text-[#344c63]">/api/webhooks/razorpay</code>.</p>
        <p>Enable the <code className="rounded bg-[#eef2f5] px-1.5 py-0.5 text-[#344c63]">order.paid</code> and <code className="rounded bg-[#eef2f5] px-1.5 py-0.5 text-[#344c63]">payment.captured</code> events and enter the same webhook secret above.</p>
      </div>
    </Panel>

    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><div className="mono mb-1 text-[10px] uppercase tracking-[.17em] text-[#8290a0]">SUBSCRIPTION CATALOG</div><h2 className="display text-[22px] font-bold text-[#1d2d40]">Packages</h2><p className="mt-1 text-[12px] text-[#748292]">Set the exact price and access term customers will see at checkout.</p></div>
        <button data-testid="button-new-subscription-package" onClick={() => { resetPackageForm(); setPackageFormOpen(true); setNotice(null); }} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white hover:bg-[#103f7e]"><Plus className="h-4 w-4"/>New package</button>
      </div>

      {packageFormOpen && <Panel className="mb-4 p-5 md:p-6">
        <div className="mb-4 flex items-center justify-between"><h3 className="text-[14px] font-bold text-[#23364b]">{editing ? `Edit ${editing.name}` : 'Create a package'}</h3>
          <button data-testid="button-close-package-form" onClick={resetPackageForm} className="rounded px-2 py-1 text-[11px] font-semibold text-[#6f7e8e] hover:bg-[#f1f4f6]">Close</button></div>
        <form onSubmit={submitPackage} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Package name" value={draft.name} onChange={name => setDraft(d => ({ ...d, name }))} testId="input-package-name" placeholder="e.g. Team monthly"/>
             <Field label="Price" value={draft.amount} onChange={amount => setDraft(d => ({ ...d, amount }))} testId="input-package-amount" type="number" step="any" placeholder="0.00"/>
            <Field label="Currency code" value={draft.currency} onChange={currency => setDraft(d => ({ ...d, currency: currency.toUpperCase() }))} testId="input-package-currency" placeholder="INR" hint="Three-letter ISO 4217 code."/>
             <Field label="Term length (days)" value={draft.periodDays} onChange={periodDays => setDraft(d => ({ ...d, periodDays }))} testId="input-package-period-days" type="number" step="1" placeholder="30"/>
          </div>
          <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#35445a]">Description</span><textarea data-testid="input-package-description" value={draft.description} onChange={event => setDraft(d => ({ ...d, description: event.target.value }))} rows={3} maxLength={2000} placeholder="What this package includes" className="w-full resize-y rounded-md border border-[#d8dfe6] bg-[#fcfdfe] px-3 py-2.5 text-[13px] outline-none focus:border-[#4179b4] focus:ring-2 focus:ring-[#e4eef8]"/></label>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] font-medium text-[#43566b]"><input data-testid="input-package-active" type="checkbox" checked={draft.active} onChange={event => setDraft(d => ({ ...d, active: event.target.checked }))} className="h-4 w-4 accent-[#174f99]"/>Available to customers</label>
          {(createPackage.isError || updatePackage.isError) && <p role="alert" data-testid="status-package-form-error" className="text-[12px] text-[#a84926]">{errorText(createPackage.error || updatePackage.error)}</p>}
           <button data-testid="button-submit-subscription-package" type="submit" disabled={busy || draft.name.trim().length < 2 || !draft.currency.match(/^[A-Z]{3}$/) || inputMinor(draft.amount, draft.currency) < 1 || !Number.isInteger(Number(draft.periodDays)) || Number(draft.periodDays) < 1} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}{busy ? 'Saving package' : editing ? 'Save changes' : 'Create package'}
          </button>
        </form>
      </Panel>}

      {notice && <div data-testid="status-billing-notice" role="status" className={`mb-3 rounded-md border px-4 py-3 text-[12px] ${notice.bad ? 'border-[#efd8c7] bg-[#fff8f2] text-[#985120]' : 'border-[#d8e9df] bg-[#f2f8f4] text-[#3e7252]'}`}>{notice.text}</div>}
      {packages.length === 0 ? <Panel className="grid min-h-52 place-items-center p-8 text-center" data-testid="empty-subscription-packages"><div><CreditCard className="mx-auto h-7 w-7 text-[#8396a8]"/><h3 className="mt-3 text-[14px] font-semibold text-[#2b3c4e]">No subscription packages yet</h3><p className="mt-1 text-[12px] text-[#788796]">Create the first package to make billing available to customers.</p><button data-testid="button-create-first-package" onClick={() => { resetPackageForm(); setPackageFormOpen(true); setNotice(null); }} className="mt-4 rounded-md border border-[#d8e0e7] px-3 py-2 text-[11px] font-semibold text-[#315d84]">Create first package</button></div></Panel> :
        <Panel className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(180px,1.4fr)_minmax(170px,1.2fr)_110px_100px_115px] gap-4 border-b border-[#e7ecf0] bg-[#f7f9fa] px-5 py-3 mono text-[9px] uppercase tracking-[.15em] text-[#83909d] md:grid"><span>Package</span><span>Rate & term</span><span>Visibility</span><span>Last updated</span><span className="text-right">Actions</span></div>
          <div className="divide-y divide-[#edf0f2]">{packages.map(pkg => <article key={pkg.id} data-testid={`row-subscription-package-${pkg.id}`} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(180px,1.4fr)_minmax(170px,1.2fr)_110px_100px_115px] md:items-center md:gap-4">
            <div><h3 className="text-[13px] font-semibold text-[#26374a]">{pkg.name}</h3><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#758394]">{pkg.description || 'No description provided.'}</p></div>
            <div data-testid={`text-package-price-${pkg.id}`}><div className="text-[14px] font-bold text-[#20354a]">{formatMinor(pkg.amountMinor, pkg.currency)}</div><div className="mt-0.5 text-[10px] text-[#7e8b99]">per {pkg.periodDays} days · {pkg.currency}</div></div>
            <div><span data-testid={`status-package-${pkg.id}`} className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${pkg.active ? 'bg-[#eaf5ef] text-[#397451]' : 'bg-[#f0f2f4] text-[#717e8a]'}`}>{pkg.active ? 'Available' : 'Hidden'}</span></div>
            <div className="text-[11px] text-[#788695] md:text-[10px]">{new Date(pkg.updatedAt).toLocaleDateString()}</div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button data-testid={`button-edit-package-${pkg.id}`} onClick={() => openEdit(pkg)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#dce3e8] px-2.5 text-[10px] font-semibold text-[#415970] hover:bg-[#f7f9fa]"><PencilLine className="h-3.5 w-3.5"/>Edit</button>
              <button data-testid={`button-toggle-package-${pkg.id}`} disabled={updatePackage.isPending} onClick={() => updatePackage.mutate({ packageId: pkg.id, data: { active: !pkg.active } }, { onSuccess: () => { void refreshPackages(); announce(pkg.active ? 'Package is now hidden from customers.' : 'Package is now available to customers.'); }, onError: error => setNotice({ text: errorText(error), bad: true }) })} className="h-8 rounded border border-[#dce3e8] px-2.5 text-[10px] font-semibold text-[#415970] hover:bg-[#f7f9fa] disabled:opacity-50">{pkg.active ? 'Hide' : 'Publish'}</button>
            </div>
          </article>)}</div>
        </Panel>}
    </section>
  </div>;
}