import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, Clock3, CreditCard, LoaderCircle, Mail, ShieldCheck, Users } from 'lucide-react';
import {
  getGetCurrentSubscriptionQueryKey, getListAvailableSubscriptionPackagesQueryKey,
  getListTenantSendingAccountsQueryKey,
  useActivateFreeSubscription, useCreateSubscriptionOrder, useGetCurrentSubscription, useListAvailableSubscriptionPackages,
  useListTenantSendingAccounts, useVerifyRazorpayPayment,
} from '@workspace/api-client-react';
import type { SubscriptionOrderCreated, SubscriptionPackage, SubscriptionPackageList, TenantSendingAccount } from '@workspace/api-client-react';
import {
  trackEvent,
  trackFreeActivationOutcome,
  trackPaidCheckoutOutcome,
  trackPaidVerificationOutcome,
  trackSmtpSenderRetentionCompleted,
} from '@/lib/analytics';

declare global {
  interface Window {
    Razorpay?: new (options: {
      key: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      order_id: string;
      prefill: { name: string; email: string };
      theme: { color: string };
      handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
      modal: { ondismiss: () => void };
    }) => { open: () => void };
  }
}

let checkoutScriptPromise: Promise<void> | null = null;
function loadCheckoutScript() {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;
  checkoutScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout]');
    const script = existing ?? document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => {
      if (window.Razorpay) {
        resolve();
      } else {
        script.remove();
        reject(new Error('Razorpay Checkout did not initialize.'));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Razorpay Checkout could not be loaded. Check your connection and try again.'));
    };
    if (!existing) document.body.appendChild(script);
  }).catch(error => {
    checkoutScriptPromise = null;
    throw error;
  });
  return checkoutScriptPromise;
}

const errorText = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : 'We could not complete this request. Please try again.';

function formatMinor(amountMinor: number, currency: string) {
  const digits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amountMinor / (10 ** digits));
}

function durationLabel(days: number) {
  if (days % 365 === 0) return `${days / 365} ${days === 365 ? 'year' : 'years'}`;
  if (days % 30 === 0) return `${days / 30} ${days === 30 ? 'month' : 'months'}`;
  if (days % 7 === 0) return `${days / 7} ${days === 7 ? 'week' : 'weeks'}`;
  return `${days} days`;
}

function PackageCard({ item, featured, pending, disabled, onPurchase, sendingLimits }: {
  item: SubscriptionPackage;
  featured: boolean;
  pending: boolean;
  disabled: boolean;
  onPurchase: () => void;
  sendingLimits: SubscriptionPackageList['sendingLimits'];
}) {
  const combinedHourly = sendingLimits.emailsPerHourPerSmtp * item.emailAccountLimit;
  const combinedDaily = sendingLimits.emailsPerDayPerSmtp * item.emailAccountLimit;
  return <article data-testid={`card-plan-${item.id}`} className={`flex min-h-[330px] flex-col rounded-lg border p-4 sm:p-5 md:p-6 ${featured ? 'border-[#224e78] bg-[#f1f6fa] shadow-[0_8px_26px_rgba(35,70,104,.09)]' : 'border-[#e0e6eb] bg-white'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mono text-[9px] uppercase tracking-[.17em] text-[#7e8c9a]">MAILFLOW ACCESS</span>
          {featured && <span data-testid={`badge-current-package-${item.id}`} className="mono inline-flex shrink-0 items-center rounded-full border border-[#c8d8e5] bg-white/90 px-2 py-1 text-[8px] font-semibold uppercase leading-none tracking-[.08em] text-[#365b7b]">Current package</span>}
          {item.preferred && <span data-testid={`badge-preferred-plan-${item.id}`} className="mono inline-flex shrink-0 items-center rounded-full border border-[#d4e2ef] bg-[#eff5fa] px-2 py-1 text-[8px] font-semibold uppercase leading-none tracking-[.08em] text-[#315c82]">Preferred</span>}
        </div>
        <h2 className="display mt-2 break-words text-[22px] font-bold leading-tight text-[#1d2d40]">{item.name}</h2>
      </div>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#e5eef6] text-[#345f87]">
        <CreditCard className="h-[17px] w-[17px]"/>
      </span>
    </div>

    <p className="mt-3 min-h-[44px] break-words text-[12px] leading-5 text-[#6c7b8a]">{item.description || 'A reliable subscription term for your Mailflow workspace.'}</p>

    <div className="mt-auto border-t border-[#dfe7ed] pt-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span data-testid={`text-plan-price-${item.id}`} className="display max-w-full break-words text-[27px] font-bold tracking-[-.05em] text-[#1b3045] sm:text-[29px]">{item.amountMinor === 0 ? 'Free' : formatMinor(item.amountMinor, item.currency)}</span>
        <span className="text-[11px] text-[#768595]">{item.amountMinor === 0 ? 'No payment' : item.currency}</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        <div data-testid={`text-plan-period-${item.id}`} className="flex min-w-0 items-start gap-1.5 text-[11px] text-[#718192]">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
          <span className="min-w-0 break-words">Access for {durationLabel(item.periodDays)}</span>
        </div>
        <div data-testid={`text-plan-contact-limit-${item.id}`} className="flex min-w-0 items-start gap-1.5 text-[11px] font-medium text-[#4b647b]">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
          <span className="min-w-0 break-words">Up to {item.contactLimit.toLocaleString()} contacts</span>
        </div>
        <div data-testid={`text-plan-sender-account-limit-${item.id}`} className="flex min-w-0 items-start gap-1.5 text-[11px] font-medium text-[#4b647b]">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
          <span className="min-w-0 break-words">Up to {item.emailAccountLimit} SMTP sender account{item.emailAccountLimit === 1 ? '' : 's'}</span>
        </div>
        <div data-testid={`text-plan-hourly-limit-${item.id}`} className="flex min-w-0 items-start gap-1.5 text-[11px] font-medium text-[#4b647b]">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
          <span className="min-w-0 break-words">Up to {sendingLimits.emailsPerHourPerSmtp.toLocaleString()} campaign attempts per rolling hour, per SMTP mailbox</span>
        </div>
        <div data-testid={`text-plan-daily-limit-${item.id}`} className="flex min-w-0 items-start gap-1.5 text-[11px] font-medium text-[#4b647b]">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
          <span className="min-w-0 break-words">Up to {sendingLimits.emailsPerDayPerSmtp.toLocaleString()} per rolling 24 hours, per SMTP mailbox</span>
        </div>
      </div>
    </div>
    <p data-testid={`text-plan-total-send-capacity-${item.id}`} className="mt-2 text-[10px] leading-4 text-[#718192]">
      With all {item.emailAccountLimit} mailbox{item.emailAccountLimit === 1 ? '' : 'es'} configured: up to {combinedHourly.toLocaleString()} campaign attempts/hour and {combinedDaily.toLocaleString()}/24 hours. Retries count; provider limits may be lower.
    </p>

    <button data-testid={`button-purchase-plan-${item.id}`} onClick={onPurchase} disabled={disabled} className={`mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-center text-[12px] font-semibold leading-4 transition disabled:cursor-not-allowed disabled:opacity-60 ${featured ? 'bg-[#174f99] text-white hover:bg-[#103f7e]' : 'border border-[#d5dfe7] bg-white text-[#315879] hover:bg-[#f4f8fb]'}`}>
      {pending ? <><LoaderCircle className="h-4 w-4 shrink-0 animate-spin"/><span className="min-w-0 break-words">{item.amountMinor === 0 ? 'Activating free plan' : 'Starting secure checkout'}</span></> : <><span className="min-w-0 break-words">{item.amountMinor === 0 ? `Activate ${item.name}` : `Choose ${item.name}`}</span><ArrowRight className="h-4 w-4 shrink-0"/></>}
    </button>
  </article>;
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const packagesQuery = useListAvailableSubscriptionPackages();
  const currentQuery = useGetCurrentSubscription();
  const senderAccountsQuery = useListTenantSendingAccounts();
  const createOrder = useCreateSubscriptionOrder();
  const activateFree = useActivateFreeSubscription();
  const verifyPayment = useVerifyRazorpayPayment();
  const [checkoutOrder, setCheckoutOrder] = useState<SubscriptionOrderCreated | null>(null);
  const [paymentState, setPaymentState] = useState<{ kind: 'pending' | 'active' | 'error' | 'dismissed'; message: string } | null>(null);
  const [startingPackage, setStartingPackage] = useState<string | null>(null);
  const [pendingPackage, setPendingPackage] = useState<SubscriptionPackage | null>(null);
  const [senderAccountsToKeep, setSenderAccountsToKeep] = useState<string[]>([]);
  const packages = packagesQuery.data?.packages ?? [];
  const senderAccounts = senderAccountsQuery.data?.accounts ?? [];
  const activeSubscription = currentQuery.data?.subscription?.status === 'active' ? currentQuery.data.subscription : null;
  const busy = createOrder.isPending || activateFree.isPending || verifyPayment.isPending;

  const runVerification = (
    order: SubscriptionOrderCreated,
    response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string },
    retentionAnalytics?: { accountCount: number; retainedCount: number; accountLimit: number },
  ) => {
    setPaymentState({ kind: 'pending', message: 'Payment received. Waiting for server confirmation…' });
    verifyPayment.mutate({ data: {
      paymentId: order.paymentId,
      razorpayOrderId: response.razorpay_order_id || order.orderId,
      razorpayPaymentId: response.razorpay_payment_id,
      razorpaySignature: response.razorpay_signature,
    } }, {
      onSuccess: result => {
        if (result.status === 'active' && result.subscription) {
          trackEvent('paid_subscription_activated');
          if (retentionAnalytics) {
            trackSmtpSenderRetentionCompleted(
              retentionAnalytics.accountCount,
              retentionAnalytics.retainedCount,
              retentionAnalytics.accountLimit,
            );
          }
        } else if (result.status === 'pending') {
          trackPaidVerificationOutcome('pending');
        }
        setPaymentState({ kind: result.status, message: result.message });
        setCheckoutOrder(null);
        void queryClient.invalidateQueries({ queryKey: getGetCurrentSubscriptionQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListAvailableSubscriptionPackagesQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
      },
      onError: error => {
        trackPaidVerificationOutcome('failed');
        setPaymentState({ kind: 'error', message: errorText(error) });
      },
    });
  };

  const startPurchase = (pkg: SubscriptionPackage, accountIdsToKeep?: string[]) => {
    setPaymentState(null);
    setStartingPackage(pkg.id);
    if (pkg.amountMinor === 0) {
      activateFree.mutate({ data: { packageId: pkg.id, ...(accountIdsToKeep !== undefined ? { senderAccountIdsToKeep: accountIdsToKeep } : {}) } }, {
        onSuccess: result => {
          if (accountIdsToKeep !== undefined) {
            trackSmtpSenderRetentionCompleted(
              senderAccounts.length,
              accountIdsToKeep.length,
              pkg.emailAccountLimit,
            );
          }
          trackFreeActivationOutcome('activated');
          const startsAt = new Date(result.subscription.startsAt);
          const scheduled = startsAt.getTime() > Date.now();
          setPaymentState({
            kind: 'active',
            message: scheduled
              ? `${pkg.name} is scheduled to start on ${startsAt.toLocaleDateString()}. No payment or Razorpay order was required.`
              : `${pkg.name} is active now. No payment or Razorpay order was required.`,
          });
          setStartingPackage(null);
          void queryClient.invalidateQueries({ queryKey: getGetCurrentSubscriptionQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListAvailableSubscriptionPackagesQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
        },
        onError: error => {
          trackFreeActivationOutcome('failed');
          setStartingPackage(null);
          setPaymentState({ kind: 'error', message: errorText(error) });
        },
      });
      return;
    }
    createOrder.mutate({ data: { packageId: pkg.id, ...(accountIdsToKeep !== undefined ? { senderAccountIdsToKeep: accountIdsToKeep } : {}) } }, {
      onSuccess: async order => {
        setCheckoutOrder(order);
        try {
          await loadCheckoutScript();
          if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable in this browser.');
          const checkout = new window.Razorpay({
            key: order.keyId,
            amount: order.amountMinor,
            currency: order.currency,
            name: 'Mailflow',
            description: `${order.packageName} subscription`,
            order_id: order.orderId,
            prefill: { name: order.customerName, email: order.customerEmail },
            theme: { color: '#174f99' },
            handler: response => runVerification(
              order,
              response,
              accountIdsToKeep !== undefined
                ? {
                    accountCount: senderAccounts.length,
                    retainedCount: accountIdsToKeep.length,
                    accountLimit: pkg.emailAccountLimit,
                  }
                : undefined,
            ),
            modal: { ondismiss: () => {
              trackPaidCheckoutOutcome('dismissed');
              setCheckoutOrder(null);
              setPaymentState({ kind: 'dismissed', message: 'Checkout was closed before a payment was confirmed. You can try again whenever you are ready.' });
            } },
          });
          checkout.open();
          trackPaidCheckoutOutcome('started');
        } catch (error) {
          trackPaidCheckoutOutcome('setup_failed');
          setCheckoutOrder(null);
          setPaymentState({ kind: 'error', message: errorText(error) });
        } finally {
          setStartingPackage(null);
        }
      },
      onError: error => {
        trackPaidCheckoutOutcome('setup_failed');
        setStartingPackage(null);
        setPaymentState({ kind: 'error', message: errorText(error) });
      },
    });
  };

  const purchase = (pkg: SubscriptionPackage) => {
    setPaymentState(null);
    if (!senderAccountsQuery.data) {
      setPaymentState({ kind: 'error', message: 'SMTP sender accounts could not be checked. Retry before changing packages.' });
      return;
    }
    if (senderAccounts.length > pkg.emailAccountLimit) {
      const requiredIds = senderAccounts.filter(account => account.activeCampaignCount > 0).map(account => account.id);
      if (requiredIds.length > pkg.emailAccountLimit) {
        setPaymentState({ kind: 'error', message: 'This package allows fewer sender accounts than are currently used by queued or sending campaigns. Let those campaigns finish before changing packages.' });
        return;
      }
      const ranked = [...senderAccounts].sort((left, right) => {
        if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
        return new Date(right.lastUsedAt ?? 0).getTime() - new Date(left.lastUsedAt ?? 0).getTime();
      });
      const suggested = [...new Set([...requiredIds, ...ranked.map(account => account.id)])].slice(0, pkg.emailAccountLimit);
      setPendingPackage(pkg);
      setSenderAccountsToKeep(suggested);
      return;
    }
    startPurchase(pkg);
  };
  const toggleSenderRetention = (account: TenantSendingAccount, checked: boolean) => {
    setSenderAccountsToKeep(current => {
      if (!checked && account.activeCampaignCount > 0) return current;
      if (checked) return current.includes(account.id) ? current : [...current, account.id];
      return current.filter(id => id !== account.id);
    });
  };
  const confirmPackageChange = () => {
    if (!pendingPackage || senderAccountsToKeep.length !== pendingPackage.emailAccountLimit) return;
    const pkg = pendingPackage;
    const keepIds = [...senderAccountsToKeep];
    setPendingPackage(null);
    startPurchase(pkg, keepIds);
  };

  if (packagesQuery.isLoading || currentQuery.isLoading || senderAccountsQuery.isLoading) {
    return <div className="space-y-5" aria-label="Loading subscription plans" data-testid="loading-plans"><div className="h-8 w-64 animate-pulse rounded bg-[#e9eef2]"/><div className="h-32 animate-pulse rounded-lg bg-[#edf1f4]"/><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><div className="h-80 animate-pulse rounded-lg bg-[#edf1f4]"/><div className="h-80 animate-pulse rounded-lg bg-[#edf1f4]"/></div></div>;
  }
  if (packagesQuery.isError || currentQuery.isError || senderAccountsQuery.isError) {
    return <section className="rounded-lg border border-[#e1e6eb] bg-white p-6" data-testid="error-plans"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 text-[#bd692d]"/><div><h1 className="text-[15px] font-semibold text-[#1d2d40]">Plans could not be loaded</h1><p className="mt-1 text-[12px] text-[#748292]">Your subscription has not changed.</p><button data-testid="button-retry-plans" onClick={() => { void packagesQuery.refetch(); void currentQuery.refetch(); void senderAccountsQuery.refetch(); }} className="mt-4 rounded-md border border-[#d5dfe7] px-3 py-2 text-[11px] font-semibold text-[#315879]">Retry</button></div></div></section>;
  }

  return <div className="fade-in space-y-8">
    <header className="relative overflow-hidden rounded-lg border border-[#dce5ec] bg-[#eff5f9] px-5 py-7 md:px-8 md:py-8">
      <div className="relative z-[1] max-w-[700px]"><div className="mono mb-2 flex items-center gap-2 text-[9px] uppercase tracking-[.19em] text-[#58748e]"><span className="h-px w-6 bg-[#d7823c]"/>WORKSPACE BILLING</div>
        <h1 className="display text-[30px] font-bold leading-tight tracking-[-.05em] text-[#1a2e43] md:text-[37px]">Choose your Mailflow plan.</h1>
        <p className="mt-3 max-w-[570px] text-[13px] leading-6 text-[#64778a]">Choose a subscription term for your workspace. Paid plans use Razorpay Checkout; free plans activate without a payment order.</p>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -right-5 -top-16 hidden h-64 w-64 rounded-full border border-[#d5e1e9] md:block"><div className="absolute inset-7 rounded-full border border-[#d5e1e9]"/><div className="absolute inset-14 rounded-full border border-[#d5e1e9]"/><div className="absolute inset-[84px] rounded-full border border-[#d5e1e9]"/></div>
    </header>

    {activeSubscription ? <section data-testid="current-subscription" className="grid gap-4 rounded-lg border border-[#d7e6dd] bg-[#f4f9f5] p-5 md:grid-cols-[1fr_auto] md:items-center md:px-6">
      <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#4d795e]"><CheckCircle2 className="h-4 w-4"/>Current term active</div><h2 className="display mt-2 text-[20px] font-bold text-[#213a2e]">{activeSubscription.package.name}</h2><p data-testid="text-current-subscription-dates" className="mt-1 text-[12px] text-[#647b6b]">Started {new Date(activeSubscription.startsAt).toLocaleDateString()} · Ends {new Date(activeSubscription.endsAt).toLocaleDateString()}</p><p data-testid="text-current-subscription-contact-limit" className="mt-1 flex items-center gap-1.5 text-[11px] text-[#647b6b]"><Users className="h-3.5 w-3.5"/>Up to {activeSubscription.package.contactLimit.toLocaleString()} contacts</p><p data-testid="text-current-subscription-sender-limit" className="mt-1 flex items-center gap-1.5 text-[11px] text-[#647b6b]"><Mail className="h-3.5 w-3.5"/>Up to {activeSubscription.package.emailAccountLimit} SMTP sender account{activeSubscription.package.emailAccountLimit === 1 ? '' : 's'}</p></div>
      <span data-testid="status-current-subscription" className="flex items-center gap-2 rounded-md border border-[#dce9e0] bg-white px-3 py-2 text-[11px] font-semibold text-[#477154]"><Clock3 className="h-4 w-4"/>Active through {new Date(activeSubscription.endsAt).toLocaleDateString()}</span>
    </section> : <section data-testid="current-subscription" className="flex items-center gap-3 rounded-lg border border-[#e0e6eb] bg-white p-4 md:px-5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#f1f4f6] text-[#738394]"><CalendarClock className="h-4 w-4"/></span><div><h2 className="text-[12px] font-semibold text-[#34485d]">No active subscription</h2><p className="mt-0.5 text-[11px] text-[#798796]">Your workspace access term will appear here after payment is confirmed.</p></div></section>}

    {paymentState && <div role="status" data-testid="status-payment" className={`flex items-start gap-3 rounded-md border p-4 text-[12px] leading-5 ${paymentState.kind === 'active' ? 'border-[#d4e8dc] bg-[#f1f8f3] text-[#3c6d4f]' : paymentState.kind === 'pending' ? 'border-[#d6e3ef] bg-[#f3f7fb] text-[#385c7e]' : paymentState.kind === 'error' ? 'border-[#eed9ca] bg-[#fff8f2] text-[#965323]' : 'border-[#e2e6ea] bg-[#f7f8f9] text-[#647281]'}`}>
      {paymentState.kind === 'active' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/> : paymentState.kind === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0"/> : paymentState.kind === 'pending' ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin"/> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0"/>}
      <div><div className="font-semibold">{paymentState.kind === 'active' ? 'Subscription active' : paymentState.kind === 'pending' ? 'Payment verification pending' : paymentState.kind === 'error' ? 'Payment needs attention' : 'Checkout closed'}</div><p>{paymentState.message}</p></div>
    </div>}
    {(createOrder.isError || verifyPayment.isError) && !paymentState && <p role="alert" data-testid="status-payment-error" className="rounded-md border border-[#eed9ca] bg-[#fff8f2] p-3 text-[12px] text-[#965323]">{errorText(createOrder.error || verifyPayment.error)}</p>}

    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="mono mb-1 text-[9px] uppercase tracking-[.18em] text-[#8290a0]">AVAILABLE TERMS</div><h2 className="display text-[23px] font-bold text-[#1d2d40]">Select a package</h2></div><div className="flex items-center gap-2 text-[10px] text-[#718193]"><ShieldCheck className="h-4 w-4 text-[#48769e]"/>Verified server-side before activation</div></div>
      {packages.length === 0 ? <section data-testid="empty-plans" className="rounded-lg border border-dashed border-[#d8e1e8] bg-[#fbfcfd] px-6 py-12 text-center"><CreditCard className="mx-auto h-7 w-7 text-[#8798a8]"/><h3 className="mt-3 text-[14px] font-semibold text-[#2b3e51]">No plans are available right now</h3><p className="mt-1 text-[12px] text-[#778797]">Please check back later or contact your workspace administrator.</p></section> :
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{packages.map(pkg => <PackageCard key={pkg.id} item={pkg} featured={activeSubscription?.package.id === pkg.id} pending={startingPackage === pkg.id} disabled={busy || startingPackage !== null || checkoutOrder !== null || pendingPackage !== null} sendingLimits={packagesQuery.data!.sendingLimits} onPurchase={() => purchase(pkg)}/>)}</div>}
    </section>

    {pendingPackage && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#101d2a]/55 p-4" data-testid="dialog-sender-retention">
      <section role="dialog" aria-modal="true" aria-labelledby="sender-retention-title" className="my-auto w-full max-w-xl rounded-lg border border-[#dce3e9] bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">PACKAGE CHANGE</div><h2 id="sender-retention-title" className="display mt-2 text-[20px] font-bold text-[#1b293a]">Choose SMTP accounts to keep</h2></div>
          <button type="button" aria-label="Cancel package change" data-testid="button-cancel-sender-retention" onClick={() => setPendingPackage(null)} className="rounded px-2 py-1 text-[18px] text-[#667587] hover:bg-[#f1f4f6]">×</button>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-[#637284]">
          {pendingPackage.name} allows {pendingPackage.emailAccountLimit} SMTP sender account{pendingPackage.emailAccountLimit === 1 ? '' : 's'}. Select exactly {pendingPackage.emailAccountLimit} to retain. This change starts after your current term ends.
        </p>
        <p className="mt-2 rounded-md border border-[#efd9bd] bg-[#fff8ef] p-3 text-[11px] leading-5 text-[#895b2f]">
          On the start date, unselected SMTP accounts and their saved credentials will be permanently deleted. Accounts used by queued or sending campaigns must be kept until those campaigns finish.
        </p>
        <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-[#405469]">
          <span>Keep {senderAccountsToKeep.length} of {pendingPackage.emailAccountLimit}</span>
          <span>{senderAccounts.length} currently configured</span>
        </div>
        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
          {senderAccounts.map(account => <label key={account.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-[#e2e7ec] bg-[#fbfcfd] p-3">
            <input type="checkbox" data-testid={`checkbox-retain-sender-account-${account.id}`} checked={senderAccountsToKeep.includes(account.id)} disabled={account.activeCampaignCount > 0} onChange={event => toggleSenderRetention(account, event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#245b9b]"/>
            <span className="min-w-0 flex-1">
              <span data-testid={`text-retention-sender-account-${account.id}`} className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#2c3b4d]">{account.fromEmail}{account.isPrimary && <span className="rounded bg-[#e9f1f8] px-1.5 py-0.5 text-[9px] text-[#3a6388]">default</span>}</span>
              <span className="mt-1 block break-words text-[10px] text-[#778392]">{account.fromName} · {account.host} · {account.lastUsedAt ? `Last used ${new Date(account.lastUsedAt).toLocaleDateString()}` : 'Never used'}</span>
              {account.activeCampaignCount > 0 && <span className="mt-1 block text-[10px] text-[#895b2f]">Required: {account.activeCampaignCount} active campaign{account.activeCampaignCount === 1 ? '' : 's'}</span>}
            </span>
          </label>)}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#edf0f2] pt-4">
          <button type="button" data-testid="button-cancel-package-change" onClick={() => setPendingPackage(null)} className="min-h-10 rounded-md border border-[#d7dce3] px-4 text-[12px] font-semibold text-[#38485a] hover:bg-[#f7f9fb]">Cancel</button>
          <button type="button" data-testid="button-confirm-sender-retention" disabled={senderAccountsToKeep.length !== pendingPackage.emailAccountLimit || busy} onClick={confirmPackageChange} className="min-h-10 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {pendingPackage.amountMinor === 0 ? 'Activate package' : 'Continue to checkout'}
          </button>
        </div>
      </section>
    </div>}

    <footer className="flex flex-col gap-3 border-t border-[#e5eaee] pt-5 text-[10px] leading-5 text-[#82909d] sm:flex-row sm:items-center sm:justify-between"><span>Paid terms start after payment is verified; free terms activate without checkout. A new term starts after any current term ends. Renewals are manual, not recurring charges.</span><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5"/>Paid checkout by Razorpay</span></footer>
    {checkoutOrder && verifyPayment.isPending && <span className="sr-only" data-testid="text-checkout-order">Order {checkoutOrder.orderId} awaiting payment verification</span>}
  </div>;
}