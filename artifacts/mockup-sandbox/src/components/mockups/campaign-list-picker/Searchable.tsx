import './_group.css';
import { ArrowDown, ArrowUp, Check, Search, X } from 'lucide-react';

const results = [
  { name: 'Spring launch', contacts: 1240, selected: true },
  { name: 'Spring launch waitlist', contacts: 582, selected: false },
  { name: 'Spring launch partners', contacts: 148, selected: false },
  { name: 'Spring launch webinar', contacts: 306, selected: true },
];

const selected = [
  'Spring launch',
  'Product updates',
  'Early access',
  'Newsletter subscribers',
  'Trial users',
  'Partner network',
  'Webinar registrations',
  'Enterprise contacts',
];

export function Searchable() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f2f4f7] p-6 font-sans text-[#182333]">
      <section className="w-full max-w-[760px] rounded-xl border border-[#dfe4ea] bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mono mb-2 text-[9px] uppercase tracking-[.16em] text-[#788596]">WORKSPACE EDITOR</div>
            <h1 className="display text-[23px] font-bold text-[#172334]">New campaign draft</h1>
            <p className="mt-1 text-[12px] text-[#748090]">Choose and order the lists for this campaign.</p>
          </div>
          <button className="rounded-md px-2 py-1 text-[12px] text-[#788596]">Close</button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-[#344154]">
            Internal campaign name
            <input className="mt-1.5 h-10 w-full rounded-md border border-[#d8dde4] px-3 font-normal" value="Spring product notes" readOnly />
          </label>
          <fieldset className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between">
              <legend className="text-[12px] font-semibold text-[#344154]">Target lists</legend>
              <span className="text-[10px] font-medium text-[#687484]">8 selected</span>
            </div>
            <div className="overflow-hidden rounded-md border border-[#d8dde4] bg-white">
              <div className="border-b border-[#e9edf0] bg-[#fbfcfd] p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-md border border-[#e0e4e9] bg-white p-0.5">
                    <button className="rounded bg-[#edf4fc] px-2 py-1 text-[10px] font-semibold text-[#245b9b]">All <span className="font-normal opacity-75">126</span></button>
                    <button className="rounded px-2 py-1 text-[10px] font-semibold text-[#66717e]">Selected <span className="font-normal opacity-75">8</span></button>
                  </div>
                  <span className="text-[10px] text-[#808a97]">4 of 126 lists</span>
                </div>
                <label className="relative mt-2 block">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8993a0]" />
                  <input className="h-9 w-full rounded-md border border-[#d8dde4] bg-white pl-8 pr-3 text-[11px] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#dbe8f7]" value="spring launch" readOnly />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8993a0]" aria-label="Clear search"><X className="h-3 w-3" /></button>
                </label>
                <div className="mt-2 flex min-h-6 items-center justify-between gap-2">
                  <span className="text-[10px] text-[#808a97]">4 results · 1 already selected</span>
                  <button className="rounded px-1.5 py-1 text-[10px] font-semibold text-[#245b9b] hover:bg-[#edf4fc]">Add 3 matches</button>
                </div>
              </div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto p-1.5">
                {results.map((list) => (
                  <label key={list.name} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-[11px] hover:bg-[#f5f8fb]">
                    <input type="checkbox" checked={list.selected} readOnly className="h-4 w-4 accent-[#245b9b]" />
                    <span className="min-w-0 flex-1 truncate font-medium text-[#344154]">{list.name}</span>
                    <span className="shrink-0 text-[10px] text-[#8993a0]">{list.contacts.toLocaleString()} contacts</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-[#808a97]">Search by name or switch to Selected to review your audience.</p>
          </fieldset>
        </div>
        <section className="mt-4 rounded-lg border border-[#e0e4e9] bg-[#fbfcfd] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[11px] font-semibold text-[#344154]">Processing order <span className="ml-1 rounded-full bg-[#edf4fc] px-2 py-0.5 text-[10px] text-[#245b9b]">8 lists</span></h2>
              <p className="mt-1 text-[10px] leading-4 text-[#788392]">Use arrows to set priority. Overlapping addresses still receive one email.</p>
            </div>
            <button className="shrink-0 rounded px-2 py-1 text-[10px] font-semibold text-[#687484] hover:bg-[#eef1f4]">Clear all</button>
          </div>
          <ol className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
            {selected.map((name, index) => (
              <li key={name} className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-[#e5e9ee] bg-white px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-[#344154]">
                  <span className="mono shrink-0 text-[10px] text-[#8a95a1]">{index + 1}</span>
                  <span className="truncate">{name}</span>
                  {index === 0 && <span className="shrink-0 rounded-full bg-[#edf4fc] px-2 py-1 text-[10px] font-semibold text-[#245b9b]">first priority</span>}
                </span>
                <span className="flex shrink-0 gap-0.5">
                  <button className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-[10px] font-semibold text-[#596474] hover:bg-[#f4f6f8]" aria-label={`Move ${name} earlier`}><ArrowUp className="h-3 w-3" />Earlier</button>
                  <button className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-[10px] font-semibold text-[#596474] hover:bg-[#f4f6f8]" aria-label={`Move ${name} later`}><ArrowDown className="h-3 w-3" />Later</button>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-[#cfe4d8] bg-[#f1f8f4] px-3 py-2.5 text-[11px] leading-5 text-[#31674b]">
          <Check className="h-4 w-4 shrink-0" />
          <span><strong>2,841 unique subscribed email addresses</strong> across the selected lists.</span>
        </div>
      </section>
    </main>
  );
}
