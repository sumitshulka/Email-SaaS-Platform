import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, Clock3, CreditCard, LoaderCircle, ShieldCheck, Users } from 'lucide-react';
import {
  getGetCurrentSubscriptionQueryKey, getListAvailableSubscriptionPackagesQueryKey,
  useCreateSubscriptionOrder, useGetCurrentSubscription, useListAvailableSubscriptionPackages,
  useVerifyRazorpayPayment,
} from '@workspace/api-client-react';
import type { SubscriptionOrderCreated, SubscriptionPackage } from '@workspace/api-client-react';

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
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('Razorpay Checkout did not initialize.'));
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded. Check your connection and try again.'));
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

function PackageCard({ item, featured, pending, disabled, onPurchase }: {
  item: SubscriptionPackage; featured: boolean; pending: boolean; disabled: boolean; onPurchase: () => void;
}) {
  return <article data-testid={`card-plan-${item.id}`} className={`relative flex min-h-[330px] flex-col overflow-hidden rounded-lg border p-5 md:p-6 ${featured ? 'border-[#224e78] bg-[#f1f6fa] shadow-[0_8px_26px_rgba(35,70,104,.09)]' : 'border-[#e0e6eb] bg-white'}`}>
    {featured && <div className="mono absolute right-0 top-0 rounded-bl-md bg-[#214f7c] px-3 py-2 text-[9px] uppercase tracking-[.14em] text-white">Current package</div>}
    <div className="flex items-start justify-between gap-3"><div><div className="mono text-[9px] uppercase tracking-[.17em] text-[#7e8c9a]">MAILFLOW ACCESS</div><h2 className="display mt-2 text-[22px] font-bold leading-tight text-[#1d2d40]">{item.name}</h2></div><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#e5eef6] text-[#345f87]"><CreditCard className="h-[17px] w-[17px]"/></span></div>
    <p className="mt-4 min-h-[44px] text-[12px] leading-5 text-[#6c7b8a]">{item.description || 'A reliable subscription term for your Mailflow workspace.'}</p>
      <div className="mt-6 border-t border-[#dfe7ed] pt-5"><div className="flex items-baseline gap-2"><span data-testid={`text-plan-price-${item.id}`} className="display text-[29px] font-bold tracking-[-.05em] text-[#1b3045]">{formatMinor(item.amountMinor, item.currency)}</span><span className="text-[11px] text-[#768595]">{item.currency}</span></div><div data-testid={`text-plan-period-${item.id}`} className="mt-1 flex items-center gap-1.5 text-[11px] text-[#718192]"><CalendarClock className="h-3.5 w-3.5"/>Access for {durationLabel(item.periodDays)}</div><div data-testid={`text-plan-contact-limit-${item.id}`} className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-[#4b647b]"><Users className="h-3.5 w-3.5"/>Up to {item.contactLimit.toLocaleString()} contacts</div></div>
    <button data-testid={`button-purchase-plan-${item.id}`} onClick={onPurchase} disabled={disabled} className={`mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${featured ? 'bg-[#174f99] text-white hover:bg-[#103f7e]' : 'border border-[#d5dfe7] bg-white text-[#315879] hover:bg-[#f4f8fb]'}`}>
      {pending ? <><LoaderCircle className="h-4 w-4 animate-spin"/>Starting secure checkout</> : <>Choose {item.name}<ArrowRight className="h-4 w-4"/></>}
    </button>
  </article>;
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const packagesQuery = useListAvailableSubscriptionPackages();
  const currentQuery = useGetCurrentSubscription();
  const createOrder = useCreateSubscriptionOrder();
  const verifyPayment = useVerifyRazorpayPayment();
  const [checkoutOrder, setCheckoutOrder] = useState<SubscriptionOrderCreated | null>(null);
  const [paymentState, setPaymentState] = useState<{ kind: 'pending' | 'active' | 'error' | 'dismissed'; message: string } | null>(null);
  const [startingPackage, setStartingPackage] = useState<string | null>(null);
  const packages = packagesQuery.data?.packages ?? [];
  const activeSubscription = currentQuery.data?.subscription?.status === 'active' ? currentQuery.data.subscription : null;
  const busy = createOrder.isPending || verifyPayment.isPending;

  const runVerification = (order: SubscriptionOrderCreated, response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
    setPaymentState({ kind: 'pending', message: 'Payment received. Waiting for server confirmation…' });
    verifyPayment.mutate({ data: {
      paymentId: order.paymentId,
      razorpayOrderId: response.razorpay_order_id || order.orderId,
      razorpayPaymentId: response.razorpay_payment_id,
      razorpaySignature: response.razorpay_signature,
    } }, {
      onSuccess: result => {
        setPaymentState({ kind: result.status, message: result.message });
        setCheckoutOrder(null);
        void queryClient.invalidateQueries({ queryKey: getGetCurrentSubscriptionQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListAvailableSubscriptionPackagesQueryKey() });
      },
      onError: error => setPaymentState({ kind: 'error', message: errorText(error) }),
    });
  };

  const purchase = (pkg: SubscriptionPackage) => {
    setPaymentState(null);
    setStartingPackage(pkg.id);
    createOrder.mutate({ data: { packageId: pkg.id } }, {
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
            handler: response => runVerification(order, response),
            modal: { ondismiss: () => {
              setCheckoutOrder(null);
              setPaymentState({ kind: 'dismissed', message: 'Checkout was closed before a payment was confirmed. You can try again whenever you are ready.' });
            } },
          });
          checkout.open();
        } catch (error) {
          setCheckoutOrder(null);
          setPaymentState({ kind: 'error', message: errorText(error) });
        } finally {
          setStartingPackage(null);
        }
      },
      onError: error => {
        setStartingPackage(null);
        setPaymentState({ kind: 'error', message: errorText(error) });
      },
    });
  };

  if (packagesQuery.isLoading || currentQuery.isLoading) {
    return <div className="space-y-5" aria-label="Loading subscription plans" data-testid="loading-plans"><div className="h-8 w-64 animate-pulse rounded bg-[#e9eef2]"/><div className="h-32 animate-pulse rounded-lg bg-[#edf1f4]"/><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><div className="h-80 animate-pulse rounded-lg bg-[#edf1f4]"/><div className="h-80 animate-pulse rounded-lg bg-[#edf1f4]"/></div></div>;
  }
  if (packagesQuery.isError || currentQuery.isError) {
    return <section className="rounded-lg border border-[#e1e6eb] bg-white p-6" data-testid="error-plans"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 text-[#bd692d]"/><div><h1 className="text-[15px] font-semibold text-[#1d2d40]">Plans could not be loaded</h1><p className="mt-1 text-[12px] text-[#748292]">Your subscription has not changed.</p><button data-testid="button-retry-plans" onClick={() => { void packagesQuery.refetch(); void currentQuery.refetch(); }} className="mt-4 rounded-md border border-[#d5dfe7] px-3 py-2 text-[11px] font-semibold text-[#315879]">Retry</button></div></div></section>;
  }

  return <div className="fade-in space-y-8">
    <header className="relative overflow-hidden rounded-lg border border-[#dce5ec] bg-[#eff5f9] px-5 py-7 md:px-8 md:py-8">
      <div className="relative z-[1] max-w-[700px]"><div className="mono mb-2 flex items-center gap-2 text-[9px] uppercase tracking-[.19em] text-[#58748e]"><span className="h-px w-6 bg-[#d7823c]"/>WORKSPACE BILLING</div>
        <h1 className="display text-[30px] font-bold leading-tight tracking-[-.05em] text-[#1a2e43] md:text-[37px]">Choose your Mailflow plan.</h1>
        <p className="mt-3 max-w-[570px] text-[13px] leading-6 text-[#64778a]">Choose a subscription term for your workspace. Payments are processed securely through Razorpay Standard Checkout.</p>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -right-5 -top-16 hidden h-64 w-64 rounded-full border border-[#d5e1e9] md:block"><div className="absolute inset-7 rounded-full border border-[#d5e1e9]"/><div className="absolute inset-14 rounded-full border border-[#d5e1e9]"/><div className="absolute inset-[84px] rounded-full border border-[#d5e1e9]"/></div>
    </header>

    {activeSubscription ? <section data-testid="current-subscription" className="grid gap-4 rounded-lg border border-[#d7e6dd] bg-[#f4f9f5] p-5 md:grid-cols-[1fr_auto] md:items-center md:px-6">
      <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#4d795e]"><CheckCircle2 className="h-4 w-4"/>Current term active</div><h2 className="display mt-2 text-[20px] font-bold text-[#213a2e]">{activeSubscription.package.name}</h2><p data-testid="text-current-subscription-dates" className="mt-1 text-[12px] text-[#647b6b]">Started {new Date(activeSubscription.startsAt).toLocaleDateString()} · Ends {new Date(activeSubscription.endsAt).toLocaleDateString()}</p><p data-testid="text-current-subscription-contact-limit" className="mt-1 flex items-center gap-1.5 text-[11px] text-[#647b6b]"><Users className="h-3.5 w-3.5"/>Up to {activeSubscription.package.contactLimit.toLocaleString()} contacts</p></div>
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{packages.map(pkg => <PackageCard key={pkg.id} item={pkg} featured={activeSubscription?.package.id === pkg.id} pending={startingPackage === pkg.id} disabled={busy || startingPackage !== null || checkoutOrder !== null} onPurchase={() => purchase(pkg)}/>)}</div>}
    </section>

    <footer className="flex flex-col gap-3 border-t border-[#e5eaee] pt-5 text-[10px] leading-5 text-[#82909d] sm:flex-row sm:items-center sm:justify-between"><span>Prices use the currency shown. Terms start after payment is verified, or after your current term ends. Renewals are manual, not recurring charges.</span><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5"/>Razorpay secure checkout</span></footer>
    {checkoutOrder && verifyPayment.isPending && <span className="sr-only" data-testid="text-checkout-order">Order {checkoutOrder.orderId} awaiting payment verification</span>}
  </div>;
}