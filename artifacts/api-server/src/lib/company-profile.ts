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

export function conflictingCompanyProfileFields(
  profiles: readonly CompanyProfileValues[],
): CompanyProfileField[] {
  return companyProfileFields.filter((field) => {
    const values = profiles
      .map((profile) => profile[field])
      .filter((value): value is string => value !== null && value.trim() !== "");
    return new Set(values.map((value) => comparisonValue(field, value))).size > 1;
  });
}

const companyFieldLabels: Record<CompanyProfileField, string> = {
  companyName: "company name",
  companyWebsiteUrl: "website",
  companyDomain: "domain",
  companyIndustry: "industry",
  companySize: "company size",
  companyRevenueRange: "revenue range",
  companyDescription: "description",
  companyPhoneNumber: "phone number",
  companyLinkedinUrl: "LinkedIn URL",
  companyLocation: "location",
};

export function companyProfileReviewReason(
  profile: CompanyProfileValues,
  profilesWithSameDomain: readonly CompanyProfileValues[],
  existingCompany?: CompanyProfileValues,
): string {
  const reasons: string[] = [];
  const domainKey = companyDomainKey(profile);
  if (!profile.companyName) reasons.push("Company name is missing.");
  if (!domainKey) {
    const hasInvalidDomain =
      Boolean(profile.companyDomain || profile.companyWebsiteUrl);
    reasons.push(
      hasInvalidDomain
        ? "A valid company domain or website URL could not be read from this profile."
        : "A company domain or website URL is missing; a domain is required for safe matching.",
    );
  } else {
    const legacyConflicts = conflictingCompanyProfileFields(
      profilesWithSameDomain,
    );
    if (legacyConflicts.length > 0) {
      const labels = legacyConflicts.map((field) => companyFieldLabels[field]);
      reasons.push(
        `Other unlinked profiles for ${domainKey} have conflicting ${labels.join(", ")} values.`,
      );
    }
    if (existingCompany) {
      const sharedConflicts = conflictingCompanyProfileFields([
        profile,
        existingCompany,
      ]);
      if (sharedConflicts.length > 0) {
        const labels = sharedConflicts.map((field) => companyFieldLabels[field]);
        reasons.push(
          `The shared company for ${domainKey} has conflicting ${labels.join(", ")} values.`,
        );
      }
    }
  }
  return reasons.length > 0
    ? reasons.join(" ")
    : "No safe domain-based match was confirmed. Review the saved company details before linking.";
}

export function mergeCompatibleCompanyProfiles(
  profiles: readonly CompanyProfileValues[],
): CompanyProfileValues | null {
  if (conflictingCompanyProfileFields(profiles).length > 0) return null;
  const merged = {} as CompanyProfileValues;
  for (const field of companyProfileFields) {
    const values = profiles
      .map((profile) => profile[field])
      .filter((value): value is string => value !== null && value.trim() !== "");
    merged[field] = values[0] ?? null;
  }
  return merged;
}