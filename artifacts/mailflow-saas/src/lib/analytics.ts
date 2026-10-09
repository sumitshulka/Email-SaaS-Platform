type AnalyticsData = Record<string, string | number | boolean>;

type MarketingPage = 'home' | 'features' | 'pricing';
type SignupPlacement = 'header' | 'footer' | 'hero' | 'intro' | 'sender' | 'final_cta' | 'plan' | 'bottom_cta';
type SignupAttribution = { page: MarketingPage; placement: SignupPlacement };

const SIGNUP_ATTRIBUTION_KEY = 'mailflow-marketing-signup-attribution';
const PENDING_VERIFIED_SIGNUP_KEY = 'mailflow-pending-verified-signup';

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

function isSignupAttribution(value: unknown): value is SignupAttribution {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.page === 'home') {
    return ['header', 'footer', 'hero', 'intro', 'final_cta'].includes(String(candidate.placement));
  }
  if (candidate.page === 'features') {
    return ['header', 'footer', 'hero', 'sender', 'final_cta'].includes(String(candidate.placement));
  }
  if (candidate.page === 'pricing') {
    return ['header', 'footer', 'plan', 'bottom_cta'].includes(String(candidate.placement));
  }
  return false;
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === 'undefined') return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never break the app.
  }
}

export function trackMarketingSignupCta(page: MarketingPage, placement: SignupPlacement): void {
  const attribution: SignupAttribution = { page, placement };
  trackEvent('marketing_signup_cta_clicked', attribution);
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(SIGNUP_ATTRIBUTION_KEY, JSON.stringify(attribution));
  } catch {
    // Attribution storage must never block navigation.
  }
}

function takeSignupAttribution(key: string): SignupAttribution | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const stored = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    const parsed: unknown = stored ? JSON.parse(stored) : undefined;
    return isSignupAttribution(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function trackRegistrationSucceeded(awaitingEmailVerification = true): void {
  const attribution = takeSignupAttribution(SIGNUP_ATTRIBUTION_KEY);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(PENDING_VERIFIED_SIGNUP_KEY);
      if (awaitingEmailVerification) {
        window.sessionStorage.setItem(
          PENDING_VERIFIED_SIGNUP_KEY,
          JSON.stringify(attribution ?? {}),
        );
      }
    } catch {
      // Verified-signup attribution must never affect account creation.
    }
  }

  trackEvent('registration_succeeded', attribution);
}

export function trackVerifiedSignupSucceeded(): void {
  if (typeof window === 'undefined') return;

  let stored: string | null;
  try {
    stored = window.sessionStorage.getItem(PENDING_VERIFIED_SIGNUP_KEY);
    window.sessionStorage.removeItem(PENDING_VERIFIED_SIGNUP_KEY);
  } catch {
    return;
  }
  if (stored === null) return;

  let attribution: SignupAttribution | undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (isSignupAttribution(parsed)) attribution = parsed;
  } catch {
    // Malformed attribution does not prevent counting a verified signup.
  }

  trackEvent('verified_signup_succeeded', attribution);
}

export function trackPaidVerificationOutcome(outcome: 'pending' | 'failed'): void {
  trackEvent(
    outcome === 'pending'
      ? 'paid_payment_verification_pending'
      : 'paid_payment_verification_failed',
  );
}

export function trackFreeActivationOutcome(outcome: 'activated' | 'failed'): void {
  trackEvent(
    outcome === 'activated'
      ? 'free_subscription_activated'
      : 'free_subscription_activation_failed',
  );
}

export function trackPaidCheckoutOutcome(outcome: 'started' | 'dismissed' | 'setup_failed'): void {
  const eventName = {
    started: 'paid_checkout_started',
    dismissed: 'paid_checkout_dismissed',
    setup_failed: 'paid_checkout_setup_failed',
  }[outcome];
  trackEvent(eventName);
}

export function trackSmtpSenderAccountCreated(accountCount: number, accountLimit: number): void {
  trackEvent('smtp_sender_account_created', {
    account_count: accountCount,
    account_limit: accountLimit,
    outcome: 'success',
  });
}

export function trackSmtpSenderAccountDeleted(accountCount: number, accountLimit: number): void {
  trackEvent('smtp_sender_account_deleted', {
    account_count: accountCount,
    account_limit: accountLimit,
    outcome: 'success',
  });
}

export function trackSmtpSenderAccountDefaultSelected(accountCount: number, accountLimit: number): void {
  trackEvent('smtp_sender_account_default_selected', {
    account_count: accountCount,
    account_limit: accountLimit,
    outcome: 'success',
  });
}

export function trackSmtpSenderRetentionCompleted(
  accountCount: number,
  retainedCount: number,
  accountLimit: number,
): void {
  trackEvent('smtp_sender_retention_completed', {
    account_count: accountCount,
    retained_count: retainedCount,
    account_limit: accountLimit,
    outcome: 'accepted',
  });
}
