import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, systemConfigurationTable } from "@workspace/db";
import { GetAdminSettingsResponse } from "@workspace/api-zod";

export type PlatformSettingsInput = {
  applicationName: string;
  defaultCurrency: string;
  defaultTimezone: string;
  dateFormat: string;
  supportEmail: string;
  supportPhone: string;
  maintenanceMode: boolean;
  maxContactsPerUser: number;
  maxUploadFileSizeMb: number;
  allowedContactFileTypes: string[];
  passwordMinimumLength: number;
  otpExpiryMinutes: number;
  maxOtpAttempts: number;
  loginAttemptThreshold: number;
  sessionDurationHours: number;
  defaultEmailsPerHour: number;
  maxEmailsPerDay: number;
  maxCampaignSize: number;
  maxConcurrentCampaigns: number;
  retryAttempts: number;
  retryDelaySeconds: number;
  bounceThreshold: number;
  deliveryTrackingEnabled: boolean;
  queuePollingSeconds: number;
  subjectVariantMinimum: number;
  subjectVariantMaximum: number;
  greetingVariantMinimum: number;
  greetingVariantMaximum: number;
  signatureVariantMinimum: number;
  signatureVariantMaximum: number;
  prohibitedEmailKeywords: string[];
  allowUserWithoutSubscription: boolean;
  gracePeriodDays: number;
  packageVisibility: "public" | "hidden";
  inactiveUserMonths: number;
  inactivityWarningDays: number;
  inactivityRemovalDays: number;
};

export const defaultPlatformSettings: PlatformSettingsInput = {
  applicationName: "Mailflow",
  defaultCurrency: "INR",
  defaultTimezone: "Asia/Kolkata",
  dateFormat: "DD MMM YYYY",
  supportEmail: "support@example.com",
  supportPhone: "",
  maintenanceMode: false,
  maxContactsPerUser: 5000,
  maxUploadFileSizeMb: 10,
  allowedContactFileTypes: ["csv"],
  passwordMinimumLength: 12,
  otpExpiryMinutes: 10,
  maxOtpAttempts: 5,
  loginAttemptThreshold: 5,
  sessionDurationHours: 24,
  defaultEmailsPerHour: 100,
  maxEmailsPerDay: 1000,
  maxCampaignSize: 5000,
  maxConcurrentCampaigns: 1,
  retryAttempts: 3,
  retryDelaySeconds: 60,
  bounceThreshold: 3,
  deliveryTrackingEnabled: false,
  queuePollingSeconds: 15,
  subjectVariantMinimum: 3,
  subjectVariantMaximum: 7,
  greetingVariantMinimum: 3,
  greetingVariantMaximum: 7,
  signatureVariantMinimum: 3,
  signatureVariantMaximum: 7,
  prohibitedEmailKeywords: [],
  allowUserWithoutSubscription: false,
  gracePeriodDays: 0,
  packageVisibility: "public",
  inactiveUserMonths: 3,
  inactivityWarningDays: 15,
  inactivityRemovalDays: 7,
};

function withSettingsVersion(settings: unknown) {
  const parsed = GetAdminSettingsResponse.omit({ settingsVersion: true }).parse(settings);
  const { updatedAt: _updatedAt, ...configuration } = parsed;
  const settingsVersion = createHash("sha256")
    .update(JSON.stringify(configuration))
    .digest("hex");
  return GetAdminSettingsResponse.parse({ ...parsed, settingsVersion });
}

export function getMinimumEmailSpacingSeconds(
  settings: Pick<
    PlatformSettingsInput,
    "defaultEmailsPerHour" | "queuePollingSeconds"
  >,
): number {
  const hourlyCap = Math.max(1, settings.defaultEmailsPerHour);
  const pollingSeconds = Math.max(1, settings.queuePollingSeconds);
  return Math.max(pollingSeconds, Math.ceil(3600 / hourlyCap));
}

export const CAMPAIGN_EMAIL_GAP_MIN_SECONDS = 5 * 60;
export const CAMPAIGN_EMAIL_GAP_MAX_SECONDS = 15 * 60;
export const CAMPAIGN_EMAIL_GAP_AVERAGE_SECONDS =
  (CAMPAIGN_EMAIL_GAP_MIN_SECONDS + CAMPAIGN_EMAIL_GAP_MAX_SECONDS) / 2;

export function getCampaignMinimumSpacingSeconds(
  settings: Pick<
    PlatformSettingsInput,
    "defaultEmailsPerHour" | "maxEmailsPerDay" | "queuePollingSeconds"
  >,
): number {
  const dailyCap = Math.max(1, settings.maxEmailsPerDay);
  return Math.max(
    CAMPAIGN_EMAIL_GAP_MIN_SECONDS,
    getMinimumEmailSpacingSeconds(settings),
    Math.ceil((24 * 60 * 60) / dailyCap),
  );
}

export function getCampaignEmailGapSeconds(
  attemptId: string,
  minimumSeconds = CAMPAIGN_EMAIL_GAP_MIN_SECONDS,
  maximumSeconds = CAMPAIGN_EMAIL_GAP_MAX_SECONDS,
): number {
  const parsedBits = Number.parseInt(
    attemptId.replaceAll("-", "").slice(-8),
    16,
  );
  const randomBits = Number.isFinite(parsedBits)
    ? parsedBits
    : Array.from(attemptId).reduce(
        (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
        0,
      );
  const range = maximumSeconds - minimumSeconds + 1;
  return minimumSeconds + (randomBits % range);
}

export function getCampaignEmailSpacingSeconds(
  attemptId: string,
  settings: Pick<
    PlatformSettingsInput,
    "defaultEmailsPerHour" | "queuePollingSeconds"
  >,
  window?: { minimumSeconds: number; maximumSeconds: number } | null,
): number {
  return Math.max(
    getCampaignEmailGapSeconds(
      attemptId,
      window?.minimumSeconds ?? CAMPAIGN_EMAIL_GAP_MIN_SECONDS,
      window?.maximumSeconds ?? CAMPAIGN_EMAIL_GAP_MAX_SECONDS,
    ),
    getMinimumEmailSpacingSeconds(settings),
  );
}

export type CampaignQueueEstimateRecipient = {
  campaignId: string;
  senderAccountId: string | null;
  nextAttemptAt: Date;
  createdAt: Date;
};

export type CampaignQueueEstimateAttempt = {
  senderAccountId: string | null;
  attemptedAt: Date;
  completedAt?: Date | null;
};

type DeliveryForecastState = {
  attempts: number[];
  firstHourlyAttempt: number;
  firstDailyAttempt: number;
};

function createDeliveryForecastState(attempts: Date[]): DeliveryForecastState {
  return {
    attempts: attempts.map((attempt) => attempt.getTime()).sort((a, b) => a - b),
    firstHourlyAttempt: 0,
    firstDailyAttempt: 0,
  };
}

function scheduleForecastAttempt(
  state: DeliveryForecastState,
  eligibleAt: number,
  settings: Pick<
    PlatformSettingsInput,
    "defaultEmailsPerHour" | "maxEmailsPerDay" | "queuePollingSeconds"
  >,
  nowMs: number,
): number {
  const spacing = Math.max(
    CAMPAIGN_EMAIL_GAP_AVERAGE_SECONDS,
    getMinimumEmailSpacingSeconds(settings),
  );
  const hourlyLimit = Math.max(1, settings.defaultEmailsPerHour);
  const dailyLimit = Math.max(1, settings.maxEmailsPerDay);
  const pollingMs = Math.max(1, settings.queuePollingSeconds) * 1000;
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const previousAttempt =
    state.attempts.length > 0
      ? state.attempts[state.attempts.length - 1]
      : nowMs - spacing * 1000;
  let nextAt = Math.max(nowMs, eligibleAt, previousAttempt + spacing * 1000);

  while (true) {
    while (
      state.firstHourlyAttempt < state.attempts.length &&
      state.attempts[state.firstHourlyAttempt] < nextAt - hourMs
    ) {
      state.firstHourlyAttempt += 1;
    }
    while (
      state.firstDailyAttempt < state.attempts.length &&
      state.attempts[state.firstDailyAttempt] < nextAt - dayMs
    ) {
      state.firstDailyAttempt += 1;
    }

    let delayedUntil = nextAt;
    if (state.attempts.length - state.firstHourlyAttempt >= hourlyLimit) {
      delayedUntil = Math.max(
        delayedUntil,
        state.attempts[state.attempts.length - hourlyLimit] + hourMs + pollingMs,
      );
    }
    if (state.attempts.length - state.firstDailyAttempt >= dailyLimit) {
      delayedUntil = Math.max(
        delayedUntil,
        state.attempts[state.attempts.length - dailyLimit] + dayMs + pollingMs,
      );
    }
    if (delayedUntil === nextAt) break;
    nextAt = delayedUntil;
  }

  state.attempts.push(nextAt);
  return nextAt;
}

function forecastDurationSeconds(
  lastScheduledAt: number,
  nowMs: number,
  settings: Pick<PlatformSettingsInput, "defaultEmailsPerHour" | "queuePollingSeconds">,
  hasRecentAttempts: boolean,
): number {
  const completionBuffer =
    hasRecentAttempts
      ? Math.max(1, settings.queuePollingSeconds) * 1000
      : getMinimumEmailSpacingSeconds(settings) * 1000;
  return Math.max(
    0,
    Math.ceil((lastScheduledAt - nowMs + completionBuffer) / 1000),
  );
}

export function estimateCampaignDeliverySeconds(
  recipientCount: number,
  settings: Pick<
    PlatformSettingsInput,
    "defaultEmailsPerHour" | "maxEmailsPerDay" | "queuePollingSeconds"
  >,
  recentAttempts: Date[] = [],
  now = new Date(),
): number {
  const recipients = Math.max(0, Math.floor(recipientCount));
  if (recipients === 0) return 0;

  const nowMs = now.getTime();
  const historicalAttempts = recentAttempts.filter(
    (attempt) => attempt.getTime() <= nowMs,
  );
  const state = createDeliveryForecastState(historicalAttempts);
  let lastScheduledAt = nowMs;

  for (let index = 0; index < recipients; index += 1) {
    lastScheduledAt = scheduleForecastAttempt(
      state,
      nowMs,
      settings,
      nowMs,
    );
  }

  return forecastDurationSeconds(
    lastScheduledAt,
    nowMs,
    settings,
    historicalAttempts.length > 0,
  );
}

export function estimateCampaignQueueDeliverySeconds(
  recipients: CampaignQueueEstimateRecipient[],
  settings: Pick<
    PlatformSettingsInput,
    "defaultEmailsPerHour" | "maxEmailsPerDay" | "queuePollingSeconds"
  >,
  recentAttempts: CampaignQueueEstimateAttempt[] = [],
  now = new Date(),
): {
  durationSecondsByCampaign: Map<string, number>;
  projectedAttemptTimesBySenderAccount: Map<string | null, Date[]>;
} {
  const nowMs = now.getTime();
  const historicalAttemptsBySender = new Map<string | null, Date[]>();
  for (const attempt of recentAttempts) {
    if (attempt.attemptedAt.getTime() > nowMs) continue;
    const attempts =
      historicalAttemptsBySender.get(attempt.senderAccountId) ?? [];
    attempts.push(
      attempt.completedAt ??
        new Date(Math.max(attempt.attemptedAt.getTime(), nowMs)),
    );
    historicalAttemptsBySender.set(attempt.senderAccountId, attempts);
  }
  const statesBySender = new Map<string | null, DeliveryForecastState>();
  const stateForSender = (senderAccountId: string | null) => {
    let state = statesBySender.get(senderAccountId);
    if (!state) {
      state = createDeliveryForecastState(
        historicalAttemptsBySender.get(senderAccountId) ?? [],
      );
      statesBySender.set(senderAccountId, state);
    }
    return state;
  };
  for (const senderAccountId of historicalAttemptsBySender.keys()) {
    stateForSender(senderAccountId);
  }
  const orderedRecipients = recipients
    .map((recipient, index) => ({ ...recipient, index }))
    .sort(
      (left, right) =>
        left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime() ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.index - right.index,
    );
  const durationSecondsByCampaign = new Map<string, number>();

  for (const recipient of orderedRecipients) {
    const state = stateForSender(recipient.senderAccountId);
    const scheduledAt = scheduleForecastAttempt(
      state,
      recipient.nextAttemptAt.getTime(),
      settings,
      nowMs,
    );
    const durationSeconds = forecastDurationSeconds(
      scheduledAt,
      nowMs,
      settings,
      (historicalAttemptsBySender.get(recipient.senderAccountId)?.length ??
        0) > 0,
    );
    durationSecondsByCampaign.set(
      recipient.campaignId,
      Math.max(
        durationSecondsByCampaign.get(recipient.campaignId) ?? 0,
        durationSeconds,
      ),
    );
  }

  return {
    durationSecondsByCampaign,
    projectedAttemptTimesBySenderAccount: new Map(
      Array.from(statesBySender, ([senderAccountId, state]) => [
        senderAccountId,
        state.attempts.map((attempt) => new Date(attempt)),
      ]),
    ),
  };
}

export function estimateCampaignDeliveryAfterQueueSeconds(
  recipientCount: number,
  settings: Pick<
    PlatformSettingsInput,
    "defaultEmailsPerHour" | "maxEmailsPerDay" | "queuePollingSeconds"
  >,
  precedingAttemptTimes: Date[],
  hasRecentAttempts: boolean,
  now = new Date(),
  earliestAttemptAt = now,
): number {
  const recipients = Math.max(0, Math.floor(recipientCount));
  if (recipients === 0) return 0;

  const nowMs = now.getTime();
  const state = createDeliveryForecastState(precedingAttemptTimes);
  let lastScheduledAt = nowMs;
  for (let index = 0; index < recipients; index += 1) {
    lastScheduledAt = scheduleForecastAttempt(
      state,
      earliestAttemptAt.getTime(),
      settings,
      nowMs,
    );
  }
  return forecastDurationSeconds(
    lastScheduledAt,
    nowMs,
    settings,
    hasRecentAttempts,
  );
}

export async function getPlatformSettings() {
  const [row] = await db
    .select()
    .from(systemConfigurationTable)
    .where(eq(systemConfigurationTable.key, "platform"));

  const persisted =
    row?.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};

  return withSettingsVersion({
    ...defaultPlatformSettings,
    ...persisted,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
}

export async function lockPlatformSettings(
  tx: Pick<typeof db, "insert" | "select">,
) {
  // Creating the singleton first makes the lock reliable even before settings
  // have ever been saved on a fresh installation.
  await tx
    .insert(systemConfigurationTable)
    .values({ key: "platform", value: defaultPlatformSettings })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(systemConfigurationTable)
    .where(eq(systemConfigurationTable.key, "platform"))
    .for("update");

  const persisted =
    row?.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};

  return withSettingsVersion({
    ...defaultPlatformSettings,
    ...persisted,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
}