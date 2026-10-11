const PACKAGE_ID_KEY = 'mailflow-package-checkout-id';
const PACKAGE_EMAIL_KEY = 'mailflow-package-checkout-email';
const PACKAGE_PROOF_KEY = 'mailflow-package-checkout-proof';
const PACKAGE_TERMS_KEY = 'mailflow-package-checkout-terms';

export type PackageCheckoutTermsSnapshot = {
  packageId: string;
  name: string;
  description: string;
  amountMinor: number;
  currency: string;
  periodDays: number;
  contactLimit: number;
  emailAccountLimit: number;
  researchAllowance: number;
  aiEmailAssistAllowance: number;
  additionalMailboxCount: number;
  emailsPerHourPerSmtp: number;
  emailsPerDayPerSmtp: number;
};

type PackageTermsSource = {
  id: string;
  name: string;
  description?: string | null;
  amountMinor: number;
  currency: string;
  periodDays: number;
  contactLimit: number;
  emailAccountLimit: number;
  researchAllowance: number;
  aiEmailAssistAllowance: number;
  additionalMailboxCount: number;
};

type SendingLimitSource = {
  emailsPerHourPerSmtp: number;
  emailsPerDayPerSmtp: number;
};

export type PackageSlugSource = {
  id: string;
  name: string;
};

export function packageNameSlug(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized) return normalized;
  return name.trim().toLowerCase().replace(/\s+/g, '-') || 'plan';
}

export function packageCheckoutPath<T extends PackageSlugSource>(
  selected: T,
  packages: readonly T[],
): string {
  const baseSlug = packageNameSlug(selected.name);
  const duplicateName = packages.filter(
    item => packageNameSlug(item.name) === baseSlug,
  ).length > 1;
  const slug = duplicateName
    ? `${baseSlug}-${selected.id.slice(0, 8).toLowerCase()}`
    : baseSlug;
  return `/package-checkout/${encodeURIComponent(slug)}`;
}

export function packageCheckoutSlugFromUrl(
  pathname: string,
  search: string,
): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const checkoutIndex = segments.findIndex(segment => segment === 'package-checkout');
  const pathSlug = checkoutIndex >= 0 ? segments[checkoutIndex + 1] : undefined;
  if (pathSlug) {
    try {
      return decodeURIComponent(pathSlug);
    } catch {
      return null;
    }
  }
  const query = new URLSearchParams(search);
  const name = query.get('packageName') ?? query.get('package');
  return name ? packageNameSlug(name) : null;
}

export function isAmbiguousPackageCheckoutSlug<T extends PackageSlugSource>(
  slug: string,
  packages: readonly T[],
): boolean {
  const sameName = packages.filter(item => packageNameSlug(item.name) === slug);
  return sameName.length > 1 && !packages.some(
    item => `${packageNameSlug(item.name)}-${item.id.slice(0, 8).toLowerCase()}` === slug,
  );
}

export function saveVerifiedPackageCheckout(id: string, email: string, proof: string) {
  sessionStorage.setItem(PACKAGE_ID_KEY, id);
  sessionStorage.setItem(PACKAGE_EMAIL_KEY, email);
  sessionStorage.setItem(PACKAGE_PROOF_KEY, proof);
}

export function createPackageCheckoutTermsSnapshot(
  pkg: PackageTermsSource,
  sendingLimits: SendingLimitSource,
): PackageCheckoutTermsSnapshot {
  return {
    packageId: pkg.id,
    name: pkg.name,
    description: pkg.description ?? '',
    amountMinor: pkg.amountMinor,
    currency: pkg.currency,
    periodDays: pkg.periodDays,
    contactLimit: pkg.contactLimit,
    emailAccountLimit: pkg.emailAccountLimit,
    researchAllowance: pkg.researchAllowance,
    aiEmailAssistAllowance: pkg.aiEmailAssistAllowance,
    additionalMailboxCount: pkg.additionalMailboxCount,
    emailsPerHourPerSmtp: sendingLimits.emailsPerHourPerSmtp,
    emailsPerDayPerSmtp: sendingLimits.emailsPerDayPerSmtp,
  };
}

export function savePackageCheckoutTerms(
  pkg: PackageTermsSource,
  sendingLimits: SendingLimitSource,
) {
  const snapshot = createPackageCheckoutTermsSnapshot(pkg, sendingLimits);
  sessionStorage.setItem(PACKAGE_TERMS_KEY, JSON.stringify(snapshot));
}

export function getPackageCheckoutTerms(
  id: string | null,
): PackageCheckoutTermsSnapshot | null {
  if (!id) return null;
  const serialized = sessionStorage.getItem(PACKAGE_TERMS_KEY);
  if (!serialized) return null;
  try {
    const snapshot = JSON.parse(serialized) as PackageCheckoutTermsSnapshot;
    return snapshot.packageId === id ? snapshot : null;
  } catch {
    return null;
  }
}

export function packageCheckoutTermsMatch(
  snapshot: PackageCheckoutTermsSnapshot,
  pkg: PackageTermsSource,
  sendingLimits: SendingLimitSource,
): boolean {
  return snapshot.packageId === pkg.id &&
    snapshot.name === pkg.name &&
    snapshot.description === (pkg.description ?? '') &&
    snapshot.amountMinor === pkg.amountMinor &&
    snapshot.currency === pkg.currency &&
    snapshot.periodDays === pkg.periodDays &&
    snapshot.contactLimit === pkg.contactLimit &&
    snapshot.emailAccountLimit === pkg.emailAccountLimit &&
    snapshot.researchAllowance === pkg.researchAllowance &&
    snapshot.aiEmailAssistAllowance === pkg.aiEmailAssistAllowance &&
    snapshot.additionalMailboxCount === pkg.additionalMailboxCount &&
    snapshot.emailsPerHourPerSmtp === sendingLimits.emailsPerHourPerSmtp &&
    snapshot.emailsPerDayPerSmtp === sendingLimits.emailsPerDayPerSmtp;
}

export function getVerifiedPackageCheckout(id: string | null) {
  if (!id || sessionStorage.getItem(PACKAGE_ID_KEY) !== id) return null;
  const email = sessionStorage.getItem(PACKAGE_EMAIL_KEY);
  const proof = sessionStorage.getItem(PACKAGE_PROOF_KEY);
  return email && proof ? { email, proof } : null;
}

export function rebindVerifiedPackageCheckout(
  verifiedPackageId: string | null,
  replacementPackageId: string,
): boolean {
  const verifiedCheckout = getVerifiedPackageCheckout(verifiedPackageId);
  if (!verifiedCheckout || !replacementPackageId) return false;
  saveVerifiedPackageCheckout(
    replacementPackageId,
    verifiedCheckout.email,
    verifiedCheckout.proof,
  );
  return true;
}

export function clearPackageCheckoutCredentials() {
  sessionStorage.removeItem(PACKAGE_ID_KEY);
  sessionStorage.removeItem(PACKAGE_EMAIL_KEY);
  sessionStorage.removeItem(PACKAGE_PROOF_KEY);
}

export function clearPackageCheckoutSession() {
  clearPackageCheckoutCredentials();
  sessionStorage.removeItem(PACKAGE_TERMS_KEY);
}
