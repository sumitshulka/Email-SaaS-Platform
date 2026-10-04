import { eq } from "drizzle-orm";
import { db, systemConfigurationTable } from "@workspace/db";
import { decryptSecret, encryptSecret } from "./security";

const CONFIGURATION_KEY = "google_oauth";
const CALLBACK_PATH = "/api/sending/gmail/oauth/callback";

export type GoogleOAuthConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type StoredGoogleOAuthConfiguration = {
  clientId: string | null;
  clientSecretEncrypted: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  updatedAt: Date | null;
};

export type GoogleOAuthSettingsStatus = {
  configured: boolean;
  clientId: string | null;
  clientSecretConfigured: boolean;
  redirectUri: string | null;
  updatedAt: string | null;
};

export function isValidGoogleOAuthRedirectUri(value: string): boolean {
  try {
    const uri = new URL(value);
    const secure =
      uri.protocol === "https:" ||
      (uri.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(uri.hostname));
    return (
      secure &&
      uri.pathname.endsWith(CALLBACK_PATH) &&
      !uri.search &&
      !uri.hash &&
      !uri.username &&
      !uri.password
    );
  } catch {
    return false;
  }
}

async function readStoredConfiguration(): Promise<StoredGoogleOAuthConfiguration | null> {
  const [row] = await db
    .select()
    .from(systemConfigurationTable)
    .where(eq(systemConfigurationTable.key, CONFIGURATION_KEY))
    .limit(1);
  if (!row || !row.value || typeof row.value !== "object") return null;

  const value = row.value as Record<string, unknown>;
  const clientSecretEncrypted =
    typeof value.clientSecretEncrypted === "string"
      ? value.clientSecretEncrypted
      : null;
  let clientSecret: string | null = null;
  if (clientSecretEncrypted) {
    try {
      clientSecret = decryptSecret(clientSecretEncrypted);
    } catch {
      // Keep the admin setup recoverable if the saved ciphertext is invalid.
    }
  }

  return {
    clientId: typeof value.clientId === "string" ? value.clientId : null,
    clientSecretEncrypted,
    clientSecret,
    redirectUri: typeof value.redirectUri === "string" ? value.redirectUri : null,
    updatedAt: row.updatedAt ?? null,
  };
}

export async function getGoogleOAuthConfiguration(): Promise<GoogleOAuthConfiguration | null> {
  const stored = await readStoredConfiguration();
  if (
    !stored?.clientId?.trim() ||
    !stored.clientSecret ||
    !stored.redirectUri ||
    !isValidGoogleOAuthRedirectUri(stored.redirectUri)
  ) {
    return null;
  }
  return {
    clientId: stored.clientId.trim(),
    clientSecret: stored.clientSecret,
    redirectUri: stored.redirectUri,
  };
}

export async function getGoogleOAuthSettingsStatus(): Promise<GoogleOAuthSettingsStatus> {
  const stored = await readStoredConfiguration();
  const clientId = stored?.clientId?.trim() || null;
  const redirectUri = stored?.redirectUri || null;
  const clientSecretConfigured = Boolean(stored?.clientSecret);
  return {
    configured: Boolean(
      clientId &&
        clientSecretConfigured &&
        redirectUri &&
        isValidGoogleOAuthRedirectUri(redirectUri),
    ),
    clientId,
    clientSecretConfigured,
    redirectUri,
    updatedAt: stored?.updatedAt?.toISOString() ?? null,
  };
}

export async function saveGoogleOAuthConfiguration({
  clientId,
  clientSecret,
  redirectUri,
  updatedBy,
}: {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  updatedBy: string;
}): Promise<void> {
  const existing = await readStoredConfiguration();
  const suppliedSecret = clientSecret?.trim();
  const secret = suppliedSecret || existing?.clientSecret;
  if (!secret) {
    throw new Error("Enter the Google OAuth client secret to finish setup.");
  }

  const clientSecretEncrypted = suppliedSecret
    ? encryptSecret(suppliedSecret)
    : existing!.clientSecretEncrypted!;
  const value = {
    clientId: clientId.trim(),
    clientSecretEncrypted,
    redirectUri: redirectUri.trim(),
  };
  await db
    .insert(systemConfigurationTable)
    .values({ key: CONFIGURATION_KEY, value, updatedBy })
    .onConflictDoUpdate({
      target: systemConfigurationTable.key,
      set: { value, updatedBy, updatedAt: new Date() },
    });
}