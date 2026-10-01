import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useForm } from 'react-hook-form';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, Check, Eye, EyeOff,
  ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, CreditCard, Gauge, KeyRound, LoaderCircle,
  LockKeyhole, LogOut, Menu, Search, Send, Settings2, ShieldCheck, SlidersHorizontal,
  Trash2, UserRound, Users,
} from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getGetAdminSettingsQueryKey, getGetApplicationEmailSettingsQueryKey,
  getGetCurrentUserQueryKey, getListAdminUsersQueryKey,
  useChangePassword, useDeleteAdminUser, useGetAdminDashboard, useGetAdminSettings, useGetUserDashboard,
  useGetApplicationEmailSettings, useGetCurrentUser, useListAdminUsers,
  useLogin, useLogout, useRegister, useRequestPasswordReset, useResetPassword,
  useSendApplicationEmailTest, useUpdateAdminSettings, useUpdateAdminUserStatus,
  useUpdateApplicationEmailSettings, useUpdateProfile, useVerifyRegistrationEmail,
} from '@workspace/api-client-react';
import type { AdminUser, ApplicationEmailSettingsInput, AuthUser, PlatformSettingsInput } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Form } from '@/components/ui/form';
import AdminBillingPage from '@/pages/admin-billing';
import { CampaignsPage, ContactsPage, ListsPage, SendingSettingsPage } from '@/pages/sending';
import PlansPage from '@/pages/plans';
import NotFound from '@/pages/not-found';
import './index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000, refetchOnWindowFocus: false } } });

type Fields = Record<string, string | number | boolean | string[]>;
const cn = (...s: Array<string | false | undefined>) => s.filter(Boolean).join(' ');
const getError = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Something went wrong. Please try again.';
};
function Mark({ small = false }: { small?: boolean }) {
  return <div className={cn('flex items-center gap-2.5', small && 'gap-2')}><span className="relative grid h-8 w-8 place-items-center rounded-[9px] bg-[#174f99] text-white" aria-hidden="true"><span className="absolute left-[7px] top-[8px] h-[12px] w-[16px] -skew-x-12 border-[1.5px] border-white"/><span className="absolute bottom-[7px] right-[7px] h-[5px] w-[5px] rounded-full bg-[#f28b32]"/></span><span className="display text-[20px] font-extrabold tracking-[-.05em] text-[#172334]">mailflow</span></div>;
}
function Button({ children, onClick, type = 'button', variant = 'primary', disabled, className = '', testId }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; variant?: 'primary' | 'quiet' | 'outline' | 'danger'; disabled?: boolean; className?: string; testId: string }) {
  const style = {
    primary: 'bg-[#174f99] text-white hover:bg-[#103f7e] border border-[#174f99]',
    quiet: 'bg-transparent text-[#596474] border border-transparent hover:bg-[#f4f6f8] hover:text-[#182333]',
    outline: 'bg-white text-[#283545] border border-[#d7dce3] hover:bg-[#f7f9fb]',
    danger: 'bg-white text-[#b85b20] border border-[#edc5a7] hover:bg-[#fff7f0]',
  }[variant];
  return <button data-testid={testId} type={type} onClick={onClick} disabled={disabled} className={cn('inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55', style, className)}>{children}</button>;
}
function Field({ label, value, onChange, type = 'text', placeholder, testId, required = false, hint, autoComplete, disabled = false }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string; testId: string; required?: boolean; hint?: string; autoComplete?: string; disabled?: boolean }) {
  return <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">{label}</span><input data-testid={testId} required={required} disabled={disabled} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3] disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#697584]"/>{hint && <span className="block text-[11px] leading-relaxed text-[#808a97]">{hint}</span>}</label>;
}
function SelectField({ label, value, onChange, options, testId, required = false, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: Array<string | { value: string; label: string }>; testId: string; required?: boolean; disabled?: boolean }) {
  return <label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">{label}</span><select required={required} disabled={disabled} data-testid={testId} value={value} onChange={e => onChange(e.target.value)} className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#697584]">{options.map(option => { const optionValue = typeof option === 'string' ? option : option.value; const optionLabel = typeof option === 'string' ? (option || 'Select encryption') : option.label; return <option key={optionValue} value={optionValue}>{optionLabel}</option>; })}</select></label>;
}
function Panel({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={cn('rounded-lg border border-[#e0e4e9] bg-white', className)}>{children}</section>; }
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
function AuthFrame({ children, label = 'Your email infrastructure, in focus.' }: { children: ReactNode; label?: string }) {
  return <main className="min-h-[100dvh] bg-white"><header className="absolute left-0 right-0 top-0 z-10 flex h-[76px] items-center justify-between px-6 md:px-12"><Link href="/" data-testid="link-brand" className="no-underline"><Mark/></Link><div className="mono hidden text-[10px] uppercase tracking-[.16em] text-[#8893a0] md:block">TRANSACTIONAL EMAIL / CONTROL PLANE</div></header><div className="grid min-h-[100dvh] pt-[76px] lg:grid-cols-[minmax(0,1fr)_minmax(420px,.92fr)]"><section className="auth-grid relative hidden overflow-hidden border-r border-[#e5e8eb] bg-white px-12 lg:flex lg:flex-col lg:justify-between lg:py-12"><div className="relative z-[1] mt-16 max-w-[560px]"><div className="mono mb-6 flex items-center gap-2 text-[10px] uppercase tracking-[.19em] text-[#557399]"><span className="h-px w-7 bg-[#e18a42]"/>A calmer way to send</div><h1 className="display max-w-[500px] text-[54px] font-semibold leading-[1.04] text-[#172334] xl:text-[64px]">{label}</h1><p className="mt-6 max-w-[415px] text-[15px] leading-7 text-[#687484]">One dependable place to manage delivery, account access, and the systems behind every message.</p></div><div className="relative z-[1] mb-5 flex items-center gap-4"><div className="flex -space-x-2">{['M','D','S'].map((letter, i) => <span key={letter} className={cn('grid h-9 w-9 place-items-center rounded-full border-2 border-white text-[11px] font-bold', i === 1 ? 'bg-[#e9eef4] text-[#44536a]' : i === 2 ? 'bg-[#fff0e2] text-[#a65a22]' : 'bg-[#e4effa] text-[#24578f]')}>{letter}</span>)}</div><div className="text-[12px] text-[#687484]">Built for the people who keep email moving.</div></div><div className="pointer-events-none absolute bottom-[90px] right-[-40px] h-[270px] w-[270px] rounded-full border border-[#d5e0ec]"/><div className="pointer-events-none absolute bottom-[115px] right-[-15px] h-[220px] w-[220px] rounded-full border border-[#d5e0ec]"/><div className="pointer-events-none absolute bottom-[140px] right-[10px] h-[170px] w-[170px] rounded-full border border-[#d5e0ec]"/><div className="pointer-events-none absolute bottom-[164px] right-[34px] grid h-[122px] w-[122px] place-items-center rounded-full border border-[#cad8e7] bg-white/80"><div className="h-[43px] w-[52px] -skew-x-12 border-2 border-[#245b9b]"/><span className="absolute bottom-[31px] right-[31px] h-2 w-2 rounded-full bg-[#ee913f]"/></div><div className="relative z-[1] mono text-[10px] tracking-wide text-[#99a1aa]">MAILFLOW PLATFORM <span className="px-2 text-[#d58b4f]">/</span> TRUST IN EVERY SEND</div></section><section className="flex items-center justify-center px-5 py-12 sm:px-10"><div className="w-full max-w-[410px]">{children}</div></section></div></main>;
}
function FormError({ message }: { message?: string }) { return message ? <div role="alert" data-testid="status-form-error" className="rounded-md border border-[#f0d5bd] bg-[#fff8f1] px-3 py-2.5 text-[12px] leading-relaxed text-[#99501e]">{message}</div> : null; }
function AuthTitle({ overline, title, sub }: { overline: string; title: string; sub: string }) { return <div className="mb-7"><div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#738196]">{overline}</div><h2 className="display text-[31px] font-bold tracking-[-.04em] text-[#172334]">{title}</h2><p className="mt-2 text-[13px] leading-6 text-[#687484]">{sub}</p></div>; }
function LoginPage() {
  const form = useForm<{ identifier: string; password: string }>({ defaultValues: { identifier: '', password: '' } });
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin(); const qc = useQueryClient(); const [, setLocation] = useLocation();
  const submit = form.handleSubmit(values => login.mutate({ data: values }, { onSuccess: res => { qc.setQueryData(getGetCurrentUserQueryKey(), res.user); setLocation(res.user.mustChangeCredentials ? '/profile?rotate=1' : res.user.role === 'SUPERADMIN' ? '/admin' : '/dashboard'); } }));
  return <AuthFrame><AuthTitle overline="Secure sign in" title="Welcome back." sub="Sign in with your account credentials to continue."/><Form {...form}><form onSubmit={submit} className="space-y-4"><Field label="Username or email" value={form.watch('identifier')} onChange={v => form.setValue('identifier', v, { shouldValidate: true })} testId="input-identifier" placeholder="you@company.com" required autoComplete="username"/><label className="block space-y-1.5"><span className="text-[12px] font-semibold text-[#344154]">Password</span><span className="relative block"><input data-testid="input-password" required type={showPassword ? 'text' : 'password'} value={form.watch('password')} onChange={e => form.setValue('password', e.target.value)} placeholder="Your password" autoComplete="current-password" className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 pr-11 text-[13px] text-[#182333] outline-none transition focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7] placeholder:text-[#a0a8b3]"/><button type="button" data-testid="button-toggle-password-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(visible => !visible)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-[#778291] hover:text-[#245b9b] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#3b73b8]">{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></span></label><div className="flex justify-end"><Link data-testid="link-forgot-password" href="/forgot-password" className="text-[12px] font-semibold text-[#245b9b] no-underline hover:underline">Forgot password?</Link></div><FormError message={login.isError ? getError(login.error) : undefined}/><Button type="submit" testId="button-sign-in" disabled={login.isPending} className="w-full">{login.isPending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <ArrowRight className="h-4 w-4"/>}{login.isPending ? 'Signing in' : 'Sign in'}</Button></form></Form><div className="mt-7 border-t border-[#e7eaee] pt-5 text-center text-[12px] text-[#737e8b]">New to Mailflow? <Link data-testid="link-register" href="/register" className="ml-1 font-semibold text-[#245b9b] no-underline hover:underline">Create an account</Link></div><div className="mt-8 flex items-center justify-center gap-2 text-[10px] text-[#929ba6]"><ShieldCheck className="h-3.5 w-3.5"/>Protected account access</div></AuthFrame>;
}
function RegisterPage() {
  const register = useRegister(); const [, setLocation] = useLocation();
  const [values, setValues] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const onSubmit = (e: FormEvent) => { e.preventDefault(); register.mutate({ data: values }, { onSuccess: () => { sessionStorage.setItem('mailflow-verification-email', values.email); setLocation('/verify-email'); } }); };
  return <AuthFrame label="Good email starts with a solid foundation."><AuthTitle overline="Create workspace access" title="Start with your account." sub="A few details are all we need to get you set up."/><form onSubmit={onSubmit} className="space-y-4"><div className="grid grid-cols-2 gap-3"><Field label="First name" value={values.firstName} onChange={firstName => setValues(v => ({ ...v, firstName }))} testId="input-first-name" required autoComplete="given-name"/><Field label="Last name" value={values.lastName} onChange={lastName => setValues(v => ({ ...v, lastName }))} testId="input-last-name" required autoComplete="family-name"/></div><Field label="Work email" value={values.email} onChange={email => setValues(v => ({ ...v, email }))} testId="input-register-email" type="email" placeholder="name@company.com" required autoComplete="email"/><Field label="Password" value={values.password} onChange={password => setValues(v => ({ ...v, password }))} testId="input-register-password" type="password" required hint="Use at least 12 characters." autoComplete="new-password"/><FormError message={register.isError ? getError(register.error) : undefined}/><Button type="submit" testId="button-create-account" disabled={register.isPending} className="w-full">{register.isPending ? 'Creating account…' : 'Create account'}<ArrowRight className="h-4 w-4"/></Button></form><p className="mt-6 text-center text-[12px] text-[#737e8b]">Already have an account? <Link data-testid="link-login" href="/" className="ml-1 font-semibold text-[#245b9b] no-underline">Sign in</Link></p></AuthFrame>;
}
function VerifyPage() {
  const verify = useVerifyRegistrationEmail(); const [, setLocation] = useLocation();
  const [email, setEmail] = useState(sessionStorage.getItem('mailflow-verification-email') || '');
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); verify.mutate({ data: { email, code } }, { onSuccess: res => { client.setQueryData(getGetCurrentUserQueryKey(), res.user); setLocation(res.user.mustChangeCredentials ? '/profile?rotate=1' : res.user.role === 'SUPERADMIN' ? '/admin' : '/dashboard'); } }); };
  return <AuthFrame label="A small check. Then you're in."><AuthTitle overline="Email verification" title="Check your inbox." sub="Enter the six-character verification code sent to your email address."/><form onSubmit={submit} className="space-y-4"><Field label="Email address" value={email} onChange={setEmail} testId="input-verify-email" type="email" required/><Field label="Verification code" value={code} onChange={setCode} testId="input-verification-code" placeholder="000000" required/><FormError message={verify.isError ? getError(verify.error) : undefined}/><Button type="submit" testId="button-verify-email" disabled={verify.isPending} className="w-full">{verify.isPending ? 'Verifying…' : 'Verify email'}<ArrowRight className="h-4 w-4"/></Button></form><div className="mt-6 text-center text-[12px] text-[#737e8b]">Wrong email? <Link href="/register" data-testid="link-back-register" className="ml-1 font-semibold text-[#245b9b] no-underline">Start over</Link></div></AuthFrame>;
}
function ForgotPage() {
  const reset = useRequestPasswordReset(); const [email, setEmail] = useState(''); const [done, setDone] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); reset.mutate({ data: { email } }, { onSuccess: () => setDone(true) }); };
  return <AuthFrame label="Access should never be a guessing game."><AuthTitle overline="Account recovery" title={done ? 'Request received.' : 'Reset your password.'} sub={done ? 'If that address belongs to an account, a reset link is on its way.' : 'Enter the email associated with your account and we’ll send a secure reset link.'}/>{!done && <form onSubmit={submit} className="space-y-4"><Field label="Email address" value={email} onChange={setEmail} testId="input-reset-email" type="email" required/><FormError message={reset.isError ? getError(reset.error) : undefined}/><Button type="submit" testId="button-request-reset" disabled={reset.isPending} className="w-full">{reset.isPending ? 'Sending…' : 'Send reset link'}<ArrowRight className="h-4 w-4"/></Button></form>}<Link href="/" data-testid="link-return-login" className="mt-6 flex items-center justify-center gap-2 text-[12px] font-semibold text-[#245b9b] no-underline"><ChevronLeft className="h-4 w-4"/>Back to sign in</Link></AuthFrame>;
}
function ResetPage() {
  const reset = useResetPassword(); const [, setLocation] = useLocation();
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); reset.mutate({ data: { token, password } }, { onSuccess: () => setLocation('/') }); };
  return <AuthFrame label="Take control of your account again."><AuthTitle overline="Secure recovery" title="Choose a new password." sub="Set a new password to restore access to your Mailflow account."/><form onSubmit={submit} className="space-y-4"><Field label="Reset token" value={token} onChange={setToken} testId="input-reset-token" required hint="The secure token from your email link."/><Field label="New password" value={password} onChange={setPassword} testId="input-new-password" type="password" required hint="Use at least 12 characters." autoComplete="new-password"/><FormError message={reset.isError ? getError(reset.error) : undefined}/><Button type="submit" testId="button-reset-password" disabled={reset.isPending || token.length < 32} className="w-full">{reset.isPending ? 'Saving…' : 'Set new password'}<ArrowRight className="h-4 w-4"/></Button></form></AuthFrame>;
}
function AppShell({ user, children, admin = false }: { user: AuthUser; children: ReactNode; admin?: boolean }) {
  const [location, setLocation] = useLocation(); const logout = useLogout(); const [navOpen, setNavOpen] = useState(false);
  const qc = useQueryClient(); const nav = admin ? [{ href: '/admin', label: 'Overview', icon: Gauge }, { href: '/admin/users', label: 'Accounts', icon: Users }, { href: '/admin/billing', label: 'Billing', icon: CreditCard }, { href: '/admin/settings', label: 'Platform settings', icon: Settings2 }] : [{ href: '/dashboard', label: 'Overview', icon: Gauge }, { href: '/campaigns', label: 'Campaigns', icon: Send }, { href: '/contacts', label: 'Contacts', icon: Users }, { href: '/lists', label: 'Lists', icon: Activity }, { href: '/sending-settings', label: 'Sending settings', icon: Settings2 }, { href: '/plans', label: 'Plans & billing', icon: CreditCard }, { href: '/profile', label: 'Profile & security', icon: UserRound }];
  const leave = () => logout.mutate(undefined, { onSuccess: () => { qc.clear(); setLocation('/'); } });
  return <div className="min-h-[100dvh] bg-white text-[#182333]"><aside className={cn('fixed inset-y-0 left-0 z-30 flex w-[246px] flex-col border-r border-[#e3e7eb] bg-white transition-transform md:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full')}><div className="flex h-[69px] items-center border-b border-[#e8ebef] px-6"><Link href={admin ? '/admin' : '/dashboard'} data-testid="link-shell-brand" className="no-underline"><Mark small/></Link></div><div className="px-4 pt-6"><div className="mono mb-3 px-2 text-[9px] uppercase tracking-[.18em] text-[#99a1aa]">{admin ? 'PLATFORM' : 'WORKSPACE'}</div><nav className="space-y-1">{nav.map(item => { const Icon = item.icon; const active = location === item.href || (item.href !== '/admin' && item.href !== '/dashboard' && location.startsWith(item.href)); return <Link key={item.href} href={item.href} data-testid={`nav-${item.label.toLowerCase().replace(/[^a-z]+/g, '-')}`} onClick={() => setNavOpen(false)} className={cn('flex h-10 items-center gap-3 rounded-md px-3 text-[13px] font-medium no-underline transition-colors', active ? 'bg-[#edf4fc] text-[#174f99]' : 'text-[#66717e] hover:bg-[#f5f7f9] hover:text-[#182333]')}><Icon className="h-[17px] w-[17px]"/>{item.label}{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#ed913e]"/>}</Link>; })}</nav></div><div className="mt-auto px-4 pb-4"><div className="mb-4 border-t border-[#e8ebef] pt-4"><Link href="/profile" data-testid="nav-account-profile" className="flex items-center gap-3 rounded-md px-2 py-2 no-underline hover:bg-[#f7f8fa]"><span className="grid h-8 w-8 place-items-center rounded-md bg-[#edf2f7] text-[11px] font-bold text-[#34577c]">{(user.firstName[0] || user.username[0] || 'A').toUpperCase()}{(user.lastName[0] || '').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-[#243144]">{user.firstName} {user.lastName}</span><span className="block truncate text-[10px] text-[#858f9c]">{user.email}</span></span><ChevronDown className="h-3.5 w-3.5 text-[#8b95a1]"/></Link></div><Button variant="quiet" className="w-full justify-start px-2" testId="button-logout" disabled={logout.isPending} onClick={leave}><LogOut className="h-4 w-4"/>Sign out</Button></div></aside><div className="md:pl-[246px]"><header className="sticky top-0 z-20 flex h-[69px] items-center justify-between border-b border-[#e3e7eb] bg-white/95 px-5 backdrop-blur md:px-9"><div className="flex items-center gap-3"><button data-testid="button-open-navigation" className="rounded-md p-2 text-[#66717e] hover:bg-[#f2f4f6] md:hidden" onClick={() => setNavOpen(v => !v)}><Menu className="h-5 w-5"/></button><div className="mono hidden text-[10px] uppercase tracking-[.16em] text-[#8893a0] sm:block">{admin ? 'PLATFORM CONTROL' : 'ACCOUNT CONSOLE'}</div></div><div className="flex items-center gap-3"><span className="hidden items-center gap-1.5 text-[11px] text-[#7d8794] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#4c82bb]"/>Signed in</span><div className="h-4 w-px bg-[#e3e7eb]"/><span className="mono text-[10px] text-[#7d8794]">{user.timezone}</span><Link href="/profile" data-testid="link-header-profile" className="grid h-8 w-8 place-items-center rounded-full border border-[#e1e5e9] text-[#5c6877] hover:bg-[#f4f6f8]"><UserRound className="h-4 w-4"/></Link></div></header><main className="mx-auto max-w-[1440px] px-5 py-8 md:px-9 md:py-10">{children}</main></div></div>;
}
function Gate({ children, admin = false }: { children: (user: AuthUser) => ReactNode; admin?: boolean }) {
  const auth = useGetCurrentUser(); const [location, setLocation] = useLocation();
  useEffect(() => { if (auth.isError) setLocation('/'); }, [auth.isError, setLocation]);
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
function UserDashboardPage({ user }: { user: AuthUser }) {
  const query = useGetUserDashboard();
  const data = query.data;
  if (query.isLoading) return <LoadingPanel label="Loading workspace sending summary"/>;
  if (query.isError || !data) return <QueryProblem retry={() => void query.refetch()}/>;
  const metrics = [
    { label: 'Contacts', value: data.contacts, sub: 'In this workspace', icon: Users },
    { label: 'Active lists', value: data.activeLists, sub: 'Ready for campaign audiences', icon: Activity },
    { label: 'Emails sent', value: data.emailsSent, sub: 'Persisted recipient outcomes', icon: Send },
    { label: 'Delivered', value: data.delivered, sub: 'Accepted by the SMTP provider', icon: ArrowUpRight },
    { label: 'Bounced', value: data.bounced, sub: 'Could not be delivered', icon: ArrowDownLeft, accent: 'orange' as const },
    { label: 'Remaining this hour', value: data.remainingThisHour, sub: 'Workspace send limit', icon: Clock3 },
  ];
  return <><PageHeading eyebrow="ACCOUNT OVERVIEW" title="Workspace" detail="A live view of your tenant's audience, campaigns, and delivery outcomes."/>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(item => <Metric key={item.label} {...item}/>)}</div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Panel className="p-6"><div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">SENDING WORKSPACE</div><h2 className="display mt-2 text-xl font-bold">Your audience and campaigns are ready to manage</h2><p className="mt-3 max-w-2xl text-[13px] leading-6 text-[#6d7886]">Sending credentials, contacts, lists, and campaign results are kept within this workspace. Campaigns send through your verified SMTP identity, separately from Mailflow platform notifications.</p><div className="mt-5 flex flex-wrap gap-4"><Link href="/campaigns" data-testid="link-workspace-campaigns" className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#245b9b] no-underline">Manage campaigns <ArrowRight className="h-4 w-4"/></Link><Link href="/sending-settings" data-testid="link-workspace-sender" className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#245b9b] no-underline">Configure sender identity <ArrowRight className="h-4 w-4"/></Link></div></Panel>
      <Panel className="p-6"><div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">GETTING STARTED</div><div className="mt-3 flex items-end justify-between gap-3"><div><h2 className="display text-xl font-bold">Workspace setup</h2><p className="mt-1 text-[12px] text-[#778291]">{data.setupStepsCompleted} of {data.setupStepsTotal} steps completed</p></div><span className="mono text-[16px] font-semibold text-[#245b9b]">{Math.round(data.setupStepsCompleted / data.setupStepsTotal * 100)}%</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#edf0f3]"><div className="h-full rounded-full bg-[#245b9b] transition-all" style={{ width: `${data.setupStepsCompleted / data.setupStepsTotal * 100}%` }}/></div><div className="mt-4 grid gap-2 text-[12px]"><div className="flex items-center justify-between"><span className="text-[#647182]">Email verified</span><StatusPill tone={user.emailVerified ? 'blue' : 'orange'}>{user.emailVerified ? 'Done' : 'Needed'}</StatusPill></div><div className="flex items-center justify-between"><span className="text-[#647182]">Sender identity tested</span><Link href="/sending-settings" className="font-semibold text-[#245b9b] no-underline">Configure</Link></div><div className="flex items-center justify-between"><span className="text-[#647182]">Contacts and active lists</span><Link href="/contacts" className="font-semibold text-[#245b9b] no-underline">Manage</Link></div><div className="mt-2 flex items-center justify-between border-t border-[#edf0f2] pt-3"><span className="text-[#647182]">Subscription</span><span className="font-semibold capitalize text-[#344154]">{data.subscriptionStatus}</span></div></div></Panel>
    </div><div className="mt-5 flex flex-wrap gap-3"><Link href="/contacts" className="rounded-md border border-[#d8e0e8] px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline hover:bg-[#f6f9fc]">Contacts</Link><Link href="/lists" className="rounded-md border border-[#d8e0e8] px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline hover:bg-[#f6f9fc]">Lists</Link><Link href="/plans" data-testid="link-workspace-plans" className="rounded-md border border-[#d8e0e8] px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline hover:bg-[#f6f9fc]">Plans & billing</Link><Link href="/profile" data-testid="link-workspace-profile" className="rounded-md border border-[#d8e0e8] px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline hover:bg-[#f6f9fc]">Profile & security</Link></div>
  </>;
}
function AdminDashboardPage() {
  const query = useGetAdminDashboard(); const d = query.data;
  if (query.isLoading) return <LoadingPanel label="Loading platform overview"/>;
  if (query.isError || !d) return <QueryProblem retry={() => query.refetch()}/>;
  return <><PageHeading eyebrow="PLATFORM CONTROL" title="Platform overview" detail="A live view of customer-account activity and access." trailing={<StatusPill>Operator access</StatusPill>}/><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Total accounts" value={d.totalUsers.toLocaleString()} sub={`${d.newUsersThisMonth} new this month`} icon={Users}/><Metric label="Active accounts" value={d.activeUsers.toLocaleString()} sub="Verified and enabled" icon={BadgeCheck}/><Metric label="Pending verification" value={d.pendingUsers.toLocaleString()} sub="Awaiting email confirmation" icon={ShieldCheck}/><Metric label="Disabled accounts" value={d.disabledUsers.toLocaleString()} sub="Access currently disabled" icon={UserRound} accent="orange"/></div><div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_.75fr]"><Panel className="p-6"><div className="flex items-start justify-between"><div><div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">ACCOUNT ACTIVITY</div><h2 className="display mt-2 text-xl font-bold">Recent accounts</h2></div><Link href="/admin/users" data-testid="link-all-accounts" className="flex items-center gap-1 text-[12px] font-semibold text-[#245b9b] no-underline">All accounts <ArrowRight className="h-3.5 w-3.5"/></Link></div>{d.recentUsers.length ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[540px] text-left"><thead><tr className="border-b border-[#e9edf0] text-[10px] uppercase tracking-[.12em] text-[#8b95a1]"><th className="pb-3 font-medium">Account</th><th className="pb-3 font-medium">Joined</th><th className="pb-3 font-medium">Status</th></tr></thead><tbody>{d.recentUsers.map((u: AdminUser) => <tr key={u.id} data-testid={`row-recent-user-${u.id}`} className="border-b border-[#f0f2f4] last:border-0"><td className="py-3"><div className="text-[12px] font-semibold">{u.firstName} {u.lastName}</div><div className="mt-0.5 text-[11px] text-[#7d8794]">{u.email}</div></td><td className="py-3 text-[11px] text-[#6d7886]">{new Date(u.createdAt).toLocaleDateString()}</td><td className="py-3"><StatusPill tone={u.active ? 'blue' : 'orange'}>{u.active ? 'Active' : 'Disabled'}</StatusPill></td></tr>)}</tbody></table></div> : <div className="py-12 text-center text-[12px] text-[#7d8794]">No account activity to display.</div>}</Panel><div className="space-y-5"><Panel className="p-6"><div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">ACTIVE CAPABILITIES</div><div className="mt-4 text-[14px] font-semibold">Identity, billing, and platform controls</div><p className="mt-2 text-[12px] leading-5 text-[#747f8c]">Account administration, security settings, and application email are active. Razorpay and subscription packages are ready to configure; customers can pay after gateway credentials and plans are set up. Campaigns and delivery reporting are planned for later phases.</p><div className="mt-5 flex justify-between border-t border-[#edf0f2] pt-4 text-[12px]"><span className="text-[#6d7886]">New accounts this month</span><span className="mono font-medium">{d.newUsersThisMonth}</span></div><Link href="/admin/billing" data-testid="link-admin-billing" className="mt-4 flex items-center justify-between border-t border-[#edf0f2] pt-4 text-[12px] font-semibold text-[#245b9b] no-underline">Configure Razorpay & packages <ArrowRight className="h-4 w-4"/></Link><Link href="/admin/settings" data-testid="link-platform-settings" className="mt-4 flex items-center justify-between border-t border-[#edf0f2] pt-4 text-[12px] font-semibold text-[#245b9b] no-underline">Review settings <ArrowRight className="h-4 w-4"/></Link></Panel><Panel className="p-6"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-[#245b9b]"/><div className="text-[13px] font-semibold">Platform status</div></div><p className="mt-2 text-[12px] leading-5 text-[#747f8c]">Review account access and system configuration from operator controls.</p></Panel></div></div></>;
}
function AdminUsersPage() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [page, setPage] = useState(1);
  const params = useMemo(() => ({ search: search || undefined, status: status as 'all' | 'active' | 'inactive' | 'pending', page, pageSize: 12 }), [search, status, page]);
  const q = useListAdminUsers(params); const qc = useQueryClient(); const update = useUpdateAdminUserStatus(); const remove = useDeleteAdminUser();
  const invalidate = () => { qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); };
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const setActive = (u: AdminUser) => { const next = !u.active; if (!window.confirm(`${next ? 'Activate' : 'Deactivate'} ${u.firstName} ${u.lastName}?`)) return; update.mutate({ userId: u.id, data: { active: next } }, { onSuccess: invalidate }); };
  const softDelete = (u: AdminUser) => { if (!window.confirm(`Soft-delete the account for ${u.email}? This action cannot be undone here.`)) return; remove.mutate({ userId: u.id }, { onSuccess: invalidate }); };
  return <><PageHeading eyebrow="CUSTOMER ACCOUNTS" title="Accounts" detail="Search and manage tenant access. Changes apply to the selected customer account."/><Panel className="mb-4 p-4"><div className="flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b95a1]"/><input data-testid="input-account-search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, username, or email" className="h-10 w-full rounded-md border border-[#d8dde4] pl-9 pr-3 text-[13px] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]"/></label><div className="relative"><SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b95a1]"/><select data-testid="select-account-status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="h-10 min-w-[172px] rounded-md border border-[#d8dde4] bg-white pl-9 pr-3 text-[12px] outline-none focus:border-[#3b73b8]"><option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Disabled</option><option value="pending">Pending verification</option></select></div></div></Panel>{q.isLoading ? <div className="space-y-2"><div className="h-14 animate-pulse rounded bg-[#eceff2]"/><div className="h-14 animate-pulse rounded bg-[#eceff2]"/><div className="h-14 animate-pulse rounded bg-[#eceff2]"/></div> : q.isError ? <QueryProblem retry={() => q.refetch()}/> : <Panel><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead className="bg-[#fafbfc]"><tr className="border-b border-[#e8ebef] text-[10px] uppercase tracking-[.12em] text-[#8893a0]"><th className="px-5 py-3 font-medium">Customer</th><th className="px-4 py-3 font-medium">Created</th><th className="px-4 py-3 font-medium">Last sign-in</th><th className="px-4 py-3 font-medium">Subscription</th><th className="px-4 py-3 font-medium">Account status</th><th className="px-4 py-3 font-medium text-right">Actions</th></tr></thead><tbody>{q.data?.items.map((u: AdminUser) => <tr key={u.id} data-testid={`row-account-${u.id}`} className="border-b border-[#eef0f2] last:border-0 hover:bg-[#fcfcfd]"><td className="px-5 py-3.5"><div className="text-[12px] font-semibold">{u.firstName} {u.lastName}</div><div className="mt-0.5 text-[11px] text-[#7d8794]">{u.email} <span className="text-[#b1b8c0]">· @{u.username}</span></div></td><td className="px-4 py-3 text-[11px] text-[#687484]">{new Date(u.createdAt).toLocaleDateString()}</td><td className="px-4 py-3 text-[11px] text-[#687484]">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td><td className="px-4 py-3 text-[11px] text-[#687484]">{u.subscriptionStatus || '—'}</td><td className="px-4 py-3"><div className="flex flex-col items-start gap-1.5"><StatusPill tone={u.active ? 'blue' : 'orange'}>{u.active ? 'Active' : 'Disabled'}</StatusPill>{!u.emailVerified && <span className="text-[10px] text-[#aa5c24]">Email unverified</span>}</div></td><td className="px-4 py-3 text-right"><div className="inline-flex gap-1"><Button variant="outline" className="min-h-8 px-2.5 text-[11px]" testId={`button-toggle-account-${u.id}`} disabled={update.isPending} onClick={() => setActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</Button><Button variant="danger" className="min-h-8 px-2.5" testId={`button-delete-account-${u.id}`} disabled={remove.isPending} onClick={() => softDelete(u)}><Trash2 className="h-3.5 w-3.5"/></Button></div></td></tr>)}{!q.data?.items.length && <tr><td colSpan={6} className="px-5 py-16 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#f1f4f7] text-[#778392]"><Search className="h-4 w-4"/></div><div className="mt-3 text-[13px] font-semibold">No matching accounts</div><div className="mt-1 text-[11px] text-[#7d8794]">Try another search or status filter.</div></td></tr>}</tbody></table></div><div className="flex items-center justify-between border-t border-[#e8ebef] px-5 py-3"><span className="text-[11px] text-[#7d8794]">{q.data?.total || 0} accounts</span><div className="flex items-center gap-2"><Button variant="quiet" className="min-h-8 px-2" testId="button-page-previous" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4"/>Previous</Button><span className="mono text-[10px] text-[#687484]">{page} / {totalPages}</span><Button variant="quiet" className="min-h-8 px-2" testId="button-page-next" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="h-4 w-4"/></Button></div></div></Panel>}</>;
}
const settingGroups: Array<{ title: string; fields: Array<[keyof PlatformSettingsInput, string, 'text' | 'number' | 'boolean' | 'list' | 'select', string[]?]> }> = [
  { title: 'Identity & defaults', fields: [['applicationName','Application name','text'],['defaultCurrency','Default currency','text'],['defaultTimezone','Default timezone','text'],['dateFormat','Date format','text'],['supportEmail','Support email','text'],['supportPhone','Support phone','text'],['maintenanceMode','Maintenance mode','boolean']] },
  { title: 'Account & authentication', fields: [['maxContactsPerUser','Contacts per user','number'],['maxUploadFileSizeMb','Upload file size limit (MB)','number'],['allowedContactFileTypes','Allowed contact file types','list'],['passwordMinimumLength','Minimum password length','number'],['otpExpiryMinutes','OTP expiry (minutes)','number'],['maxOtpAttempts','Maximum OTP attempts','number'],['loginAttemptThreshold','Login attempt threshold','number'],['sessionDurationHours','Session duration (hours)','number']] },
  { title: 'Sending & delivery', fields: [['defaultEmailsPerHour','Default emails per hour','number'],['maxEmailsPerDay','Maximum emails per day','number'],['maxCampaignSize','Maximum campaign size','number'],['maxConcurrentCampaigns','Concurrent campaigns','number'],['retryAttempts','Retry attempts','number'],['retryDelaySeconds','Retry delay (seconds)','number'],['bounceThreshold','Bounce threshold','number'],['deliveryTrackingEnabled','Delivery tracking','boolean'],['queuePollingSeconds','Queue polling (seconds)','number']] },
  { title: 'Subscription rules', fields: [['allowUserWithoutSubscription','Allow accounts without subscription','boolean'],['gracePeriodDays','Grace period (days)','number'],['packageVisibility','Package visibility','select',['public','hidden']]] },
];
function SettingsGroup({ title, fields, values, setValues }: { title: string; fields: Array<[keyof PlatformSettingsInput, string, 'text'|'number'|'boolean'|'list'|'select', string[]?]>; values: Fields; setValues: (v: Fields) => void }) {
  return <Panel className="p-5 md:p-6"><div className="mb-5"><h2 className="display text-[18px] font-bold">{title}</h2></div><div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">{fields.map(([key, label, type, options]) => <div key={key as string} className={type === 'boolean' ? 'flex min-h-10 items-center justify-between gap-4 rounded-md border border-[#e4e8ec] px-3' : ''}>{type === 'boolean' ? <><span className="text-[12px] font-medium text-[#344154]">{label}</span><button type="button" data-testid={`toggle-setting-${String(key)}`} aria-pressed={!!values[key]} onClick={() => setValues({ ...values, [key]: !values[key] })} className={cn('relative h-[22px] w-10 rounded-full transition-colors', values[key] ? 'bg-[#245b9b]' : 'bg-[#c8ced5]')}><span className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform', values[key] ? 'translate-x-[21px]' : 'translate-x-[3px]')}/></button></> : type === 'select' ? <SelectField label={label} value={String(values[key] ?? options?.[0] ?? '')} onChange={v => setValues({ ...values, [key]: v })} options={options || []} testId={`select-setting-${String(key)}`}/> : <Field label={label} value={Array.isArray(values[key]) ? (values[key] as string[]).join(', ') : String(values[key] ?? '')} onChange={v => setValues({ ...values, [key]: type === 'number' ? (v === '' ? '' : Number(v)) : type === 'list' ? v.split(',').map(x => x.trim()).filter(Boolean) : v })} testId={`input-setting-${String(key)}`} type={type === 'number' ? 'number' : 'text'}/>}</div>)}</div></Panel>;
}
type SmtpProvider = 'google_workspace' | 'gmail' | 'microsoft_365' | 'other';
const SMTP_PROVIDER_OPTIONS = [
  { value: 'google_workspace', label: 'Google Workspace' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'microsoft_365', label: 'Microsoft 365' },
  { value: 'other', label: 'Other SMTP provider' },
];
const SMTP_PROVIDER_PRESETS: Partial<Record<SmtpProvider, { host: string; port: string; encryption: 'tls' }>> = {
  google_workspace: { host: 'smtp.gmail.com', port: '587', encryption: 'tls' },
  gmail: { host: 'smtp.gmail.com', port: '587', encryption: 'tls' },
  microsoft_365: { host: 'smtp.office365.com', port: '587', encryption: 'tls' },
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
    save.mutate(
      { data: settings as unknown as PlatformSettingsInput },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() }) },
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
  const [rotate, setRotate] = useState(new URLSearchParams(window.location.search).get('rotate') === '1' || user.mustChangeCredentials);
  const [, setLocation] = useLocation();
  const [profile, setProfile] = useState({ username: user.username, firstName: user.firstName, lastName: user.lastName, email: user.email, timezone: user.timezone });
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '' });
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
          qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
          if (rotate) {
            setRotate(false);
            setLocation(user.role === 'SUPERADMIN' ? '/admin' : '/dashboard');
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

        <Panel className="p-5 md:p-6">
          <div className="mb-5">
            <div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">SIGN-IN SECURITY</div>
            <h2 className="display mt-2 text-[18px] font-bold">Change password</h2>
          </div>
          <form onSubmit={savePassword} className="space-y-4">
            <Field label="Current password" value={password.currentPassword} onChange={value => setPassword(current => ({ ...current, currentPassword: value }))} testId="input-current-password" type="password" required autoComplete="current-password"/>
            <Field label="New password" value={password.newPassword} onChange={value => setPassword(current => ({ ...current, newPassword: value }))} testId="input-change-new-password" type="password" required hint="Use at least 12 characters." autoComplete="new-password"/>
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
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={LoginPage}/><Route path="/register" component={RegisterPage}/><Route path="/verify-email" component={VerifyPage}/><Route path="/forgot-password" component={ForgotPage}/><Route path="/reset-password" component={ResetPage}/>
    <Route path="/dashboard">{() => <RouteGate>{u => <UserDashboardPage user={u}/>}</RouteGate>}</Route>
    <Route path="/sending-settings">{() => <RouteGate>{() => <SendingSettingsPage/>}</RouteGate>}</Route>
    <Route path="/contacts">{() => <RouteGate>{u => u.role === 'USER' ? <ContactsPage/> : <NotFound/>}</RouteGate>}</Route>
    <Route path="/lists">{() => <RouteGate>{() => <ListsPage/>}</RouteGate>}</Route>
    <Route path="/campaigns">{() => <RouteGate>{() => <CampaignsPage/>}</RouteGate>}</Route>
    <Route path="/admin">{() => <RouteGate admin>{() => <AdminDashboardPage/>}</RouteGate>}</Route>
    <Route path="/admin/users">{() => <RouteGate admin>{() => <AdminUsersPage/>}</RouteGate>}</Route>
    <Route path="/admin/billing">{() => <RouteGate admin>{() => <AdminBillingPage/>}</RouteGate>}</Route>
    <Route path="/admin/settings">{() => <RouteGate admin>{() => <AdminSettingsPage/>}</RouteGate>}</Route>
    <Route path="/plans">{() => <RouteGate>{() => <PlansPage/>}</RouteGate>}</Route>
    <Route path="/profile">{() => <RouteGate>{u => <ProfilePage user={u}/>}</RouteGate>}</Route>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={client}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Routes/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;