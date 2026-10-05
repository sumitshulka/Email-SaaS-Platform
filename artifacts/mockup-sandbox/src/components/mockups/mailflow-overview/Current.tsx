import './_group.css';
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Clock3, Send, Users } from 'lucide-react';

const data = {
  contacts: 2480,
  activeLists: 7,
  emailsSent: 3942,
  delivered: 3620,
  bounced: 114,
  remainingThisHour: 786,
  setupStepsCompleted: 3,
  setupStepsTotal: 4,
  subscriptionStatus: 'active',
};
const user = { emailVerified: true };

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-[#e0e4e9] bg-white ${className}`}>{children}</section>;
}

function PageHeading({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail?: string }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">{eyebrow}</div>}<h1 className="display text-[30px] font-bold leading-tight text-[#172334]">{title}</h1>{detail && <p className="mt-2 max-w-2xl text-[13px] text-[#687484]">{detail}</p>}</div></div>;
}

function StatusPill({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'orange' | 'gray' }) {
  const tones = { blue: 'bg-[#edf4fc] text-[#245b9b]', orange: 'bg-[#fff3e8] text-[#a95218]', gray: 'bg-[#f0f2f4] text-[#66717e]' };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}><span className={`h-1.5 w-1.5 rounded-full ${tone === 'orange' ? 'bg-[#e78b3b]' : tone === 'blue' ? 'bg-[#4382c4]' : 'bg-[#929ba6]'}`}/>{children}</span>;
}

function Metric({ label, value, sub, icon: Icon, accent = 'blue' }: { label: string; value: string | number; sub?: string; icon: typeof Send; accent?: 'blue' | 'orange' }) {
  return <Panel className="p-5"><div className="flex items-start justify-between"><span className="text-[12px] font-medium text-[#6d7886]">{label}</span><span className={`grid h-8 w-8 place-items-center rounded-md ${accent === 'blue' ? 'bg-[#edf4fc] text-[#245b9b]' : 'bg-[#fff2e6] text-[#bc6829]'}`}><Icon className="h-4 w-4"/></span></div><div className="display mt-3 text-[27px] font-bold leading-none tracking-[-.04em] text-[#192638]">{value}</div>{sub && <div className="mt-2 text-[11px] text-[#7e8894]">{sub}</div>}</Panel>;
}

function StaticLink({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <a href="#" onClick={event => event.preventDefault()} className={className}>{children}</a>;
}

export function Current() {
  const metrics = [
    { label: 'Contacts', value: data.contacts, sub: 'In this workspace', icon: Users },
    { label: 'Active lists', value: data.activeLists, sub: 'Ready for campaign audiences', icon: Activity },
    { label: 'Emails sent', value: data.emailsSent, sub: 'Persisted recipient outcomes', icon: Send },
    { label: 'SMTP accepted', value: data.delivered, sub: 'Inbox delivery is not confirmed', icon: ArrowUpRight },
    { label: 'Rejected / failed', value: data.bounced, sub: 'SMTP rejection or terminal send failure', icon: ArrowDownLeft, accent: 'orange' as const },
    { label: 'Remaining this hour', value: data.remainingThisHour, sub: 'Workspace send limit', icon: Clock3 },
  ];

  return <main className="mx-auto min-h-screen max-w-[1440px] bg-white px-5 py-8 text-[#182333] md:px-9 md:py-10">
    <PageHeading eyebrow="ACCOUNT OVERVIEW" title="Workspace" detail="A live view of your tenant's audience, campaigns, and delivery outcomes."/>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(item => <Metric key={item.label} {...item}/>)}</div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Panel className="p-6"><div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">SENDING WORKSPACE</div><h2 className="display mt-2 text-xl font-bold">Your audience and campaigns are ready to manage</h2><p className="mt-3 max-w-2xl text-[13px] leading-6 text-[#6d7886]">Sending credentials, contacts, lists, and campaign results are kept within this workspace. Campaigns send through your verified SMTP identity, separately from Mailflow platform notifications.</p><div className="mt-5 flex flex-wrap gap-4"><StaticLink className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#245b9b] no-underline">Manage campaigns <ArrowRight className="h-4 w-4"/></StaticLink><StaticLink className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#245b9b] no-underline">Configure sender identity <ArrowRight className="h-4 w-4"/></StaticLink></div></Panel>
      <Panel className="p-6"><div className="mono text-[10px] uppercase tracking-[.15em] text-[#858f9c]">GETTING STARTED</div><div className="mt-3 flex items-end justify-between gap-3"><div><h2 className="display text-xl font-bold">Workspace setup</h2><p className="mt-1 text-[12px] text-[#778291]">{data.setupStepsCompleted} of {data.setupStepsTotal} steps completed</p></div><span className="mono text-[16px] font-semibold text-[#245b9b]">{Math.round(data.setupStepsCompleted / data.setupStepsTotal * 100)}%</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#edf0f3]"><div className="h-full rounded-full bg-[#245b9b] transition-all" style={{ width: `${data.setupStepsCompleted / data.setupStepsTotal * 100}%` }}/></div><div className="mt-4 grid gap-2 text-[12px]"><div className="flex items-center justify-between"><span className="text-[#647182]">Email verified</span><StatusPill>{user.emailVerified ? 'Done' : 'Needed'}</StatusPill></div><div className="flex items-center justify-between"><span className="text-[#647182]">Sender identity tested</span><StaticLink className="font-semibold text-[#245b9b] no-underline">Configure</StaticLink></div><div className="flex items-center justify-between"><span className="text-[#647182]">Contacts and active lists</span><StaticLink className="font-semibold text-[#245b9b] no-underline">Manage</StaticLink></div><div className="mt-2 flex items-center justify-between border-t border-[#edf0f2] pt-3"><span className="text-[#647182]">Subscription</span><span className="font-semibold capitalize text-[#344154]">{data.subscriptionStatus}</span></div></div></Panel>
    </div>
    <div className="mt-5 flex flex-wrap gap-3"><StaticLink className="rounded-md border border-[#d8e0e8] px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline">Contacts</StaticLink><StaticLink className="rounded-md border border-[#d8e0e8] px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline">Lists</StaticLink><StaticLink className="rounded-md border border-[#d8e0e8] px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline">Plans &amp; billing</StaticLink><StaticLink className="rounded-md border border-[#d8e0e8] px-3 py-2 text-[12px] font-semibold text-[#245b9b] no-underline">Profile &amp; security</StaticLink></div>
  </main>;
}
