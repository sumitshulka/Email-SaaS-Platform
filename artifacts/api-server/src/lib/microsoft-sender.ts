import { and, eq } from "drizzle-orm";
import { db, systemConfigurationTable, microsoftSenderConnectionsTable } from "@workspace/db";
import { decryptSecret, encryptSecret, sha256 } from "./security";

export const MICROSOFT_CALLBACK_PATH = "/api/sending/microsoft/oauth/callback";
export const MICROSOFT_SCOPES = "openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send";
export const MICROSOFT_CONFIGURATION_KEY = "microsoft_sender_oauth";
export type MicrosoftConfiguration = { enabled: boolean; clientId: string; clientSecret: string; redirectUri: string };

export class MicrosoftSenderError extends Error {
  constructor(public code: string, message: string, public deliveryUncertain = false, public retryAfterMs?: number) { super(message); this.name = "MicrosoftSenderError"; }
}

export function validMicrosoftRedirect(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) &&
      url.pathname.endsWith(MICROSOFT_CALLBACK_PATH) && !url.username && !url.password && !url.hash && !url.search;
  } catch { return false; }
}

export async function getMicrosoftConfiguration(): Promise<MicrosoftConfiguration | null> {
  const [row] = await db.select().from(systemConfigurationTable).where(eq(systemConfigurationTable.key, MICROSOFT_CONFIGURATION_KEY));
  const value = row?.value as Record<string, unknown> | undefined;
  if (!value || typeof value.clientId !== "string" || typeof value.clientSecretEncrypted !== "string" ||
    typeof value.redirectUri !== "string" || !validMicrosoftRedirect(value.redirectUri)) return null;
  try {
    return { enabled: value.enabled === true, clientId: value.clientId, clientSecret: decryptSecret(value.clientSecretEncrypted), redirectUri: value.redirectUri };
  } catch { return null; }
}

export const microsoftConfigurationFingerprint = (config: MicrosoftConfiguration) =>
  sha256(JSON.stringify([config.clientId, config.clientSecret, config.redirectUri]));

export async function microsoftConfigurationStatus() {
  const config = await getMicrosoftConfiguration();
  return { enabled: config?.enabled ?? false, configured: Boolean(config?.enabled && config.clientSecret),
    clientId: config?.clientId ?? null, clientSecretConfigured: Boolean(config?.clientSecret), redirectUri: config?.redirectUri ?? null };
}

export async function exchangeMicrosoftToken(config: MicrosoftConfiguration, parameters: Record<string, string>) {
  const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: MICROSOFT_SCOPES, ...parameters }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new MicrosoftSenderError("MICROSOFT_RECONNECT_REQUIRED",
      "Microsoft authorization could not be renewed. Sign in with Microsoft again. Your organization may require administrator consent or may have revoked access.");
  }
  const scope = typeof body.scope === "string" ? body.scope.toLowerCase() : "";
  if (!scope.split(" ").some(s => s === "mail.send" || s.endsWith("/mail.send"))) {
    throw new MicrosoftSenderError("MICROSOFT_SEND_PERMISSION_REQUIRED", "Microsoft did not grant permission to send email. Ask your organization administrator to approve Mail.Send, then reconnect.");
  }
  const expires = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: new Date(Date.now() + Math.max(60, expires) * 1000) };
}

export async function microsoftProfile(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new MicrosoftSenderError("MICROSOFT_MAILBOX_UNAVAILABLE",
    "Microsoft could not confirm access to this mailbox. Reconnect the mailbox; if it continues, ask your administrator to check the account license and application access policy.");
  const profile = await response.json() as { mail?: string; userPrincipalName?: string };
  const mailbox = (profile.mail || profile.userPrincipalName || "").toLowerCase();
  if (!mailbox.includes("@")) throw new MicrosoftSenderError("MICROSOFT_MAILBOX_UNAVAILABLE", "Microsoft did not return a usable mailbox address.");
  return { mailbox, principal: profile.userPrincipalName?.toLowerCase() };
}

export async function microsoftAccessToken(accountId: string, userId: string) {
  const config = await getMicrosoftConfiguration();
  if (!config?.enabled) throw new MicrosoftSenderError("MICROSOFT_SIGN_IN_UNAVAILABLE", "Microsoft sign-in is not enabled by the platform administrator.");
  return db.transaction(async tx => {
    const [connection] = await tx.select().from(microsoftSenderConnectionsTable)
      .where(and(eq(microsoftSenderConnectionsTable.accountId, accountId), eq(microsoftSenderConnectionsTable.userId, userId))).for("update");
    if (!connection || connection.clientId !== config.clientId) {
      throw new MicrosoftSenderError("MICROSOFT_RECONNECT_REQUIRED", "Sign in with Microsoft again for this saved sender account.");
    }
    if (connection.expiresAt.getTime() > Date.now() + 120_000) return decryptSecret(connection.accessTokenEncrypted);
    // A row lock serializes refresh-token rotation across campaign workers and instances.
    const token = await exchangeMicrosoftToken(config, { grant_type: "refresh_token", refresh_token: decryptSecret(connection.refreshTokenEncrypted) });
    await tx.update(microsoftSenderConnectionsTable).set({
      accessTokenEncrypted: encryptSecret(token.accessToken),
      refreshTokenEncrypted: token.refreshToken ? encryptSecret(token.refreshToken) : connection.refreshTokenEncrypted,
      expiresAt: token.expiresAt, updatedAt: new Date(),
    }).where(eq(microsoftSenderConnectionsTable.accountId, accountId));
    return token.accessToken;
  });
}

export async function verifyMicrosoftSender(accountId: string, userId: string, fromEmail: string) {
  const profile = await microsoftProfile(await microsoftAccessToken(accountId, userId));
  if (profile.mailbox !== fromEmail.toLowerCase()) {
    throw new MicrosoftSenderError("MICROSOFT_MAILBOX_MISMATCH", "The Microsoft account does not match the saved From email. Disconnect and sign in with the correct mailbox.");
  }
}

export async function sendMicrosoftMime(accountId: string, userId: string, mime: Buffer) {
  const encoded = mime.toString("base64");
  if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) {
    throw new MicrosoftSenderError("MICROSOFT_MESSAGE_TOO_LARGE", "This message exceeds Mailflow's 4 MB encoded Microsoft API request limit. Reduce the PDF attachments or use a permitted SMTP connection.");
  }
  let accessToken: string;
  try { accessToken = await microsoftAccessToken(accountId, userId); }
  catch (error) {
    if (error instanceof MicrosoftSenderError) throw error;
    throw new MicrosoftSenderError("MICROSOFT_TOKEN_UNAVAILABLE", "Microsoft authorization could not be renewed before sending. Check connectivity and reconnect this mailbox if needed. No message was submitted.");
  }
  // Do not retry sendMail automatically: a timeout can happen after Microsoft accepted it.
  let response: Response;
  try { response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "text/plain" },
    body: encoded, signal: AbortSignal.timeout(30_000),
  }); } catch {
    throw new MicrosoftSenderError("MICROSOFT_DELIVERY_UNKNOWN", "The Microsoft send request was interrupted. Microsoft may have accepted the message. Review this unknown outcome before retrying to avoid duplicates.", true);
  }
  if (response.status !== 202) {
    const message = response.status === 401 ? "Microsoft access expired or was revoked. Reconnect this mailbox." :
      response.status === 403 ? "Microsoft blocked sending. Ask your administrator to check Mail.Send consent, the mailbox license, and application access policy." :
      response.status === 429 ? "Microsoft temporarily rate-limited this mailbox. Try again later." :
      response.status === 413 ? "Microsoft rejected the message size. Reduce the PDF attachments and try again." :
      "Microsoft did not accept this message. Check the mailbox license and reconnect if the issue continues.";
    const retrySeconds = Number(response.headers.get("Retry-After"));
    const retryAfterMs = response.status === 429
      ? Math.max(60_000, Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 60_000)
      : undefined;
    throw new MicrosoftSenderError("MICROSOFT_SEND_FAILED", response.status >= 500
      ? "Microsoft returned a server error after submission; delivery is uncertain. Review this unknown outcome before retrying."
      : message, response.status >= 500, retryAfterMs);
  }
  return { accepted: true };
}
