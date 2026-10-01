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