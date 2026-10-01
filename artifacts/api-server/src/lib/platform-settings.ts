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
  allowUserWithoutSubscription: boolean;
  gracePeriodDays: number;
  packageVisibility: "public" | "hidden";
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
  allowUserWithoutSubscription: false,
  gracePeriodDays: 0,
  packageVisibility: "public",
};

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

  const spacing = getMinimumEmailSpacingSeconds(settings);
  const hourlyLimit = Math.max(1, settings.defaultEmailsPerHour);
  const dailyLimit = Math.max(1, settings.maxEmailsPerDay);
  const pollingMs = Math.max(1, settings.queuePollingSeconds) * 1000;
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const nowMs = now.getTime();
  const attempts = recentAttempts
    .map((attempt) => attempt.getTime())
    .filter((attemptAt) => attemptAt <= nowMs)
    .sort((a, b) => a - b);
  const hasRecentAttempts = attempts.length > 0;
  let firstHourlyAttempt = 0;
  let firstDailyAttempt = 0;

  for (let index = 0; index < recipients; index += 1) {
    let nextAt = Math.max(
      nowMs,
      attempts.length > 0
        ? attempts[attempts.length - 1] + spacing * 1000
        : nowMs,
    );

    while (true) {
      while (
        firstHourlyAttempt < attempts.length &&
        attempts[firstHourlyAttempt] < nextAt - hourMs
      ) {
        firstHourlyAttempt += 1;
      }
      while (
        firstDailyAttempt < attempts.length &&
        attempts[firstDailyAttempt] < nextAt - dayMs
      ) {
        firstDailyAttempt += 1;
      }

      let delayedUntil = nextAt;
      if (attempts.length - firstHourlyAttempt >= hourlyLimit) {
        delayedUntil = Math.max(
          delayedUntil,
          attempts[attempts.length - hourlyLimit] + hourMs + pollingMs,
        );
      }
      if (attempts.length - firstDailyAttempt >= dailyLimit) {
        delayedUntil = Math.max(
          delayedUntil,
          attempts[attempts.length - dailyLimit] + dayMs + pollingMs,
        );
      }
      if (delayedUntil === nextAt) break;
      nextAt = delayedUntil;
    }

    attempts.push(nextAt);
  }

  const lastScheduledAt = attempts[attempts.length - 1];
  const completionBuffer = hasRecentAttempts
    ? pollingMs
    : spacing * 1000;
  return Math.max(
    0,
    Math.ceil((lastScheduledAt - nowMs + completionBuffer) / 1000),
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

  return GetAdminSettingsResponse.parse({
    ...defaultPlatformSettings,
    ...persisted,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
}