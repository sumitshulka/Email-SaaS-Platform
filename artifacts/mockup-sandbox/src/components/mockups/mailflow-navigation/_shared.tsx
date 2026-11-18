import { useState } from 'react';
import {
  Activity, Bell, BrainCircuit, Building2, ChevronDown, Clock3, CreditCard, Gauge, LifeBuoy,
  LogOut, Menu, Package, ReceiptText, Send, Settings2, ShieldCheck, UserRound, Users, X,
} from 'lucide-react';
import './_group.css';

type IconComponent = typeof Gauge;
type NavigationItem = { href: string; label: string; icon: IconComponent };
type NavigationGroup = { title: string | null; items: NavigationItem[] };

const workspaceGroups: NavigationGroup[] = [
  { title: null, items: [{ href: '/dashboard', label: 'Overview', icon: Gauge }] },
  { title: 'Contacts & companies', items: [
    { href: '/companies', label: 'Companies', icon: Building2 },
    { href: '/contacts', label: 'Contacts', icon: Users },
    { href: '/contact-report', label: 'Contact Report', icon: Activity },
    { href: '/contact-field-settings', label: 'Contact Fields', icon: Settings2 },
  ] },
  { title: 'Prospect Management', items: [
    { href: '/prospects', label: 'Prospects', icon: Activity },
    { href: '/prospect-follow-ups', label: 'Follow-ups', icon: Clock3 },
    { href: '/prospect-products', label: 'Prospect Fields', icon: Settings2 },
  ] },
  { title: 'Email marketing', items: [
    { href: '/lists', label: 'Lists', icon: Activity },
    { href: '/campaigns', label: 'Campaigns', icon: Send },
  ] },
  { title: 'Account & settings', items: [
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/support', label: 'Support', icon: LifeBuoy },
    { href: '/sending-settings', label: 'Email Setup', icon: Settings2 },
    { href: '/plans', label: 'Plans & billing', icon: CreditCard },
    { href: '/profile', label: 'Profile & security', icon: UserRound },
  ] },
];

const adminGroups: NavigationGroup[] = [
  { title: null, items: [{ href: '/admin', label: 'Overview', icon: Gauge }] },
  { title: 'Accounts & intelligence', items: [
    { href: '/admin/users', label: 'Accounts', icon: Users },
    { href: '/admin/global-companies', label: 'Global companies', icon: Building2 },
    { href: '/admin/company-intelligence', label: 'Company intelligence', icon: BrainCircuit },
  ] },
  { title: 'Billing & plans', items: [
    { href: '/admin/billing', label: 'Billing & PG setup', icon: CreditCard },
    { href: '/admin/packages', label: 'Packages', icon: Package },
    { href: '/admin/finance', label: 'Finance', icon: ReceiptText },
  ] },
  { title: 'Notifications & support', items: [
    { href: '/admin/notifications', label: 'Notifications', icon: Bell },
    { href: '/admin/email-templates', label: 'Email templates', icon: Send },
    { href: '/admin/support', label: 'Support inbox', icon: LifeBuoy },
  ] },
  { title: 'Platform configuration', items: [
    { href: '/admin/settings', label: 'Platform settings', icon: Settings2 },
    { href: '/admin/object-storage', label: 'Campaign file storage', icon: Package },
    { href: '/admin/google-oauth', label: 'Gmail setup', icon: ShieldCheck },
    { href: '/admin/ai-provider', label: 'AI integration', icon: BrainCircuit },
    { href: '/admin/contact-intent', label: 'Intent questionnaire', icon: BrainCircuit },
  ] },
];

function itemTone(href: string, vibrant: boolean) {
  if (!vibrant) return 'text-[#7c8998]';
  if (href.includes('prospect')) return 'bg-[#f1edff] text-[#7658aa]';
  if (href.includes('contact') || href.includes('compan')) return 'bg-[#e8f5f3] text-[#3b827c]';
  if (href.includes('campaign') || href.includes('email') || href === '/lists') return 'bg-[#fff0e6] text-[#bd6b35]';
  if (href.includes('billing') || href.includes('finance') || href.includes('plans')) return 'bg-[#fff5df] text-[#a8782e]';
  if (href.includes('notification') || href.includes('support')) return 'bg-[#fcecf0] text-[#b6526b]';
  return 'bg-[#eaf1ff] text-[#3d6fb1]';
}

export function MailflowNavigation({ vibrant }: { vibrant: boolean }) {
  const [admin, setAdmin] = useState(false);
  const [activePath, setActivePath] = useState('/dashboard');
  const [navOpen, setNavOpen] = useState(false);
  const groups = admin ? adminGroups : workspaceGroups;
  const defaultPath = admin ? '/admin' : '/dashboard';
  const active = activePath === defaultPath ? defaultPath : activePath;

  function switchRole(isAdmin: boolean) {
    setAdmin(isAdmin);
    setActivePath(isAdmin ? '/admin' : '/dashboard');
    setNavOpen(false);
  }

  return (
    <div className={`mailflow-navigation-preview min-h-screen bg-[#f4f7fb] text-[#19283b] ${vibrant ? 'mailflow-vibrant' : ''}`}>
      <aside className={[
        'fixed inset-y-0 left-0 z-30 flex w-[246px] flex-col border-r transition-transform duration-200 md:translate-x-0',
        vibrant ? 'border-[#d9e4f1] bg-gradient-to-b from-[#f6f9ff] via-white to-[#fcf9f7]' : 'border-[#e3e7eb] bg-white',
        navOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}>
        <div className={`flex h-[69px] shrink-0 items-center border-b px-6 ${vibrant ? 'border-[#dfe8f3] bg-gradient-to-r from-[#edf4ff] to-white' : 'border-[#e8ebef]'}`}>
          <div className="flex items-center gap-2.5">
            <svg className="h-7 w-7" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
              <rect width="32" height="32" rx="7" fill="#142035"/>
              <path d="M7 25V10l9 9 9-9" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19.5 7.5H25V13" stroke="#E83D4A" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[19px] font-extrabold lowercase tracking-[-.04em] text-[#142035]">mailflow</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6">
          <div className={`mono mb-3 px-2 text-[9px] uppercase tracking-[.18em] ${vibrant ? 'text-[#607d9f]' : 'text-[#99a1aa]'}`}>{admin ? 'PLATFORM' : 'WORKSPACE'}</div>
          <nav className="space-y-3" aria-label={admin ? 'Platform navigation' : 'Workspace navigation'}>
            {groups.map(group => <div key={group.title ?? 'overview'} className="space-y-1" role="group" aria-label={group.title ?? 'Overview'}>
              {group.title && <div className={`mono mt-3 border-t px-2 pb-1 pt-3 text-[9px] uppercase tracking-[.14em] ${vibrant ? 'border-[#e5ebf3] text-[#8795a7]' : 'border-[#eef0f2] text-[#99a1aa]'}`}>{group.title}</div>}
              {group.items.map(item => {
                const Icon = item.icon;
                const isActive = active === item.href || (item.href !== defaultPath && active.startsWith(item.href));
                return <button
                  key={item.href}
                  type="button"
                  onClick={() => { setActivePath(item.href); setNavOpen(false); }}
                  className={[
                    'group relative flex h-10 w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[12px] font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4382c4]',
                    isActive
                      ? vibrant ? 'bg-gradient-to-r from-[#e3eeff] to-[#eff5ff] font-bold text-[#174f99] shadow-[0_2px_8px_rgba(28,75,132,.08)]' : 'bg-[#edf4fc] font-semibold text-[#174f99]'
                      : vibrant ? 'text-[#586b82] hover:translate-x-0.5 hover:bg-white/90 hover:text-[#243c5b]' : 'text-[#66717e] hover:bg-[#f5f7f9] hover:text-[#182333]',
                  ].join(' ')}
                >
                  {isActive && vibrant && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-[#2867b0]"/>}
                  <span className={[
                    'grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[9px] transition-colors',
                    isActive && vibrant ? 'bg-[#174f99] text-white shadow-[0_3px_7px_rgba(23,79,153,.2)]' : itemTone(item.href, vibrant),
                    isActive && !vibrant ? 'bg-transparent text-[#174f99]' : '',
                  ].join(' ')}>
                    <Icon className="h-[15px] w-[15px]"/>
                  </span>
                  <span className="truncate">{item.label}</span>
                  {item.label === 'Notifications' && <span className={`ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[9px] font-bold ${vibrant ? 'bg-[#dce8fb] text-[#315f9c]' : 'bg-[#eef1f4] text-[#7d8794]'}`}>3</span>}
                  {isActive && !vibrant && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#ed913e]"/>}
                </button>;
              })}
            </div>)}
          </nav>
        </div>
        <div className={`shrink-0 px-4 pb-4 ${vibrant ? 'bg-gradient-to-r from-transparent to-[#fff8f1]' : ''}`}>
          <div className={`mb-4 border-t pt-4 ${vibrant ? 'border-[#e2e9f1]' : 'border-[#e8ebef]'}`}>
            <button className={`flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors ${vibrant ? 'hover:bg-white' : 'hover:bg-[#f7f8fa]'}`}>
              <span className={`grid h-8 w-8 place-items-center rounded-[10px] text-[11px] font-bold ${vibrant ? 'bg-gradient-to-br from-[#dceaff] to-[#ebe7ff] text-[#355c93]' : 'bg-[#edf2f7] text-[#34577c]'}`}>ND</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-[#243144]">Nancy Dhiman</span>
                <span className="block truncate text-[10px] text-[#858f9c]">nancyd@example.com</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[#8b95a1]"/>
            </button>
          </div>
          <button className={`flex min-h-9 w-full items-center gap-2 rounded-[9px] px-2 text-[12px] font-medium transition-colors ${vibrant ? 'text-[#a34e4e] hover:bg-[#fff0ef]' : 'text-[#596474] hover:bg-[#f4f6f8]'}`}>
            <LogOut className="h-4 w-4"/>Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-h-screen flex-col md:pl-[246px]">
        <header className={`sticky top-0 z-20 flex h-[69px] items-center justify-between border-b px-5 backdrop-blur md:px-9 ${vibrant ? 'border-[#dce5f0] bg-gradient-to-r from-[#f4f8ff]/95 via-white/95 to-[#fff9f4]/95 shadow-[0_3px_14px_rgba(30,54,82,.045)]' : 'border-[#e3e7eb] bg-white/95'}`}>
          <div className="flex items-center gap-3">
            <button aria-label="Open navigation" className={`rounded-[9px] p-2 transition-colors md:hidden ${vibrant ? 'bg-[#edf4ff] text-[#315f9c] hover:bg-[#dfeaff]' : 'text-[#66717e] hover:bg-[#f2f4f6]'}`} onClick={() => setNavOpen(v => !v)}>
              {navOpen ? <X className="h-5 w-5"/> : <Menu className="h-5 w-5"/>}
            </button>
            <div className={`mono hidden text-[10px] uppercase tracking-[.16em] sm:block ${vibrant ? 'text-[#5c7596]' : 'text-[#8893a0]'}`}>{admin ? 'PLATFORM CONTROL' : 'ACCOUNT CONSOLE'}</div>
          </div>
          <div className="flex items-center gap-2.5 sm:gap-3">
            <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold sm:flex ${vibrant ? 'bg-[#eaf6f0] text-[#3c765e]' : 'text-[#7d8794]'}`}><span className="h-1.5 w-1.5 rounded-full bg-[#4c9a71]"/>Signed in</span>
            <div className={`hidden h-4 w-px sm:block ${vibrant ? 'bg-[#dbe5ef]' : 'bg-[#e3e7eb]'}`}/>
            <span className={`mono hidden rounded-full px-2 py-1 text-[9px] sm:block ${vibrant ? 'bg-[#f0f4fb] text-[#66809f]' : 'text-[#7d8794]'}`}>Asia/Kolkata</span>
            {!admin && <button aria-label="Notifications, 3 unread notifications" className={`relative grid h-9 w-9 place-items-center rounded-[11px] border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8] ${vibrant ? 'border-[#d8e5f6] bg-[#edf4ff] text-[#2f67a7] shadow-[0_2px_6px_rgba(35,76,129,.06)] hover:-translate-y-0.5 hover:bg-[#e2edff]' : 'border-[#e1e5e9] text-[#5c6877] hover:bg-[#f4f6f8]'}`}>
              <Bell className="h-4 w-4"/>
              <span className={`absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-white px-1 text-[8px] font-bold text-white ${vibrant ? 'bg-[#d36749]' : 'bg-[#c45f22]'}`}>3</span>
            </button>}
            <button aria-label="Profile" className={`grid h-9 w-9 place-items-center rounded-[11px] border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8] ${vibrant ? 'border-[#d9e8e2] bg-[#eef7f3] text-[#397967] hover:-translate-y-0.5 hover:bg-[#e1f1eb]' : 'border-[#e1e5e9] text-[#5c6877] hover:bg-[#f4f6f8]'}`}><UserRound className="h-4 w-4"/></button>
            <button aria-label="Sign out" className={`grid h-9 w-9 place-items-center rounded-[11px] border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8] ${vibrant ? 'border-[#f0dada] bg-[#fff1f0] text-[#b0524e] hover:-translate-y-0.5 hover:bg-[#ffe5e3]' : 'border-[#e1e5e9] text-[#5c6877] hover:bg-[#fff4f2] hover:text-[#b34e43]'}`}><LogOut className="h-4 w-4"/></button>
          </div>
        </header>
        <main className="flex-1 p-6 md:p-9">
          <div className={`mb-6 inline-flex rounded-full border p-1 md:hidden ${vibrant ? 'border-[#dce6f2] bg-white' : 'border-[#e3e7eb] bg-white'}`}>
            <button onClick={() => switchRole(false)} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${!admin ? 'bg-[#174f99] text-white' : 'text-[#687789]'}`}>Workspace</button>
            <button onClick={() => switchRole(true)} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${admin ? 'bg-[#174f99] text-white' : 'text-[#687789]'}`}>Superadmin</button>
          </div>
          <div className={`mb-5 hidden w-fit rounded-full border p-1 md:flex ${vibrant ? 'border-[#dce6f2] bg-white shadow-sm' : 'border-[#e3e7eb] bg-white'}`}>
            <button onClick={() => switchRole(false)} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${!admin ? 'bg-[#174f99] text-white' : 'text-[#687789]'}`}>Workspace navigation</button>
            <button onClick={() => switchRole(true)} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${admin ? 'bg-[#174f99] text-white' : 'text-[#687789]'}`}>Superadmin navigation</button>
          </div>
          <div className={`rounded-2xl border p-6 ${vibrant ? 'border-[#e0e8f1] bg-white shadow-[0_8px_24px_rgba(28,50,78,.045)]' : 'border-[#e6eaee] bg-white'}`}>
            <div className="mono text-[9px] uppercase tracking-[.16em] text-[#8593a3]">{admin ? 'PLATFORM / OVERVIEW' : 'WORKSPACE / OVERVIEW'}</div>
            <h1 className="mt-2 text-[23px] font-bold tracking-[-.035em] text-[#1d2d42]">{admin ? 'Platform overview' : 'Good morning, Nancy'}</h1>
            <p className="mt-2 max-w-xl text-[12px] leading-5 text-[#758496]">A small preview area keeps attention on the shared navigation and header controls.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {['Campaigns ready', 'Contacts managed', 'Follow-ups today'].map((label, index) => <div key={label} className={`rounded-xl border p-4 ${vibrant ? ['border-[#dce8f5] bg-[#f3f7fd]', 'border-[#d9ebe5] bg-[#f1f8f5]', 'border-[#f0e4d2] bg-[#fff8ee]'][index] : 'border-[#edf0f3] bg-[#fbfcfd]'}`}><div className="text-[10px] font-medium text-[#7b8a9b]">{label}</div><div className={`mt-2 text-xl font-bold ${vibrant ? ['text-[#3269a8]', 'text-[#3c806e]', 'text-[#a87836]'][index] : 'text-[#30465f]'}`}>{[4, 128, 6][index]}</div></div>)}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
