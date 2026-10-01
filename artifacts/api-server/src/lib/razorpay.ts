import { eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { db, razorpayConfigurationTable } from "@workspace/db";
import { constantTimeEqual, decryptSecret } from "./security";

const API_BASE = "https://api.razorpay.com/v1";

export type RazorpayEnvironment = "sandbox" | "production";

export type RazorpayConfiguration = {
  environment: RazorpayEnvironment;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
};

type RazorpayConfigurationRow = typeof razorpayConfigurationTable.$inferSelect;

export type StoredRazorpayCredentials = {
  keyId: string | null;
  keySecretEncrypted: string | null;
  webhookSecretEncrypted: string | null;
};

export function inferLegacyRazorpayEnvironment(
  keyId: string,
): RazorpayEnvironment | null {
  if (keyId.startsWith("rzp_test_")) return "sandbox";
  if (keyId.startsWith("rzp_live_")) return "production";
  return null;
}

export function getStoredRazorpayCredentials(
  row: RazorpayConfigurationRow,
  environment: RazorpayEnvironment,
): StoredRazorpayCredentials {
  const isSandbox = environment === "sandbox";
  const legacyEnvironment = inferLegacyRazorpayEnvironment(row.keyId);
  const canUseLegacy = legacyEnvironment === environment;
  return {
    keyId:
      (isSandbox ? row.sandboxKeyId : row.productionKeyId) ??
      (canUseLegacy ? row.keyId : null),
    keySecretEncrypted:
      (isSandbox
        ? row.sandboxKeySecretEncrypted
        : row.productionKeySecretEncrypted) ??
      (canUseLegacy ? row.keySecretEncrypted : null),
    webhookSecretEncrypted:
      (isSandbox
        ? row.sandboxWebhookSecretEncrypted
        : row.productionWebhookSecretEncrypted) ??
      (canUseLegacy ? row.webhookSecretEncrypted : null),
  };
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
};

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

export async function getRazorpayConfiguration(
  environment?: RazorpayEnvironment,
): Promise<RazorpayConfiguration | null> {
  const [row] = await db
    .select()
    .from(razorpayConfigurationTable)
    .where(eq(razorpayConfigurationTable.id, "platform"))
    .limit(1);
  if (!row) return null;
  const activeEnvironment =
    environment ??
    row.activeEnvironment ??
    inferLegacyRazorpayEnvironment(row.keyId);
  if (!activeEnvironment) return null;
  const credentials = getStoredRazorpayCredentials(row, activeEnvironment);
  if (
    !credentials.keyId ||
    !credentials.keySecretEncrypted ||
    !credentials.webhookSecretEncrypted
  ) {
    return null;
  }
  return {
    environment: activeEnvironment,
    keyId: credentials.keyId,
    keySecret: decryptSecret(credentials.keySecretEncrypted),
    webhookSecret: decryptSecret(credentials.webhookSecretEncrypted),
  };
}

async function request<T>(
  config: RazorpayConfiguration,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const responseText = await response.text();
    let payload: unknown;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const message =
        response.status === 401
          ? "Razorpay rejected the saved key ID or key secret."
          : "Razorpay could not complete the request.";
      throw new RazorpayApiError(message, response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof RazorpayApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new RazorpayApiError("Razorpay did not respond in time.", 504);
    }
    throw new RazorpayApiError("Razorpay could not be reached.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function createRazorpayOrder(
  config: RazorpayConfiguration,
  input: {
    amount: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  },
): Promise<RazorpayOrder> {
  return request<RazorpayOrder>(config, "/orders", "POST", input);
}

export function getRazorpayPayment(
  config: RazorpayConfiguration,
  paymentId: string,
): Promise<RazorpayPayment> {
  return request<RazorpayPayment>(
    config,
    `/payments/${encodeURIComponent(paymentId)}`,
    "GET",
  );
}

export async function testRazorpayConnection(
  config: RazorpayConfiguration,
): Promise<void> {
  await request<{ items: unknown[] }>(config, "/payments?count=1", "GET");
}

export function verifyCheckoutSignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const expected = createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return constantTimeEqual(expected, signature.toLowerCase());
}

export function verifyWebhookSignature(
  webhookSecret: string,
  rawBody: Buffer,
  signature: string,
): boolean {
  const expected = createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
  return constantTimeEqual(expected, signature.toLowerCase());
}