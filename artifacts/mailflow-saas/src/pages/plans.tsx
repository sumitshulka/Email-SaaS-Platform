import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, Clock3, CreditCard, LoaderCircle, Mail, ShieldCheck, Sparkles, Users } from 'lucide-react';
import {
  getGetCompanyResearchAllowanceQueryKey, getGetCurrentSubscriptionQueryKey, getGetSubscriptionAddOnsQueryKey, getListAvailableSubscriptionPackagesQueryKey, getListContactsQueryKey,
  getListTenantSendingAccountsQueryKey,
  useActivateFreeAddOn, useActivateFreeSubscription, useCreateSubscriptionOrder, useGetCompanyResearchAllowance, useGetCurrentSubscription, useGetSubscriptionAddOns, useGetSubscriptionPaymentAvailability, useListAvailableSubscriptionPackages,
  useListContacts, useListTenantSendingAccounts, useVerifyRazorpayPayment,
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

const primaryLimitFields = [
  'contactLimit',
  'emailAccountLimit',
  'researchAllowance',
  'aiEmailAssistAllowance',
] as const;

type PlanAction = {
  label: string;
  mode: 'current' | 'scheduled' | 'blocked' | 'activate' | 'purchase' | 'upgrade' | 'no-cost-upgrade' | 'free-downgrade' | 'scheduled-change';
  requiresPayment: boolean;
  disabled: boolean;
};

type PlanSubscription = {
  status: string;
  startsAt: string;
  endsAt: string;
  package: SubscriptionPackage;
};

function comparePrimaryPlans(current: SubscriptionPackage, target: SubscriptionPackage) {
  const targetAtLeastAsHigh = primaryLimitFields.every(field => target[field] >= current[field]);
  const targetAtMostAsHigh = primaryLimitFields.every(field => target[field] <= current[field]);
  const exactlyEqual = primaryLimitFields.every(field => target[field] === current[field]);
  if (exactlyEqual) return 'same' as const;
  if (targetAtLeastAsHigh) return 'upgrade' as const;
  if (targetAtMostAsHigh) return 'downgrade' as const;
  return 'switch' as const;
}

function proratedUpgradeAmountMinor(current: SubscriptionPackage, target: SubscriptionPackage, endsAt: string) {
  if (current.currency !== target.currency) return null;
  const remainingMs = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const perDayDifference = target.amountMinor / target.periodDays - current.amountMinor / current.periodDays;
  if (remainingMs === 0 || perDayDifference <= 0) return 0;
  return Math.max(1, Math.round(perDayDifference * remainingMs / (24 * 60 * 60 * 1000)));
}

function getPlanAction(
  item: SubscriptionPackage,
  current: PlanSubscription | null | undefined,
  scheduled: PlanSubscription | null | undefined,
): PlanAction {
  if (current?.status === 'active' && current.package.id === item.id) {
    return { label: 'Current plan', mode: 'current', requiresPayment: false, disabled: true };
  }
  if (scheduled?.package.id === item.id) {
    return { label: `Scheduled for ${new Date(scheduled.startsAt).toLocaleDateString()}`, mode: 'scheduled', requiresPayment: false, disabled: true };
  }
  if (scheduled) {
    return { label: 'Another change is scheduled', mode: 'blocked', requiresPayment: false, disabled: true };
  }
  if (!current || current.status !== 'active') {
    return {
      label: item.amountMinor === 0 ? `Activate ${item.name}` : `Choose ${item.name}`,
      mode: item.amountMinor === 0 ? 'activate' : 'purchase',
      requiresPayment: item.amountMinor > 0,
      disabled: false,
    };
  }

  const changeKind = comparePrimaryPlans(current.package, item);
  const proration = changeKind === 'upgrade'
    ? proratedUpgradeAmountMinor(current.package, item, current.endsAt)
    : null;
  if (proration !== null) {
    return {
      label: proration > 0
        ? `Upgrade · ${formatMinor(proration, item.currency)}`
        : 'Upgrade · no extra charge',
      mode: proration > 0 ? 'upgrade' : 'no-cost-upgrade',
      requiresPayment: proration > 0,
      disabled: false,
    };
  }
  if (item.amountMinor === 0) {
    return { label: 'Schedule free plan', mode: 'free-downgrade', requiresPayment: false, disabled: false };
  }
  return {
    label: `Pay ${formatMinor(item.amountMinor, item.currency)} now · starts ${new Date(current.endsAt).toLocaleDateString()}`,
    mode: 'scheduled-change',
    requiresPayment: true,
    disabled: false,
  };
}

function PackageCard({ item, featured, scheduled, pending, disabled, action, onlinePaymentsEnabled, onPurchase, sendingLimits }: {
  item: SubscriptionPackage;
  featured: boolean;
  scheduled: boolean;
  pending: boolean;
  disabled: boolean;
  action: PlanAction;
  onlinePaymentsEnabled: boolean;
  onPurchase: () => void;
  sendingLimits: SubscriptionPackageList['sendingLimits'];
}) {
  const combinedHourly = sendingLimits.emailsPerHourPerSmtp * item.emailAccountLimit;
  const combinedDaily = sendingLimits.emailsPerDayPerSmtp * item.emailAccountLimit;
  const paidCheckoutUnavailable = action.requiresPayment && !onlinePaymentsEnabled;
  return <article data-testid={`card-plan-${item.id}`} className={`flex min-h-[330px] flex-col rounded-lg border p-4 sm:p-5 md:p-6 ${featured ? 'border-[#224e78] bg-[#f1f6fa] shadow-[0_8px_26px_rgba(35,70,104,.09)]' : 'border-[#e0e6eb] bg-white'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mono text-[9px] uppercase tracking-[.17em] text-[#7e8c9a]">MAILFLOW ACCESS</span>
          {featured && <span data-testid={`badge-current-package-${item.id}`} className="mono inline-flex shrink-0 items-center rounded-full border border-[#c8d8e5] bg-white/90 px-2 py-1 text-[8px] font-semibold uppercase leading-none tracking-[.08em] text-[#365b7b]">Current package</span>}
          {scheduled && <span data-testid={`badge-scheduled-package-${item.id}`} className="mono inline-flex shrink-0 items-center rounded-full border border-[#ead4b8] bg-[#fff8ef] px-2 py-1 text-[8px] font-semibold uppercase leading-none tracking-[.08em] text-[#865b2e]">Scheduled</span>}
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
          <span className="min-w-0 break-words">Up to {item.emailAccountLimit} base SMTP sender account{item.emailAccountLimit === 1 ? '' : 's'}; mailbox add-ons add slots</span>
        </div>
        <div data-testid={`text-plan-research-allowance-${item.id}`} className="flex min-w-0 items-start gap-1.5 text-[11px] font-medium text-[#4b647b]">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
          <span className="min-w-0 break-words">{item.researchAllowance === 0 ? 'Company research is not included in this package' : `${item.researchAllowance} company research run${item.researchAllowance === 1 ? '' : 's'} per term; queued retries count, and unused runs expire at term end`}</span>
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
      With all {item.emailAccountLimit} base mailbox{item.emailAccountLimit === 1 ? '' : 'es'} configured: up to {combinedHourly.toLocaleString()} campaign attempts/hour and {combinedDaily.toLocaleString()}/24 hours. Retries count; provider limits may be lower.
    </p>

    <button data-testid={`button-purchase-plan-${item.id}`} onClick={onPurchase} disabled={disabled || action.disabled || paidCheckoutUnavailable} className={`mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-center text-[12px] font-semibold leading-4 transition disabled:cursor-not-allowed disabled:opacity-60 ${featured ? 'bg-[#174f99] text-white hover:bg-[#103f7e]' : 'border border-[#d5dfe7] bg-white text-[#315879] hover:bg-[#f4f8fb]'}`}>
      {pending ? <><LoaderCircle className="h-4 w-4 shrink-0 animate-spin"/><span className="min-w-0 break-words">{action.requiresPayment ? 'Starting secure checkout' : 'Applying plan change'}</span></> : paidCheckoutUnavailable ? <><span className="min-w-0 break-words">Online payments unavailable</span><CircleAlert className="h-4 w-4 shrink-0"/></> : <><span className="min-w-0 break-words">{action.label}</span>{!action.disabled && <ArrowRight className="h-4 w-4 shrink-0"/>}</>}
    </button>
  </article>;
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const packagesQuery = useListAvailableSubscriptionPackages();
  const currentQuery = useGetCurrentSubscription();
  const addOnsQuery = useGetSubscriptionAddOns();
  const researchAllowanceQuery = useGetCompanyResearchAllowance({
    query: {
      queryKey: getGetCompanyResearchAllowanceQueryKey(),
      staleTime: 0,
      refetchOnMount: 'always',
    },
  });
  const contactUsageParams = { page: 1, pageSize: 1, includeHistory: false };
  const contactsUsageQuery = useListContacts(contactUsageParams, {
    query: {
      queryKey: getListContactsQueryKey(contactUsageParams),
      staleTime: 0,
      refetchOnMount: 'always',
    },
  });
  const paymentAvailabilityQuery = useGetSubscriptionPaymentAvailability();
  const senderAccountsQuery = useListTenantSendingAccounts();
  const createOrder = useCreateSubscriptionOrder();
  const activateFree = useActivateFreeSubscription();
  const activateFreeAddOn = useActivateFreeAddOn();
  const verifyPayment = useVerifyRazorpayPayment();
  const [checkoutOrder, setCheckoutOrder] = useState<SubscriptionOrderCreated | null>(null);
  const [paymentState, setPaymentState] = useState<{ kind: 'pending' | 'active' | 'error' | 'dismissed'; message: string; label?: string; nextStepHref?: string } | null>(null);
  const checkoutAutoStartRef = useRef<string | null>(null);
  const [startingPackage, setStartingPackage] = useState<string | null>(null);
  const [pendingPackage, setPendingPackage] = useState<SubscriptionPackage | null>(null);
  const [pendingPackageAccountLimit, setPendingPackageAccountLimit] = useState(1);
  const [senderAccountsToKeep, setSenderAccountsToKeep] = useState<string[]>([]);
  const packages = packagesQuery.data?.packages ?? [];
  const senderAccounts = senderAccountsQuery.data?.accounts ?? [];
  const onlinePaymentsEnabled = paymentAvailabilityQuery.data?.enabled === true;
  const activeSubscription = currentQuery.data?.subscription?.status === 'active' ? currentQuery.data.subscription : null;
  const scheduledSubscription = currentQuery.data?.scheduledSubscription ?? null;
  const primaryResearchUsage = researchAllowanceQuery.data?.allowance;
  const addOnDashboard = addOnsQuery.data;
  const addOnPackages = addOnDashboard?.packages ?? [];
  const busy = createOrder.isPending || activateFree.isPending || activateFreeAddOn.isPending || verifyPayment.isPending;
  const currentEmailAccountLimit =
    senderAccountsQuery.data?.emailAccountLimit ??
    activeSubscription?.package.emailAccountLimit ??
    0;
  const contactQuota = contactsUsageQuery.data?.quota;
  const configuredSenderCount = senderAccountsQuery.data?.configuredCount ?? senderAccounts.length;
  const primaryContactLimit = activeSubscription
    ? (contactQuota?.limit ?? activeSubscription.package.contactLimit)
    : 0;
  const primaryContactUsed = activeSubscription ? (contactQuota?.used ?? 0) : 0;
  const primaryContactRemaining = activeSubscription
    ? Math.max(0, contactQuota?.remaining ?? (primaryContactLimit - primaryContactUsed))
    : 0;
  const primarySenderLimit = activeSubscription?.package.emailAccountLimit ?? 0;
  const primarySenderUsed = Math.min(configuredSenderCount, primarySenderLimit);
  const primarySenderRemaining = Math.max(0, primarySenderLimit - primarySenderUsed);

  const packageAccountLimit = (pkg: SubscriptionPackage) =>
    pkg.emailAccountLimit +
    (pkg.packageType === 'primary' && pkg.amountMinor > 0
      ? addOnDashboard?.balances.mailboxes.additionalSlots ?? 0
      : 0);

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
        } else if (result.status === 'active' && result.addOnEntitlement) {
          trackEvent('paid_addon_activated');
        } else if (result.status === 'pending') {
          trackPaidVerificationOutcome('pending');
        }
        setPaymentState({
          kind: result.status,
          message: result.message,
          label: result.addOnEntitlement ? 'Add-on activated' : undefined,
        });
        setCheckoutOrder(null);
        void queryClient.invalidateQueries({ queryKey: getGetCurrentSubscriptionQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetSubscriptionAddOnsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetCompanyResearchAllowanceQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListAvailableSubscriptionPackagesQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
      },
      onError: error => {
        trackPaidVerificationOutcome('failed');
        setPaymentState({ kind: 'error', message: errorText(error) });
      },
    });
  };

  const startPurchase = (
    pkg: SubscriptionPackage,
    accountIdsToKeep?: string[],
    noCostPlanUpgrade = false,
  ) => {
    setPaymentState(null);
    setStartingPackage(pkg.id);
    if (pkg.amountMinor === 0 && pkg.packageType === 'addon') {
        activateFreeAddOn.mutate({ data: { packageId: pkg.id } }, {
          onSuccess: result => {
            trackEvent('free_addon_activated');
            setPaymentState({ kind: 'active', label: 'Add-on activated', message: result.message });
            setStartingPackage(null);
            void queryClient.invalidateQueries({ queryKey: getGetSubscriptionAddOnsQueryKey() });
            void queryClient.invalidateQueries({ queryKey: getGetCurrentSubscriptionQueryKey() });
            void queryClient.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
          },
          onError: error => {
            setStartingPackage(null);
            setPaymentState({ kind: 'error', message: errorText(error) });
          },
        });
        return;
    }
    if (pkg.amountMinor === 0 || noCostPlanUpgrade) {
      activateFree.mutate({ data: { packageId: pkg.id, ...(accountIdsToKeep !== undefined ? { senderAccountIdsToKeep: accountIdsToKeep } : {}) } }, {
        onSuccess: result => {
          if (accountIdsToKeep !== undefined) {
            trackSmtpSenderRetentionCompleted(
              senderAccounts.length,
              accountIdsToKeep.length,
              pkg.emailAccountLimit,
            );
          }
          if (pkg.amountMinor === 0) trackFreeActivationOutcome('activated');
          const startsAt = new Date(result.subscription.startsAt);
          const scheduled = startsAt.getTime() > Date.now();
          setPaymentState({
            kind: 'active',
            label: scheduled ? 'Plan change scheduled' : noCostPlanUpgrade ? 'Plan upgrade active' : undefined,
            nextStepHref: pkg.amountMinor === 0 && !scheduled ? '/sending-settings' : undefined,
            message: scheduled
              ? `${pkg.name} is scheduled to start on ${startsAt.toLocaleDateString()}. No payment is due for this change.`
              : noCostPlanUpgrade
                ? `${pkg.name} is active now through your current term expiry. The prorated difference was zero, so no payment was due.`
                : `${pkg.name} is active now. No payment or Razorpay order was required.`,
          });
          setStartingPackage(null);
          void queryClient.invalidateQueries({ queryKey: getGetCurrentSubscriptionQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetSubscriptionAddOnsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetCompanyResearchAllowanceQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListAvailableSubscriptionPackagesQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListTenantSendingAccountsQueryKey() });
        },
        onError: error => {
          if (pkg.amountMinor === 0) trackFreeActivationOutcome('failed');
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
            description: `${order.packageName} ${pkg.packageType === 'addon' ? 'add-on' : 'subscription'}`,
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
                     accountLimit: packageAccountLimit(pkg),
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
    if (pkg.amountMinor > 0 && !onlinePaymentsEnabled) {
      setPaymentState({
        kind: 'error',
        message: 'Online payments are not active at the moment. Please contact the platform administrator before starting a paid checkout.',
      });
      return;
    }
    if (pkg.packageType === 'addon') {
      startPurchase(pkg);
      return;
    }
    const action = getPlanAction(pkg, activeSubscription, scheduledSubscription);
    if (action.disabled) {
      setPaymentState({
        kind: 'error',
        message: scheduledSubscription
          ? 'A primary plan change is already scheduled. It must start before you can schedule another.'
          : 'This is already the active package.',
      });
      return;
    }
    if (!senderAccountsQuery.data) {
      setPaymentState({ kind: 'error', message: 'SMTP sender accounts could not be checked. Retry before changing packages.' });
      return;
    }
    const targetAccountLimit = packageAccountLimit(pkg);
    if (senderAccounts.length > targetAccountLimit) {
      const requiredIds = senderAccounts.filter(account => account.activeCampaignCount > 0).map(account => account.id);
      if (requiredIds.length > targetAccountLimit) {
        setPaymentState({ kind: 'error', message: 'This package allows fewer sender accounts than are currently used by queued or sending campaigns. Let those campaigns finish before changing packages.' });
        return;
      }
      const ranked = [...senderAccounts].sort((left, right) => {
        if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
        return new Date(right.lastUsedAt ?? 0).getTime() - new Date(left.lastUsedAt ?? 0).getTime();
      });
      const suggested = [...new Set([...requiredIds, ...ranked.map(account => account.id)])].slice(0, targetAccountLimit);
      setPendingPackage(pkg);
      setPendingPackageAccountLimit(targetAccountLimit);
      setSenderAccountsToKeep(suggested);
      return;
    }
    startPurchase(pkg, undefined, action.mode === 'no-cost-upgrade');
  };
  const toggleSenderRetention = (account: TenantSendingAccount, checked: boolean) => {
    setSenderAccountsToKeep(current => {
      if (!checked && account.activeCampaignCount > 0) return current;
      if (checked) return current.includes(account.id) ? current : [...current, account.id];
      return current.filter(id => id !== account.id);
    });
  };
  const confirmPackageChange = () => {
    if (!pendingPackage || senderAccountsToKeep.length !== pendingPackageAccountLimit) return;
    const pkg = pendingPackage;
    const keepIds = [...senderAccountsToKeep];
    setPendingPackage(null);
    startPurchase(
      pkg,
      keepIds,
      getPlanAction(pkg, activeSubscription, scheduledSubscription).mode === 'no-cost-upgrade',
    );
  };

  const checkoutPackageId = new URLSearchParams(window.location.search).get('checkout');
  useEffect(() => {
    if (!checkoutPackageId || checkoutAutoStartRef.current === checkoutPackageId) return;
    const isLoading =
      packagesQuery.isLoading ||
      currentQuery.isLoading ||
      addOnsQuery.isLoading ||
      researchAllowanceQuery.isLoading ||
      researchAllowanceQuery.isFetching ||
      contactsUsageQuery.isLoading ||
      contactsUsageQuery.isFetching ||
      senderAccountsQuery.isLoading ||
      paymentAvailabilityQuery.isLoading;
    if (isLoading) return;

    checkoutAutoStartRef.current = checkoutPackageId;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (
      packagesQuery.isError ||
      currentQuery.isError ||
      addOnsQuery.isError ||
      researchAllowanceQuery.isError ||
      contactsUsageQuery.isError ||
      senderAccountsQuery.isError ||
      paymentAvailabilityQuery.isError
    ) {
      setPaymentState({
        kind: 'error',
        message: 'We could not verify the account and plan details for checkout. Retry loading the page before trying again.',
      });
      return;
    }
    const selected = packages.find(item => item.id === checkoutPackageId);
    if (!selected) {
      setPaymentState({
        kind: 'error',
        message: 'The selected plan is no longer available. Choose a current plan below.',
      });
      return;
    }
    purchase(selected);
  }, [
    checkoutPackageId,
    packagesQuery.isLoading,
    currentQuery.isLoading,
    addOnsQuery.isLoading,
    researchAllowanceQuery.isLoading,
    researchAllowanceQuery.isFetching,
    contactsUsageQuery.isLoading,
    contactsUsageQuery.isFetching,
    senderAccountsQuery.isLoading,
    paymentAvailabilityQuery.isLoading,
  ]);

  if (packagesQuery.isLoading || currentQuery.isLoading || addOnsQuery.isLoading || researchAllowanceQuery.isLoading || researchAllowanceQuery.isFetching || contactsUsageQuery.isLoading || contactsUsageQuery.isFetching || senderAccountsQuery.isLoading) {
    return <div className="space-y-5" aria-label="Loading subscription plans" data-testid="loading-plans"><div className="h-8 w-64 animate-pulse rounded bg-[#e9eef2]"/><div className="h-32 animate-pulse rounded-lg bg-[#edf1f4]"/><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><div className="h-80 animate-pulse rounded-lg bg-[#edf1f4]"/><div className="h-80 animate-pulse rounded-lg bg-[#edf1f4]"/></div></div>;
  }
  if (packagesQuery.isError || currentQuery.isError || addOnsQuery.isError || researchAllowanceQuery.isError || contactsUsageQuery.isError || senderAccountsQuery.isError) {
    return <section className="rounded-lg border border-[#e1e6eb] bg-white p-6" data-testid="error-plans"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 text-[#bd692d]"/><div><h1 className="text-[15px] font-semibold text-[#1d2d40]">Plans could not be loaded</h1><p className="mt-1 text-[12px] text-[#748292]">Your subscription has not changed.</p><button data-testid="button-retry-plans" onClick={() => { void packagesQuery.refetch(); void currentQuery.refetch(); void addOnsQuery.refetch(); void researchAllowanceQuery.refetch(); void contactsUsageQuery.refetch(); void senderAccountsQuery.refetch(); }} className="mt-4 rounded-md border border-[#d5dfe7] px-3 py-2 text-[11px] font-semibold text-[#315879]">Retry</button></div></div></section>;
  }

  return <div className="fade-in space-y-8">
    <header className="relative overflow-hidden rounded-lg border border-[#dce5ec] bg-[#eff5f9] px-5 py-7 md:px-8 md:py-8">
      <div className="relative z-[1] max-w-[700px]"><div className="mono mb-2 flex items-center gap-2 text-[9px] uppercase tracking-[.19em] text-[#58748e]"><span className="h-px w-6 bg-[#d7823c]"/>WORKSPACE BILLING</div>
        <h1 className="display text-[30px] font-bold leading-tight tracking-[-.05em] text-[#1a2e43] md:text-[37px]">Manage your Mailflow plan.</h1>
        <p className="mt-3 max-w-[650px] text-[13px] leading-6 text-[#64778a]">Higher-limit upgrades start immediately and charge only the prorated price difference through your current expiry. Downgrades and other plan changes are paid once now and start after the current term. Plans do not auto-renew.</p>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -right-5 -top-16 hidden h-64 w-64 rounded-full border border-[#d5e1e9] md:block"><div className="absolute inset-7 rounded-full border border-[#d5e1e9]"/><div className="absolute inset-14 rounded-full border border-[#d5e1e9]"/><div className="absolute inset-[84px] rounded-full border border-[#d5e1e9]"/></div>
    </header>

    {activeSubscription ? (
      <section data-testid="current-subscription" className="grid gap-4 rounded-lg border border-[#d7e6dd] bg-[#f4f9f5] p-5 md:grid-cols-[1fr_auto] md:items-center md:px-6">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#4d795e]"><CheckCircle2 className="h-4 w-4"/>Current term active</div>
          <h2 className="display mt-2 text-[20px] font-bold text-[#213a2e]">{activeSubscription.package.name}</h2>
          <p data-testid="text-current-subscription-dates" className="mt-1 text-[12px] text-[#647b6b]">Started {new Date(activeSubscription.startsAt).toLocaleDateString()} · Ends {new Date(activeSubscription.endsAt).toLocaleDateString()}</p>
          <p data-testid="text-current-subscription-contact-limit" className="mt-1 flex items-center gap-1.5 text-[11px] text-[#647b6b]"><Users className="h-3.5 w-3.5"/>Up to {activeSubscription.package.contactLimit.toLocaleString()} contacts</p>
          <p data-testid="text-current-subscription-sender-limit" className="mt-1 flex items-center gap-1.5 text-[11px] text-[#647b6b]"><Mail className="h-3.5 w-3.5"/>Up to {currentEmailAccountLimit} SMTP sender account{currentEmailAccountLimit === 1 ? '' : 's'} (including active mailbox add-ons)</p>
          <p data-testid="text-current-subscription-research-allowance" className="mt-1 flex items-center gap-1.5 text-[11px] text-[#647b6b]"><Clock3 className="h-3.5 w-3.5"/>{activeSubscription.package.researchAllowance === 0 ? 'No company research runs are included this term' : `Up to ${activeSubscription.package.researchAllowance} company research run${activeSubscription.package.researchAllowance === 1 ? '' : 's'} this term; unused runs expire at term end`}</p>
        </div>
        <span data-testid="status-current-subscription" className="flex items-center gap-2 rounded-md border border-[#dce9e0] bg-white px-3 py-2 text-[11px] font-semibold text-[#477154]"><Clock3 className="h-4 w-4"/>Active through {new Date(activeSubscription.endsAt).toLocaleDateString()}</span>
      </section>
    ) : (
      <section data-testid="current-subscription" className="flex items-center gap-3 rounded-lg border border-[#e0e6eb] bg-white p-4 md:px-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#f1f4f6] text-[#738394]"><CalendarClock className="h-4 w-4"/></span>
        <div><h2 className="text-[12px] font-semibold text-[#34485d]">No active subscription</h2><p className="mt-0.5 text-[11px] text-[#798796]">Your workspace access term will appear here after payment is confirmed.</p></div>
      </section>
    )}

    {scheduledSubscription && <section data-testid="scheduled-plan-change" className="grid gap-3 rounded-lg border border-[#ead8be] bg-[#fff9f1] p-4 sm:grid-cols-[auto_1fr] sm:items-start">
      <span className="grid h-9 w-9 place-items-center rounded-md bg-white text-[#926332]"><CalendarClock className="h-4 w-4"/></span>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#895d31]">Next plan scheduled</div>
        <h2 className="display mt-1 text-[17px] font-bold text-[#49351f]">{scheduledSubscription.package.name}</h2>
        <p data-testid="text-scheduled-plan-date" className="mt-1 text-[11px] leading-5 text-[#735b3d]">
          Starts {new Date(scheduledSubscription.startsAt).toLocaleDateString()} and runs for {durationLabel(scheduledSubscription.package.periodDays)}.
          {scheduledSubscription.package.amountMinor === 0
            ? ' No payment is due.'
            : ' The one-time payment is already made; there will be no automatic renewal.'}
          {' '}You can schedule another primary plan change after this one starts.
        </p>
      </div>
    </section>}

    <section data-testid="subscription-primary-usage" className="rounded-lg border border-[#dce5ec] bg-[#f8fbfd] p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">PRIMARY PACKAGE</div>
          <h2 className="display mt-1 text-[19px] font-bold text-[#1d2d40]">Primary plan usage</h2>
          <p className="mt-1 text-[11px] leading-5 text-[#718192]">Company research runs included with your primary package for the current term.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${activeSubscription ? 'bg-[#eaf5ef] text-[#397451]' : 'bg-[#f2f4f6] text-[#6c7a88]'}`}>
          {activeSubscription ? 'Term-based allowance' : 'No active primary plan'}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          {
            key: 'research',
            title: 'Company research',
            detail: 'Runs included for this subscription term; queued retries count.',
            total: activeSubscription ? primaryResearchUsage?.limit ?? 0 : 0,
            used: activeSubscription ? primaryResearchUsage?.used ?? 0 : 0,
            remaining: activeSubscription ? primaryResearchUsage?.remaining ?? 0 : 0,
            unit: 'runs',
          },
          {
            key: 'contacts',
            title: 'Contacts',
            detail: 'Contact records allowed in your workspace.',
            total: primaryContactLimit,
            used: primaryContactUsed,
            remaining: primaryContactRemaining,
            unit: 'contacts',
          },
          {
            key: 'smtp-accounts',
            title: 'SMTP sender accounts',
            detail: 'Primary-plan slots only; additional mailbox slots are tracked under add-ons.',
            total: primarySenderLimit,
            used: primarySenderUsed,
            remaining: primarySenderRemaining,
            unit: 'accounts',
          },
        ].map(metric => (
          <article key={metric.key} data-testid={`primary-balance-${metric.key}`} className="rounded-md border border-[#e3e8ed] bg-white p-4">
            <h3 className="text-[11px] font-semibold text-[#42566b]">{metric.title}</h3>
            <p className="mt-1 min-h-8 text-[10px] leading-4 text-[#788796]">{metric.detail}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div><strong data-testid={`primary-${metric.key}-total`} className="block text-[17px] text-[#24394e]">{metric.total.toLocaleString()}</strong><span className="text-[9px] text-[#788796]">Total {metric.unit}</span></div>
              <div><strong data-testid={`primary-${metric.key}-used`} className="block text-[17px] text-[#24394e]">{metric.used.toLocaleString()}</strong><span className="text-[9px] text-[#788796]">Used</span></div>
              <div><strong data-testid={`primary-${metric.key}-remaining`} className="block text-[17px] text-[#24394e]">{metric.remaining.toLocaleString()}</strong><span className="text-[9px] text-[#788796]">Remaining</span></div>
            </div>
            {metric.key === 'contacts' && primaryContactUsed > primaryContactLimit && (
              <p className="mt-3 text-[10px] font-medium text-[#aa5d37]">Usage is {primaryContactUsed - primaryContactLimit} contacts above this plan’s limit.</p>
            )}
            {metric.key === 'smtp-accounts' && (
              <p className="mt-3 text-[10px] text-[#788796]">
                {configuredSenderCount} account{configuredSenderCount === 1 ? '' : 's'} configured; active add-on slots are shown separately.
              </p>
            )}
            {!activeSubscription && <p className="mt-3 text-[10px] text-[#788796]">Choose a primary plan to activate this allowance.</p>}
          </article>
        ))}
      </div>
    </section>

    <section data-testid="subscription-add-on-balances" className="rounded-lg border border-[#e0e6eb] bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">PURCHASED ADD-ONS</div><h2 className="display mt-1 text-[19px] font-bold text-[#1d2d40]">Add-on balances</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#718192]">Unused credits and mailbox slots stay on your workspace. They pause when a paid primary plan ends and resume when you start another paid plan.</p></div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${addOnDashboard?.eligible ? 'bg-[#eaf5ef] text-[#397451]' : 'bg-[#f2f4f6] text-[#6c7a88]'}`}>{addOnDashboard?.eligible ? 'Available on paid plan' : 'Paused until paid plan'}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { key: 'research', title: 'Company research', value: addOnDashboard?.balances.research, unit: 'credits' },
          { key: 'emailAssist', title: 'AI Email Assist', value: addOnDashboard?.balances.emailAssist, unit: 'drafts' },
        ].map(metric => <article key={metric.key} data-testid={`addon-balance-${metric.key}`} className="rounded-md border border-[#e3e8ed] bg-[#f8fafb] p-3.5">
          <h3 className="text-[11px] font-semibold text-[#42566b]">{metric.title}</h3>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div><strong className="block text-[15px] text-[#24394e]">{metric.value?.total ?? 0}</strong><span className="text-[9px] text-[#788796]">Total {metric.unit}</span></div>
            <div><strong className="block text-[15px] text-[#24394e]">{metric.value?.used ?? 0}</strong><span className="text-[9px] text-[#788796]">Used</span></div>
            <div><strong className="block text-[15px] text-[#24394e]">{metric.value?.remaining ?? 0}</strong><span className="text-[9px] text-[#788796]">Remaining</span></div>
          </div>
        </article>)}
        <article data-testid="addon-balance-mailboxes" className="rounded-md border border-[#e3e8ed] bg-[#f8fafb] p-3.5">
          <h3 className="text-[11px] font-semibold text-[#42566b]">Additional SMTP slots</h3>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div><strong className="block text-[15px] text-[#24394e]">{addOnDashboard?.balances.mailboxes.additionalSlots ?? 0}</strong><span className="text-[9px] text-[#788796]">Total</span></div>
            <div><strong className="block text-[15px] text-[#24394e]">{Math.min(addOnDashboard?.balances.mailboxes.additionalSlots ?? 0, Math.max(0, (addOnDashboard?.balances.mailboxes.used ?? 0) - (addOnDashboard?.balances.mailboxes.baseLimit ?? 0)))}</strong><span className="text-[9px] text-[#788796]">Used</span></div>
            <div><strong className="block text-[15px] text-[#24394e]">{Math.max(0, (addOnDashboard?.balances.mailboxes.additionalSlots ?? 0) - Math.max(0, (addOnDashboard?.balances.mailboxes.used ?? 0) - (addOnDashboard?.balances.mailboxes.baseLimit ?? 0)))}</strong><span className="text-[9px] text-[#788796]">Remaining</span></div>
          </div>
          <p className="mt-2 text-[9px] leading-4 text-[#778596]">Current usable limit: {addOnDashboard?.balances.mailboxes.totalLimit ?? 0} total ({addOnDashboard?.balances.mailboxes.baseLimit ?? 0} base + add-on slots). {addOnDashboard?.balances.mailboxes.active ? 'Add-on slots are active.' : 'Add-on slots are paused until a paid primary plan is active.'}</p>
        </article>
      </div>
    </section>

    <section data-testid="subscription-add-on-catalog">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="mono mb-1 text-[9px] uppercase tracking-[.18em] text-[#8290a0]">OPTIONAL CAPACITY</div><h2 className="display text-[23px] font-bold text-[#1d2d40]">Add-on packages</h2><p className="mt-1 text-[11px] text-[#718192]">Add credits or SMTP mailbox slots to a paid primary subscription. Add-ons are separate purchases; primary-plan upgrade and downgrade rules do not apply to them.</p></div><Sparkles className="h-5 w-5 text-[#52799c]"/></div>
      {!addOnDashboard?.eligible
        ? <div data-testid="notice-addon-eligibility" className="rounded-lg border border-[#dfe5ea] bg-[#f8fafb] p-4 text-[12px] leading-5 text-[#627487]">Add-ons are available only while an active paid primary plan is in effect. Existing balances are preserved and will resume on a future paid plan.</div>
        : addOnPackages.length === 0
          ? <div data-testid="empty-addon-packages" className="rounded-lg border border-dashed border-[#d8e1e8] bg-[#fbfcfd] px-6 py-8 text-center text-[12px] text-[#778797]">No add-on packages are available right now.</div>
          : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{addOnPackages.map(pkg => {
            const alreadyClaimed = pkg.amountMinor === 0 && addOnDashboard.claimedFreePackageIds.includes(pkg.id);
            const paymentBlocked = pkg.amountMinor > 0 && !onlinePaymentsEnabled;
            return <article key={pkg.id} data-testid={`card-addon-${pkg.id}`} className="flex min-h-[245px] flex-col rounded-lg border border-[#dfe6ec] bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3"><div><span className="mono text-[9px] uppercase tracking-[.16em] text-[#7c8b9a]">MAILFLOW ADD-ON</span><h3 className="display mt-2 text-[19px] font-bold text-[#1d2d40]">{pkg.name}</h3></div><Sparkles className="mt-1 h-4 w-4 shrink-0 text-[#52799c]"/></div>
              <p className="mt-2 min-h-9 text-[11px] leading-5 text-[#718192]">{pkg.description || 'Additional capacity for your Mailflow workspace.'}</p>
              <div className="mt-3 space-y-1 text-[11px] font-medium text-[#49627a]">
                {pkg.researchAllowance > 0 && <p>{pkg.researchAllowance} company research credits</p>}
                {pkg.aiEmailAssistAllowance > 0 && <p>{pkg.aiEmailAssistAllowance} AI Email Assist credits</p>}
                {pkg.additionalMailboxCount > 0 && <p>{pkg.additionalMailboxCount} additional SMTP mailbox slots</p>}
              </div>
              <div className="mt-auto flex items-end justify-between gap-2 border-t border-[#e6ebef] pt-3">
                <strong className="text-[17px] text-[#20354a]">{pkg.amountMinor === 0 ? 'Free' : formatMinor(pkg.amountMinor, pkg.currency)}</strong>
                <button data-testid={`button-purchase-addon-${pkg.id}`} type="button" disabled={busy || startingPackage !== null || checkoutOrder !== null || alreadyClaimed || paymentBlocked} onClick={() => purchase(pkg)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[#174f99] px-3 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55">
                  {startingPackage === pkg.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin"/> : null}
                  {alreadyClaimed ? 'Already activated' : paymentBlocked ? 'Payments unavailable' : pkg.amountMinor === 0 ? 'Activate free add-on' : 'Buy add-on'}
                </button>
              </div>
            </article>;
          })}</div>}
    </section>

    {paymentState && <div role="status" data-testid="status-payment" className={`flex items-start gap-3 rounded-md border p-4 text-[12px] leading-5 ${paymentState.kind === 'active' ? 'border-[#d4e8dc] bg-[#f1f8f3] text-[#3c6d4f]' : paymentState.kind === 'pending' ? 'border-[#d6e3ef] bg-[#f3f7fb] text-[#385c7e]' : paymentState.kind === 'error' ? 'border-[#eed9ca] bg-[#fff8f2] text-[#965323]' : 'border-[#e2e6ea] bg-[#f7f8f9] text-[#647281]'}`}>
      {paymentState.kind === 'active' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/> : paymentState.kind === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0"/> : paymentState.kind === 'pending' ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin"/> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0"/>}
      <div><div className="font-semibold">{paymentState.label ?? (paymentState.kind === 'active' ? 'Subscription active' : paymentState.kind === 'pending' ? 'Payment verification pending' : paymentState.kind === 'error' ? 'Payment needs attention' : 'Checkout closed')}</div><p>{paymentState.message}</p>{paymentState.nextStepHref && <Link href={paymentState.nextStepHref} data-testid="link-free-plan-smtp-setup" className="mt-2 inline-flex items-center gap-1 font-semibold text-[#245b9b] underline underline-offset-2">Set up your SMTP sending account <ArrowRight className="h-3.5 w-3.5"/></Link>}</div>
    </div>}
    {(createOrder.isError || verifyPayment.isError) && !paymentState && <p role="alert" data-testid="status-payment-error" className="rounded-md border border-[#eed9ca] bg-[#fff8f2] p-3 text-[12px] text-[#965323]">{errorText(createOrder.error || verifyPayment.error)}</p>}
    {paymentAvailabilityQuery.data?.enabled === false && <section data-testid="notice-online-payments-disabled" role="status" className="rounded-md border border-[#ead9c5] bg-[#fff8ef] p-4 text-[12px] leading-5 text-[#76552f]">
      <p className="font-semibold text-[#684822]">Online payments are not active at the moment.</p>
      <p className="mt-1">
        Please send an email to{' '}
        {paymentAvailabilityQuery.data.superadminEmail
          ? <a className="font-semibold underline underline-offset-2" href={`mailto:${paymentAvailabilityQuery.data.superadminEmail}`}>{paymentAvailabilityQuery.data.superadminEmail}</a>
          : 'your platform administrator'}{' '}
        to activate your account.
      </p>
    </section>}
    {paymentAvailabilityQuery.isError && <section data-testid="notice-online-payment-status-error" role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#ead9c5] bg-[#fff8ef] p-4 text-[12px] leading-5 text-[#76552f]">
      <p>Online payment availability could not be checked. Paid checkout is unavailable for now; free plans can still be activated.</p>
      <button type="button" data-testid="button-retry-payment-availability" onClick={() => { void paymentAvailabilityQuery.refetch(); }} className="rounded-md border border-[#d8c5ad] px-3 py-1.5 text-[11px] font-semibold text-[#684822]">Retry</button>
    </section>}

    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="mono mb-1 text-[9px] uppercase tracking-[.18em] text-[#8290a0]">PRIMARY PLANS</div><h2 className="display text-[23px] font-bold text-[#1d2d40]">Choose a plan change</h2><p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#718192]">Upgrade amounts are prorated to your current expiry. Downgrades and other switches are charged once when selected and begin at that expiry.</p></div><div className="flex items-center gap-2 text-[10px] text-[#718193]"><ShieldCheck className="h-4 w-4 text-[#48769e]"/>Verified server-side before activation</div></div>
      {packages.length === 0 ? <section data-testid="empty-plans" className="rounded-lg border border-dashed border-[#d8e1e8] bg-[#fbfcfd] px-6 py-12 text-center"><CreditCard className="mx-auto h-7 w-7 text-[#8798a8]"/><h3 className="mt-3 text-[14px] font-semibold text-[#2b3e51]">No plans are available right now</h3><p className="mt-1 text-[12px] text-[#778797]">Please check back later or contact your workspace administrator.</p></section> :
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{packages.map(pkg => {
          const action = getPlanAction(pkg, activeSubscription, scheduledSubscription);
          return <PackageCard key={pkg.id} item={pkg} featured={activeSubscription?.package.id === pkg.id} scheduled={scheduledSubscription?.package.id === pkg.id} action={action} pending={startingPackage === pkg.id} disabled={busy || startingPackage !== null || checkoutOrder !== null || pendingPackage !== null} onlinePaymentsEnabled={onlinePaymentsEnabled} sendingLimits={packagesQuery.data!.sendingLimits} onPurchase={() => purchase(pkg)}/>;
        })}</div>}
    </section>

    {pendingPackage && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#101d2a]/55 p-4" data-testid="dialog-sender-retention">
      <section role="dialog" aria-modal="true" aria-labelledby="sender-retention-title" className="my-auto w-full max-w-xl rounded-lg border border-[#dce3e9] bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#778596]">PACKAGE CHANGE</div><h2 id="sender-retention-title" className="display mt-2 text-[20px] font-bold text-[#1b293a]">Choose SMTP accounts to keep</h2></div>
          <button type="button" aria-label="Cancel package change" data-testid="button-cancel-sender-retention" onClick={() => setPendingPackage(null)} className="rounded px-2 py-1 text-[18px] text-[#667587] hover:bg-[#f1f4f6]">×</button>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-[#637284]">
          {pendingPackage.name} allows {pendingPackageAccountLimit} SMTP sender account{pendingPackageAccountLimit === 1 ? '' : 's'} including active paid add-on slots. Select exactly {pendingPackageAccountLimit} to retain.
          {getPlanAction(pendingPackage, activeSubscription, scheduledSubscription).mode === 'upgrade' ||
          getPlanAction(pendingPackage, activeSubscription, scheduledSubscription).mode === 'no-cost-upgrade'
            ? ' This upgrade takes effect immediately after checkout.'
            : activeSubscription
              ? ` This change starts after your current term ends on ${new Date(activeSubscription.endsAt).toLocaleDateString()}.`
              : ' This package starts when activation or payment is confirmed.'}
        </p>
        <p className="mt-2 rounded-md border border-[#efd9bd] bg-[#fff8ef] p-3 text-[11px] leading-5 text-[#895b2f]">
          On the start date, unselected SMTP accounts and their saved credentials will be permanently deleted. Accounts used by queued or sending campaigns must be kept until those campaigns finish.
        </p>
        <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-[#405469]">
          <span>Keep {senderAccountsToKeep.length} of {pendingPackageAccountLimit}</span>
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
          <button type="button" data-testid="button-confirm-sender-retention" disabled={senderAccountsToKeep.length !== pendingPackageAccountLimit || busy} onClick={confirmPackageChange} className="min-h-10 rounded-md bg-[#174f99] px-4 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {getPlanAction(pendingPackage, activeSubscription, scheduledSubscription).mode === 'no-cost-upgrade'
              ? 'Apply upgrade'
              : pendingPackage.amountMinor === 0
                ? 'Schedule free plan'
                : getPlanAction(pendingPackage, activeSubscription, scheduledSubscription).mode === 'upgrade'
                  ? 'Continue to prorated checkout'
                  : 'Continue to checkout'}
          </button>
        </div>
      </section>
    </div>}

    <footer className="flex flex-col gap-3 border-t border-[#e5eaee] pt-5 text-[10px] leading-5 text-[#82909d] sm:flex-row sm:items-center sm:justify-between"><span>Upgrades are prorated through the current expiry. Downgrades are paid once at selection and start at term end. Free plans need no checkout. No plan renews automatically.</span><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5"/>Paid checkout by Razorpay</span></footer>
    {checkoutOrder && verifyPayment.isPending && <span className="sr-only" data-testid="text-checkout-order">Order {checkoutOrder.orderId} awaiting payment verification</span>}
  </div>;
}