import './_group.css';
import { ArrowRight, Clock3 } from 'lucide-react';

const todayItems = [
  {
    id: 'demo-1',
    prospect: 'Northstar Learning',
    action: 'Proposal review',
    contact: 'Avery James',
    date: 'Nov 18',
  },
  {
    id: 'demo-2',
    prospect: 'Oakridge Systems',
    action: 'Discovery call',
    contact: 'Jordan Lee',
    date: 'Nov 18',
  },
];

function DemoLink({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <a href="#" onClick={event => event.preventDefault()} className={className}>{children}</a>;
}

export function CurrentFollowUps() {
  return <main className="min-h-screen bg-[#f7f9fb] p-8 text-[#182333]">
    <section className="overflow-hidden rounded-xl border border-[#dce4ed] bg-white shadow-[0_4px_18px_rgba(19,43,70,.035)]" aria-label="Follow-ups today">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d6e3ef] bg-[#edf4fb] px-5 py-3.5">
        <div><div className="mono text-[9px] tracking-[.14em] text-[#52718f]">PROSPECT MANAGEMENT / TODAY</div><h2 className="mt-1 text-[14px] font-bold text-[#263c53]">Follow-ups today</h2></div>
        <DemoLink className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#245b91] no-underline hover:underline">Open calendar <ArrowRight className="h-3.5 w-3.5"/></DemoLink>
      </header>
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_160px] sm:p-5">
        <div className="min-w-0 space-y-2">
          {todayItems.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#e8edf2] px-3 py-2.5">
            <div className="min-w-0"><DemoLink className="block truncate text-[11px] font-bold text-[#285b8a] no-underline hover:underline">{item.prospect}</DemoLink><div className="mt-1 truncate text-[9px] text-[#7c8b99]">{item.action} · {item.contact}</div></div>
            <time className="shrink-0 text-[9px] font-semibold text-[#718398]">{item.date}</time>
          </div>)}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
          <div className="rounded-lg border border-[#dce8f2] bg-[#f2f7fb] p-3"><div className="text-[9px] font-bold uppercase tracking-[.1em] text-[#64809a]">Pending today</div><div className="display mt-1 text-[24px] font-bold text-[#274764]">2</div></div>
          <div className="rounded-lg border border-[#f0ddc6] bg-[#fff8ef] p-3"><div className="text-[9px] font-bold uppercase tracking-[.1em] text-[#9a7042]">Overdue</div><div className="display mt-1 text-[24px] font-bold text-[#82562e]">3</div></div>
        </div>
      </div>
    </section>
  </main>;
}
