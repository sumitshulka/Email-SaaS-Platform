export const SITE_ORIGIN = 'https://email-saa-s-platform.replit.app';
export const SOCIAL_IMAGE_URL = `${SITE_ORIGIN}/mailflow-social-share.png`;
export const SOCIAL_IMAGE_ALT =
  'Mailflow — simple email campaigns from your own sender';

export const PUBLIC_PAGE_METADATA = {
  home: {
    path: '/',
    title: 'Mailflow — prospect tracking and email campaigns',
    description:
      'Organize contacts and companies, track prospects and follow-ups, then run campaigns through an SMTP account you control.',
  },
  features: {
    path: '/features',
    title: 'Mailflow Features: Prospect Management, Campaigns & Your Sender',
    description:
      'Track prospect stages, deal history and follow-ups alongside private contacts, company context, Open Campaigns and sending through your own SMTP.',
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
