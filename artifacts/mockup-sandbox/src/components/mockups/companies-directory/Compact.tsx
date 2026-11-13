import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
  Users,
  X,
} from "lucide-react";
import "./_group.css";

type Company = {
  name: string;
  area: string;
  location: string;
  contacts: number;
  size: string;
  revenue: string;
  domain?: string;
};

const initialCompanies: Company[] = [
  { name: "Harborlight Analytics", area: "Technology", location: "Seattle, WA", contacts: 12, size: "51–200", revenue: "$10M–$50M", domain: "harborlight.io" },
  { name: "Cedarstone Health", area: "Healthcare", location: "Portland, OR", contacts: 8, size: "11–50", revenue: "$1M–$10M", domain: "cedarstone.health" },
  { name: "Northstar Labs", area: "Research", location: "Vancouver, BC", contacts: 4, size: "11–50", revenue: "$1M–$10M", domain: "northstarlabs.ca" },
  { name: "Juniper Works", area: "Professional Services", location: "San Francisco, CA", contacts: 3, size: "1–10", revenue: "Under $1M", domain: "juniperworks.co" },
];

type ActionKind = "catalog" | "upload" | "add" | null;

function Action({
  children,
  primary = false,
  onClick,
}: {
  children: ReactNode;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8] focus-visible:ring-offset-2 ${
        primary
          ? "border-[#174f99] bg-[#174f99] text-white hover:bg-[#123f7b]"
          : "border-[#d7dce3] bg-white text-[#283545] hover:bg-[#f5f8fb]"
      }`}
    >
      {children}
    </button>
  );
}

export function Compact() {
  const [companies, setCompanies] = useState(initialCompanies);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [revenue, setRevenue] = useState("");
  const [location, setLocation] = useState("");
  const [action, setAction] = useState<ActionKind>(null);
  const [notice, setNotice] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyArea, setNewCompanyArea] = useState("");
  const [newCompanyLocation, setNewCompanyLocation] = useState("");

  const activeFilterCount = [industry, size, revenue, location].filter(Boolean).length;
  const reviewProfiles: Company[] = [];
  const visibleCompanies = useMemo(
    () =>
      companies.filter((company) => {
        const query = search.trim().toLowerCase();
        const matchesSearch =
          !query ||
          [company.name, company.domain ?? "", company.area, company.location]
            .join(" ")
            .toLowerCase()
            .includes(query);
        return (
          matchesSearch &&
          (!industry || company.area === industry) &&
          (!size || company.size === size) &&
          (!revenue || company.revenue === revenue) &&
          (!location || company.location === location)
        );
      }),
    [companies, search, industry, size, revenue, location],
  );

  const downloadCompanies = () => {
    const rows = [["Company", "Business area", "Location", "Contacts", "Domain"], ...visibleCompanies.map((company) => [
      company.name,
      company.area,
      company.location,
      String(company.contacts),
      company.domain ?? "",
    ])];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "mailflow-companies.csv";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Your company directory download is ready.");
  };

  const clearFilters = () => {
    setIndustry("");
    setSize("");
    setRevenue("");
    setLocation("");
  };

  const addCompany = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newCompanyName.trim()) return;
    setCompanies((current) => [
      ...current,
      {
        name: newCompanyName.trim(),
        area: newCompanyArea.trim() || "Unspecified",
        location: newCompanyLocation.trim() || "Not set",
        contacts: 0,
        size: "",
        revenue: "",
      },
    ]);
    setSearch("");
    clearFilters();
    setNewCompanyName("");
    setNewCompanyArea("");
    setNewCompanyLocation("");
    setAction(null);
    setNotice(`${newCompanyName.trim()} was added to your directory.`);
  };

  const closeAction = () => setAction(null);

  return (
    <main className="min-h-screen bg-[#f7f8fa] p-4 text-[#223247] sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono mb-2 text-[10px] uppercase tracking-[.16em] text-[#7d8794]">CUSTOMER CONTEXT / DIRECTORY</div>
          <h1 className="display text-[30px] font-bold leading-tight text-[#172334]">Companies</h1>
          <p className="mt-2 max-w-2xl text-[13px] text-[#687484]">Shared profiles for the organizations behind your contacts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Action onClick={() => setAction("catalog")}><Building2 className="h-4 w-4" />Browse global catalog</Action>
          <Action onClick={downloadCompanies}><Download className="h-4 w-4" />Download companies</Action>
          <Action onClick={() => setAction("upload")}><Upload className="h-4 w-4" />Bulk upload</Action>
          <Action primary onClick={() => setAction("add")}><Plus className="h-4 w-4" />Add company</Action>
        </div>
      </div>

      <div data-testid="status-company-backfill" className="mb-4 flex flex-col gap-3 rounded-lg border border-[#d8e5df] bg-[#f4f9f6] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#43825e]" />
          <div>
            <div className="text-[12px] font-semibold text-[#2c6547]">Legacy company profiles checked</div>
            <p className="mt-1 text-[11px] leading-5 text-[#617c6d]">0 contacts linked · 0 shared companies created · 0 contacts stayed unlinked</p>
          </div>
        </div>
        <span className="text-[10px] text-[#789080]">Only safe matches are linked.</span>
      </div>

      <section data-testid="section-unlinked-company-profiles" aria-label="Company profiles to review" className="mb-4 overflow-hidden rounded-lg border border-[#e0e4e9] bg-white">
        <button
          type="button"
          aria-expanded={reviewOpen}
          aria-controls="company-review-details"
          onClick={() => setReviewOpen((open) => !open)}
          className="flex min-h-[58px] w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-[#fbfcfd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b73b8] sm:px-5"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#f3f5f7] text-[#6a7888]"><Building2 className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-[#223247]">Company profiles to review</span>
              <span className="mt-0.5 block truncate text-[10px] text-[#788697]">
                {reviewProfiles.length
                  ? `${reviewProfiles.length} profiles need a closer look`
                  : "No profiles currently need review"}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-semibold text-[#647386]">
              {reviewProfiles.length} to review
            </span>
            <ChevronDown className={`h-4 w-4 text-[#768496] transition-transform ${reviewOpen ? "rotate-180" : ""}`} />
          </span>
        </button>
        {reviewOpen && (
          <div id="company-review-details" className="border-t border-[#e8edf1]">
            <div className="px-4 py-4 sm:px-5">
              <p className="max-w-4xl text-[11px] leading-5 text-[#788697]">
                Profiles that could not be safely linked stay on their contact. Automatic linking requires compatible details and a matching domain; names alone are never used.
              </p>
              {reviewProfiles.length === 0 ? (
                <div data-testid="empty-unlinked-company-profiles" className="mt-3 rounded-md border border-dashed border-[#dfe5eb] bg-[#fbfcfd] px-4 py-4">
                  <p className="text-[12px] font-semibold text-[#405166]">No unlinked profiles need review</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#84909e]">When a legacy profile is incomplete or conflicts with another record, it will appear here.</p>
                </div>
              ) : (
                <div className="mt-3 divide-y divide-[#edf0f2] rounded-md border border-[#e6eaee]">
                  {reviewProfiles.map((profile) => (
                    <div key={profile.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="text-[11px] font-semibold text-[#405166]">{profile.name}</span>
                      <span className="text-[10px] text-[#84909e]">{profile.location}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <footer className="border-t border-[#edf0f2] bg-[#fbfcfd] px-4 py-3 text-[10px] leading-4 text-[#778596] sm:px-5">
              To keep a profile unchanged, leave it as-is. It remains on the contact and in this list until you correct or link it.
            </footer>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#e0e4e9] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e8edf1] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-[14px] font-bold text-[#223247]">Company directory</h2>
            <p data-testid="text-company-result-count" className="mt-1 text-[11px] text-[#84909e]">
              {companies.length} {companies.length === 1 ? "record" : "records"} in this workspace
              {visibleCompanies.length !== companies.length && ` · ${visibleCompanies.length} shown`}
            </p>
            <p className="mt-1 max-w-2xl text-[10px] leading-4 text-[#84909e]">Select workspace-owned companies to set one shared business area. Global catalog profiles are managed there.</p>
          </div>
          <label className="relative block w-full sm:max-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8b96a3]" />
            <input
              aria-label="Search companies"
              data-testid="input-search-companies"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, domain, industry…"
              className="h-9 w-full rounded-md border border-[#dce2e8] bg-[#fbfcfd] pl-9 pr-3 text-[11px] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#3b73b8]/15"
            />
          </label>
        </div>

        <section data-testid="section-company-filters" aria-label="Smart company filters" className="border-b border-[#e8edf1] bg-[#fbfcfd]">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="smart-company-filter-fields"
            onClick={() => setFiltersOpen((open) => !open)}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left hover:bg-[#f7f9fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b73b8] sm:px-5"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#718093]" />
              <span className="text-[11px] font-semibold text-[#344154]">Smart filters</span>
              {activeFilterCount > 0 ? (
                <span className="rounded-full bg-[#e9f0f8] px-2 py-0.5 text-[9px] font-semibold text-[#245b9b]">
                  {activeFilterCount} active
                </span>
              ) : (
                <span className="text-[10px] text-[#8a95a2]">None active</span>
              )}
            </span>
            <span className="flex items-center gap-2 text-[10px] text-[#788697]">
              {filtersOpen ? "Hide filters" : "Show filters"}
              <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </span>
          </button>
          {filtersOpen && (
            <div id="smart-company-filter-fields" className="border-t border-[#e8edf1] px-4 pb-4 pt-3 sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] text-[#7d8997]">Combine company profile filters; all selected values must match.</p>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#245b9b] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8]">
                    <X className="h-3 w-3" /> Clear
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Industry", value: industry, set: setIndustry, options: ["Technology", "Healthcare", "Research", "Professional Services"] },
                  { label: "Company size", value: size, set: setSize, options: ["1–10", "11–50", "51–200"] },
                  { label: "Revenue range", value: revenue, set: setRevenue, options: ["Under $1M", "$1M–$10M", "$10M–$50M"] },
                  { label: "Location", value: location, set: setLocation, options: ["Seattle, WA", "Portland, OR", "Vancouver, BC", "San Francisco, CA"] },
                ].map(({ label, value, set, options }) => (
                  <label key={label} className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#465568]">{label}</span>
                    <select
                      value={value}
                      onChange={(event) => set(event.target.value)}
                      className="h-9 w-full rounded-md border border-[#d8dde4] bg-white px-3 text-[11px] text-[#435267] outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#3b73b8]/15"
                    >
                      <option value="">{label === "Location" ? "Any location" : `All ${label.toLowerCase()}`}</option>
                      {options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-[#f8fafb]">
              <tr className="mono text-[9px] uppercase tracking-[.11em] text-[#84909e]">
                <th className="w-10 px-3 py-3" />
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Business area (Domain)</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Contacts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f2]">
              {visibleCompanies.map((company) => (
                <tr key={company.name} className="group hover:bg-[#f8fafb]">
                  <td className="px-3 py-3.5" />
                  <td className="px-5 py-3.5">
                    <span className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-md border border-[#dbe5ef] bg-[#eef4fa] text-[#245b9b]"><Building2 className="h-4 w-4" /></span>
                      <span>
                        <span className="block text-[12px] font-semibold text-[#26364a]">{company.name}</span>
                        {company.domain && <span className="mt-0.5 block text-[10px] text-[#84909e]">{company.domain}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-[11px] text-[#536477]">{company.area}</td>
                  <td className="px-4 py-3.5 text-[11px] text-[#536477]">{company.location}</td>
                  <td className="px-5 py-3.5"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#f0f4f7] px-2.5 py-1 text-[10px] font-semibold text-[#607184]"><Users className="h-3 w-3" />{company.contacts}</span></td>
                </tr>
              ))}
              {visibleCompanies.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center">
                    <p className="text-[12px] font-semibold text-[#405166]">No companies match this view</p>
                    <p className="mt-1 text-[11px] text-[#84909e]">Try another search or clear your filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-col gap-3 border-t border-[#e8edf1] px-4 py-3 text-[10px] text-[#7f8b99] sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span>{visibleCompanies.length ? `Showing 1–${visibleCompanies.length} of ${visibleCompanies.length}` : "Showing 0 companies"}</span>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button type="button" aria-label="Previous page" disabled className="grid h-8 w-8 place-items-center rounded-md border border-[#dce2e8] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="mono min-w-[54px] text-center">1 / 1</span>
            <button type="button" aria-label="Next page" disabled className="grid h-8 w-8 place-items-center rounded-md border border-[#dce2e8] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </footer>
      </section>

      <div className="sr-only" aria-live="polite">{notice}</div>

      {action && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#1e2a38]/35 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeAction();
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="company-action-title" className="w-full max-w-md rounded-lg border border-[#dfe4e9] bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="company-action-title" className="text-[15px] font-bold text-[#223247]">
                  {action === "catalog" ? "Browse global catalog" : action === "upload" ? "Bulk upload companies" : "Add a company"}
                </h2>
                <p className="mt-1 text-[11px] leading-5 text-[#788697]">
                  {action === "catalog"
                    ? "Global catalog profiles are managed separately from your workspace directory."
                    : action === "upload"
                      ? "Choose a CSV file to prepare a company import."
                      : "Create a shared company profile for your workspace."}
                </p>
              </div>
              <button type="button" aria-label="Close dialog" onClick={closeAction} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#718093] hover:bg-[#f1f4f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8]"><X className="h-4 w-4" /></button>
            </div>
            {action === "catalog" && (
              <div className="mt-4 rounded-md border border-[#e7ebef] bg-[#f8fafb] px-3.5 py-3 text-[11px] leading-5 text-[#536477]">
                Search and manage public company profiles in the global catalog. Workspace-owned records remain available here.
              </div>
            )}
            {action === "upload" && (
              <label className="mt-4 block rounded-md border border-dashed border-[#cfd8e1] bg-[#fafbfd] px-4 py-5 text-center">
                <Upload className="mx-auto h-5 w-5 text-[#75869a]" />
                <span className="mt-2 block text-[11px] font-semibold text-[#405166]">Choose a CSV file</span>
                <span className="mt-1 block text-[10px] text-[#84909e]">CSV files only</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setNotice(`${file.name} is ready for import review.`);
                      closeAction();
                    }
                  }}
                />
              </label>
            )}
            {action === "add" && (
              <form onSubmit={addCompany} className="mt-4 space-y-3">
                <label className="block text-[11px] font-semibold text-[#465568]">Company name
                  <input autoFocus required value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#d8dde4] px-3 text-[12px] font-normal outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#3b73b8]/15" placeholder="e.g. Alder & Finch" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[11px] font-semibold text-[#465568]">Business area
                    <input value={newCompanyArea} onChange={(event) => setNewCompanyArea(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#d8dde4] px-3 text-[12px] font-normal outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#3b73b8]/15" placeholder="Technology" />
                  </label>
                  <label className="block text-[11px] font-semibold text-[#465568]">Location
                    <input value={newCompanyLocation} onChange={(event) => setNewCompanyLocation(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#d8dde4] px-3 text-[12px] font-normal outline-none focus:border-[#3b73b8] focus:ring-2 focus:ring-[#3b73b8]/15" placeholder="City, region" />
                  </label>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={closeAction} className="min-h-9 rounded-md border border-[#d7dce3] px-3 text-[11px] font-semibold text-[#435267] hover:bg-[#f7f9fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8]">Cancel</button>
                  <button type="submit" className="min-h-9 rounded-md bg-[#174f99] px-3.5 text-[11px] font-semibold text-white hover:bg-[#123f7b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8] focus-visible:ring-offset-2">Add company</button>
                </div>
              </form>
            )}
            {action !== "add" && (
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={closeAction} className="min-h-9 rounded-md border border-[#d7dce3] px-3.5 text-[11px] font-semibold text-[#435267] hover:bg-[#f7f9fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b73b8]">Done</button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
