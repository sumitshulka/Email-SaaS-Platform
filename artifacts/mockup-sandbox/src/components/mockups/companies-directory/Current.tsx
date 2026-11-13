import { useState } from "react";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  Upload,
  Users,
} from "lucide-react";
import "./_group.css";

const companies = [
  { name: "Harborlight Analytics", area: "Technology", location: "Seattle, WA", contacts: 12 },
  { name: "Cedarstone Health", area: "Healthcare", location: "Portland, OR", contacts: 8 },
  { name: "Northstar Labs", area: "Research", location: "Vancouver, BC", contacts: 4 },
  { name: "Juniper Works", area: "Professional Services", location: "San Francisco, CA", contacts: 3 },
];

function Action({ children, primary = false }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3.5 text-[12px] font-semibold ${primary ? "border-[#174f99] bg-[#174f99] text-white" : "border-[#d7dce3] bg-white text-[#283545]"}`}>
      {children}
    </button>
  );
}

export function Current() {
  const [search, setSearch] = useState("");
  const visibleCompanies = companies.filter((company) => company.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <main className="min-h-screen bg-[#f7f8fa] p-4 text-[#223247] sm:p-6">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">CUSTOMER CONTEXT / DIRECTORY</div>
          <h1 className="display text-[30px] font-bold leading-tight text-[#172334]">Companies</h1>
          <p className="mt-2 max-w-2xl text-[13px] text-[#687484]">Shared profiles for the organizations behind your contacts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Action><Building2 className="h-4 w-4"/>Browse global catalog</Action>
          <Action><Download className="h-4 w-4"/>Download companies</Action>
          <Action><Upload className="h-4 w-4"/>Bulk upload</Action>
          <Action primary><Plus className="h-4 w-4"/>Add company</Action>
        </div>
      </div>

      <div data-testid="status-company-backfill" className="mb-5 flex flex-col gap-3 rounded-lg border border-[#d8e5df] bg-[#f4f9f6] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#43825e]"/>
          <div>
            <div className="text-[12px] font-semibold text-[#2c6547]">Legacy company profiles checked</div>
            <p className="mt-1 text-[11px] leading-5 text-[#617c6d]">0 contacts linked · 0 shared companies created · 0 contacts stayed unlinked</p>
          </div>
        </div>
        <span className="text-[10px] text-[#789080]">Only safe matches are linked.</span>
      </div>

      <section data-testid="section-unlinked-company-profiles" className="mb-5 overflow-hidden rounded-lg border border-[#e0e4e9] bg-white">
        <header className="border-b border-[#e8edf1] px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-bold text-[#223247]">Company profiles to review</h2>
              <p className="mt-1 text-[11px] leading-5 text-[#788697]">Profiles that could not be safely linked stay on their contact. Automatic linking requires compatible details and a matching domain; names alone are never used.</p>
            </div>
            <span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-semibold text-[#647386]">0 to review</span>
          </div>
        </header>
        <div data-testid="empty-unlinked-company-profiles" className="px-5 py-7">
          <p className="text-[12px] font-semibold text-[#405166]">No unlinked profiles need review</p>
          <p className="mt-1 text-[11px] text-[#84909e]">When a legacy profile is incomplete or conflicts with another record, it will appear here.</p>
        </div>
        <footer className="border-t border-[#edf0f2] bg-[#fbfcfd] px-4 py-3 text-[10px] leading-4 text-[#778596] sm:px-5">To keep a profile unchanged, leave it as-is. It remains on the contact and in this list until you correct or link it.</footer>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#e0e4e9] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e8edf1] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-[14px] font-bold text-[#223247]">Company directory</h2>
            <p data-testid="text-company-result-count" className="mt-1 text-[11px] text-[#84909e]">4 records in this workspace</p>
            <p className="mt-1 text-[10px] text-[#84909e]">Select workspace-owned companies to set one shared business area. Global catalog profiles are managed there.</p>
          </div>
          <label className="relative block w-full sm:max-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8b96a3]"/>
            <input aria-label="Search companies" data-testid="input-search-companies" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, domain, industry…" className="h-9 w-full rounded-md border border-[#dce2e8] bg-[#fbfcfd] pl-9 pr-3 text-[11px] outline-none focus:border-[#3b73b8]"/>
          </label>
        </div>
        <section data-testid="section-company-filters" aria-label="Smart company filters" className="border-b border-[#e8edf1] bg-[#fbfcfd] px-4 py-4 sm:px-5">
          <div className="mb-3"><h3 className="text-[12px] font-semibold text-[#344154]">Smart filters</h3><p className="mt-1 text-[10px] text-[#7d8997]">Combine company profile filters; all selected values must match.</p></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {["Industry", "Company size", "Revenue range", "Location"].map((label) => (
              <label key={label} className="block"><span className="mb-1.5 block text-[11px] font-semibold text-[#465568]">{label}</span><select className="h-10 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[13px]"><option>{label === "Location" ? "Any location" : `All ${label.toLowerCase()}`}</option></select></label>
            ))}
          </div>
        </section>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-[#f8fafb]"><tr className="mono text-[9px] uppercase tracking-[.11em] text-[#84909e]"><th className="w-10 px-3 py-3"/><th className="px-5 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Business area (Domain)</th><th className="px-4 py-3 font-medium">Location</th><th className="px-5 py-3 font-medium">Contacts</th></tr></thead>
            <tbody className="divide-y divide-[#edf0f2]">
              {visibleCompanies.map((company) => <tr key={company.name} className="group hover:bg-[#f8fafb]"><td className="px-3 py-3.5"/><td className="px-5 py-3.5"><span className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-md border border-[#dbe5ef] bg-[#eef4fa] text-[#245b9b]"><Building2 className="h-4 w-4"/></span><span className="text-[12px] font-semibold text-[#26364a]">{company.name}</span></span></td><td className="px-4 py-3.5 text-[11px] text-[#536477]">{company.area}</td><td className="px-4 py-3.5 text-[11px] text-[#536477]">{company.location}</td><td className="px-5 py-3.5"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#f0f4f7] px-2.5 py-1 text-[10px] font-semibold text-[#607184]"><Users className="h-3 w-3"/>{company.contacts}</span></td></tr>)}
            </tbody>
          </table>
        </div>
        <footer className="flex items-center justify-between border-t border-[#e8edf1] px-5 py-3 text-[10px] text-[#7f8b99]"><span>Showing 1–{visibleCompanies.length} of {visibleCompanies.length}</span><div className="flex items-center gap-2"><button aria-label="Previous page" disabled className="grid h-8 w-8 place-items-center rounded-md border border-[#dce2e8] disabled:opacity-40"><ChevronLeft className="h-4 w-4"/></button><span className="mono min-w-[54px] text-center">1 / 1</span><button aria-label="Next page" disabled className="grid h-8 w-8 place-items-center rounded-md border border-[#dce2e8] disabled:opacity-40"><ChevronRight className="h-4 w-4"/></button></div></footer>
      </section>
    </main>
  );
}
