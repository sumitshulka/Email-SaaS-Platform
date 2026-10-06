import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  type User,
  userSessionsTable,
  usersTable,
} from "@workspace/db";
import type { NextFunction, Request, Response } from "express";
import { createHmac } from "node:crypto";
import { getPlatformSettings } from "./platform-settings";
import { constantTimeEqual, randomToken, requireSessionSecret, sha256 } from "./security";

const SESSION_COOKIE = "mailflow_session";

function sessionCookieOptions(req: Request, expires?: Date) {
  const secure = process.env.NODE_ENV === "production" || req.secure;
  const embeddedPreview = process.env.NODE_ENV !== "production" && req.secure;

  return {
    httpOnly: true,
    secure,
    sameSite: embeddedPreview ? ("none" as const) : ("lax" as const),
    path: "/",
    ...(expires ? { expires } : {}),
  };
}

declare global {
  namespace Express {
    interface Request {
      authUser?: User;
      sessionTokenHash?: string;
    }
  }
}

function signSessionToken(token: string): string {
  const signature = createHmac("sha256", requireSessionSecret())
    .update(`session:${token}`)
    .digest("base64url");
  return `${token}.${signature}`;
}

function verifyCookie(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const token = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = signSessionToken(token).slice(token.length + 1);
  return constantTimeEqual(signature, expected) ? token : null;
}

export async function createUserSession(
  user: User,
  req: Request,
  res: Response,
): Promise<void> {
  const token = randomToken(48);
  const tokenHash = sha256(token);
  const settings = await getPlatformSettings();
  const expiresAt = new Date(
    Date.now() + settings.sessionDurationHours * 60 * 60 * 1000,
  );

  await db.insert(userSessionsTable).values({
    userId: user.id,
    tokenHash,
    ipAddress: req.ip?.slice(0, 80) ?? null,
    userAgent: req.get("user-agent")?.slice(0, 512) ?? null,
    expiresAt,
  });

  res.cookie(
    SESSION_COOKIE,
    signSessionToken(token),
    sessionCookieOptions(req, expiresAt),
  );
}

export async function revokeCurrentSession(req: Request): Promise<void> {
  if (!req.sessionTokenHash) return;
  await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(userSessionsTable.tokenHash, req.sessionTokenHash));
}

export function clearSessionCookie(res: Response, req: Request): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req));
}

export async function loadSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = verifyCookie(req.cookies?.[SESSION_COOKIE] as string | undefined);
    if (!token) {
      next();
      return;
    }

    const tokenHash = sha256(token);
    const [row] = await db
      .select({ user: usersTable })
      .from(userSessionsTable)
      .innerJoin(usersTable, eq(userSessionsTable.userId, usersTable.id))
      .where(
        and(
          eq(userSessionsTable.tokenHash, tokenHash),
          isNull(userSessionsTable.revokedAt),
          gt(userSessionsTable.expiresAt, new Date()),
          isNull(usersTable.deletedAt),
          eq(usersTable.active, true),
        ),
      )
      .limit(1);

    if (row) {
      req.authUser = row.user;
      req.sessionTokenHash = tokenHash;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function enforceSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    req.method === "POST" &&
    req.path === "/api/public/unsubscribe" &&
    req.body?.["List-Unsubscribe"] === "One-Click"
  ) {
    next();
    return;
  }
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }
  try {
    const originHost = new URL(origin).host;
    if (originHost !== req.get("host")) {
      res.status(403).json({
        error: "Cross-origin requests are not allowed.",
        code: "CROSS_ORIGIN_REQUEST",
      });
      return;
    }
    next();
  } catch {
    res.status(403).json({
      error: "Invalid request origin.",
      code: "CROSS_ORIGIN_REQUEST",
    });
  }
}

const maintenanceAllowedRequests = new Set([
  "GET /api/healthz",
  "GET /api/maintenance/status",
  "POST /api/auth/login",
  "GET /api/auth/me",
  "POST /api/auth/logout",
  "POST /api/webhooks/razorpay",
  "POST /api/public/unsubscribe",
]);

export async function enforcePlatformMaintenance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const settings = await getPlatformSettings();
    if (
      !settings.maintenanceMode ||
      req.authUser ||
      maintenanceAllowedRequests.has(`${req.method} ${req.path}`)
    ) {
      next();
      return;
    }
    res.status(503).json({
      error: "Mailflow is temporarily unavailable while maintenance is in progress.",
      code: "MAINTENANCE_MODE",
    });
  } catch (error) {
    next(error);
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.authUser) {
    res.status(401).json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" });
    return;
  }
  next();
}

export function requireUserRole(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.authUser) {
    res.status(401).json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" });
    return;
  }
  if (req.authUser.role !== "USER") {
    res.status(403).json({ error: "This area is for customer accounts.", code: "FORBIDDEN" });
    return;
  }
  if (req.authUser.mustChangeCredentials) {
    res.status(403).json({ error: "Change your initial credentials to continue.", code: "CREDENTIAL_CHANGE_REQUIRED" });
    return;
  }
  next();
}

export function requireSuperadmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.authUser) {
    res.status(401).json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" });
    return;
  }
  if (req.authUser.role !== "SUPERADMIN") {
    res.status(403).json({ error: "Superadmin access is required.", code: "FORBIDDEN" });
    return;
  }
  if (req.authUser.mustChangeCredentials) {
    res.status(403).json({ error: "Change your initial credentials to continue.", code: "CREDENTIAL_CHANGE_REQUIRED" });
    return;
  }
  next();
}

export function tokenSignatureIsValid(token: string, signature: string): boolean {
  const expected = createHmac("sha256", requireSessionSecret())
    .update(`session:${token}`)
    .digest("base64url");
  return constantTimeEqual(signature, expected);
}