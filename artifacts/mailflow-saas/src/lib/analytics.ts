type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === 'undefined') return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never break the app.
  }
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
