import { createHmac, timingSafeEqual } from "node:crypto";

export const REMOTE_DIAGNOSTICS_PATH = "/api/internal/diagnostics/summary";
const MAX_CLOCK_SKEW_MS = 60_000;

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

export function getRemoteDiagnosticsSecret(): string | null {
  const secret = process.env.MAILFLOW_DIAGNOSTICS_HMAC_SECRET;
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
}
