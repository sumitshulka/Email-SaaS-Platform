import './_group.css';
import { ArrowRight, CalendarDays, Clock3 } from 'lucide-react';

const todayItems = [
  {
    id: 'demo-1',
    prospect: 'Northstar Learning',
    action: 'Proposal review',
    contact: 'Avery James',
    date: 'Today · 10:30 AM',
  },
  {
    id: 'demo-2',
    prospect: 'Oakridge Systems',
    action: 'Discovery call',
    contact: 'Jordan Lee',
    date: 'Today · 2:00 PM',
  },
  {
    id: 'demo-3',
    prospect: 'Pinecrest Analytics',
    action: 'Send pricing details',
    contact: 'Morgan Chen',
    date: 'Today · 4:15 PM',
  },
];

function DemoLink({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <a href="#" onClick={event => event.preventDefault()} className={className}>{children}</a>;
}

export function CompactFollowUps() {
  return <main className="min-h-screen bg-[#f7f9fb] p-8 text-[#182333]">
    <section className="overflow-hidden rounded-xl border border-[#bfd5cf] bg-white shadow-[0_8px_24px_rgba(24,65,59,.09)]" aria-label="Follow-ups today">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#183f48] to-[#285f62] px-4 py-3.5 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/10 text-[#d9eee4]"><CalendarDays className="h-4 w-4"/></span>
          <div className="min-w-0"><div className="mono text-[8px] tracking-[.15em] text-[#c2ded3]">PROSPECT MANAGEMENT</div><h2 className="mt-0.5 truncate text-[14px] font-bold">Follow-ups today</h2></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#b5ddcd]/25 bg-[#b5ddcd]/15 px-2.5 py-1 text-[9px] font-bold text-[#e1f4eb]"><span className="h-1.5 w-1.5 rounded-full bg-[#9de0bd]"/>5 pending</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f1c98d]/25 bg-[#f1c98d]/15 px-2.5 py-1 text-[9px] font-bold text-[#ffdfaa]"><span className="h-1.5 w-1.5 rounded-full bg-[#f3b956]"/>3 overdue</span>
          <DemoLink className="ml-1 inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-[9px] font-bold text-white no-underline transition hover:bg-white/20">Calendar <ArrowRight className="h-3 w-3"/></DemoLink>
        </div>
      </header>
      <div className="divide-y divide-[#e8efec]">
        {todayItems.map(item => <DemoLink key={item.id} className="group flex items-center gap-3 px-4 py-2.5 no-underline transition hover:bg-[#f4f8f6]">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#eaf3ef] text-[#3c756b] transition group-hover:bg-[#dcece5]"><Clock3 className="h-3.5 w-3.5"/></span>
          <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
            <strong className="block truncate text-[11px] font-bold text-[#25463f] group-hover:text-[#176153] sm:w-[30%]">{item.prospect}</strong>
            <span className="mt-0.5 block truncate text-[9px] text-[#667e77] sm:mt-0">{item.action} <span className="text-[#b2c0ba]">·</span> {item.contact}</span>
          </span>
          <time className="shrink-0 rounded-md border border-[#e5ece8] bg-[#f8faf9] px-2 py-1 text-[9px] font-semibold text-[#536d65]">{item.date}</time>
        </DemoLink>)}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-[#e5ece8] bg-[#f5f8f6] px-4 py-2">
        <span className="text-[9px] text-[#72857d]">2 more follow-ups due today</span>
        <DemoLink className="inline-flex items-center gap-1 text-[9px] font-bold text-[#2e7062] no-underline hover:underline">View all <ArrowRight className="h-3 w-3"/></DemoLink>
      </footer>
    </section>
  </main>;
}
