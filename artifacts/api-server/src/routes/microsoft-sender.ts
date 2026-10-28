import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";
import { and, eq, lt, gt } from "drizzle-orm";
import { db, systemConfigurationTable, tenantSendingConfigurationTable as senders,
  microsoftSenderConnectionsTable as connections, microsoftSenderStatesTable as states } from "@workspace/db";
import { UpdateMicrosoftOAuthSettingsBody, GetMicrosoftOAuthSettingsResponse, GetMicrosoftSenderConnectionParams,
  GetMicrosoftSenderConnectionResponse, AuthorizeMicrosoftSenderResponse } from "@workspace/api-zod";
import { requireSuperadmin, requireUserRole } from "../lib/session";
import { decryptSecret, encryptSecret, sha256 } from "../lib/security";
import { writeAuditLog } from "../lib/audit";
import { getMicrosoftConfiguration, MICROSOFT_CONFIGURATION_KEY, MICROSOFT_SCOPES,
  microsoftConfigurationStatus, microsoftConfigurationFingerprint, validMicrosoftRedirect,
  exchangeMicrosoftToken, microsoftProfile, MICROSOFT_CALLBACK_PATH } from "../lib/microsoft-sender";

const router = Router();
const fingerprint = (s: typeof senders.$inferSelect) =>
  sha256(JSON.stringify([s.provider, s.fromEmail.toLowerCase(), s.usernameEncrypted, s.passwordEncrypted]));
const accountFor = async (accountId: string, userId: string) => {
  const [account] = await db.select().from(senders).where(and(eq(senders.id, accountId), eq(senders.userId, userId)));
  return account;
};

router.get("/admin/settings/microsoft-oauth", requireSuperadmin, async (_req, res) => {
  res.json(GetMicrosoftOAuthSettingsResponse.parse(await microsoftConfigurationStatus()));
});
router.put("/admin/settings/microsoft-oauth", requireSuperadmin, async (req, res) => {
  const parsed = UpdateMicrosoftOAuthSettingsBody.safeParse(req.body);
  if (!parsed.success || !validMicrosoftRedirect(parsed.data.redirectUri) ||
    !/^[0-9a-f-]{36}$/i.test(parsed.data.clientId.trim())) {
    res.status(400).json({ error: `Enter the Microsoft application client ID and a secure callback URL ending in ${MICROSOFT_CALLBACK_PATH}.`, code: "INVALID_MICROSOFT_SETTINGS" }); return;
  }
  const current = await getMicrosoftConfiguration();
  const secret = parsed.data.clientSecret || current?.clientSecret;
  if (!secret || (current && current.clientId !== parsed.data.clientId.trim() && !parsed.data.clientSecret)) {
    res.status(400).json({ error: "Enter the client secret for this Microsoft application. Blank preserves a secret only for the same client ID.", code: "MICROSOFT_SECRET_REQUIRED" }); return;
  }
  await db.insert(systemConfigurationTable).values({
    key: MICROSOFT_CONFIGURATION_KEY, updatedBy: req.authUser!.id,
    value: { enabled: parsed.data.enabled, clientId: parsed.data.clientId.trim(), redirectUri: parsed.data.redirectUri.trim(), clientSecretEncrypted: encryptSecret(secret) },
  }).onConflictDoUpdate({ target: systemConfigurationTable.key, set: {
    updatedBy: req.authUser!.id, updatedAt: new Date(),
    value: { enabled: parsed.data.enabled, clientId: parsed.data.clientId.trim(), redirectUri: parsed.data.redirectUri.trim(), clientSecretEncrypted: encryptSecret(secret) },
  } });
  await writeAuditLog({ actorId: req.authUser!.id, action: "microsoft_oauth_configuration.updated", entity: "system_configuration", entityId: MICROSOFT_CONFIGURATION_KEY, ipAddress: req.ip, metadata: { secretChanged: Boolean(parsed.data.clientSecret) } });
  res.json(GetMicrosoftOAuthSettingsResponse.parse(await microsoftConfigurationStatus()));
});

router.get("/sending/accounts/:accountId/microsoft/connection", requireUserRole, async (req, res) => {
  const parsed = GetMicrosoftSenderConnectionParams.safeParse(req.params);
  const account = parsed.success ? await accountFor(parsed.data.accountId, req.authUser!.id) : null;
  if (!account) { res.status(404).json({ error: "Sender account not found.", code: "SENDER_ACCOUNT_NOT_FOUND" }); return; }
  const config = await getMicrosoftConfiguration();
  const [connection] = await db.select({ mailbox: connections.mailbox, clientId: connections.clientId }).from(connections)
    .where(and(eq(connections.accountId, account.id), eq(connections.userId, req.authUser!.id)));
  res.json(GetMicrosoftSenderConnectionResponse.parse({ configured: Boolean(config?.enabled),
    connected: account.authenticationMethod === "microsoft_oauth" && Boolean(connection && config?.clientId === connection.clientId),
    mailbox: connection?.mailbox ?? null }));
});
router.post("/sending/accounts/:accountId/microsoft/authorize", requireUserRole, async (req, res) => {
  const parsed = GetMicrosoftSenderConnectionParams.safeParse(req.params);
  const account = parsed.success ? await accountFor(parsed.data.accountId, req.authUser!.id) : null;
  if (!account || account.provider !== "microsoft_365") { res.status(404).json({ error: "Save a Microsoft 365 sender account first.", code: "SENDER_ACCOUNT_NOT_FOUND" }); return; }
  const config = await getMicrosoftConfiguration();
  if (!config?.enabled) { res.status(409).json({ error: "The platform administrator must complete the one-time Microsoft sign-in setup.", code: "MICROSOFT_NOT_CONFIGURED" }); return; }
  if (new URL(config.redirectUri).origin !== `${req.protocol}://${req.get("host")}`) {
    res.status(409).json({ error: "Use the application domain configured for Microsoft sign-in. The callback URL must match this site's origin.", code: "MICROSOFT_ORIGIN_MISMATCH" }); return;
  }
  if (!req.sessionTokenHash) { res.status(401).json({ error: "Sign in to Mailflow again before connecting Microsoft.", code: "UNAUTHENTICATED" }); return; }
  const nonce = randomBytes(32).toString("hex");
  const verifier = randomBytes(48).toString("base64url");
  await db.delete(states).where(lt(states.expiresAt, new Date()));
  await db.delete(states).where(and(eq(states.userId, req.authUser!.id), eq(states.accountId, account.id)));
  await db.insert(states).values({ nonce: sha256(nonce), userId: req.authUser!.id, accountId: account.id,
    sessionHash: req.sessionTokenHash, verifierEncrypted: encryptSecret(verifier),
    configurationFingerprint: microsoftConfigurationFingerprint(config), senderFingerprint: fingerprint(account),
    expiresAt: new Date(Date.now() + 10 * 60_000) });
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri,
    response_mode: "query", scope: MICROSOFT_SCOPES, state: nonce, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), prompt: "select_account",
    login_hint: account.fromEmail }).toString();
  res.set("Cache-Control", "no-store").json(AuthorizeMicrosoftSenderResponse.parse({ authorizationUrl: url.toString() }));
});

router.get("/sending/microsoft/oauth/callback", requireUserRole, async (req, res) => {
  const base = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
  let returnAccountId = "";
  const done = (result: string) => res.redirect(303, `${base}/sending-settings?${new URLSearchParams({ microsoft: result, ...(returnAccountId ? { accountId: returnAccountId } : {}) })}`);
  res.set("Cache-Control", "no-store");
  const nonce = typeof req.query.state === "string" ? req.query.state : "";
  if (!/^[0-9a-f]{64}$/.test(nonce) || !req.sessionTokenHash) { done("expired"); return; }
  const [state] = await db.delete(states).where(and(eq(states.nonce, sha256(nonce)), eq(states.userId, req.authUser!.id),
    eq(states.sessionHash, req.sessionTokenHash), gt(states.expiresAt, new Date()))).returning();
  if (!state) { done("expired"); return; }
  returnAccountId = state.accountId;
  if (req.query.error) { done(req.query.error === "access_denied" ? "consent-required" : "failed"); return; }
  const config = await getMicrosoftConfiguration();
  if (!config?.enabled || state.configurationFingerprint !== microsoftConfigurationFingerprint(config)) { done("settings-changed"); return; }
  if (typeof req.query.code !== "string" || req.query.code.length > 10_000) { done("failed"); return; }
  try {
    const token = await exchangeMicrosoftToken(config, { grant_type: "authorization_code", code: req.query.code,
      redirect_uri: config.redirectUri, code_verifier: decryptSecret(state.verifierEncrypted) });
    if (!token.refreshToken) { done("consent-required"); return; }
    const profile = await microsoftProfile(token.accessToken);
    const outcome = await db.transaction(async tx => {
      const [sender] = await tx.select().from(senders).where(and(eq(senders.id, state.accountId), eq(senders.userId, state.userId))).for("update");
      if (!sender || sender.provider !== "microsoft_365" || fingerprint(sender) !== state.senderFingerprint) return "settings-changed";
      if (sender.fromEmail.toLowerCase() !== profile.mailbox) return "mailbox-mismatch";
      const values = { accountId: sender.id, userId: state.userId, mailbox: profile.mailbox, clientId: config.clientId,
        accessTokenEncrypted: encryptSecret(token.accessToken), refreshTokenEncrypted: encryptSecret(token.refreshToken!),
        expiresAt: token.expiresAt, updatedAt: new Date() };
      await tx.insert(connections).values(values).onConflictDoUpdate({ target: connections.accountId, set: values });
      await tx.update(senders).set({ authenticationMethod: "microsoft_oauth", connectionCheckAt: new Date(),
        connectionCheckStatus: "success", verifiedAt: null, updatedAt: new Date() }).where(eq(senders.id, sender.id));
      return "connected";
    });
    done(outcome);
  } catch {
    req.log.warn({ category: "microsoft_sender_authorization_failed" }, "Microsoft sender authorization failed");
    done("failed");
  }
});
router.delete("/sending/accounts/:accountId/microsoft/connection", requireUserRole, async (req, res) => {
  const parsed = GetMicrosoftSenderConnectionParams.safeParse(req.params);
  const account = parsed.success ? await accountFor(parsed.data.accountId, req.authUser!.id) : null;
  if (!account) { res.status(404).json({ error: "Sender account not found.", code: "SENDER_ACCOUNT_NOT_FOUND" }); return; }
  await db.transaction(async tx => {
    await tx.select({ id: senders.id }).from(senders).where(eq(senders.id, account.id)).for("update");
    await tx.delete(connections).where(and(eq(connections.accountId, account.id), eq(connections.userId, req.authUser!.id)));
    await tx.update(senders).set({ authenticationMethod: "password", verifiedAt: null,
      connectionCheckStatus: null, connectionCheckAt: null, updatedAt: new Date() }).where(eq(senders.id, account.id));
  });
  res.json(GetMicrosoftSenderConnectionResponse.parse({ configured: (await microsoftConfigurationStatus()).configured, connected: false, mailbox: null }));
});
export default router;
