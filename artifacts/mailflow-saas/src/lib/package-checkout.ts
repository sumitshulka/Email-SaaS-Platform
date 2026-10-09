const PACKAGE_ID_KEY = 'mailflow-package-checkout-id';
const PACKAGE_EMAIL_KEY = 'mailflow-package-checkout-email';
const PACKAGE_PROOF_KEY = 'mailflow-package-checkout-proof';

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

export function getVerifiedPackageCheckout(id: string | null) {
  if (!id || sessionStorage.getItem(PACKAGE_ID_KEY) !== id) return null;
  const email = sessionStorage.getItem(PACKAGE_EMAIL_KEY);
  const proof = sessionStorage.getItem(PACKAGE_PROOF_KEY);
  return email && proof ? { email, proof } : null;
}

export function clearPackageCheckoutSession() {
  sessionStorage.removeItem(PACKAGE_ID_KEY);
  sessionStorage.removeItem(PACKAGE_EMAIL_KEY);
  sessionStorage.removeItem(PACKAGE_PROOF_KEY);
}
