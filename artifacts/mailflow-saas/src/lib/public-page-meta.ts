export const SITE_ORIGIN = 'https://email-saas-platform.replit.app';
export const SOCIAL_IMAGE_URL = `${SITE_ORIGIN}/mailflow-social-share.png`;
export const SOCIAL_IMAGE_ALT =
  'Mailflow — simple email campaigns from your own sender';

export const PUBLIC_PAGE_METADATA = {
  home: {
    path: '/',
    title: 'Mailflow — simple email campaigns from your own sender',
    description:
      'Organize contacts and companies, prepare simple campaigns, and send with your SMTP account. Add company research and AI drafts when included in your plan.',
  },
  features: {
    path: '/features',
    title: 'Mailflow Features: Your Sender, Simpler Campaigns & AI',
    description:
      'Use your own SMTP, keep contact records private, and manage campaigns with stable variants, one-click unsubscribe, company research and optional AI drafts.',
  },
  pricing: {
    path: '/pricing',
    title: 'Mailflow pricing — plans for your next send',
    description:
      'Explore Mailflow plans for organizing contacts and preparing email campaigns. See current plan limits and pricing, with no invented numbers.',
  },
  checkout: {
    path: '/package-checkout',
    title: 'Continue with a Mailflow plan',
    description:
      'Review your selected Mailflow plan, verify your email, then sign in or create an account to continue.',
  },
  terms: {
    path: '/terms-and-conditions',
    title: 'Terms and Conditions | Mailflow',
    description:
      'Read the terms for using Mailflow, including account responsibilities, paid plan terms, permitted use and service scope.',
  },
  privacy: {
    path: '/privacy-policy',
    title: 'Privacy Policy | Mailflow',
    description:
      'Learn what information Mailflow uses, how it supports the service, and how to submit a privacy request.',
  },
  shipping: {
    path: '/shipping-refund',
    title: 'Shipping & Refund Policy | Mailflow',
    description:
      'Understand digital plan access and the exact eligibility requirements for Mailflow refunds.',
  },
} as const;

export type PublicPageMetadata =
  (typeof PUBLIC_PAGE_METADATA)[keyof typeof PUBLIC_PAGE_METADATA];

export function canonicalUrl(path: string) {
  return new URL(path, `${SITE_ORIGIN}/`).toString();
}
