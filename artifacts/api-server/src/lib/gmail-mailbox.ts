import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import {
  Router,
  type IRouter,
  type Request,
  type Response as ExpressResponse,
} from "express";
import {
  db,
  gmailOAuthStatesTable,
  gmailMailboxConnectionsTable,
} from "@workspace/db";
import { getGoogleOAuthConfiguration } from "./google-oauth-configuration";
import { decryptSecret, encryptSecret, hmac, randomToken, constantTimeEqual } from "./security";
import { logger } from "./logger";
import { requireUserRole } from "./session";
import {
  GmailApiError,
  GmailHistoryExpiredError,
  syncGmailHistory,
} from "./gmail-api";
import { ingestDeliveryReports } from "./delivery-report-ingestion";

const POLL_INTERVAL_MS = 2 * 60_000;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60_000;
const OAUTH_COOKIE = "mailflow_gmail_oauth_state";
const OAUTH_STATE_PURPOSE = "gmail-mailbox-oauth-state";
const OAUTH_COOKIE_PATH = "/api/sending/gmail/oauth/callback";
let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerRunning = false;

function oauthCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  };
}

function signedOAuthState(userId: string, nonce: string, expiresAt: number) {
  const payload = Buffer.from(
    JSON.stringify({ userId, nonce, expiresAt }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${hmac(payload, OAUTH_STATE_PURPOSE)}`;
}

function parseOAuthState(state: string, cookieNonce: string | undefined) {
  const [payload, signature, ...extra] = state.split(".");
  if (!payload || !signature || extra.length || !cookieNonce) return null;
  if (!constantTimeEqual(signature, hmac(payload, OAUTH_STATE_PURPOSE))) return null;
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { userId?: unknown; nonce?: unknown; expiresAt?: unknown };
    if (
      typeof value.userId !== "string" ||
      typeof value.nonce !== "string" ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt < Date.now() ||
      !constantTimeEqual(value.nonce, cookieNonce)
    ) {
      return null;
    }
    return {
      userId: value.userId,
      nonce: value.nonce,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

async function consumeOAuthNonce(nonce: string): Promise<boolean> {
  const now = new Date();
  await db
    .delete(gmailOAuthStatesTable)
    .where(lte(gmailOAuthStatesTable.expiresAt, now));
  const [consumed] = await db
    .update(gmailOAuthStatesTable)
    .set({ consumedAt: now })
    .where(
      and(
        eq(gmailOAuthStatesTable.nonce, nonce),
        isNull(gmailOAuthStatesTable.consumedAt),
        gt(gmailOAuthStatesTable.expiresAt, now),
      ),
    )
    .returning({ nonce: gmailOAuthStatesTable.nonce });
  return Boolean(consumed);
}

async function postOAuthForm(
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: globalThis.Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GmailApiError("Could not reach Google's OAuth service.", 0);
  }
  const value = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const code =
      typeof value.error === "string" ? value.error : undefined;
    throw new GmailApiError("Google OAuth authorization failed.", response.status, code);
  }
  return value;
}

async function revokeGoogleToken(token: string): Promise<void> {
  let response: globalThis.Response;
  try {
    response = await fetch(
      `https://oauth2.googleapis.com/revoke?${new URLSearchParams({ token })}`,
      { method: "POST", signal: AbortSignal.timeout(5_000) },
    );
  } catch {
    logger.warn(
      { failureType: "network" },
      "Google grant revocation failed",
    );
    // The local credential is still removed; the user can also revoke access in Google.
    return;
  }
  if (!response.ok) {
    logger.warn(
      { failureType: "http", statusCode: response.status },
      "Google grant revocation failed",
    );
  }
}

function redirectToSettings(
  req: Request,
  res: ExpressResponse,
  result: "connected" | "failed",
  callbackUri?: string | null,
) {
  const callback = callbackUri ? new URL(callbackUri) : null;
  const basePath = process.env.BASE_PATH?.replace(/\/+$/, "") ?? "";
  const callbackSuffix = "/api/sending/gmail/oauth/callback";
  const settingsPath = callback?.pathname.endsWith(callbackSuffix)
    ? `${callback.pathname.slice(0, -callbackSuffix.length)}/sending-settings`
    : `${basePath}/sending-settings`;
  const target = new URL(
    settingsPath.startsWith("/") ? settingsPath : `/${settingsPath}`,
    callback?.origin ?? `${req.protocol}://${req.get("host")}`,
  );
  target.searchParams.set("gmail", result);
  res.redirect(303, target.toString());
}

export function createGmailMailboxRouter(): IRouter {
  const router: IRouter = Router();

  router.get(
  "/sending/gmail/connection",
  requireUserRole,
  async (req, res): Promise<void> => {
    const userId = req.authUser!.id;
    const [connection] = await db
      .select()
      .from(gmailMailboxConnectionsTable)
      .where(eq(gmailMailboxConnectionsTable.userId, userId))
      .limit(1);
    const config = await getGoogleOAuthConfiguration();
    res.json({
      configured: config !== null,
      redirectUri: null,
      connected: Boolean(connection),
      emailAddress: connection?.emailAddress ?? null,
      syncStatus: connection?.syncStatus ?? "disconnected",
      lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: connection?.lastSuccessAt?.toISOString() ?? null,
      nextSyncAt: connection?.nextSyncAt?.toISOString() ?? null,
      lastError: connection?.lastError ?? null,
      pollIntervalSeconds: POLL_INTERVAL_MS / 1000,
    });
  },
);

  router.post(
  "/sending/gmail/connect",
  requireUserRole,
  async (req, res): Promise<void> => {
    const config = await getGoogleOAuthConfiguration();
    if (!config) {
      res.status(503).json({
        error: "Gmail bounce monitoring is not available yet. Contact the platform administrator.",
        code: "GMAIL_OAUTH_NOT_CONFIGURED",
      });
      return;
    }
    const nonce = randomToken(24);
    const expiresAt = Date.now() + OAUTH_STATE_MAX_AGE_MS;
    const state = signedOAuthState(
      req.authUser!.id,
      nonce,
      expiresAt,
    );
    await db.insert(gmailOAuthStatesTable).values({
      nonce,
      expiresAt: new Date(expiresAt),
    });
    res.cookie(OAUTH_COOKIE, nonce, oauthCookieOptions(req.secure));
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.searchParams.set("client_id", config.clientId);
    authorization.searchParams.set("redirect_uri", config.redirectUri);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("scope", "openid email https://www.googleapis.com/auth/gmail.readonly");
    authorization.searchParams.set("access_type", "offline");
    authorization.searchParams.set("include_granted_scopes", "true");
    authorization.searchParams.set("prompt", "consent");
    authorization.searchParams.set("state", state);
    res.json({ authorizationUrl: authorization.toString() });
  },
);

  router.get(
  "/sending/gmail/oauth/callback",
  requireUserRole,
  async (req, res): Promise<void> => {
    const config = await getGoogleOAuthConfiguration();
    const state =
      typeof req.query.state === "string" ? req.query.state : "";
    const params = parseOAuthState(state, req.cookies?.[OAUTH_COOKIE]);
    res.clearCookie(OAUTH_COOKIE, {
      httpOnly: true,
      secure: req.secure,
      sameSite: "lax",
      path: OAUTH_COOKIE_PATH,
    });
    if (
      !config ||
      !params ||
      params.userId !== req.authUser!.id ||
      typeof req.query.code !== "string" ||
      req.query.error
    ) {
      redirectToSettings(req, res, "failed", config?.redirectUri);
      return;
    }
    if (!(await consumeOAuthNonce(params.nonce))) {
      redirectToSettings(req, res, "failed", config?.redirectUri);
      return;
    }

    let identityVerified = false;
    let newlyIssuedGoogleToken: string | null = null;
    let hadSavedConnection = false;
    try {
      const [savedConnection] = await db
        .select({ userId: gmailMailboxConnectionsTable.userId })
        .from(gmailMailboxConnectionsTable)
        .where(eq(gmailMailboxConnectionsTable.userId, params.userId))
        .limit(1);
      hadSavedConnection = Boolean(savedConnection);

      const tokenResponse = await postOAuthForm({
        code: req.query.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      });
      const accessToken =
        typeof tokenResponse.access_token === "string"
          ? tokenResponse.access_token
          : null;
      let refreshToken =
        typeof tokenResponse.refresh_token === "string"
          ? tokenResponse.refresh_token
          : null;
      newlyIssuedGoogleToken = refreshToken ?? accessToken;
      if (!accessToken) throw new Error("OAuth response omitted its access token.");

      const userInfoResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!userInfoResponse.ok) throw new Error("Could not verify the Google account.");
      const userInfo = (await userInfoResponse.json()) as {
        email?: string;
        email_verified?: boolean;
      };
      if (!userInfo.email || userInfo.email_verified !== true) {
        throw new Error("Google did not verify the mailbox email address.");
      }

      const profileResponse = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!profileResponse.ok) throw new Error("Could not read Gmail mailbox metadata.");
      const profile = (await profileResponse.json()) as {
        emailAddress?: string;
        historyId?: string;
      };
      const emailAddress = profile.emailAddress?.trim().toLowerCase();
      if (
        !emailAddress ||
        emailAddress !== userInfo.email.trim().toLowerCase() ||
        !profile.historyId
      ) {
        throw new Error("Google account and Gmail mailbox identity did not match.");
      }
      identityVerified = true;

      const [existing] = await db
        .select()
        .from(gmailMailboxConnectionsTable)
        .where(eq(gmailMailboxConnectionsTable.userId, params.userId))
        .limit(1);
      if (!refreshToken && existing?.emailAddress === emailAddress) {
        refreshToken = decryptSecret(existing.refreshTokenEncrypted);
      }
      if (!refreshToken) {
        throw new Error("Google did not provide a refresh token. Reconnect with consent.");
      }
      if (existing && existing.emailAddress !== emailAddress) {
        await revokeGoogleToken(decryptSecret(existing.refreshTokenEncrypted));
      }
      const now = new Date();
      await db
        .insert(gmailMailboxConnectionsTable)
        .values({
          userId: params.userId,
          emailAddress,
          refreshTokenEncrypted: encryptSecret(refreshToken),
          historyId: profile.historyId,
          syncStatus: "connected",
          lastSyncAt: null,
          lastSuccessAt: null,
          nextSyncAt: now,
          leaseExpiresAt: null,
          lastError: null,
        })
        .onConflictDoUpdate({
          target: gmailMailboxConnectionsTable.userId,
          set: {
            emailAddress,
            refreshTokenEncrypted: encryptSecret(refreshToken),
            historyId: profile.historyId,
            syncStatus: "connected",
            lastSyncAt: null,
            lastSuccessAt: null,
            nextSyncAt: now,
            leaseExpiresAt: null,
            lastError: null,
            updatedAt: now,
          },
        });
      redirectToSettings(req, res, "connected", config.redirectUri);
    } catch (error) {
      if (!identityVerified && newlyIssuedGoogleToken && !hadSavedConnection) {
        await revokeGoogleToken(newlyIssuedGoogleToken);
      }
      logger.warn(
        {
          userId: params.userId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Gmail mailbox connection failed",
      );
      redirectToSettings(req, res, "failed", config.redirectUri);
    }
  },
);

  router.delete(
  "/sending/gmail/connection",
  requireUserRole,
  async (req, res): Promise<void> => {
    const [connection] = await db
      .delete(gmailMailboxConnectionsTable)
      .where(eq(gmailMailboxConnectionsTable.userId, req.authUser!.id))
      .returning({ refreshTokenEncrypted: gmailMailboxConnectionsTable.refreshTokenEncrypted });
    if (connection) {
      try {
        await revokeGoogleToken(decryptSecret(connection.refreshTokenEncrypted));
      } catch {
        // Local disconnection and deletion are authoritative for Mailflow.
      }
    }
    res.status(204).end();
  },
  );

  return router;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const config = await getGoogleOAuthConfiguration();
  if (!config) throw new Error("Google OAuth configuration is incomplete.");
  const response = await postOAuthForm({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (typeof response.access_token !== "string") {
    throw new GmailApiError("Google did not return an access token.", 502);
  }
  return response.access_token;
}

function syncFailureStatus(error: unknown): {
  status: string;
  message: string;
  delay: number;
} {
  if (error instanceof GmailHistoryExpiredError) {
    return {
      status: "history_expired",
      message:
        "Gmail's history checkpoint expired. Reconnect to establish a new baseline; reports from the gap cannot be recovered automatically.",
      delay: 3650 * 24 * 60 * 60_000,
    };
  }
  if (
    error instanceof GmailApiError &&
    (error.status === 401 || error.providerCode === "invalid_grant")
  ) {
    return {
      status: "reauthorization_required",
      message: "Google authorization expired or was revoked. Reconnect the mailbox.",
      delay: 3650 * 24 * 60 * 60_000,
    };
  }
  const suffix =
    error instanceof GmailApiError && error.status > 0
      ? ` (HTTP ${error.status})`
      : "";
  return {
    status: "error",
    message: `Gmail sync failed${suffix}; Mailflow will retry.`,
    delay: POLL_INTERVAL_MS,
  };
}

export async function syncDueGmailMailboxes(): Promise<void> {
  const now = new Date();
  const due = await db
    .select()
    .from(gmailMailboxConnectionsTable)
    .where(
      and(
        inArray(gmailMailboxConnectionsTable.syncStatus, ["connected", "error"]),
        lte(gmailMailboxConnectionsTable.nextSyncAt, now),
        or(
          isNull(gmailMailboxConnectionsTable.leaseExpiresAt),
          lte(gmailMailboxConnectionsTable.leaseExpiresAt, now),
        ),
      ),
    )
    .limit(20);

  for (const connection of due) {
    const leaseExpiresAt = new Date(Date.now() + 60_000);
    const claimed = await db
      .update(gmailMailboxConnectionsTable)
      .set({ leaseExpiresAt, updatedAt: now })
      .where(
        and(
          eq(gmailMailboxConnectionsTable.id, connection.id),
          inArray(gmailMailboxConnectionsTable.syncStatus, ["connected", "error"]),
          lte(gmailMailboxConnectionsTable.nextSyncAt, now),
          or(
            isNull(gmailMailboxConnectionsTable.leaseExpiresAt),
            lte(gmailMailboxConnectionsTable.leaseExpiresAt, now),
          ),
        ),
      )
      .returning({ id: gmailMailboxConnectionsTable.id });
    if (!claimed.length) continue;

    try {
      const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
      const accessToken = await getAccessToken(refreshToken);
      const result = await syncGmailHistory({
        accessToken,
        startHistoryId: connection.historyId,
        ingest: (reports) =>
          ingestDeliveryReports({
            userId: connection.userId,
            reports,
            verification: "gmail_authorized",
            gmailMailboxConnectionId: connection.id,
          }),
      });
      const completedAt = new Date();
      const lastError =
        result.warningCount || result.unmatched || result.ignored
          ? `Sync completed with ${result.warningCount} notice warning(s), ${result.unmatched} unmatched report(s), and ${result.ignored} ignored report(s).`
          : null;
      await db
        .update(gmailMailboxConnectionsTable)
        .set({
          historyId: result.historyId,
          syncStatus: "connected",
          lastSyncAt: completedAt,
          lastSuccessAt: completedAt,
          nextSyncAt: new Date(completedAt.getTime() + POLL_INTERVAL_MS),
          leaseExpiresAt: null,
          lastError,
          updatedAt: completedAt,
        })
        .where(eq(gmailMailboxConnectionsTable.id, connection.id));
    } catch (error) {
      const failure = syncFailureStatus(error);
      const failedAt = new Date();
      await db
        .update(gmailMailboxConnectionsTable)
        .set({
          syncStatus: failure.status,
          lastSyncAt: failedAt,
          nextSyncAt: new Date(failedAt.getTime() + failure.delay),
          leaseExpiresAt: null,
          lastError: failure.message,
          updatedAt: failedAt,
        })
        .where(eq(gmailMailboxConnectionsTable.id, connection.id));
      logger.warn(
        {
          connectionId: connection.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
          syncStatus: failure.status,
        },
        "Gmail mailbox sync failed",
      );
    }
  }
}

export function startGmailMailboxWorker(): void {
  if (workerTimer) return;
  const tick = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await syncDueGmailMailboxes();
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Gmail mailbox worker tick failed",
      );
    } finally {
      workerRunning = false;
    }
  };
  void tick();
  workerTimer = setInterval(() => void tick(), 30_000);
}

const router = createGmailMailboxRouter();

export default router;