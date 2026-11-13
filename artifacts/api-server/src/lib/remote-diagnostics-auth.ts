import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, systemConfigurationTable } from "@workspace/db";
import { decryptSecret } from "./security";

export const REMOTE_DIAGNOSTICS_PATH = "/api/internal/diagnostics/summary";
export const REMOTE_DIAGNOSTICS_CONFIGURATION_KEY = "remote_diagnostics_hmac_secret";
const MAX_CLOCK_SKEW_MS = 60_000;
const SECRET_CACHE_TTL_MS = 10_000;
const SECRET_READ_TIMEOUT_MS = 750;
let cachedSecret: string | null = null;
let cacheExpiresAt = 0;
let refreshPromise: Promise<void> | null = null;

function canonicalRequest(timestamp: string, nonce: string): string {
  return `GET\n${REMOTE_DIAGNOSTICS_PATH}\n${timestamp}\n${nonce}`;
}

export function createRemoteDiagnosticsSignature(
  secret: string,
  timestamp: string,
  nonce: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalRequest(timestamp, nonce))
    .digest("hex");
}

export function verifyRemoteDiagnosticsSignature(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  signature: string;
  nowMs?: number;
}): boolean {
  const nowMs = input.nowMs ?? Date.now();
  const timestampMs = Number(input.timestamp);
  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(nowMs - timestampMs) > MAX_CLOCK_SKEW_MS ||
    !/^[0-9a-f-]{36}$/i.test(input.nonce) ||
    !/^[0-9a-f]{64}$/i.test(input.signature)
  ) {
    return false;
  }

  const expected = createRemoteDiagnosticsSignature(
    input.secret,
    input.timestamp,
    input.nonce,
  );
  const actualBuffer = Buffer.from(input.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

export function updateRemoteDiagnosticsSecretCache(secret: string | null): void {
  cachedSecret = secret;
  cacheExpiresAt = Date.now() + SECRET_CACHE_TTL_MS;
}

export function getRemoteDiagnosticsClientSecret(): string | null {
  const secret = process.env.MAILFLOW_DIAGNOSTICS_HMAC_SECRET?.trim();
  return secret && /^[0-9a-f]{64}$/i.test(secret) ? secret : null;
}

export async function initializeRemoteDiagnosticsSecret(): Promise<void> {
  await getRemoteDiagnosticsSecret();
}

async function readStoredRemoteDiagnosticsSecret(): Promise<string | null> {
  const [row] = await db
    .select({ value: systemConfigurationTable.value })
    .from(systemConfigurationTable)
    .where(eq(systemConfigurationTable.key, REMOTE_DIAGNOSTICS_CONFIGURATION_KEY))
    .limit(1);
  const value = row?.value && typeof row.value === "object" && !Array.isArray(row.value)
    ? row.value as Record<string, unknown>
    : null;
  const encrypted = typeof value?.secretEncrypted === "string"
    ? value.secretEncrypted
    : null;
  if (!encrypted) return null;
  try {
    const decrypted = decryptSecret(encrypted);
    return Buffer.byteLength(decrypted, "utf8") === 32 ? decrypted : null;
  } catch {
    return null;
  }
}

export async function getRemoteDiagnosticsSecret(): Promise<string | null> {
  if (Date.now() < cacheExpiresAt) return cachedSecret;
  if (!refreshPromise) {
    refreshPromise = readStoredRemoteDiagnosticsSecret()
      .then((secret) => {
        cachedSecret = secret;
        cacheExpiresAt = Date.now() + SECRET_CACHE_TTL_MS;
      })
      .catch(() => {
        cacheExpiresAt = Date.now() + SECRET_CACHE_TTL_MS;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    refreshPromise,
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, SECRET_READ_TIMEOUT_MS);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return cachedSecret;
}
