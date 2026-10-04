export const companyProfileFields = [
  "companyName",
  "companyWebsiteUrl",
  "companyDomain",
  "companyIndustry",
  "companySize",
  "companyRevenueRange",
  "companyDescription",
  "companyPhoneNumber",
  "companyLinkedinUrl",
  "companyLocation",
] as const;

export type CompanyProfileField = (typeof companyProfileFields)[number];
export type CompanyProfileValues = Record<CompanyProfileField, string | null>;

export function normalizeCompanyDomain(value: string | null | undefined): string | null {
  const source = value?.trim();
  if (!source) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(source) ? source : `https://${source}`);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    return hostname && !/\s/.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

export function companyDomainKey(profile: Pick<CompanyProfileValues, "companyDomain" | "companyWebsiteUrl">): string | null {
  return normalizeCompanyDomain(profile.companyDomain) ?? normalizeCompanyDomain(profile.companyWebsiteUrl);
}

export function companyProfileFrom(source: Partial<Record<CompanyProfileField, unknown>>): CompanyProfileValues {
  return Object.fromEntries(
    companyProfileFields.map((field) => {
      const value = source[field];
      return [field, typeof value === "string" && value.trim() ? value.trim() : null];
    }),
  ) as CompanyProfileValues;
}

export function hasCompanyProfile(profile: CompanyProfileValues): boolean {
  return companyProfileFields.some((field) => profile[field] !== null);
}

function comparisonValue(field: CompanyProfileField, value: string): string {
  if (field === "companyDomain") {
    return normalizeCompanyDomain(value) ?? value.trim().toLowerCase();
  }
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function mergeCompatibleCompanyProfiles(
  profiles: readonly CompanyProfileValues[],
): CompanyProfileValues | null {
  const merged = {} as CompanyProfileValues;
  for (const field of companyProfileFields) {
    const values = profiles
      .map((profile) => profile[field])
      .filter((value): value is string => value !== null && value.trim() !== "");
    const distinct = new Set(values.map((value) => comparisonValue(field, value)));
    if (distinct.size > 1) return null;
    merged[field] = values[0] ?? null;
  }
  return merged;
}