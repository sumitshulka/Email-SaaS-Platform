import './_group.css';

const lists = [
  'Spring launch',
  'Early access',
  'Product updates',
  'Trial users',
  'Enterprise contacts',
  'Newsletter subscribers',
  'Partner network',
  'Webinar registrations',
  'Customer advisory group',
  'June release notes',
  'New signups',
  'Churn prevention',
  'Growth accounts',
  'Security briefing',
  'Community members',
  'Retail customers',
  'Support follow-up',
  'Marketplace sellers',
];

const selected = new Set(lists.slice(0, 10));

export function Current() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f2f4f7] p-6 font-sans text-[#182333]">
      <section className="w-full max-w-[760px] rounded-xl border border-[#dfe4ea] bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mono mb-2 text-[9px] uppercase tracking-[.16em] text-[#788596]">WORKSPACE EDITOR</div>
            <h1 className="display text-[23px] font-bold text-[#172334]">New campaign draft</h1>
            <p className="mt-1 text-[12px] text-[#748090]">Choose one or more lists for this campaign.</p>
          </div>
          <button className="rounded-md px-2 py-1 text-[12px] text-[#788596]">Close</button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-[#344154]">
            Internal campaign name
            <input className="mt-1.5 h-10 w-full rounded-md border border-[#d8dde4] px-3 font-normal" value="Spring product notes" readOnly />
          </label>
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-[12px] font-semibold text-[#344154]">Target lists</legend>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-[#d8dde4] bg-white p-2">
              {lists.map((name, index) => (
                <label key={name} className="flex items-center gap-2 rounded px-2 py-2 text-[11px] hover:bg-[#f5f8fb]">
                  <input type="checkbox" checked={selected.has(name)} readOnly className="h-4 w-4 accent-[#245b9b]" />
                  <span className="min-w-0 flex-1 truncate font-medium text-[#344154]">{name}</span>
                  <span className="shrink-0 text-[10px] text-[#8993a0]">{(index + 1) * 147} contacts</span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-[#808a97]">Choose one or more lists. Inactive lists can’t be newly selected or queued.</p>
          </fieldset>
        </div>
        <section className="mt-4 rounded-lg border border-[#e0e4e9] bg-[#fbfcfd] p-3">
          <div>
            <h2 className="text-[11px] font-semibold text-[#344154]">Processing order</h2>
            <p className="mt-1 text-[10px] leading-4 text-[#788392]">The first list containing an address determines the entry used.</p>
          </div>
          <ol className="mt-2 space-y-1">
            {lists.slice(0, 10).map((name, index) => (
              <li key={name} className="flex items-center justify-between gap-2 rounded-md border border-[#e5e9ee] bg-white px-3 py-2">
                <span className="flex items-center gap-2 text-[11px] font-medium text-[#344154]">
                  <span className="mono text-[10px] text-[#8a95a1]">{index + 1}</span>
                  {name}
                  {index === 0 && <span className="rounded-full bg-[#edf4fc] px-2 py-1 text-[10px] font-semibold text-[#245b9b]">first priority</span>}
                </span>
                <span className="flex gap-1">
                  <button className="rounded px-2 py-1.5 text-[10px] font-semibold text-[#596474]">↑ Earlier</button>
                  <button className="rounded px-2 py-1.5 text-[10px] font-semibold text-[#596474]">↓ Later</button>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <div className="mt-4 rounded-md border border-[#cfe4d8] bg-[#f1f8f4] px-3 py-2.5 text-[11px] leading-5 text-[#31674b]">
          <strong>2,841 unique subscribed email addresses</strong> across the selected lists.
        </div>
      </section>
    </main>
  );
}
