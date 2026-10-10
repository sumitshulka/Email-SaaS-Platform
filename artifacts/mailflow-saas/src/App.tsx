import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useForm } from 'react-hook-form';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bell, BrainCircuit, Check, Eye, EyeOff,
  ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, CreditCard, Gauge, KeyRound, LoaderCircle,
  LockKeyhole, LogOut, Menu, Package, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, ReceiptText,
  Trash2, UserRound, Users, Building2, LifeBuoy,
} from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getGetAdminSettingsQueryKey, getGetApplicationEmailSettingsQueryKey, getGetMaintenanceStatusQueryKey, getGetPasswordPolicyQueryKey,
  getGetCurrentUserQueryKey, getGetUserDashboardQueryKey, getListAdminUsersQueryKey,
  getGetUserNotificationsQueryKey, useGetUserNotifications, useMarkUserNotificationRead,
  useChangePassword, useDeleteAdminUser, useGetAdminDashboard, useGetAdminSettings, useGetPasswordPolicy, useGetUserDashboard,
  useGetApplicationEmailSettings, useGetCurrentUser, useGetMaintenanceStatus, useListAdminUsers,
  useLogin, useLogout, useRegister, useRequestPasswordReset, useResetPassword,
  useSendApplicationEmailTest, useUpdateAdminSettings, useUpdateAdminUserStatus,
  useUpdateApplicationEmailSettings, useUpdateProfile, useVerifyRegistrationEmail,
} from '@workspace/api-client-react';
import type { AdminUser, ApplicationEmailSettingsInput, AuthUser, PlatformSettingsInput } from '@workspace/api-client-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorBoundary } from '@/components/error-boundary';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Form } from '@/components/ui/form';
import { MailflowBrand } from '@/components/brand';
import AdminBillingPage, { AdminPackagesPage } from '@/pages/admin-billing';
import AdminNotificationsPage, { NotificationsPage } from '@/pages/notifications';
import AdminGoogleOAuthPage from '@/pages/admin-google-oauth';
import AdminAIProviderPage from '@/pages/admin-ai-provider';
import { AdminGlobalCompaniesPage } from '@/pages/admin-global-companies';
import { AdminCompanyIntelligencePage } from '@/pages/admin-company-intelligence';
import AdminFinancePage from '@/pages/finance';
import { AdminSupportTicketsPage, SupportTicketsPage } from '@/pages/support';
import { MarketingHomePage, PackageCheckoutPage, PublicFeaturesPage, PublicPricingPage } from '@/pages/marketing';
import { PrivacyPolicyPage, ShippingRefundPage, TermsAndConditionsPage } from '@/pages/legal';
import { CampaignDashboardPage, CampaignsPage, ContactsPage, ListsPage, SendingSettingsPage } from '@/pages/sending';
import { CampaignUnsubscribePage } from '@/pages/unsubscribe';
import ContactFieldSettingsPage from '@/pages/contact-field-settings';
import { trackPackageCheckoutRegistrationCompleted, trackRegistrationSucceeded, trackVerifiedSignupSucceeded } from '@/lib/analytics';
import { clearPackageCheckoutSession, getVerifiedPackageCheckout } from '@/lib/package-checkout';
import { ContactDetailPage } from '@/pages/contact-detail';
import { CompaniesPage } from '@/pages/companies';
import { CompanyDetailPage } from '@/pages/company-detail';
import PlansPage from '@/pages/plans';
import NotFound from '@/pages/not-found';
import './index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000, refetchOnWindowFocus: false } } });
const SUPPORT_TICKET_RETURN_KEY = 'mailflow-support-ticket-return';

type Fields = Record<string, string | number | boolean | string[]>;
const cn = (...s: Array<string | false | undefined>) => s.filter(Boolean).join(' ');
function getSupportTicketReturnPath() {
  const ticketId = sessionStorage.getItem(SUPPORT_TICKET_RETURN_KEY);
  return ticketId ? `/support?ticketId=${encodeURIComponent(ticketId)}` : undefined;
}
const getError = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Something went wrong. Please try again.';
};
function Button({ children, onClick, type = 'button', variant = 'primary', disabled, className = '', testId }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; variant?: 'primary' | 'quiet' | 'outline' | 'danger'; disabled?: boolean; className?: string; testId: string }) {
  const style = {
    primary: 'bg-[#174f99] text-white hover:bg-[#103f7e] border border-[#174f99]',
    quiet: 'bg-transparent text-[#596474] border border-transparent hover:bg-[#f4f6f8] hover:text-[#182333]',
    outline: 'bg-white text-[#283545] border border-[#d7dce3] hover:bg-[#f7f9fb]',
    danger: 'bg-white text-[#b85b20] border border-[#edc5a7] hover:bg-[#fff7f0]',
  }[variant];
  return <button data-testid={testId} type={type} onClick={onClick} disabled={disabled} className={cn('inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55', style, className)}>{children}</button>;
}
function Field({ label, value, onChange, type = 'text', placeholder, testId, required = false, hint, autoComplete, disabled = false, minLength }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string; testId: string; required?: boolean; hint?: string; autoComplete?: string; disabled?: boolean; minLength?: number }) {
  return <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">{label}</span><input data-testid={testId} required={required} disabled={disabled} minLength={minLength} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3] disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#697584]"/>{hint && <span className="block text-[11px] leading-relaxed text-[#808a97]">{hint}</span>}</label>;
}
function usePasswordRequirement() {
  const policy = useGetPasswordPolicy({
    query: { queryKey: getGetPasswordPolicyQueryKey(), staleTime: 0, refetchOnWindowFocus: true },
  });
  const minimumLength = policy.data?.passwordMinimumLength;
  const hint = minimumLength
    ? `Use at least ${minimumLength} characters.`
    : policy.isError
      ? 'Password requirements could not be loaded. The server will enforce the current policy.'
      : 'Loading password requirements…';
  return { minimumLength, hint };
}
function SelectField({ label, value, onChange, options, testId, required = false, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: Array<string | { value: string; label: string }>; testId: string; required?: boolean; disabled?: boolean }) {
  return <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">{label}</span><select required={required} disabled={disabled} data-testid={testId} value={value} onChange={e => onChange(e.target.value)} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#697584]">{options.map(option => { const optionValue = typeof option === 'string' ? option : option.value; const optionLabel = typeof option === 'string' ? (option || 'Select encryption') : option.label; return <option key={optionValue} value={optionValue}>{optionLabel}</option>; })}</select></label>;
}
function Panel({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) { return <section style={style} className={cn('rounded-lg border border-[#e0e4e9] bg-white', className)}>{children}</section>; }
function PageHeading({ eyebrow, title, detail, trailing }: { eyebrow?: string; title: string; detail?: string; trailing?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">{eyebrow}</div>}<h1 className="display text-[30px] font-bold leading-tight text-[#172334]">{title}</h1>{detail && <p className="mt-2 max-w-2xl text-[13px] text-[#687484]">{detail}</p>}</div>{trailing}</div>;
}
function LoadingPanel({ label = 'Loading account data' }: { label?: string }) {
  return <div className="space-y-5" aria-label={label}><div className="h-8 w-52 animate-pulse rounded bg-[#edf0f3]"/><div className="grid gap-4 md:grid-cols-3"><div className="h-32 animate-pulse rounded-lg bg-[#f1f3f5]"/><div className="h-32 animate-pulse rounded-lg bg-[#f1f3f5]"/><div className="h-32 animate-pulse rounded-lg bg-[#f1f3f5]"/></div><div className="h-64 animate-pulse rounded-lg bg-[#f1f3f5]"/></div>;
}
function QueryProblem({ retry }: { retry: () => void }) { return <Panel className="flex items-center justify-between gap-4 p-5"><div className="flex items-center gap-3"><CircleAlert className="h-5 w-5 text-[#cd732f]"/><div><div className="text-sm font-semibold">We couldn't load this view</div><div className="mt-1 text-xs text-[#778291]">Your account data is unchanged. Try again.</div></div></div><Button variant="outline" testId="button-retry" onClick={retry}>Retry</Button></Panel>; }
function StatusPill({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'orange' | 'gray' }) {
  const tones = { blue: 'bg-[#edf4fc] text-[#245b9b]', orange: 'bg-[#fff3e8] text-[#a95218]', gray: 'bg-[#f0f2f4] text-[#66717e]' };
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', tones[tone])}><span className={cn('h-1.5 w-1.5 rounded-full', tone === 'orange' ? 'bg-[#e78b3b]' : tone === 'blue' ? 'bg-[#4382c4]' : 'bg-[#929ba6]')}/>{children}</span>;
}
function AuthFrame({ children, label = 'Your email infrastructure, in focus.', className = '' }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <main className={cn('min-h-[100dvh] bg-white', className)}>
      <header className="auth-header absolute left-0 right-0 top-0 z-10 flex h-[76px] items-center justify-between px-6 md:px-12">
        <Link href="/" data-testid="link-brand" className="no-underline"><MailflowBrand/></Link>
        <div className="auth-header-label mono hidden text-[10px] uppercase tracking-[.16em] text-[#8893a0] md:block">TRANSACTIONAL EMAIL / CONTROL PLANE</div>
      </header>
      <div className="grid min-h-[100dvh] pt-[76px] lg:grid-cols-[minmax(0,1fr)_minmax(420px,.92fr)]">
        <section className="auth-grid relative hidden overflow-hidden border-r border-[#e5e8eb] bg-white px-12 lg:flex lg:flex-col lg:justify-between lg:py-12">
          <div className="relative z-[1] mt-16 max-w-[560px]">
            <div className="auth-hero-kicker mono mb-6 flex items-center gap-2 text-[10px] uppercase tracking-[.19em] text-[#557399]"><span className="auth-hero-rule h-px w-7 bg-[#e18a42]"/>A calmer way to send</div>
            <h1 className="auth-hero-title display max-w-[500px] text-[54px] font-semibold leading-[1.04] text-[#172334] xl:text-[64px]">{label}</h1>
            <p className="auth-hero-description mt-6 max-w-[415px] text-[15px] leading-7 text-[#687484]">One dependable place to manage delivery, account access, and the systems behind every message.</p>
          </div>
          <div className="relative z-[1] mb-5 flex items-center gap-4">
            <div className="flex -space-x-2">{['M','D','S'].map((letter, i) => <span key={letter} className={cn('auth-hero-avatar grid h-9 w-9 place-items-center rounded-full border-2 border-white text-[11px] font-bold', i === 1 ? 'bg-[#e9eef4] text-[#44536a]' : i === 2 ? 'bg-[#fff0e2] text-[#a65a22]' : 'bg-[#e4effa] text-[#24578f]')}>{letter}</span>)}</div>
            <div className="auth-hero-footer text-[12px] text-[#687484]">Built for the people who keep email moving.</div>
          </div>
          <div className="auth-hero-ring auth-hero-ring-outer pointer-events-none absolute bottom-[90px] right-[-40px] h-[270px] w-[270px] rounded-full border border-[#d5e0ec]"/>
          <div className="auth-hero-ring auth-hero-ring-middle pointer-events-none absolute bottom-[115px] right-[-15px] h-[220px] w-[220px] rounded-full border border-[#d5e0ec]"/>
          <div className="auth-hero-ring auth-hero-ring-inner pointer-events-none absolute bottom-[140px] right-[10px] h-[170px] w-[170px] rounded-full border border-[#d5e0ec]"/>
          <div className="auth-hero-mark pointer-events-none absolute bottom-[164px] right-[34px] grid h-[122px] w-[122px] place-items-center rounded-full border border-[#cad8e7] bg-white/80"><div className="auth-hero-mark-icon h-[43px] w-[52px] -skew-x-12 border-2 border-[#245b9b]"/><span className="auth-hero-mark-dot absolute bottom-[31px] right-[31px] h-2 w-2 rounded-full bg-[#ee913f]"/></div>
          <div className="auth-hero-footer relative z-[1] mono text-[10px] tracking-wide text-[#99a1aa]">MAILFLOW PLATFORM <span className="px-2 text-[#d58b4f]">/</span> TRUST IN EVERY SEND</div>
        </section>
        <section className="auth-panel flex items-center justify-center px-5 py-12 sm:px-10">
          <div className="w-full max-w-[410px]">{children}</div>
        </section>
      </div>
    </main>
  );
}
function FormError({ message }: { message?: string }) { return message ? <div role="alert" data-testid="status-form-error" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[12px] leading-relaxed text-[#99501e]">{message}</div> : null; }
function AuthTitle({ overline, title, sub, className = '' }: { overline: string; title: string; sub: string; className?: string }) { return <div className={cn('mb-7', className)}><div className="auth-title-overline mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#738196]">{overline}</div><h2 className="display text-[31px] font-bold tracking-[-.04em] text-[#172334]">{title}</h2><p className="mt-2 text-[13px] leading-6 text-[#687484]">{sub}</p></div>; }
function LoginPage() {
  const form = useForm<{ identifier: string; password: string }>({ defaultValues: { identifier: '', password: '' } });
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin(); const qc = useQueryClient(); const [, setLocation] = useLocation();
  const submit = form.handleSubmit(values => login.mutate({ data: values }, { onSuccess: res => {
    qc.setQueryData(getGetCurrentUserQueryKey(), res.user);
    const supportReturnPath = res.user.role === 'USER' ? getSupportTicketReturnPath() : undefined;
    if (res.user.role !== 'USER' || !res.user.mustChangeCredentials) sessionStorage.removeItem(SUPPORT_TICKET_RETURN_KEY);
    setLocation(res.user.mustChangeCredentials ? '/profile?rotate=1' : supportReturnPath || (res.user.role === 'SUPERADMIN' ? '/admin' : '/dashboard'));
  } }));
  return (
    <AuthFrame className="auth-branded-frame">
      <AuthTitle className="auth-form-title" overline="Secure sign in" title="Welcome back." sub="Sign in with your account credentials to continue." />
      <Form {...form}>
        <form onSubmit={submit} className="auth-form space-y-4">
          <Field label="Username or email" value={form.watch('identifier')} onChange={v => form.setValue('identifier', v, { shouldValidate: true })} testId="input-identifier" placeholder="you@company.com" required autoComplete="username" />
          <label className="block space-y-1.5">
            <span className="text-[12px] font-semibold text-[#344154]">Password</span>
            <span className="relative block">
              <input data-testid="input-password" required type={showPassword ? 'text' : 'password'} value={form.watch('password')} onChange={e => form.setValue('password', e.target.value)} placeholder="Your password" autoComplete="current-password" className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 pr-11 text-[13px] text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3]" />
              <button type="button" data-testid="button-toggle-password-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(visible => !visible)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-[#778291] hover:text-[#245b9b] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#3b73b8]">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>
          <div className="flex justify-end">
            <Link data-testid="link-forgot-password" href="/forgot-password" className="text-[12px] font-semibold text-[#245b9b] no-underline hover:underline">Forgot password?</Link>
          </div>
          <FormError message={login.isError ? getError(login.error) : undefined} />
          <Button type="submit" testId="button-sign-in" disabled={login.isPending} className="auth-submit w-full">
            {login.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {login.isPending ? 'Signing in' : 'Sign in'}
          </Button>
        </form>
      </Form>
      <div className="auth-footer mt-7 border-t border-[#e7eaee] pt-5 text-center text-[12px] text-[#737e8b]">
        New to Mailflow? <Link data-testid="link-register" href="/register" className="ml-1 font-semibold text-[#245b9b] no-underline hover:underline">Create an account</Link>
      </div>
      <div className="auth-protection mt-8 flex items-center justify-center gap-2 text-[10px] text-[#929ba6]">
        <ShieldCheck className="h-3.5 w-3.5" />Protected account access
      </div>
    </AuthFrame>
  );
}
function RegisterPage() {
  const register = useRegister(); const [, setLocation] = useLocation();
  const passwordRequirement = usePasswordRequirement();
  const checkoutPackageId = new URLSearchParams(window.location.search).get('packageId');
  const verifiedCheckout = getVerifiedPackageCheckout(checkoutPackageId);
  const [values, setValues] = useState({ firstName: '', lastName: '', email: verifiedCheckout?.email ?? '', password: '' });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate(
      { data: { ...values, ...(verifiedCheckout ? { emailVerificationProof: verifiedCheckout.proof } : {}) } },
      { onSuccess: () => {
        if (verifiedCheckout && checkoutPackageId) trackPackageCheckoutRegistrationCompleted();
        trackRegistrationSucceeded(!verifiedCheckout);
        if (verifiedCheckout && checkoutPackageId) {
          clearPackageCheckoutSession();
          setLocation(`/plans?checkout=${encodeURIComponent(checkoutPackageId)}`);
          return;
        }
        sessionStorage.setItem('mailflow-verification-email', values.email);
        setLocation('/verify-email');
      } },
    );
  };
  return (
    <AuthFrame className="auth-branded-frame" label="Good email starts with a solid foundation.">
      <AuthTitle className="auth-form-title" overline="Create workspace access" title="Start with your account." sub={verifiedCheckout ? 'Your email is verified. Create your account to continue to the selected plan.' : 'A few details are all we need to get you set up.'} />
      <form onSubmit={onSubmit} className="auth-form space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={values.firstName} onChange={firstName => setValues(v => ({ ...v, firstName }))} testId="input-first-name" required autoComplete="given-name" />
          <Field label="Last name" value={values.lastName} onChange={lastName => setValues(v => ({ ...v, lastName }))} testId="input-last-name" required autoComplete="family-name" />
        </div>
        <Field label="Work email" value={values.email} onChange={email => setValues(v => ({ ...v, email }))} testId="input-register-email" type="email" placeholder="name@company.com" required autoComplete="email" disabled={Boolean(verifiedCheckout)} hint={verifiedCheckout ? 'Verified for the selected plan.' : undefined} />
        <Field label="Password" value={values.password} onChange={password => setValues(v => ({ ...v, password }))} testId="input-register-password" type="password" required minLength={passwordRequirement.minimumLength} hint={passwordRequirement.hint} autoComplete="new-password" />
        <FormError message={register.isError ? getError(register.error) : undefined} />
        <Button type="submit" testId="button-create-account" disabled={register.isPending} className="auth-submit w-full">
          {register.isPending ? 'Creating account…' : 'Create account'}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
      {verifiedCheckout && checkoutPackageId && <div className="mt-3 text-center text-[11px]"><Link href={`/package-checkout?packageId=${encodeURIComponent(checkoutPackageId)}`} className="font-semibold text-[#245b9b] underline">Restart email verification</Link></div>}
      <div className="auth-footer mt-7 border-t border-[#e7eaee] pt-5 text-center text-[12px] text-[#737e8b]">
        Already have an account? <Link data-testid="link-login" href="/login" className="ml-1 font-semibold text-[#245b9b] no-underline hover:underline">Sign in</Link>
      </div>
      <div className="auth-protection mt-8 flex items-center justify-center gap-2 text-[10px] text-[#929ba6]">
        <ShieldCheck className="h-3.5 w-3.5" />Protected account access
      </div>
    </AuthFrame>
  );
}
function VerifyPage() {
  const verify = useVerifyRegistrationEmail(); const [, setLocation] = useLocation();
  const [email, setEmail] = useState(sessionStorage.getItem('mailflow-verification-email') || '');
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); verify.mutate({ data: { email, code } }, { onSuccess: res => { trackVerifiedSignupSucceeded(); client.setQueryData(getGetCurrentUserQueryKey(), res.user); setLocation(res.user.mustChangeCredentials ? '/profile?rotate=1' : res.user.role === 'SUPERADMIN' ? '/admin' : '/dashboard'); } }); };
  return <AuthFrame label="A small check. Then you're in."><AuthTitle overline="Email verification" title="Check your inbox." sub="Enter the six-character verification code sent to your email address."/><form onSubmit={submit} className="space-y-4"><Field label="Email address" value={email} onChange={setEmail} testId="input-verify-email" type="email" required/><Field label="Verification code" value={code} onChange={setCode} testId="input-verification-code" placeholder="000000" required/><FormError message={verify.isError ? getError(verify.error) : undefined}/><Button type="submit" testId="button-verify-email" disabled={verify.isPending} className="w-full">{verify.isPending ? 'Verifying…' : 'Verify email'}<ArrowRight className="h-4 w-4"/></Button></form><div className="mt-6 text-center text-[12px] text-[#737e8b]">Wrong email? <Link href="/register" data-testid="link-back-register" className="ml-1 font-semibold text-[#245b9b] no-underline">Start over</Link></div></AuthFrame>;
}
function ForgotPage() {
  const reset = useRequestPasswordReset(); const [email, setEmail] = useState(''); const [done, setDone] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); reset.mutate({ data: { email } }, { onSuccess: () => setDone(true) }); };
  return (
    <AuthFrame className="auth-branded-frame" label="Access should never be a guessing game.">
      <AuthTitle
        className="auth-form-title"
        overline="Account recovery"
        title={done ? 'Request received.' : 'Reset your password.'}
        sub={done ? 'If that address belongs to an account, a reset link is on its way.' : 'Enter the email associated with your account and we’ll send a secure reset link.'}
      />
      {!done && (
        <form onSubmit={submit} className="auth-form space-y-4">
          <Field label="Email address" value={email} onChange={setEmail} testId="input-reset-email" type="email" required autoComplete="email" />
          <FormError message={reset.isError ? getError(reset.error) : undefined} />
          <Button type="submit" testId="button-request-reset" disabled={reset.isPending} className="auth-submit w-full">
            {reset.isPending ? 'Sending…' : 'Send reset link'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      )}
      <div className="auth-footer mt-7 border-t pt-5 text-center text-[12px]">
        <Link href="/login" data-testid="link-return-login" className="inline-flex items-center justify-center gap-2 font-semibold no-underline hover:underline">
          <ChevronLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </div>
      <div className="auth-protection mt-8 flex items-center justify-center gap-2 text-[10px]">
        <ShieldCheck className="h-3.5 w-3.5" />
        Protected account access
      </div>
    </AuthFrame>
  );
}
function ResetPage() {
  const reset = useResetPassword(); const [, setLocation] = useLocation();
  const passwordRequirement = usePasswordRequirement();
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); reset.mutate({ data: { token, password } }, { onSuccess: () => setLocation('/login') }); };
  return <AuthFrame label="Take control of your account again."><AuthTitle overline="Secure recovery" title="Choose a new password." sub="Set a new password to restore access to your Mailflow account."/><form onSubmit={submit} className="space-y-4"><Field label="Reset token" value={token} onChange={setToken} testId="input-reset-token" required hint="The secure token from your email link."/><Field label="New password" value={password} onChange={setPassword} testId="input-new-password" type="password" required minLength={passwordRequirement.minimumLength} hint={passwordRequirement.hint} autoComplete="new-password"/><FormError message={reset.isError ? getError(reset.error) : undefined}/><Button type="submit" testId="button-reset-password" disabled={reset.isPending || token.length < 32} className="w-full">{reset.isPending ? 'Saving…' : 'Set new password'}<ArrowRight className="h-4 w-4"/></Button></form></AuthFrame>;
}
type SidebarNavigationItem = { href: string; label: string; icon: typeof Gauge };
type SidebarNavigationGroup = { title: string | null; items: SidebarNavigationItem[] };

const workspaceNavigationGroups: SidebarNavigationGroup[] = [
  { title: null, items: [{ href: '/dashboard', label: 'Overview', icon: Gauge }] },
  {
    title: 'Contacts & companies',
    items: [
      { href: '/companies', label: 'Companies', icon: Building2 },
      { href: '/contacts', label: 'Contacts', icon: Users },
      { href: '/contact-field-settings', label: 'Contact Fields', icon: Settings2 },
    ],
  },
  {
    title: 'Email marketing',
    items: [
      { href: '/lists', label: 'Lists', icon: Activity },
      { href: '/campaigns', label: 'Campaigns', icon: Send },
    ],
  },
  {
    title: 'Account & settings',
    items: [
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/support', label: 'Support', icon: LifeBuoy },
      { href: '/sending-settings', label: 'Email Setup', icon: Settings2 },
      { href: '/plans', label: 'Plans & billing', icon: CreditCard },
      { href: '/profile', label: 'Profile & security', icon: UserRound },
    ],
  },
];

const platformNavigationGroups: SidebarNavigationGroup[] = [
  {
    title: null,
    items: [
      { href: '/admin', label: 'Overview', icon: Gauge },
      { href: '/admin/users', label: 'Accounts', icon: Users },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell },
      { href: '/admin/support', label: 'Support inbox', icon: LifeBuoy },
      { href: '/admin/billing', label: 'Billing & PG setup', icon: CreditCard },
      { href: '/admin/packages', label: 'Packages', icon: Package },
      { href: '/admin/finance', label: 'Finance', icon: ReceiptText },
      { href: '/admin/settings', label: 'Platform settings', icon: Settings2 },
      { href: '/admin/google-oauth', label: 'Gmail setup', icon: ShieldCheck },
      { href: '/admin/ai-provider', label: 'AI integration', icon: BrainCircuit },
      { href: '/admin/global-companies', label: 'Global companies', icon: Building2 },
      { href: '/admin/company-intelligence', label: 'Company intelligence', icon: BrainCircuit },
    ],
  },
];

function UserNotificationsHeaderAction() {
  const notificationQuery = useGetUserNotifications({ query: {
    queryKey: getGetUserNotificationsQueryKey(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  } });
  const unreadCount = notificationQuery.data?.unread.length ?? 0;
  const label = unreadCount
    ? `Notifications, ${unreadCount} unread ${unreadCount === 1 ? 'notification' : 'notifications'}`
    : 'Notifications';

  return (
    <Link
      href="/notifications"
      data-testid="link-header-notifications"
      aria-label={label}
      title={label}
      className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#e1e5e9] text-[#5c6877] transition-colors hover:bg-[#f4f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8]"
    >
      <Bell aria-hidden="true" className="h-4 w-4"/>
      {unreadCount > 0 && (
        <span
          data-testid="badge-header-unread-notifications"
          aria-hidden="true"
          className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full border-2 border-white bg-[#c45f22] px-1 text-[9px] font-bold leading-none text-white shadow-sm"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}

function AppShell({ user, children, admin = false }: { user: AuthUser; children: ReactNode; admin?: boolean }) {
  const [location, setLocation] = useLocation();
  const logout = useLogout();
  const [navOpen, setNavOpen] = useState(false);
  const qc = useQueryClient();
  const navGroups = admin ? platformNavigationGroups : workspaceNavigationGroups;
  const leave = () => logout.mutate(undefined, { onSuccess: () => { qc.clear(); setLocation('/'); } });

  return (
    <div className="min-h-[100dvh] bg-white text-[#182333]">
      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 flex w-[246px] flex-col border-r border-[#e3e7eb] bg-white transition-transform md:translate-x-0',
        navOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="flex h-[69px] shrink-0 items-center border-b border-[#e8ebef] px-6">
          <Link href={admin ? '/admin' : '/dashboard'} data-testid="link-shell-brand" className="no-underline"><MailflowBrand small/></Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6">
          <div className="mono mb-3 px-2 text-[9px] uppercase tracking-[.18em] text-[#99a1aa]">{admin ? 'PLATFORM' : 'WORKSPACE'}</div>
          <nav className="space-y-3" aria-label={admin ? 'Platform navigation' : 'Workspace navigation'}>
            {navGroups.map(group => (
              <div key={group.title ?? 'overview'} className="space-y-1" role="group" aria-label={group.title ?? 'Overview'}>
                {group.title && <div className="mono mt-3 border-t border-[#eef0f2] px-2 pb-1 pt-3 text-[9px] uppercase tracking-[.14em] text-[#99a1aa]">{group.title}</div>}
                {group.items.map(item => {
                  const Icon = item.icon;
                  const active = location === item.href || (item.href !== '/admin' && item.href !== '/dashboard' && location.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-testid={`nav-${item.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                      onClick={() => setNavOpen(false)}
                      className={cn(
                        'flex h-10 items-center gap-3 rounded-md px-3 text-[13px] font-medium no-underline transition-colors',
                        active ? 'bg-[#edf4fc] text-[#174f99]' : 'text-[#66717e] hover:bg-[#f5f7f9] hover:text-[#182333]',
                      )}
                    >
                      <Icon className="h-[17px] w-[17px]"/>
                      {item.label}
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#ed913e]"/>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
        <div className="shrink-0 px-4 pb-4">
          <div className="mb-4 border-t border-[#e8ebef] pt-4">
            <Link href="/profile" data-testid="nav-account-profile" className="flex items-center gap-3 rounded-md px-2 py-2 no-underline hover:bg-[#f7f8fa]">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-[#edf2f7] text-[11px] font-bold text-[#34577c]">
                {(user.firstName[0] || user.username[0] || 'A').toUpperCase()}{(user.lastName[0] || '').toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-[#243144]">{user.firstName} {user.lastName}</span>
                <span className="block truncate text-[10px] text-[#858f9c]">{user.email}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[#8b95a1]"/>
            </Link>
          </div>
          <Button variant="quiet" className="w-full justify-start px-2" testId="button-logout" disabled={logout.isPending} onClick={leave}>
            <LogOut className="h-4 w-4"/>Sign out
          </Button>
        </div>
      </aside>
      <div className="md:pl-[246px]">
        <header className="sticky top-0 z-20 flex h-[69px] items-center justify-between border-b border-[#e3e7eb] bg-white/95 px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-3">
            <button data-testid="button-open-navigation" aria-label="Open navigation" className="rounded-md p-2 text-[#66717e] hover:bg-[#f2f4f6] md:hidden" onClick={() => setNavOpen(v => !v)}>
              <Menu className="h-5 w-5"/>
            </button>
            <div className="mono hidden text-[10px] uppercase tracking-[.16em] text-[#8893a0] sm:block">{admin ? 'PLATFORM CONTROL' : 'ACCOUNT CONSOLE'}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-[11px] text-[#7d8794] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#4c82bb]"/>Signed in</span>
            <div className="h-4 w-px bg-[#e3e7eb]"/>
            <span className="mono text-[10px] text-[#7d8794]">{user.timezone}</span>
            {!admin && user.role === 'USER' && <UserNotificationsHeaderAction/>}
            <Link href="/profile" data-testid="link-header-profile" className="grid h-8 w-8 place-items-center rounded-full border border-[#e1e5e9] text-[#5c6877] hover:bg-[#f4f6f8]"><UserRound className="h-4 w-4"/></Link>
            <button
              type="button"
              data-testid="button-header-logout"
              aria-label={logout.isPending ? 'Signing out' : 'Sign out'}
              title={logout.isPending ? 'Signing out' : 'Sign out'}
              disabled={logout.isPending}
              onClick={leave}
              className="grid h-8 w-8 place-items-center rounded-full border border-[#e1e5e9] text-[#5c6877] transition-colors hover:bg-[#fff4f2] hover:text-[#b34e43] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8] disabled:cursor-wait disabled:opacity-60"
            >
              {logout.isPending
                ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true"/>
                : <LogOut className="h-4 w-4" aria-hidden="true"/>}
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-5 py-8 md:px-9 md:py-10">{children}</main>
      </div>
    </div>
  );
}
function Gate({ children, admin = false }: { children: (user: AuthUser) => ReactNode; admin?: boolean }) {
  const auth = useGetCurrentUser(); const [location, setLocation] = useLocation();
  useEffect(() => {
    if (!auth.isError) return;
    const url = new URL(window.location.href);
    const ticketId = url.pathname === '/support' ? url.searchParams.get('ticketId') : null;
    if (ticketId) sessionStorage.setItem(SUPPORT_TICKET_RETURN_KEY, ticketId);
    setLocation('/login');
  }, [auth.isError, setLocation]);
  useEffect(() => {
    if (!auth.data) return;
    if (auth.data.mustChangeCredentials && location !== '/profile') setLocation('/profile?rotate=1');
    else if (admin && auth.data.role !== 'SUPERADMIN') setLocation('/dashboard');
    else if (!admin && auth.data.role === 'SUPERADMIN' && location === '/dashboard') setLocation('/admin');
  }, [auth.data, admin, location, setLocation]);
  if (auth.isLoading || !auth.data) return <div className="min-h-[100dvh] bg-white p-8"><div className="mx-auto max-w-5xl space-y-5 pt-20"><div className="h-8 w-56 animate-pulse rounded bg-[#edf0f3]"/><div className="h-36 animate-pulse rounded-lg bg-[#f1f3f5]"/></div></div>;
  if ((auth.data.mustChangeCredentials && location !== '/profile') || (admin && auth.data.role !== 'SUPERADMIN') || (!admin && auth.data.role === 'SUPERADMIN' && location === '/dashboard')) return null;
  return <AppShell user={auth.data} admin={auth.data.role === 'SUPERADMIN'}>{children(auth.data)}</AppShell>;
}
function Metric({ label, value, sub, icon: Icon, accent = 'blue' }: { label: string; value: string | number; sub?: string; icon: typeof Send; accent?: 'blue' | 'orange' }) {
  return <Panel className="p-5"><div className="flex items-start justify-between"><span className="text-[12px] font-medium text-[#6d7886]">{label}</span><span className={cn('grid h-8 w-8 place-items-center rounded-md', accent === 'blue' ? 'bg-[#edf4fc] text-[#245b9b]' : 'bg-[#fff2e6] text-[#bc6829]')}><Icon className="h-4 w-4"/></span></div><div className="mt-3 display text-[27px] font-bold leading-none tracking-[-.04em] text-[#192638]" data-testid={`metric-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{value}</div>{sub && <div className="mt-2 text-[11px] text-[#7e8894]">{sub}</div>}</Panel>;
}
function UserDashboardPage({ user, maintenancePaused = false }: { user: AuthUser; maintenancePaused?: boolean }) {
  const query = useGetUserDashboard({ query: { queryKey: getGetUserDashboardQueryKey() } });
  const notificationQuery = useGetUserNotifications({ query: {
    queryKey: getGetUserNotificationsQueryKey(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  } });
  const markNotificationRead = useMarkUserNotificationRead();
  const queryClient = useQueryClient();
  const data = query.data;
  if (query.isLoading) return <LoadingPanel label="Loading workspace sending summary"/>;
  if (query.isError || !data) return <QueryProblem retry={() => void query.refetch()}/>;
  const stages = normalizeSegments(data.lifecycleStages);
  const leads = normalizeSegments(data.leadStatuses);
  const setupPct = data.setupStepsTotal > 0 ? Math.min(100, Math.round(data.setupStepsCompleted / data.setupStepsTotal * 100)) : 0;
  const money = (minor: number, currency: string) => {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    const minorUnitDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(minor / 10 ** minorUnitDigits);
  };
  const shortDate = (date: string | null) => date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date)) : '—';
  const markRead = (notificationId: string) => markNotificationRead.mutate({ notificationId }, {
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetUserNotificationsQueryKey() }); },
  });
  return <div className="fade-in space-y-6">
    {notificationQuery.isError ? <section aria-label="Platform notice error" data-testid="dashboard-notification-error" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#efd8c7] bg-[#fff8f2] px-5 py-4 text-[#75421f]">
      <div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#bd692d]"/><div><h2 className="text-[12px] font-semibold">Platform notices couldn’t be loaded</h2><p className="mt-1 text-[11px] text-[#93694c]">Your dashboard is available. Retry to check for account updates.</p></div></div>
      <button type="button" data-testid="button-retry-dashboard-notifications" onClick={() => void notificationQuery.refetch()} disabled={notificationQuery.isFetching} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#e8c5a8] bg-white px-3 text-[11px] font-semibold text-[#94501f] hover:bg-[#fff7f0] disabled:opacity-50">{notificationQuery.isFetching ? 'Checking…' : 'Retry'}</button>
    </section> : notificationQuery.data?.unread.length ? <section aria-label="Unread platform notifications" data-testid="dashboard-unread-notifications" className="overflow-hidden rounded-lg border border-[#9f4c13] bg-[#a94f13] text-[#fff8f0] shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#c46d31] px-5 py-3"><Bell className="h-4 w-4"/><span className="mono text-[10px] font-medium uppercase tracking-[.15em]">Platform notice</span><span className="ml-auto rounded-full bg-[#813b0d] px-2 py-0.5 text-[10px] font-semibold">{notificationQuery.data.unread.length} unread</span></div>
      <div className="divide-y divide-[#c46d31]">
        {notificationQuery.data.unread.map(item => <article key={item.id} data-testid={`dashboard-notification-${item.id}`} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0 flex-1"><h2 className="text-[14px] font-bold text-white">{item.title}</h2><p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[#ffead7]">{item.message}</p><p className="mt-2 text-[10px] text-[#f5c8a4]">Expires {shortDate(item.expiresAt)}</p></div>
          <button type="button" data-testid={`button-dashboard-mark-read-${item.id}`} onClick={() => markRead(item.id)} disabled={markNotificationRead.isPending} className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-[#edb17f] bg-[#873d0e] px-3 text-[11px] font-semibold text-white transition hover:bg-[#74350d] disabled:opacity-55"><Check className="h-3.5 w-3.5"/>Mark read</button>
        </article>)}
      </div>
      <div className="border-t border-[#c46d31] bg-[#98460f] px-5 py-2.5 text-[10px] text-[#ffdfc5]"><Link href="/notifications" data-testid="link-dashboard-notification-history" className="font-semibold text-white underline decoration-[#e9a978] underline-offset-2">View notification history</Link></div>
    </section> : null}
    <PageHeading eyebrow="WORKSPACE / OVERVIEW" title="Good to see you, again." detail="A clear view of the audience, account, and campaigns in this workspace."
      trailing={<div className="flex items-center gap-2 rounded-full border border-[#dce5e2] bg-[#f2f7f4] px-3 py-1.5 text-[11px] font-semibold text-[#426c5d]"><span className="h-1.5 w-1.5 rounded-full bg-[#538a70]"/><span className="capitalize">{data.subscriptionStatus}</span> plan</div>}/>

    <section aria-label="Workspace summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Contacts" value={data.contacts.toLocaleString()} note="All contacts in this workspace" icon={Users} tint="blue"/>
      <SummaryCard label="Companies" value={data.companies.toLocaleString()} note="Workspace company records" icon={Building2} tint="sage"/>
      <SummaryCard label="Active lists" value={data.activeLists.toLocaleString()} note="Available for campaign audiences" icon={Activity} tint="apricot"/>
      <Panel className="overflow-hidden p-5" style={{ backgroundColor: '#fff2d6', borderColor: '#e8d8ad' }}>
        <div className="flex items-start justify-between"><div><div className="text-[12px] font-medium text-[#62583f]">Captured payments</div><div className="mt-1 text-[10px] uppercase tracking-[.08em] text-[#827657]">Spend by currency</div></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#ead9a7] text-[#795f2c]"><CreditCard className="h-4 w-4"/></span></div>
        {data.amountSpentByCurrency.length ? <div className="mt-3 space-y-1.5">{data.amountSpentByCurrency.map(item => <div key={item.currency} className="flex items-baseline justify-between gap-2" data-testid={`spend-${item.currency.toLowerCase()}`}><span className="mono text-[10px] text-[#796f56]">{item.currency}</span><span className="text-[19px] font-bold tracking-[-.04em] text-[#283747]">{money(item.amountMinor, item.currency)}</span></div>)}</div> : <div className="mt-4 text-[14px] font-semibold text-[#687484]">No captured spend</div>}
        <p className="mt-2 text-[10px] leading-4 text-[#796f56]">Captured payments only; gifts, non-captured, and refunded rows are excluded.</p>
      </Panel>
    </section>

    <section className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
      <Panel className="p-5 sm:p-6">
        <ChartHeading eyebrow="CONTACT PROFILE" title="Lifecycle stages" detail="Workspace-wide contact count by lifecycle stage."/>
        {data.contacts > 0 && stages.length ? <div className="mt-4 h-[250px]" data-testid="chart-lifecycle-stages"><ResponsiveContainer width="100%" height="100%" debounce={0}><BarChart data={stages} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#edf0ed"/><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#79838d' }} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 11, fill: '#566474' }} axisLine={false} tickLine={false}/><Tooltip isAnimationActive={false} cursor={{ fill: '#f4f6f3' }} contentStyle={chartTooltip} formatter={(value: number) => [value.toLocaleString(), 'Contacts']}/><Bar dataKey="count" name="Contacts" fill="#4d897e" radius={[0, 5, 5, 0]} isAnimationActive={false} maxBarSize={25}/>
        </BarChart></ResponsiveContainer></div> : <ChartEmpty title="No lifecycle data yet" body="Contact stage counts will appear once this workspace has categorized contacts."/>}
      </Panel>
      <Panel className="p-5 sm:p-6">
        <ChartHeading eyebrow="CONTACT PROFILE" title="Lead status" detail="Workspace-wide contact count by lead status."/>
        {data.contacts > 0 && leads.length ? <div className="mt-4 h-[250px]" data-testid="chart-lead-statuses"><ResponsiveContainer width="100%" height="100%" debounce={0}><BarChart data={leads} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#edf0ed"/><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#79838d' }} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 11, fill: '#566474' }} axisLine={false} tickLine={false}/><Tooltip isAnimationActive={false} cursor={{ fill: '#f4f6f3' }} contentStyle={chartTooltip} formatter={(value: number) => [value.toLocaleString(), 'Contacts']}/><Bar dataKey="count" name="Contacts" fill="#d88a52" radius={[0, 5, 5, 0]} isAnimationActive={false} maxBarSize={25}/>
        </BarChart></ResponsiveContainer></div> : <ChartEmpty title="No lead status data yet" body="Lead status counts will appear as contacts are categorized."/>}
      </Panel>
    </section>

    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e8ece8] px-5 py-5 sm:px-6">
        <ChartHeading eyebrow="CAMPAIGN ACTIVITY" title="Campaigns" detail="Sending and outcome figures are scoped to each campaign."/>
        <Link href="/campaigns" data-testid="link-workspace-campaigns" className="inline-flex items-center gap-2 rounded-md border border-[#d8e0e8] px-3 py-2 text-[11px] font-semibold text-[#245b9b] no-underline hover:bg-[#f6f9fc]">Manage campaigns <ArrowRight className="h-3.5 w-3.5"/></Link>
      </div>
      {data.campaigns.length ? <div className="divide-y divide-[#edf0ed]">
        {data.campaigns.map(campaign => {
          const campaignIsActive = campaign.status === 'queued' || campaign.status === 'sending';
          const campaignIsPaused = maintenancePaused && campaignIsActive;
          return <article key={campaign.id} data-testid={`campaign-row-${campaign.id}`} className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(180px,1.15fr)_repeat(5,minmax(64px,.55fr))_minmax(145px,.85fr)] lg:items-center">
            <div className="min-w-0"><div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', campaignIsPaused ? 'bg-[#d98949]' : campaign.status === 'sending' ? 'bg-[#d98949]' : campaign.status === 'completed' ? 'bg-[#548873]' : 'bg-[#8d9daf]')}/><h3 className="truncate text-[14px] font-semibold text-[#263447]">{campaign.name}</h3></div><div className="mt-1.5 flex items-center gap-2 text-[10px] text-[#85909a]"><span className="capitalize">{campaignIsPaused ? 'paused' : campaign.status}</span><span>·</span><span>{campaign.recipients.toLocaleString()} recipients</span></div></div>
            <CampaignDatum label="SMTP accepted" value={campaign.delivered} hint="Accepted by the SMTP server; inbox delivery is not confirmed."/>
            <CampaignDatum label="Bounced" value={campaign.bounced} hint="Bounced campaign recipients."/>
            <CampaignDatum label="Suppressed" value={campaign.suppressed} hint="Excluded from sending by suppression rules."/>
            <CampaignDatum label="Unknown" value={campaign.unknown} hint="No confirmed outcome is available."/>
            <CampaignDatum label="Queued / sending" value={campaign.queued} hint="Recipients queued or currently being sent."/>
            <div className="rounded-lg bg-[#f6f7f4] px-3 py-2.5">{campaignIsActive ? <><div className="flex items-center justify-between gap-2 text-[10px] text-[#77828b]"><span>Mailbox attempts / last 60 min</span><span className="mono font-medium text-[#455566]">{campaign.attemptsThisHour.toLocaleString()}</span></div><div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-[#77828b]"><span>Mailbox capacity remaining</span><span className="mono font-medium text-[#455566]">{campaign.remainingThisHour.toLocaleString()} / {campaign.hourlyLimit.toLocaleString()}</span></div><div className="mt-1 text-[9px] leading-4 text-[#959da2]">Per SMTP mailbox; campaigns using the same mailbox share its allowance. Estimates are not additive.</div></> : <div className="text-[10px] text-[#77828b]">Hourly estimate shown while campaign is queued or sending.</div>}</div>
            <div className="text-[10px] text-[#9099a1] lg:col-span-7">Updated {shortDate(campaign.updatedAt)}{campaign.completedAt ? ` · Completed ${shortDate(campaign.completedAt)}` : campaign.queuedAt ? ` · Queued ${shortDate(campaign.queuedAt)}` : ''}</div>
          </article>;
        })}
      </div> : <div className="px-6 py-14"><ChartEmpty title="No campaigns to report" body="When campaigns are created, their queue and SMTP outcome summaries will appear here."/></div>}
      <div className="border-t border-[#e8ece8] bg-[#fbfcfa] px-5 py-3 text-[10px] leading-5 text-[#7f8992] sm:px-6">SMTP accepted means the sending server accepted the message, not that it reached the inbox. Hourly estimates appear for queued or sending campaigns only; the cap is shared, so estimates are not additive.</div>
    </Panel>

    <section className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
      <Panel className="flex flex-col justify-between gap-5 bg-[#f1f6fa] p-5 sm:flex-row sm:items-center sm:p-6">
        <div><div className="mono text-[10px] uppercase tracking-[.15em] text-[#6f8295]">SENDING WORKSPACE</div><h2 className="display mt-2 text-xl font-bold text-[#1c3044]">Your tools, one workspace.</h2><p className="mt-2 max-w-xl text-[12px] leading-5 text-[#637487]">Contacts, lists, sender settings, and campaign results stay within your tenant workspace.</p></div>
        <div className="flex shrink-0 flex-wrap gap-2"><Link href="/sending-settings" data-testid="link-workspace-sender" className="inline-flex items-center gap-2 rounded-md bg-[#174f99] px-3.5 py-2.5 text-[11px] font-semibold text-white no-underline hover:bg-[#103f7e]">Email Setup <ArrowRight className="h-3.5 w-3.5"/></Link><Link href="/campaigns" className="inline-flex items-center gap-2 rounded-md border border-[#cad7e2] bg-white/75 px-3.5 py-2.5 text-[11px] font-semibold text-[#355571] no-underline hover:bg-white">Campaigns <ArrowRight className="h-3.5 w-3.5"/></Link></div>
      </Panel>
      <Panel className="p-5 sm:p-6">
        <div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">GETTING STARTED</div><div className="mt-2 flex items-end justify-between gap-3"><div><h2 className="display text-xl font-bold">Workspace setup</h2><p className="mt-1 text-[11px] text-[#778291]">{data.setupStepsCompleted} of {data.setupStepsTotal} steps completed</p></div><span className="mono text-[15px] font-semibold text-[#245b9b]">{setupPct}%</span></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf0f3]"><div className="h-full rounded-full bg-[#4d897e] transition-all" style={{ width: `${setupPct}%` }}/></div>
        <div className="mt-4 grid gap-2.5 text-[11px]"><div className="flex items-center justify-between"><span className="text-[#647182]">Email verified</span><StatusPill tone={user.emailVerified ? 'blue' : 'orange'}>{user.emailVerified ? 'Done' : 'Needed'}</StatusPill></div><div className="flex items-center justify-between"><span className="text-[#647182]">Sender identity</span><Link href="/sending-settings" className="font-semibold text-[#245b9b] no-underline">Configure</Link></div><div className="flex items-center justify-between"><span className="text-[#647182]">Audience</span><div className="flex gap-3"><Link href="/contacts" className="font-semibold text-[#245b9b] no-underline">Contacts</Link><Link href="/lists" className="font-semibold text-[#245b9b] no-underline">Lists</Link></div></div><div className="flex items-center justify-between border-t border-[#edf0f2] pt-2.5"><span className="text-[#647182]">Plan</span><Link href="/plans" className="font-semibold capitalize text-[#245b9b] no-underline">{data.subscriptionStatus} · View billing</Link></div></div>
      </Panel>
    </section>
    <div className="flex flex-wrap gap-2"><Link href="/contacts" className="rounded-md border border-[#d8e0e8] bg-white px-3 py-2 text-[11px] font-semibold text-[#596a7b] no-underline hover:bg-[#f6f9fc]">Contacts</Link><Link href="/companies" className="rounded-md border border-[#d8e0e8] bg-white px-3 py-2 text-[11px] font-semibold text-[#596a7b] no-underline hover:bg-[#f6f9fc]">Companies</Link><Link href="/lists" className="rounded-md border border-[#d8e0e8] bg-white px-3 py-2 text-[11px] font-semibold text-[#596a7b] no-underline hover:bg-[#f6f9fc]">Lists</Link><Link href="/plans" data-testid="link-workspace-plans" className="rounded-md border border-[#d8e0e8] bg-white px-3 py-2 text-[11px] font-semibold text-[#596a7b] no-underline hover:bg-[#f6f9fc]">Plans & billing</Link><Link href="/profile" data-testid="link-workspace-profile" className="rounded-md border border-[#d8e0e8] bg-white px-3 py-2 text-[11px] font-semibold text-[#596a7b] no-underline hover:bg-[#f6f9fc]">Profile & security</Link></div>
  </div>;
}
const chartTooltip = { borderRadius: 8, border: '1px solid #dfe5e0', background: '#fffefa', fontSize: 12, boxShadow: '0 8px 24px rgba(35,48,59,.08)' };
function normalizeSegments(items: Array<{ value: string; count: number }>) {
  const counts = new Map<string, number>();
  items.forEach(item => { const name = item.value.trim() || 'Not set'; counts.set(name, (counts.get(name) || 0) + item.count); });
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
function SummaryCard({ label, value, note, icon: Icon, tint }: { label: string; value: string; note: string; icon: typeof Users; tint: 'blue' | 'sage' | 'apricot' }) {
  const colors = { blue: 'bg-[#d8e8ff] text-[#2862a1]', sage: 'bg-[#d9ecde] text-[#3e7856]', apricot: 'bg-[#ffe0ca] text-[#a75d2d]' };
  const surfaces: Record<typeof tint, CSSProperties> = {
    blue: { backgroundColor: '#eaf3ff', borderColor: '#c9dcf3' },
    sage: { backgroundColor: '#eaf4ed', borderColor: '#cce2d3' },
    apricot: { backgroundColor: '#fff0e4', borderColor: '#efd2b7' },
  };
  return <Panel className="p-5" style={surfaces[tint]}><div className="flex items-start justify-between"><span className="text-[12px] font-medium text-[#596779]">{label}</span><span className={cn('grid h-9 w-9 place-items-center rounded-xl', colors[tint])}><Icon className="h-4 w-4"/></span></div><div className="display mt-3 text-[29px] font-bold leading-none tracking-[-.045em] text-[#192638]" data-testid={`metric-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{value}</div><div className="mt-2 text-[10px] text-[#6d7886]">{note}</div></Panel>;
}
function ChartHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#8a969d]">{eyebrow}</div><h2 className="display mt-1 text-[18px] font-bold text-[#263447]">{title}</h2><p className="mt-1 text-[11px] text-[#818c97]">{detail}</p></div>;
}
function ChartEmpty({ title, body }: { title: string; body: string }) {
  return <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-[#dce3de] bg-[#fbfcfa] px-6 text-center"><span className="grid h-9 w-9 place-items-center rounded-full bg-[#edf3ef] text-[#628071]"><Activity className="h-4 w-4"/></span><h3 className="mt-3 text-[12px] font-semibold text-[#394a56]">{title}</h3><p className="mt-1 max-w-xs text-[10px] leading-5 text-[#828d95]">{body}</p></div>;
}
function CampaignDatum({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return <div title={hint}><div className="text-[9px] uppercase tracking-[.08em] text-[#9099a1]">{label}</div><div className="mono mt-1 text-[13px] font-medium text-[#425364]">{typeof value === 'number' ? value.toLocaleString() : value}</div></div>;
}
function AdminDashboardPage() {
  const query = useGetAdminDashboard(); const d = query.data;
  if (query.isLoading) return <LoadingPanel label="Loading platform overview"/>;
  if (query.isError || !d) return <QueryProblem retry={() => void query.refetch()}/>;

  const formatCurrency = (amount: number, currency: string) => {
    try {
      const digits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: digits }).format(amount);
    } catch {
      return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
  };
  const monthLabel = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(year, month - 1, 1));
  };
  const accountState = [
    { label: 'Enabled', value: d.activeUsers, color: '#4f8068' },
    { label: 'Pending', value: d.pendingUsers, color: '#d58a4b' },
    { label: 'Disabled', value: d.disabledUsers, color: '#a6afb8' },
  ];
  const activeEnvironmentLabel = d.billingEnvironment?.toUpperCase() ?? 'NO ACTIVE ENVIRONMENT';
  const maxPackageCount = Math.max(1, ...d.activeSubscriptionsByPackage.map(item => item.activeSubscriptions));
  const historyHasRegistrations = d.registrationsByMonth.some(item => item.registrations > 0);
  const historyHasRevenue = d.revenueTrend.some(item => item.revenue > 0);
  const quickLinks = [
    { href: '/admin/users', label: 'Manage accounts', detail: 'Access, verification and status', icon: Users, testId: 'link-admin-overview-accounts' },
    { href: '/admin/finance', label: 'Review finance', detail: 'Payment ledger and refunds', icon: ReceiptText, testId: 'link-admin-overview-finance' },
    { href: '/admin/billing', label: 'Billing & PG setup', detail: 'Gateway and online-payment controls', icon: CreditCard, testId: 'link-admin-overview-billing' },
    { href: '/admin/settings', label: 'Platform settings', detail: 'Operations and application email', icon: Settings2, testId: 'link-admin-overview-settings' },
    { href: '/admin/google-oauth', label: 'Gmail setup', detail: 'OAuth configuration', icon: ShieldCheck, testId: 'link-admin-overview-google-oauth' },
  ];
  return <div className="fade-in space-y-5">
    <PageHeading eyebrow="PLATFORM CONTROL / OPERATIONS" title="Platform overview" detail="Account access, subscription health, revenue and configuration at a glance."
      trailing={<div className="flex flex-wrap items-center gap-2"><span className="mono hidden text-[10px] text-[#87919b] sm:block">ACTIVE ENVIRONMENT</span><StatusPill tone={d.billingEnvironment === 'production' ? 'blue' : 'orange'}>{d.billingEnvironment ?? 'Not configured'}</StatusPill><span className="mono hidden text-[10px] text-[#87919b] sm:block">DEFAULT CURRENCY</span><StatusPill>{d.defaultCurrency}</StatusPill></div>}/>

    <section aria-label="Platform headline metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Panel className="border-[#dce6e0] bg-[#f4f8f4] p-4" data-testid="dashboard-value-new-accounts">
        <div className="flex items-start justify-between"><div className="text-[11px] font-semibold text-[#557064]">Registrations this month</div><span className="grid h-8 w-8 place-items-center rounded-md bg-white text-[#4f8068]"><UserRound className="h-4 w-4"/></span></div>
        <div className="display mt-3 text-[28px] font-bold leading-none tracking-[-.04em] text-[#25473d]">{d.newUsersThisMonth.toLocaleString()}</div>
        <div className="mt-2 text-[10px] text-[#75877e]">New platform accounts</div>
      </Panel>
      <Panel className="p-4" data-testid="dashboard-value-active-subscriptions">
        <div className="flex items-start justify-between"><div className="text-[11px] font-semibold text-[#6d7886]">Active subscription access</div><span className="grid h-8 w-8 place-items-center rounded-md bg-[#edf4fc] text-[#245b9b]"><BadgeCheck className="h-4 w-4"/></span></div>
        <div className="display mt-3 text-[28px] font-bold leading-none tracking-[-.04em] text-[#192638]">{d.activeSubscriptions.toLocaleString()}</div>
        <div className="mt-2 text-[10px] text-[#7e8894]">{d.activeCustomers.toLocaleString()} accounts with access; may include gifted or comped</div>
      </Panel>
      <Panel className={cn('p-4', d.subscriptionsEndingSoon > 0 && 'border-[#ead8c4] bg-[#fffaf4]')} data-testid="dashboard-value-ending-soon">
        <div className="flex items-start justify-between"><div className="text-[11px] font-semibold text-[#6d7886]">Ending within 7 days</div><span className="grid h-8 w-8 place-items-center rounded-md bg-[#fff2e6] text-[#bc6829]"><Clock3 className="h-4 w-4"/></span></div>
        <div className="display mt-3 text-[28px] font-bold leading-none tracking-[-.04em] text-[#192638]">{d.subscriptionsEndingSoon.toLocaleString()}</div>
        <div className="mt-2 text-[10px] text-[#7e8894]">{d.subscriptionsEndingSoon ? 'Review renewals and customer access' : 'No upcoming expirations'}</div>
      </Panel>
      <Panel className="p-4" data-testid="dashboard-value-active-packages">
        <div className="flex items-start justify-between"><div className="text-[11px] font-semibold text-[#6d7886]">Active packages</div><span className="grid h-8 w-8 place-items-center rounded-md bg-[#f3f1ea] text-[#826d46]"><SlidersHorizontal className="h-4 w-4"/></span></div>
        <div className="display mt-3 text-[28px] font-bold leading-none tracking-[-.04em] text-[#192638]">{d.activePackages.toLocaleString()}</div>
        <div className="mt-2 text-[10px] text-[#7e8894]">{d.packageVisibility === 'public' ? 'Packages visible to customers' : 'Packages currently hidden'}</div>
      </Panel>
    </section>

    <section aria-label="Account access and revenue" className="grid gap-4 xl:grid-cols-[.92fr_1.08fr]">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="mono text-[9px] uppercase tracking-[.15em] text-[#87919b]">ACCOUNT ACCESS</div><h2 className="display mt-1 text-[18px] font-bold text-[#263447]">Customer account state</h2></div>
          <Link href="/admin/users" data-testid="link-access-accounts" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#245b9b] no-underline hover:underline">Accounts <ArrowRight className="h-3.5 w-3.5"/></Link>
        </div>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div><div className="mono text-[9px] uppercase tracking-[.1em] text-[#8b95a1]">TOTAL ACCOUNTS</div><div className="display mt-1 text-[27px] font-bold leading-none text-[#192638]" data-testid="dashboard-value-total-accounts">{d.totalUsers.toLocaleString()}</div></div>
          <div className="text-right"><div className="text-[10px] text-[#808a97]">New this month</div><div className="mono mt-1 text-[13px] font-semibold text-[#425364]" data-testid="dashboard-value-monthly-registrations">{d.newUsersThisMonth.toLocaleString()}</div></div>
        </div>
        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-[#edf0f2]" role="img" aria-label={`Account state: ${d.activeUsers} active, ${d.pendingUsers} pending, ${d.disabledUsers} disabled`}>
          {d.totalUsers > 0 && accountState.map(state => <span key={state.label} style={{ width: `${state.value / d.totalUsers * 100}%`, backgroundColor: state.color }} />)}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {accountState.map(state => <div key={state.label} className="border-l-2 pl-2.5" style={{ borderColor: state.color }}><div className="text-[10px] text-[#788390]">{state.label}</div><div className="mono mt-0.5 text-[13px] font-semibold text-[#334255]" data-testid={`dashboard-value-account-${state.label.toLowerCase()}`}>{state.value.toLocaleString()}</div></div>)}
        </div>
        {d.totalUsers === 0 && <p className="mt-3 text-[11px] text-[#798491]">No customer accounts have been created yet.</p>}
      </Panel>
      <Panel className="flex flex-col justify-between border-[#dce6e0] bg-[#f4f8f4] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="mono text-[9px] uppercase tracking-[.15em] text-[#71867b]">{activeEnvironmentLabel} BILLING / {d.defaultCurrency}</div><h2 className="display mt-1 text-[18px] font-bold text-[#263f37]">Net revenue</h2></div>
          <Link href="/admin/finance" data-testid="link-revenue-finance" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#34776b] no-underline hover:underline">Payment ledger <ArrowRight className="h-3.5 w-3.5"/></Link>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div><div className="text-[10px] font-medium text-[#75877e]">This month</div><div className="display mt-1 text-[25px] font-bold tracking-[-.04em] text-[#25473d]" data-testid="dashboard-value-revenue-month">{formatCurrency(d.revenueThisMonth, d.defaultCurrency)}</div></div>
          <div className="sm:border-l sm:border-[#dce6e0] sm:pl-5"><div className="text-[10px] font-medium text-[#75877e]">Lifetime</div><div className="display mt-1 text-[25px] font-bold tracking-[-.04em] text-[#25473d]" data-testid="dashboard-value-revenue-lifetime">{formatCurrency(d.totalRevenue, d.defaultCurrency)}</div></div>
        </div>
        <p className="mt-4 border-t border-[#dce6e0] pt-3 text-[10px] leading-4 text-[#74877d]">{d.billingEnvironment ? `${d.billingEnvironment} payments only; the other environment is excluded. ` : 'No active billing environment; revenue is not reported. ' }Revenue is net of full refunds. Refunds are assigned to the original capture month because the ledger does not store refund timestamps.</p>
      </Panel>
    </section>

    <section aria-label="Six-month operating trends" className="grid gap-4 xl:grid-cols-2">
      <Panel className="p-5">
        <ChartHeading eyebrow="ACQUISITION / LAST 6 MONTHS" title="Registrations" detail="New accounts created each month"/>
        {historyHasRegistrations ? <div className="mt-4 h-[210px]" data-testid="chart-registrations">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={d.registrationsByMonth} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#edf0ee"/><XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#87919b' }}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#87919b' }}/><Tooltip contentStyle={chartTooltip} labelFormatter={label => monthLabel(String(label))} formatter={(value: number) => [value.toLocaleString(), 'Registrations']}/><Bar dataKey="registrations" name="Registrations" fill="#4f8068" radius={[3, 3, 0, 0]} maxBarSize={34}/>
          </BarChart></ResponsiveContainer>
        </div> : <div className="mt-4"><ChartEmpty title="No registrations in this period" body="Monthly account history will appear here once new customers register."/></div>}
      </Panel>
      <Panel className="p-5">
        <ChartHeading eyebrow={`REVENUE / ${activeEnvironmentLabel} / ${d.defaultCurrency} / LAST 6 MONTHS`} title="Net revenue trend" detail={d.billingEnvironment ? `Active ${d.billingEnvironment} environment; default currency only, with currencies never combined.` : 'Select an active Razorpay environment to display its revenue trend.'}/>
        {historyHasRevenue ? <div className="mt-4 h-[210px]" data-testid="chart-revenue-history">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={d.revenueTrend} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#edf0ee"/><XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#87919b' }}/><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#87919b' }} tickFormatter={value => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))}/><Tooltip contentStyle={chartTooltip} labelFormatter={label => monthLabel(String(label))} formatter={(value: number) => [formatCurrency(value, d.defaultCurrency), `Net ${d.defaultCurrency}`]}/><Bar dataKey="revenue" name={`Net ${d.defaultCurrency}`} fill="#3f7690" radius={[3, 3, 0, 0]} maxBarSize={34}/>
          </BarChart></ResponsiveContainer>
        </div> : <div className="mt-4"><ChartEmpty title="No revenue in this period" body={d.billingEnvironment ? `No ${d.billingEnvironment} revenue is recorded in ${d.defaultCurrency} for the six-month history.` : 'No active billing environment is configured, so no revenue trend can be shown.'}/></div>}
        <p className="mt-2 text-[10px] leading-4 text-[#7e8894]">Refunds are recorded against their original capture month; exact refund timing is not available in the ledger.</p>
      </Panel>
    </section>

    <section aria-label="Subscription plans and currency ledger" className="grid gap-4 xl:grid-cols-[.82fr_1.18fr]">
      <Panel className="p-5">
        <div className="flex items-start justify-between gap-3"><div><div className="mono text-[9px] uppercase tracking-[.15em] text-[#87919b]">CURRENT ACCESS</div><h2 className="display mt-1 text-[18px] font-bold text-[#263447]">Plan distribution</h2></div><Link href="/admin/packages" data-testid="link-package-billing" className="text-[11px] font-semibold text-[#245b9b] no-underline hover:underline">Manage packages <ArrowRight className="ml-1 inline h-3.5 w-3.5"/></Link></div>
        <p className="mt-1 text-[10px] leading-4 text-[#818c97]">Active subscription access by package; access may be gifted or comped.</p>
        {d.activeSubscriptionsByPackage.length ? <div className="mt-4 space-y-3">
          {d.activeSubscriptionsByPackage.map((item, index) => <div key={item.packageName} data-testid={`package-distribution-${index}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3"><span className="truncate text-[11px] font-medium text-[#455365]">{item.packageName}</span><span className="mono shrink-0 text-[11px] font-semibold text-[#344154]">{item.activeSubscriptions.toLocaleString()}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f2]"><div className="h-full rounded-full bg-[#668ba1]" style={{ width: `${Math.max(item.activeSubscriptions > 0 ? 2 : 0, item.activeSubscriptions / maxPackageCount * 100)}%` }}/></div>
          </div>)}
        </div> : <div className="mt-4 rounded-md border border-dashed border-[#dce3de] bg-[#fbfcfa] px-4 py-7 text-center"><div className="text-[12px] font-semibold text-[#52616e]">No active package access</div><p className="mt-1 text-[10px] text-[#818c97]">Active plan assignments will appear here.</p></div>}
      </Panel>
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mono text-[9px] uppercase tracking-[.15em] text-[#87919b]">LEDGER SUMMARY</div><h2 className="display mt-1 text-[18px] font-bold text-[#263447]">Revenue by currency</h2></div><Link href="/admin/finance" data-testid="link-currency-finance" className="text-[11px] font-semibold text-[#245b9b] no-underline hover:underline">Open finance <ArrowRight className="ml-1 inline h-3.5 w-3.5"/></Link></div>
        <p className="mt-1 text-[10px] leading-4 text-[#818c97]">{d.billingEnvironment ? `Each currency is reported separately. Values reflect ${d.billingEnvironment} capture totals net of full refunds.` : 'No active billing environment is configured, so no payment totals are included.'}</p>
        {d.revenueByCurrency.length ? <div className="mt-4 space-y-3">
          {d.revenueByCurrency.map(item => <div key={item.currency} data-testid={`currency-summary-${item.currency.toLowerCase()}`} className="rounded-md border border-[#e8ecef] bg-[#fbfcfb] p-3">
            <div className="mb-2 flex items-center justify-between border-b border-[#edf0f2] pb-2"><span className="mono text-[11px] font-semibold tracking-wide text-[#435465]">{item.currency}</span><span className="text-[9px] text-[#89939d]">MONTH / LIFETIME</span></div>
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2 text-[10px]">
              <span className="text-[#778390]">Net revenue</span><span className="mono text-right font-semibold text-[#334255]">{formatCurrency(item.revenueThisMonth, item.currency)}</span><span className="mono text-right font-semibold text-[#334255]">{formatCurrency(item.totalRevenue, item.currency)}</span>
              <span className="text-[#778390]">Captured / refunded</span><span className="text-right text-[#52616e]">{item.capturedPaymentsThisMonth.toLocaleString()} / {item.refundedPaymentsThisMonth.toLocaleString()} payments</span><span className="text-right text-[#52616e]">{item.capturedPaymentsTotal.toLocaleString()} / {item.refundedPaymentsTotal.toLocaleString()} payments</span>
              <span className="text-[#778390]">Captured gross</span><span className="mono text-right text-[#52616e]">{formatCurrency(item.capturedThisMonth, item.currency)}</span><span className="mono text-right text-[#52616e]">{formatCurrency(item.capturedLifetime, item.currency)}</span>
              <span className="text-[#778390]">Refunded</span><span className="mono text-right text-[#9a6547]">{formatCurrency(item.refundedThisMonth, item.currency)}</span><span className="mono text-right text-[#9a6547]">{formatCurrency(item.refundedLifetime, item.currency)}</span>
            </div>
          </div>)}
        </div> : <div className="mt-4 rounded-md border border-dashed border-[#dce3de] bg-[#fbfcfa] px-4 py-7 text-center"><div className="text-[12px] font-semibold text-[#52616e]">No payment activity recorded</div><p className="mt-1 text-[10px] text-[#818c97]">{d.billingEnvironment ? `Currency totals will appear after ${d.billingEnvironment} payments are captured.` : 'Select an active billing environment under Billing & plans to view its payments.'}</p></div>}
      </Panel>
    </section>

    <section aria-label="Platform configuration and recent accounts" className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
      <Panel className="p-5">
        <div className="flex items-start justify-between gap-3"><div><div className="mono text-[9px] uppercase tracking-[.15em] text-[#87919b]">CONTROL PLANE</div><h2 className="display mt-1 text-[18px] font-bold text-[#263447]">Operational configuration</h2></div><Link href="/admin/settings" data-testid="link-configuration-settings" className="text-[11px] font-semibold text-[#245b9b] no-underline hover:underline">Settings <ArrowRight className="ml-1 inline h-3.5 w-3.5"/></Link></div>
        <div className="mt-4 divide-y divide-[#edf0f2]">
          <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-[11px] text-[#657282]">Razorpay environment</span><StatusPill tone={d.billingEnvironment === 'production' ? 'blue' : 'orange'}>{d.billingEnvironment ? d.billingEnvironment : 'Not configured'}</StatusPill></div>
          <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-[11px] text-[#657282]">Application SMTP</span><StatusPill tone={d.applicationEmailConfigured ? 'blue' : 'gray'}>{d.applicationEmailConfigured ? 'Settings saved' : 'Not configured'}</StatusPill></div>
          <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-[11px] text-[#657282]">Maintenance mode</span><StatusPill tone={d.maintenanceMode ? 'orange' : 'blue'}>{d.maintenanceMode ? 'Enabled' : 'Off'}</StatusPill></div>
          <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-[11px] text-[#657282]">Plan visibility</span><StatusPill tone={d.packageVisibility === 'public' ? 'blue' : 'gray'}>{d.packageVisibility === 'public' ? 'Public' : 'Hidden'}</StatusPill></div>
        </div>
        <p className="mt-2 border-t border-[#edf0f2] pt-3 text-[10px] leading-4 text-[#818c97]">SMTP status confirms saved settings only, not a successful connection or delivery. Email attempts: <span className="mono font-semibold text-[#566475]" data-testid="dashboard-value-email-attempts">{d.emailsSent.toLocaleString()}</span>; this is an attempt count, not confirmed inbox delivery.</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/admin/billing" data-testid="link-configuration-billing" className="text-[10px] font-semibold text-[#245b9b] no-underline hover:underline">Billing &amp; PG setup</Link>
          <Link href="/admin/packages" data-testid="link-configuration-packages" className="text-[10px] font-semibold text-[#245b9b] no-underline hover:underline">Packages</Link>
          <Link href="/admin/settings" data-testid="link-configuration-platform" className="text-[10px] font-semibold text-[#245b9b] no-underline hover:underline">Platform settings</Link>
          <Link href="/admin/google-oauth" data-testid="link-configuration-oauth" className="text-[10px] font-semibold text-[#245b9b] no-underline hover:underline">Gmail OAuth</Link>
        </div>
      </Panel>
      <Panel className="p-5">
        <div className="flex items-start justify-between gap-3"><div><div className="mono text-[9px] uppercase tracking-[.15em] text-[#87919b]">LATEST SIGN-UPS</div><h2 className="display mt-1 text-[18px] font-bold text-[#263447]">Recent accounts</h2></div><Link href="/admin/users" data-testid="link-all-accounts" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#245b9b] no-underline hover:underline">All accounts <ArrowRight className="h-3.5 w-3.5"/></Link></div>
        {d.recentUsers.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[490px] text-left"><thead><tr className="border-b border-[#e9edf0] text-[9px] uppercase tracking-[.11em] text-[#8b95a1]"><th className="pb-2 font-medium">Account</th><th className="pb-2 font-medium">Joined</th><th className="pb-2 font-medium">Access</th><th className="pb-2 font-medium">Plan</th></tr></thead><tbody>{d.recentUsers.map((u: AdminUser) => <tr key={u.id} data-testid={`row-recent-user-${u.id}`} className="border-b border-[#f0f2f4] last:border-0"><td className="py-2.5"><div className="text-[11px] font-semibold text-[#344154]">{u.firstName} {u.lastName}</div><div className="mt-0.5 text-[10px] text-[#7d8794]">{u.email}</div></td><td className="whitespace-nowrap py-2.5 text-[10px] text-[#6d7886]">{new Date(u.createdAt).toLocaleDateString()}</td><td className="py-2.5"><div className="flex flex-wrap gap-1"><StatusPill tone={u.active ? 'blue' : 'orange'}>{u.active ? 'Enabled' : 'Disabled'}</StatusPill>{!u.emailVerified && <StatusPill tone="orange">Unverified</StatusPill>}</div></td><td className="py-2.5 text-[10px] capitalize text-[#687484]">{u.subscriptionStatus || 'No plan'}</td></tr>)}</tbody></table></div> : <div className="mt-4 rounded-md border border-dashed border-[#dce3de] bg-[#fbfcfa] px-4 py-8 text-center"><div className="text-[12px] font-semibold text-[#52616e]">No recent accounts</div><p className="mt-1 text-[10px] text-[#818c97]">New tenant sign-ups will appear here.</p></div>}
      </Panel>
    </section>

    <Panel className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-[#557b8f]"/><span className="text-[11px] font-semibold text-[#455365]">Quick access</span></div><nav aria-label="Admin destinations" className="flex flex-wrap gap-x-5 gap-y-2">{quickLinks.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} data-testid={item.testId} title={item.detail} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#536b7c] no-underline hover:text-[#174f99]"><Icon className="h-3.5 w-3.5"/>{item.label}</Link>; })}</nav></div>
    </Panel>
  </div>;
}
function AdminUsersPage() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [page, setPage] = useState(1);
  const params = useMemo(() => ({ search: search || undefined, status: status as 'all' | 'active' | 'inactive' | 'pending', page, pageSize: 12 }), [search, status, page]);
  const q = useListAdminUsers(params); const qc = useQueryClient(); const update = useUpdateAdminUserStatus(); const remove = useDeleteAdminUser();
  const [pendingAdminAction, setPendingAdminAction] = useState<{ kind: 'status'; user: AdminUser; nextActive: boolean } | { kind: 'delete'; user: AdminUser } | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); };
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const setActive = (user: AdminUser) => setPendingAdminAction({ kind: 'status', user, nextActive: !user.active });
  const softDelete = (user: AdminUser) => setPendingAdminAction({ kind: 'delete', user });
  const confirmAdminAction = () => {
    if (!pendingAdminAction) return;
    const action = pendingAdminAction;
    setActionError('');
    if (action.kind === 'status') {
      update.mutate(
        { userId: action.user.id, data: { active: action.nextActive } },
        {
          onSuccess: () => { setPendingAdminAction(null); invalidate(); setActionMessage(`Account ${action.nextActive ? 'activated' : 'deactivated'}.`); },
          onError: error => { setPendingAdminAction(null); setActionError(getError(error)); },
        },
      );
    } else {
      remove.mutate(
        { userId: action.user.id },
        {
          onSuccess: () => { setPendingAdminAction(null); invalidate(); setActionMessage('Account soft-deleted.'); },
          onError: error => { setPendingAdminAction(null); setActionError(getError(error)); },
        },
      );
    }
  };
  return <><PageHeading eyebrow="CUSTOMER ACCOUNTS" title="Accounts" detail="Search and manage tenant access. Changes apply to the selected customer account."/>
    <FormError message={actionError || undefined}/>
    {actionMessage && <div role="status" data-testid="status-admin-account-action" className="mb-4 rounded-md border border-[#cfe4d8] bg-[#f1f8f4] px-4 py-3 text-[12px] text-[#31674b]">{actionMessage}</div>}
    <Panel className="mb-4 p-4"><div className="flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b95a1]"/><input data-testid="input-account-search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, username, or email" className="h-10 w-full rounded-md border border-[#d8dde4] pl-9 pr-3 text-[13px] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"/></label><div className="relative"><SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b95a1]"/><select data-testid="select-account-status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="h-10 min-w-[172px] rounded-md border border-[#d8dde4] bg-white pl-9 pr-3 text-[12px] outline-none focus:border-[#3b73b8]"><option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Disabled</option><option value="pending">Pending verification</option></select></div></div></Panel>{q.isLoading ? <div className="space-y-2"><div className="h-14 animate-pulse rounded bg-[#eceff2]"/><div className="h-14 animate-pulse rounded bg-[#eceff2]"/><div className="h-14 animate-pulse rounded bg-[#eceff2]"/></div> : q.isError ? <QueryProblem retry={() => q.refetch()}/> : <Panel><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead className="bg-[#fafbfc]"><tr className="border-b border-[#e8ebef] text-[10px] uppercase tracking-[.12em] text-[#8893a0]"><th className="px-5 py-3 font-medium">Customer</th><th className="px-4 py-3 font-medium">Created</th><th className="px-4 py-3 font-medium">Last sign-in</th><th className="px-4 py-3 font-medium">Subscription</th><th className="px-4 py-3 font-medium">Account status</th><th className="px-4 py-3 font-medium text-right">Actions</th></tr></thead><tbody>{q.data?.items.map((u: AdminUser) => <tr key={u.id} data-testid={`row-account-${u.id}`} className="border-b border-[#eef0f2] last:border-0 hover:bg-[#fcfcfd]"><td className="px-5 py-3.5"><div className="text-[12px] font-semibold">{u.firstName} {u.lastName}</div><div className="mt-0.5 text-[11px] text-[#7d8794]">{u.email} <span className="text-[#b1b8c0]">· @{u.username}</span></div></td><td className="px-4 py-3 text-[11px] text-[#687484]">{new Date(u.createdAt).toLocaleDateString()}</td><td className="px-4 py-3 text-[11px] text-[#687484]">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td><td className="px-4 py-3 text-[11px] text-[#687484]">{u.subscriptionStatus || '—'}</td><td className="px-4 py-3"><div className="flex flex-col items-start gap-1.5"><StatusPill tone={u.active ? 'blue' : 'orange'}>{u.active ? 'Active' : 'Disabled'}</StatusPill>{!u.emailVerified && <span className="text-[10px] text-[#aa5c24]">Email unverified</span>}</div></td><td className="px-4 py-3 text-right"><div className="inline-flex gap-1"><Button variant="outline" className="min-h-8 px-2.5 text-[11px]" testId={`button-toggle-account-${u.id}`} disabled={update.isPending} onClick={() => setActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</Button><Button variant="danger" className="min-h-8 px-2.5" testId={`button-delete-account-${u.id}`} disabled={remove.isPending} onClick={() => softDelete(u)}><Trash2 className="h-3.5 w-3.5"/></Button></div></td></tr>)}{!q.data?.items.length && <tr><td colSpan={6} className="px-5 py-16 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#f1f4f7] text-[#778392]"><Search className="h-4 w-4"/></div><div className="mt-3 text-[13px] font-semibold">No matching accounts</div><div className="mt-1 text-[11px] text-[#7d8794]">Try another search or status filter.</div></td></tr>}</tbody></table></div><div className="flex items-center justify-between border-t border-[#e8ebef] px-5 py-3"><span className="text-[11px] text-[#7d8794]">{q.data?.total || 0} accounts</span><div className="flex items-center gap-2"><Button variant="quiet" className="min-h-8 px-2" testId="button-page-previous" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4"/>Previous</Button><span className="mono text-[10px] text-[#687484]">{page} / {totalPages}</span><Button variant="quiet" className="min-h-8 px-2" testId="button-page-next" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="h-4 w-4"/></Button></div></div></Panel>}
    <ConfirmActionDialog
      open={Boolean(pendingAdminAction)}
      title={pendingAdminAction?.kind === 'delete' ? 'Soft-delete this account?' : pendingAdminAction?.nextActive ? 'Activate this account?' : 'Deactivate this account?'}
      description={pendingAdminAction?.kind === 'delete'
        ? `Soft-delete ${pendingAdminAction.user.email}? They will lose account access, and this action cannot be undone from this screen.`
        : pendingAdminAction ? `${pendingAdminAction.nextActive ? 'Allow' : 'Disable'} access for ${pendingAdminAction.user.firstName} ${pendingAdminAction.user.lastName} (${pendingAdminAction.user.email})?` : ''}
      confirmLabel={pendingAdminAction?.kind === 'delete' ? 'Soft-delete account' : pendingAdminAction?.nextActive ? 'Activate account' : 'Deactivate account'}
      destructive={pendingAdminAction?.kind === 'delete' || pendingAdminAction?.nextActive === false}
      pending={update.isPending || remove.isPending}
      onOpenChange={open => { if (!open && !update.isPending && !remove.isPending) setPendingAdminAction(null); }}
      onConfirm={confirmAdminAction}
      testId="dialog-admin-account-action"
    />
  </>;
}
const settingGroups: Array<{ title: string; description?: string; fields: Array<[keyof PlatformSettingsInput, string, 'text' | 'number' | 'boolean' | 'list' | 'select', string[]?]> }> = [
  { title: 'Identity & defaults', fields: [['applicationName','Application name','text'],['defaultCurrency','Default currency','text'],['defaultTimezone','Default timezone','text'],['dateFormat','Date format','text'],['supportEmail','Support email','text'],['supportPhone','Support phone','text'],['maintenanceMode','Maintenance mode','boolean']] },
  { title: 'Account & authentication', fields: [['maxContactsPerUser','Contacts per user','number'],['maxUploadFileSizeMb','Upload file size limit (MB)','number'],['allowedContactFileTypes','Allowed contact file types','list'],['passwordMinimumLength','Minimum password length','number'],['otpExpiryMinutes','OTP expiry (minutes)','number'],['maxOtpAttempts','Maximum OTP attempts','number'],['loginAttemptThreshold','Login attempt threshold','number'],['sessionDurationHours','Session duration (hours)','number']] },
  { title: 'Sending & delivery', fields: [['defaultEmailsPerHour','Default emails per hour','number'],['maxEmailsPerDay','Maximum emails per day','number'],['maxCampaignSize','Maximum campaign size','number'],['maxConcurrentCampaigns','Concurrent campaigns','number'],['retryAttempts','Retry attempts','number'],['retryDelaySeconds','Retry delay (seconds)','number'],['bounceThreshold','Bounce threshold','number'],['deliveryTrackingEnabled','Request SMTP delivery notices (best effort)','boolean'],['queuePollingSeconds','Queue polling (seconds)','number']] },
  { title: 'Campaign content tests', description: 'Set the number of subject, greeting, and signature options required to split recipients across a test, and the maximum options allowed. Below the minimum, the first option is used for everyone.', fields: [['subjectVariantMinimum','Minimum subject options','number'],['subjectVariantMaximum','Maximum subject options','number'],['greetingVariantMinimum','Minimum greeting options','number'],['greetingVariantMaximum','Maximum greeting options','number'],['signatureVariantMinimum','Minimum signature options','number'],['signatureVariantMaximum','Maximum signature options','number']] },
  { title: 'Campaign content policy', description: 'Add blocked words or phrases one at a time. They are checked in subject lines, greetings, body text, HTML content, and signatures. Separators such as spaces, dots, brackets, and zero-width characters between letters do not bypass the check.', fields: [['prohibitedEmailKeywords','Blocked words and phrases','list']] },
  { title: 'Subscription rules', fields: [['allowUserWithoutSubscription','Allow accounts without subscription','boolean'],['gracePeriodDays','Grace period (days)','number'],['packageVisibility','Package visibility','select',['public','hidden']]] },
];
function SettingsGroup({ title, description, fields, values, setValues }: { title: string; description?: string; fields: Array<[keyof PlatformSettingsInput, string, 'text'|'number'|'boolean'|'list'|'select', string[]?]>; values: Fields; setValues: (v: Fields) => void }) {
  return <Panel className="p-5 md:p-6"><div className="mb-5"><h2 className="display text-[18px] font-bold">{title}</h2>{description && <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[#687587]">{description}</p>}</div><div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">{fields.map(([key, label, type, options]) => <div key={key as string} className={key === 'prohibitedEmailKeywords' ? 'sm:col-span-2' : type === 'boolean' ? 'flex min-h-10 items-center justify-between gap-4 rounded-md border border-[#e4e8ec] px-3' : ''}>{type === 'boolean' ? <><span className="text-[12px] font-medium text-[#344154]">{label}</span><button type="button" data-testid={`toggle-setting-${String(key)}`} aria-pressed={!!values[key]} onClick={() => setValues({ ...values, [key]: !values[key] })} className={cn('relative h-[22px] w-10 rounded-full transition-colors', values[key] ? 'bg-[#245b9b]' : 'bg-[#c8ced5]')}><span className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform', values[key] ? 'translate-x-[21px]' : 'translate-x-[3px]')}/></button></> : type === 'select' ? <SelectField label={label} value={String(values[key] ?? options?.[0] ?? '')} onChange={v => setValues({ ...values, [key]: v })} options={options || []} testId={`select-setting-${String(key)}`}/> : type === 'list' && key === 'prohibitedEmailKeywords' ? <BlockedWordsEditor label={label} words={Array.isArray(values[key]) ? values[key] as string[] : []} onChange={words => setValues({ ...values, [key]: words })}/> : <Field label={label} value={Array.isArray(values[key]) ? (values[key] as string[]).join(', ') : String(values[key] ?? '')} onChange={v => setValues({ ...values, [key]: type === 'number' ? (v === '' ? '' : Number(v)) : type === 'list' ? v.split(',').map(x => x.trim()).filter(Boolean) : v })} testId={`input-setting-${String(key)}`} type={type === 'number' ? 'number' : 'text'}/>}</div>)}</div></Panel>;
}
function BlockedWordsEditor({ label, words, onChange }: { label: string; words: string[]; onChange: (words: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');

  const addWords = () => {
    const additions = draft.split(',').map(word => word.trim()).filter(Boolean);
    if (!additions.length) {
      setMessage('Enter a word or phrase first.');
      return;
    }
    if (additions.some(word => word.length > 100)) {
      setMessage('Each word or phrase must be 100 characters or fewer.');
      return;
    }
    const known = new Set(words.map(word => word.toLocaleLowerCase()));
    const uniqueAdditions = additions.filter(word => {
      const normalized = word.toLocaleLowerCase();
      if (known.has(normalized)) return false;
      known.add(normalized);
      return true;
    });
    if (!uniqueAdditions.length) {
      setMessage('Those words are already in the list.');
      return;
    }
    if (words.length + uniqueAdditions.length > 200) {
      setMessage('You can add up to 200 words or phrases.');
      return;
    }
    onChange([...words, ...uniqueAdditions]);
    setDraft('');
    setMessage('');
  };

  return <div className="space-y-2.5">
    <span className="block text-[12px] font-semibold text-[#344154]">{label}</span>
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        data-testid="input-prohibited-keyword"
        type="text"
        value={draft}
        onChange={event => { setDraft(event.target.value); setMessage(''); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addWords(); } }}
        placeholder="Type a word or phrase"
        aria-label="Word or phrase to block"
        className="h-10 min-w-0 flex-1 rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3]"
      />
      <Button testId="button-add-prohibited-keyword" variant="outline" onClick={addWords}>Add</Button>
    </div>
    {message && <p role="alert" className="text-[11px] text-[#a95218]">{message}</p>}
    <div className="rounded-md border border-[#e4e8ec] bg-[#fafbfc] p-3" aria-live="polite">
      {words.length ? <div className="flex flex-wrap gap-2">
        {words.map((word, index) => <span key={`${word}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#dbe2ea] bg-white py-1 pl-3 pr-1 text-[12px] text-[#344154]">
          <span className="break-all">{word}</span>
          <button type="button" data-testid={`button-remove-prohibited-keyword-${index}`} aria-label={`Remove ${word}`} onClick={() => onChange(words.filter((_, wordIndex) => wordIndex !== index))} className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#687484] hover:bg-[#f0f2f4] hover:text-[#a13d36]">Remove</button>
        </span>)}
      </div> : <p className="text-[12px] text-[#7d8794]">No blocked words or phrases added yet.</p>}
      <p className="mt-2 text-right text-[10px] text-[#7d8794]">{words.length} / 200</p>
    </div>
  </div>;
}
type SmtpProvider = 'google_workspace' | 'gmail' | 'microsoft_365' | 'zeptomail' | 'other';
const SMTP_PROVIDER_OPTIONS = [
  { value: 'google_workspace', label: 'Google Workspace' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'microsoft_365', label: 'Microsoft 365' },
  { value: 'zeptomail', label: 'ZeptoMail (transactional email only)' },
  { value: 'other', label: 'Other SMTP provider' },
];
const SMTP_PROVIDER_PRESETS: Partial<Record<SmtpProvider, { host: string; port: string; encryption: 'tls' }>> = {
  google_workspace: { host: 'smtp.gmail.com', port: '587', encryption: 'tls' },
  gmail: { host: 'smtp.gmail.com', port: '587', encryption: 'tls' },
  microsoft_365: { host: 'smtp.office365.com', port: '587', encryption: 'tls' },
  zeptomail: { host: 'smtp.zeptomail.com', port: '587', encryption: 'tls' },
};

function AdminSettingsPage() {
  const q = useGetAdminSettings();
  const emailQ = useGetApplicationEmailSettings();
  const qc = useQueryClient();
  const save = useUpdateAdminSettings();
  const saveEmail = useUpdateApplicationEmailSettings();
  const testSend = useSendApplicationEmailTest();
  const [settings, setSettings] = useState<Fields | null>(null);
  const [smtp, setSmtp] = useState<Record<string, string>>({ provider: 'other' });
  const [variantLimitsError, setVariantLimitsError] = useState('');

  useEffect(() => {
    if (q.data) {
      const { updatedAt: _updatedAt, ...rest } = q.data;
      setSettings(rest as unknown as Fields);
    }
  }, [q.data]);

  useEffect(() => {
    if (emailQ.data) {
      setSmtp((previous) => ({
        ...previous,
        provider: emailQ.data.provider,
        host: emailQ.data.host || '',
        port: emailQ.data.port == null ? '' : String(emailQ.data.port),
        encryption: emailQ.data.encryption || '',
        username: emailQ.data.username || '',
        fromName: emailQ.data.fromName || '',
        fromEmail: emailQ.data.fromEmail || '',
        replyTo: emailQ.data.replyTo || '',
        password: '',
      }));
    }
  }, [emailQ.data]);

  const savePlatform = (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    const variantBounds = [
      ['subjectVariantMinimum', 'subjectVariantMaximum'],
      ['greetingVariantMinimum', 'greetingVariantMaximum'],
      ['signatureVariantMinimum', 'signatureVariantMaximum'],
    ] as const;
    const invalidBounds = variantBounds.some(([minimumKey, maximumKey]) => {
      const minimum = Number(settings[minimumKey]);
      const maximum = Number(settings[maximumKey]);
      return (
        !Number.isInteger(minimum) ||
        !Number.isInteger(maximum) ||
        minimum < 2 ||
        maximum > 20 ||
        minimum > maximum
      );
    });
    if (invalidBounds) {
      setVariantLimitsError('Each minimum must be between 1 and its maximum, and each maximum must be 20 or less.');
      return;
    }
    setVariantLimitsError('');
    save.mutate(
      { data: settings as unknown as PlatformSettingsInput },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMaintenanceStatusQueryKey() });
        },
      },
    );
  };

  const setSmtpProvider = (provider: SmtpProvider) => {
    const preset = SMTP_PROVIDER_PRESETS[provider];
    setSmtp((current) => ({
      ...current,
      provider,
      host: preset?.host ?? '',
      port: preset?.port ?? '',
      encryption: preset?.encryption ?? '',
    }));
  };

  const saveSmtp = (e: FormEvent) => {
    e.preventDefault();
    const body: ApplicationEmailSettingsInput = {
      provider: smtp.provider as SmtpProvider,
      host: smtp.host,
      port: Number(smtp.port),
      encryption: smtp.encryption as 'none' | 'ssl' | 'tls',
      username: smtp.username,
      fromName: smtp.fromName,
      fromEmail: smtp.fromEmail,
      ...(smtp.replyTo ? { replyTo: smtp.replyTo } : {}),
      ...(smtp.password ? { password: smtp.password } : {}),
    };
    saveEmail.mutate(
      { data: body },
      {
        onSuccess: () => {
          setSmtp((current) => ({ ...current, password: '' }));
          qc.invalidateQueries({ queryKey: getGetApplicationEmailSettingsQueryKey() });
        },
      },
    );
  };

  const sendTest = (e: FormEvent) => {
    e.preventDefault();
    if (smtp.testTo) testSend.mutate({ data: { toEmail: smtp.testTo } });
  };

  if (q.isLoading || emailQ.isLoading || !settings) {
    return <LoadingPanel label="Loading platform settings"/>;
  }
  if (q.isError || emailQ.isError || !emailQ.data) {
    return <QueryProblem retry={() => { q.refetch(); emailQ.refetch(); }}/>;
  }

  const selectedProvider = smtp.provider as SmtpProvider;
  const presetActive = selectedProvider !== 'other';
  const providerNote = selectedProvider === 'google_workspace'
    ? 'Uses smtp.gmail.com on port 587 with STARTTLS. Enter the full mailbox address and a Google app password. Workspace administrators may restrict app passwords; Workspace SMTP relay has tenant-specific settings.'
    : selectedProvider === 'gmail'
      ? 'Uses smtp.gmail.com on port 587 with STARTTLS. Enter the full Gmail address and a Google app password; Google requires 2-Step Verification for app passwords.'
      : selectedProvider === 'microsoft_365'
        ? 'Uses smtp.office365.com on port 587 with STARTTLS. SMTP AUTH must be enabled for the mailbox. This password-based form does not support Microsoft OAuth-only tenants.'
        : selectedProvider === 'zeptomail'
          ? 'Uses smtp.zeptomail.com on port 587 with STARTTLS. Enter the SMTP username and token from your ZeptoMail Agent, and use a verified sender address. ZeptoMail permits transactional system email only; its terms prohibit marketing campaigns, newsletters, and mass email.'
          : 'Enter the server, port, encryption, and SMTP credentials provided by your email service.';

  return (
    <>
      <PageHeading
        eyebrow="PLATFORM CONFIGURATION"
        title="Settings"
        detail="Operational controls are platform-wide. SMTP credentials are write-only and never returned by the API."
      />
      <form onSubmit={savePlatform} className="space-y-4">
        {settingGroups.map(group => (
          <SettingsGroup key={group.title} {...group} values={settings} setValues={setSettings}/>
        ))}
        {variantLimitsError && <p role="alert" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[12px] text-[#99501e]">{variantLimitsError}</p>}
        <div className="flex justify-end">
          <Button type="submit" testId="button-save-platform-settings" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save platform settings'}<Check className="h-4 w-4"/>
          </Button>
        </div>
        <FormError message={save.isError ? getError(save.error) : undefined}/>
        {save.isSuccess && <div data-testid="status-platform-settings-saved" className="text-right text-[11px] text-[#245b9b]">Platform settings saved.</div>}
      </form>

      <Panel className="mt-8 p-5 md:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">APPLICATION DELIVERY</div>
            <h2 className="display mt-2 text-[20px] font-bold">SMTP configuration</h2>
            <p className="mt-1 text-[12px] text-[#778291]">Choose a provider to prefill its connection settings for account verification and platform notices.</p>
          </div>
          <StatusPill tone={emailQ.data.passwordConfigured ? 'blue' : 'orange'}>
            {emailQ.data.passwordConfigured ? 'Password configured' : 'Password not configured'}
          </StatusPill>
        </div>

        <form onSubmit={saveSmtp} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SelectField
              label="Email provider"
              value={selectedProvider}
              onChange={value => setSmtpProvider(value as SmtpProvider)}
              options={SMTP_PROVIDER_OPTIONS}
              testId="select-smtp-provider"
              required
            />
            <p className="mt-2 text-[11px] leading-5 text-[#778291]">{providerNote}</p>
          </div>
          <Field label="SMTP host" value={smtp.host || ''} onChange={value => setSmtp(state => ({ ...state, host: value }))} testId="input-smtp-host" required disabled={presetActive}/>
          <Field label="Port" value={smtp.port || ''} onChange={value => setSmtp(state => ({ ...state, port: value }))} testId="input-smtp-port" type="number" required disabled={presetActive}/>
          <SelectField label="Encryption" value={smtp.encryption || ''} onChange={value => setSmtp(state => ({ ...state, encryption: value }))} options={[{ value: '', label: 'Select encryption' }, { value: 'none', label: 'None' }, { value: 'ssl', label: 'SSL/TLS (implicit)' }, { value: 'tls', label: 'STARTTLS' }]} testId="select-smtp-encryption" required disabled={presetActive}/>
          <Field
            label="SMTP username"
            value={smtp.username || ''}
            onChange={value => setSmtp(state => ({ ...state, username: value }))}
            testId="input-smtp-username"
            required={!emailQ.data.passwordConfigured}
            hint="Stored encrypted and returned only as a mask."
          />
          <Field
            label="SMTP password or app password"
            value={smtp.password || ''}
            onChange={value => setSmtp(state => ({ ...state, password: value }))}
            testId="input-smtp-password"
            type="password"
            required={!emailQ.data.passwordConfigured}
            hint="Write-only. Leave blank to retain the configured credential. The app cannot know or prefill your mailbox password."
            autoComplete="new-password"
          />
          <Field label="From name" value={smtp.fromName || ''} onChange={value => setSmtp(state => ({ ...state, fromName: value }))} testId="input-smtp-from-name" required/>
          <Field label="From email" value={smtp.fromEmail || ''} onChange={value => setSmtp(state => ({ ...state, fromEmail: value }))} testId="input-smtp-from-email" type="email" required/>
          <Field label="Reply-to address" value={smtp.replyTo || ''} onChange={value => setSmtp(state => ({ ...state, replyTo: value }))} testId="input-smtp-reply-to" type="email"/>
          <div className="sm:col-span-2">
            <FormError message={saveEmail.isError ? getError(saveEmail.error) : undefined}/>
            <div className="mt-3 flex justify-end">
              <Button type="submit" testId="button-save-smtp-settings" disabled={saveEmail.isPending}>
                {saveEmail.isPending ? 'Saving…' : 'Save SMTP settings'}<Check className="h-4 w-4"/>
              </Button>
            </div>
          </div>
        </form>

        <form onSubmit={sendTest} className="mt-6 flex flex-col gap-3 border-t border-[#e9edf0] pt-5 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="Test-send recipient"
              value={smtp.testTo || ''}
              onChange={value => setSmtp(state => ({ ...state, testTo: value }))}
              testId="input-test-recipient"
              type="email"
              placeholder="operator@example.com"
              required
            />
          </div>
          <Button type="submit" variant="outline" testId="button-send-test-email" disabled={testSend.isPending || !emailQ.data.passwordConfigured}>
            {testSend.isPending ? 'Sending…' : 'Send test email'}<Send className="h-4 w-4"/>
          </Button>
        </form>
        {testSend.isError && <div className="mt-3"><FormError message={getError(testSend.error)}/></div>}
        {testSend.isSuccess && <div data-testid="status-test-email-sent" className="mt-3 text-[11px] text-[#245b9b]">Test email request completed.</div>}
      </Panel>
    </>
  );
}
function ProfilePage({ user }: { user: AuthUser }) {
  const qc = useQueryClient();
  const update = useUpdateProfile();
  const change = useChangePassword();
  const passwordRequirement = usePasswordRequirement();
  const [rotate, setRotate] = useState(new URLSearchParams(window.location.search).get('rotate') === '1' || user.mustChangeCredentials);
  const [, setLocation] = useLocation();
  const [profile, setProfile] = useState({ username: user.username, firstName: user.firstName, lastName: user.lastName, email: user.email, timezone: user.timezone });
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '' });
  const pendingCheckoutId = new URLSearchParams(window.location.search).get('checkout');
  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { data: profile },
      {
        onSuccess: data => {
          qc.setQueryData(getGetCurrentUserQueryKey(), data);
          qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
          if (user.emailVerified && !data.emailVerified) {
            sessionStorage.setItem('mailflow-verification-email', data.email);
            setLocation('/verify-email');
          }
        },
      },
    );
  };
  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    change.mutate(
      { data: password },
      {
        onSuccess: () => {
          setPassword({ currentPassword: '', newPassword: '' });
          qc.setQueryData<AuthUser>(getGetCurrentUserQueryKey(), current => current
            ? { ...current, mustChangeCredentials: false }
            : current);
          qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
          if (rotate) {
            setRotate(false);
            const supportReturnPath = user.role === 'USER' ? getSupportTicketReturnPath() : undefined;
            sessionStorage.removeItem(SUPPORT_TICKET_RETURN_KEY);
            setLocation(pendingCheckoutId
              ? `/plans?checkout=${encodeURIComponent(pendingCheckoutId)}`
              : supportReturnPath || (user.role === 'SUPERADMIN' ? '/admin' : '/dashboard'));
          }
        },
      },
    );
  };

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT"
        title={rotate ? 'Secure your account' : 'Profile & security'}
        detail={rotate ? 'Your account must have new credentials before you can continue.' : 'Manage the identity and sign-in details attached to your account.'}
      />
      {rotate && (
        <div className="mb-5 flex items-start gap-3 rounded-md border border-[#f0d4b9] bg-[#fff8f1] p-4">
          <KeyRound className="mt-0.5 h-4 w-4 text-[#b76325]"/>
          <div>
            <div className="text-[13px] font-semibold text-[#75431e]">Credential rotation required</div>
            <div className="mt-1 text-[12px] leading-5 text-[#8a6445]">Set a new password to unlock the rest of the application.</div>
          </div>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_.82fr]">
        <Panel className="p-5 md:p-6">
          <div className="mb-5">
            <div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">PERSONAL DETAILS</div>
            <h2 className="display mt-2 text-[18px] font-bold">Account profile</h2>
          </div>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" value={profile.firstName} onChange={value => setProfile(current => ({ ...current, firstName: value }))} testId="input-profile-first-name" required/>
              <Field label="Last name" value={profile.lastName} onChange={value => setProfile(current => ({ ...current, lastName: value }))} testId="input-profile-last-name" required/>
            </div>
            <Field label="Username" value={profile.username} onChange={value => setProfile(current => ({ ...current, username: value }))} testId="input-profile-username" required hint="3–50 characters."/>
            <Field label="Email address" value={profile.email} onChange={value => setProfile(current => ({ ...current, email: value }))} testId="input-profile-email" type="email" required/>
            <Field label="Timezone" value={profile.timezone} onChange={value => setProfile(current => ({ ...current, timezone: value }))} testId="input-profile-timezone" required/>
            <FormError message={update.isError ? getError(update.error) : undefined}/>
            {update.isSuccess && <div data-testid="status-profile-saved" className="text-[11px] text-[#245b9b]">Profile updated.</div>}
            <div className="flex justify-end pt-1">
              <Button type="submit" testId="button-save-profile" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save profile'}<Check className="h-4 w-4"/>
              </Button>
            </div>
          </form>
        </Panel>

        <Panel className="p-5 md:p-6" style={{ backgroundColor: '#f4f8ff', borderColor: '#d9e6f4' }}>
          <div className="mb-5">
            <div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">SIGN-IN SECURITY</div>
            <h2 className="display mt-2 text-[18px] font-bold">Change password</h2>
          </div>
          <form onSubmit={savePassword} className="space-y-4">
            <Field label="Current password" value={password.currentPassword} onChange={value => setPassword(current => ({ ...current, currentPassword: value }))} testId="input-current-password" type="password" required autoComplete="current-password"/>
            <Field label="New password" value={password.newPassword} onChange={value => setPassword(current => ({ ...current, newPassword: value }))} testId="input-change-new-password" type="password" required minLength={passwordRequirement.minimumLength} hint={passwordRequirement.hint} autoComplete="new-password"/>
            <FormError message={change.isError ? getError(change.error) : undefined}/>
            {change.isSuccess && <div data-testid="status-password-changed" className="text-[11px] text-[#245b9b]">Password updated.</div>}
            <div className="flex justify-end pt-1">
              <Button type="submit" testId="button-change-password" disabled={change.isPending}>
                {change.isPending ? 'Updating…' : rotate ? 'Set new credentials' : 'Update password'}<LockKeyhole className="h-4 w-4"/>
              </Button>
            </div>
          </form>
          <div className="mt-7 border-t border-[#e9edf0] pt-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-4 w-4 text-[#245b9b]"/>
              <div>
                <div className="text-[12px] font-semibold">Account verification</div>
                <div className="mt-1 text-[11px] text-[#7b8693]">{user.emailVerified ? 'Email address verified' : 'Email address not verified'}</div>
              </div>
              <StatusPill tone={user.emailVerified ? 'blue' : 'orange'}>{user.emailVerified ? 'Verified' : 'Pending'}</StatusPill>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
function RouteGate({ admin, children }: { admin?: boolean; children: (u: AuthUser) => ReactNode }) { return <Gate admin={admin}>{children}</Gate>; }
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function Routes() {
  const maintenancePaused = useGetMaintenanceStatus({
    query: { queryKey: getGetMaintenanceStatusQueryKey() },
  }).data?.maintenanceMode === true;
  return <RoutedErrorBoundary><Switch>
     <Route path="/" component={MarketingHomePage}/><Route path="/features" component={PublicFeaturesPage}/><Route path="/pricing" component={PublicPricingPage}/><Route path="/package-checkout/:packageSlug" component={PackageCheckoutPage}/><Route path="/package-checkout" component={PackageCheckoutPage}/><Route path="/terms-and-conditions" component={TermsAndConditionsPage}/><Route path="/privacy-policy" component={PrivacyPolicyPage}/><Route path="/shipping-refund" component={ShippingRefundPage}/><Route path="/unsubscribe" component={CampaignUnsubscribePage}/><Route path="/login" component={LoginPage}/><Route path="/register" component={RegisterPage}/><Route path="/verify-email" component={VerifyPage}/><Route path="/forgot-password" component={ForgotPage}/><Route path="/reset-password" component={ResetPage}/>
    <Route path="/dashboard">{() => <RouteGate>{u => <UserDashboardPage user={u} maintenancePaused={maintenancePaused}/>}</RouteGate>}</Route>
    <Route path="/notifications">{() => <RouteGate>{u => u.role === 'USER' ? <NotificationsPage/> : <NotFound/>}</RouteGate>}</Route>
    <Route path="/support">{() => <RouteGate>{u => u.role === 'USER' ? <SupportTicketsPage/> : <NotFound/>}</RouteGate>}</Route>
    <Route path="/sending-settings">{() => <RouteGate>{() => <SendingSettingsPage/>}</RouteGate>}</Route>
    <Route path="/contact-field-settings">{() => <RouteGate>{u => u.role === 'USER' ? <ContactFieldSettingsPage/> : <NotFound/>}</RouteGate>}</Route>
    <Route path="/contacts">{() => <RouteGate>{u => u.role === 'USER' ? <ContactsPage/> : <NotFound/>}</RouteGate>}</Route>
    <Route path="/contacts/:contactId">{params => <RouteGate>{u => u.role === 'USER' ? <ContactDetailPage/> : <NotFound/>}</RouteGate>}</Route>
    <Route path="/companies">{() => <RouteGate>{u => u.role === 'USER' ? <CompaniesPage/> : <NotFound/>}</RouteGate>}</Route>
    <Route path="/companies/:companyId">{params => <RouteGate>{u => u.role === 'USER' ? <CompanyDetailPage/> : <NotFound/>}</RouteGate>}</Route>
    <Route path="/lists">{() => <RouteGate>{() => <ListsPage/>}</RouteGate>}</Route>
    <Route path="/campaigns">{() => <RouteGate>{() => <CampaignsPage maintenancePaused={maintenancePaused}/>}</RouteGate>}</Route>
    <Route path="/campaigns/:campaignId">{params => <RouteGate>{() => <CampaignDashboardPage campaignId={params.campaignId} maintenancePaused={maintenancePaused}/>}</RouteGate>}</Route>
    <Route path="/admin">{() => <RouteGate admin>{() => <AdminDashboardPage/>}</RouteGate>}</Route>
    <Route path="/admin/notifications">{() => <RouteGate admin>{() => <AdminNotificationsPage/>}</RouteGate>}</Route>
    <Route path="/admin/support">{() => <RouteGate admin>{() => <AdminSupportTicketsPage/>}</RouteGate>}</Route>
    <Route path="/admin/users">{() => <RouteGate admin>{() => <AdminUsersPage/>}</RouteGate>}</Route>
    <Route path="/admin/billing">{() => <RouteGate admin>{() => <AdminBillingPage/>}</RouteGate>}</Route>
    <Route path="/admin/packages">{() => <RouteGate admin>{() => <AdminPackagesPage/>}</RouteGate>}</Route>
    <Route path="/admin/finance">{() => <RouteGate admin>{() => <AdminFinancePage/>}</RouteGate>}</Route>
    <Route path="/admin/settings">{() => <RouteGate admin>{() => <AdminSettingsPage/>}</RouteGate>}</Route>
    <Route path="/admin/google-oauth">{() => <RouteGate admin>{() => <AdminGoogleOAuthPage/>}</RouteGate>}</Route>
    <Route path="/admin/ai-provider">{() => <RouteGate admin>{() => <AdminAIProviderPage/>}</RouteGate>}</Route>
    <Route path="/admin/company-intelligence">{() => <RouteGate admin>{() => <AdminCompanyIntelligencePage/>}</RouteGate>}</Route>
    <Route path="/admin/global-companies">{() => <RouteGate admin>{() => <AdminGlobalCompaniesPage/>}</RouteGate>}</Route>
    <Route path="/plans">{() => <RouteGate>{() => <PlansPage/>}</RouteGate>}</Route>
    <Route path="/profile">{() => <RouteGate>{u => <ProfilePage user={u}/>}</RouteGate>}</Route>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary>;
}
function MaintenancePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f6fa] px-5 py-12">
      <section className="w-full max-w-2xl rounded-2xl border border-[#dce4ed] bg-white p-7 shadow-[0_24px_70px_-38px_rgba(16,48,82,.42)] sm:p-10">
        <MailflowBrand/>
        <div className="mt-12 inline-flex items-center gap-2 rounded-full bg-[#edf4fc] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.14em] text-[#245b9b]">
          <span className="h-2 w-2 rounded-full bg-[#d29131]"/>
          Service update
        </div>
        <h1 className="display mt-5 text-[32px] font-bold leading-tight text-[#172334] sm:text-[40px]">
          Application Under Maintenance
        </h1>
        <p className="mt-3 text-[17px] font-semibold text-[#35455a]">We’ll be back soon.</p>
        <p className="mt-4 max-w-xl text-[14px] leading-7 text-[#536276]">
          Mailflow is temporarily unavailable while we carry out maintenance. Campaign delivery is paused and queued emails will resume automatically when the service is available again.
        </p>
        <div className="mt-7 rounded-xl border border-[#dce7f3] bg-[#f5f9fe] px-4 py-3 text-[12px] leading-6 text-[#40536b]">
          If you are the superadmin, you can sign in to manage the maintenance setting.
        </div>
        <Link href="/login" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-md bg-[#174f99] px-5 text-[13px] font-semibold text-white transition hover:bg-[#103f7e]">
          Superadmin sign in <ArrowRight className="h-4 w-4"/>
        </Link>
      </section>
    </main>
  );
}

function MaintenanceStatusLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f6fa] px-5">
      <div className="text-center">
        <MailflowBrand/>
        <div className="mt-7 flex items-center justify-center gap-2 text-[13px] text-[#536276]">
          <LoaderCircle className="h-4 w-4 animate-spin"/>
          Checking service status…
        </div>
      </div>
    </main>
  );
}

function MaintenanceBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const maintenanceQuery = useGetMaintenanceStatus({
    query: {
      queryKey: getGetMaintenanceStatusQueryKey(),
      staleTime: 0,
      refetchInterval: 5_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  });
  const maintenanceOn = maintenanceQuery.data?.maintenanceMode === true;
  const unsubscribePage = location === '/unsubscribe';
  const currentUserQuery = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      enabled: maintenanceOn,
      retry: false,
      staleTime: 0,
    },
  });
  const [noticeOpen, setNoticeOpen] = useState(false);
  const dismissedRef = useRef(false);
  const user = currentUserQuery.data;
  const blockedAuthPath = ['/register', '/verify-email', '/forgot-password', '/reset-password'].includes(
    location.split('?')[0] ?? '',
  );

  useEffect(() => {
    if (!maintenanceOn || !user) {
      dismissedRef.current = false;
      setNoticeOpen(false);
      return;
    }
    if (!dismissedRef.current) setNoticeOpen(true);
  }, [maintenanceOn, user?.id]);

  if (
    maintenanceOn &&
    !unsubscribePage &&
    (blockedAuthPath || (!user && location !== '/login'))
  ) {
    if (!blockedAuthPath && currentUserQuery.isLoading) {
      return <MaintenanceStatusLoading/>;
    }
    return <MaintenancePage/>;
  }

  return (
    <>
      {maintenanceOn && user && !unsubscribePage && (
        <div role="status" className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-[#d6a44c] bg-[#fff7e6] px-4 py-2 text-center text-[12px] font-medium text-[#694b17]">
          <span className="font-bold">Maintenance mode is active.</span>
          Campaign delivery is paused; queued emails will resume when the service is available again.
        </div>
      )}
      {children}
      {noticeOpen && maintenanceOn && user && !unsubscribePage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101b2a]/55 px-4 py-6" role="presentation">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="maintenance-notice-title"
            aria-describedby="maintenance-notice-description"
            className="w-full max-w-lg rounded-xl border border-[#dce4ed] bg-white p-6 shadow-2xl sm:p-7"
          >
            <div className="mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#9a6a12]">Platform notice</div>
            <h2 id="maintenance-notice-title" className="display mt-3 text-[23px] font-bold text-[#172334]">
              Maintenance mode is active
            </h2>
            <p id="maintenance-notice-description" className="mt-3 text-[13px] leading-6 text-[#536276]">
              Campaign delivery is paused. Queued emails will resume automatically when the superadmin switches maintenance off and the production service is available again. An email already being sent may finish. You can continue using your account.
            </p>
            <div className="mt-6 flex justify-end">
              <Button
                testId="button-dismiss-maintenance-notice"
                onClick={() => {
                  dismissedRef.current = true;
                  setNoticeOpen(false);
                }}
              >
                Continue working
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function App() {
  return <QueryClientProvider client={client}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><MaintenanceBoundary><Routes/></MaintenanceBoundary></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
