import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { apiErrorDiagnosticsTable, db, systemConfigurationTable } from "@workspace/db";
import { shouldCaptureApiErrorDiagnostics } from "../lib/platform-settings";
import { describeApiError } from "../lib/api-error-diagnostics";
import { encryptSecret } from "../lib/security";
import { writeAuditLog } from "../lib/audit";
import {
  createRemoteDiagnosticsSignature,
  getRemoteDiagnosticsClientSecret,
  getRemoteDiagnosticsSecret,
  REMOTE_DIAGNOSTICS_PATH,
  REMOTE_DIAGNOSTICS_CONFIGURATION_KEY,
  updateRemoteDiagnosticsSecretCache,
  verifyRemoteDiagnosticsSignature,
} from "../lib/remote-diagnostics-auth";
import { requireSuperadmin } from "../lib/session";

const router: IRouter = Router();
const EXPECTED_PRODUCTION_HOST = "mailflow.taskone.world";
const MAX_REMOTE_ERRORS = 20;
const MAX_NONCE_AGE_MS = 2 * 60_000;
const usedNonces = new Map<string, number>();

type SafeFailure = {
  errorName: string;
  rootErrorName: string | null;
  errorCode: string | null;
  databaseSchema: string | null;
  databaseTable: string | null;
  databaseColumn: string | null;
  databaseConstraint: string | null;
  errorMessage: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(value: unknown, maxLength = 2_000): string | null {
  return typeof value === "string" ? value.slice(0, maxLength) : null;
}

function safeFailure(error: unknown): SafeFailure {
  const details = describeApiError(error);
  return {
    errorName: details.errorName,
    rootErrorName: details.rootErrorName,
    errorCode: details.errorCode,
    databaseSchema: details.databaseSchema,
    databaseTable: details.databaseTable,
    databaseColumn: details.databaseColumn,
    databaseConstraint: details.databaseConstraint,
    errorMessage: details.errorMessage,
  };
}

function sanitizeRemoteFailure(value: unknown): SafeFailure | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    errorName: safeString(record.errorName, 160) ?? "UnknownError",
    rootErrorName: safeString(record.rootErrorName, 160),
    errorCode: safeString(record.errorCode, 40),
    databaseSchema: safeString(record.databaseSchema, 128),
    databaseTable: safeString(record.databaseTable, 128),
    databaseColumn: safeString(record.databaseColumn, 128),
    databaseConstraint: safeString(record.databaseConstraint, 128),
    errorMessage: safeString(record.errorMessage),
  };
}

function sanitizeRemoteReport(value: unknown): Record<string, unknown> | null {
  const report = asRecord(value);
  const database = asRecord(report?.database);
  const diagnostics = asRecord(report?.diagnostics);
  if (
    typeof report?.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(report.checkedAt)) ||
    (report.status !== "ok" && report.status !== "degraded") ||
    typeof database?.reachable !== "boolean" ||
    typeof diagnostics?.captureEnabled !== "boolean" ||
    !Array.isArray(diagnostics.recentErrors) ||
    !Array.isArray(report.issues)
  ) {
    return null;
  }

  const recentErrors = diagnostics.recentErrors.slice(0, MAX_REMOTE_ERRORS).flatMap((value) => {
    const item = asRecord(value);
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.occurredAt !== "string" ||
      typeof item.method !== "string" ||
      typeof item.path !== "string" ||
      typeof item.statusCode !== "number" ||
      typeof item.errorName !== "string"
    ) {
      return [];
    }
    return [{
      id: item.id.slice(0, 64),
      occurredAt: item.occurredAt.slice(0, 64),
      method: item.method.slice(0, 10),
      path: item.path.slice(0, 255),
      statusCode: item.statusCode,
      errorName: item.errorName.slice(0, 160),
      rootErrorName: safeString(item.rootErrorName, 160),
      errorCode: safeString(item.errorCode, 40),
      databaseSchema: safeString(item.databaseSchema, 128),
      databaseTable: safeString(item.databaseTable, 128),
      databaseColumn: safeString(item.databaseColumn, 128),
      databaseConstraint: safeString(item.databaseConstraint, 128),
      errorMessage: safeString(item.errorMessage),
      stackTrace: safeString(item.stackTrace, 6_000),
    }];
  });

  return {
    checkedAt: report.checkedAt.slice(0, 64),
    status: report.status,
    database: {
      reachable: database.reachable,
      failure: sanitizeRemoteFailure(database.failure),
    },
    diagnostics: {
      captureEnabled: diagnostics.captureEnabled,
      tablePresent: typeof diagnostics.tablePresent === "boolean" ? diagnostics.tablePresent : null,
      readable: typeof diagnostics.readable === "boolean" ? diagnostics.readable : null,
      failure: sanitizeRemoteFailure(diagnostics.failure),
      recentErrors,
    },
    issues: report.issues
      .filter((issue): issue is string => typeof issue === "string")
      .slice(0, 20)
      .map((issue) => issue.slice(0, 300)),
  };
}

function consumeNonce(nonce: string, nowMs: number): boolean {
  for (const [seenNonce, expiresAt] of usedNonces) {
    if (expiresAt <= nowMs) usedNonces.delete(seenNonce);
  }
  if (usedNonces.has(nonce) || usedNonces.size >= 5_000) return false;
  usedNonces.set(nonce, nowMs + MAX_NONCE_AGE_MS);
  return true;
}

async function verifyServiceRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const secret = await getRemoteDiagnosticsSecret();
  if (!secret) {
    res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
    return;
  }

  const timestamp = req.get("x-mailflow-diagnostics-timestamp") ?? "";
  const nonce = req.get("x-mailflow-diagnostics-nonce") ?? "";
  const signature = req.get("x-mailflow-diagnostics-signature") ?? "";
  const nowMs = Date.now();
  if (
    !verifyRemoteDiagnosticsSignature({ secret, timestamp, nonce, signature, nowMs }) ||
    !consumeNonce(nonce, nowMs)
  ) {
    res.status(401).json({ error: "Signed diagnostics access is required.", code: "INVALID_SIGNATURE" });
    return;
  }
  next();
}

async function createProductionSummary() {
  const database: {
    reachable: boolean;
    failure: SafeFailure | null;
  } = { reachable: false, failure: null };
  const diagnostics: {
    captureEnabled: boolean;
    tablePresent: boolean | null;
    readable: boolean | null;
    failure: SafeFailure | null;
    recentErrors: Array<Record<string, unknown>>;
  } = {
    captureEnabled: shouldCaptureApiErrorDiagnostics(),
    tablePresent: null,
    readable: null,
    failure: null,
    recentErrors: [],
  };

  try {
    await db.execute(sql`SELECT 1`);
    database.reachable = true;
  } catch (error) {
    database.failure = safeFailure(error);
  }

  if (database.reachable) {
    try {
      const tableStatus = await db.execute(sql`
        SELECT to_regclass('public.api_error_diagnostics') IS NOT NULL AS present
      `);
      diagnostics.tablePresent = tableStatus.rows[0]?.["present"] === true;
      if (diagnostics.tablePresent) {
        try {
          const rows = await db
            .select()
            .from(apiErrorDiagnosticsTable)
            .orderBy(desc(apiErrorDiagnosticsTable.occurredAt), desc(apiErrorDiagnosticsTable.id))
            .limit(MAX_REMOTE_ERRORS);
          diagnostics.readable = true;
          diagnostics.recentErrors = rows.map((row) => ({
            ...row,
            occurredAt: row.occurredAt.toISOString(),
          }));
        } catch (error) {
          diagnostics.readable = false;
          diagnostics.failure = safeFailure(error);
        }
      } else {
        diagnostics.readable = false;
      }
    } catch (error) {
      diagnostics.failure = safeFailure(error);
    }
  }

  const issues: string[] = [];
  if (!database.reachable) issues.push("The production API cannot reach its database.");
  if (diagnostics.tablePresent === false) {
    issues.push("The API error diagnostics migration is missing from the database used by this API.");
  }
  if (diagnostics.readable === false && diagnostics.tablePresent === true) {
    issues.push("The diagnostics table exists but could not be read; check its columns and database permissions.");
  }
  if (!diagnostics.captureEnabled) {
    issues.push("Detailed API error capture is currently disabled.");
  }

  return {
    checkedAt: new Date().toISOString(),
    status: issues.some((issue) => !issue.includes("capture is currently disabled")) ? "degraded" : "ok",
    database,
    diagnostics,
    issues,
  };
}

router.get(
  REMOTE_DIAGNOSTICS_PATH.replace("/api", ""),
  verifyServiceRequest,
  async (_req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await createProductionSummary());
  },
);

router.get(
  "/admin/remote-diagnostics/configuration",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.REPL_ID) {
      res.json({
        role: "caller",
        configured: Boolean(getRemoteDiagnosticsClientSecret()),
        updatedAt: null,
      });
      return;
    }
    const [row] = await db
      .select({
        value: systemConfigurationTable.value,
        updatedAt: systemConfigurationTable.updatedAt,
      })
      .from(systemConfigurationTable)
      .where(eq(systemConfigurationTable.key, REMOTE_DIAGNOSTICS_CONFIGURATION_KEY))
      .limit(1);
    const value = row?.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? row.value as Record<string, unknown>
      : null;
    res.json({
      role: "verifier",
      configured: typeof value?.secretEncrypted === "string" && value.secretEncrypted.length > 0,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
  },
);

router.put(
  "/admin/remote-diagnostics/configuration",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    if (process.env.REPL_ID) {
      res.status(403).json({
        error: "The production verifier key is managed on the self-hosted production app.",
        code: "PRODUCTION_VERIFIER_CONFIGURATION_ONLY",
      });
      return;
    }
    const secret = typeof req.body?.hmacSecret === "string"
      ? req.body.hmacSecret.trim()
      : "";
    if (!/^[0-9a-f]{64}$/i.test(secret)) {
      res.status(400).json({
        error: "Enter a 64-character hexadecimal key generated for diagnostics.",
        code: "INVALID_REMOTE_DIAGNOSTICS_KEY",
      });
      return;
    }

    const value = { secretEncrypted: encryptSecret(secret) };
    const updatedAt = new Date();
    await db
      .insert(systemConfigurationTable)
      .values({
        key: REMOTE_DIAGNOSTICS_CONFIGURATION_KEY,
        value,
        updatedBy: req.authUser!.id,
      })
      .onConflictDoUpdate({
        target: systemConfigurationTable.key,
        set: { value, updatedBy: req.authUser!.id, updatedAt },
      });
    updateRemoteDiagnosticsSecretCache(secret);
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "remote_diagnostics_key.updated",
      entity: "system_configuration",
      entityId: REMOTE_DIAGNOSTICS_CONFIGURATION_KEY,
      ipAddress: req.ip?.slice(0, 80) ?? null,
      metadata: { configured: true },
    });
    res.json({ configured: true, updatedAt: updatedAt.toISOString() });
  },
);

router.delete(
  "/admin/remote-diagnostics/configuration",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    if (process.env.REPL_ID) {
      res.status(403).json({
        error: "The production verifier key is managed on the self-hosted production app.",
        code: "PRODUCTION_VERIFIER_CONFIGURATION_ONLY",
      });
      return;
    }
    await db
      .delete(systemConfigurationTable)
      .where(eq(systemConfigurationTable.key, REMOTE_DIAGNOSTICS_CONFIGURATION_KEY));
    updateRemoteDiagnosticsSecretCache(null);
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "remote_diagnostics_key.removed",
      entity: "system_configuration",
      entityId: REMOTE_DIAGNOSTICS_CONFIGURATION_KEY,
      ipAddress: req.ip?.slice(0, 80) ?? null,
      metadata: {},
    });
    res.status(204).end();
  },
);

router.get(
  "/admin/remote-diagnostics",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    const secret = getRemoteDiagnosticsClientSecret();
    const origin = process.env.MAILFLOW_REMOTE_DIAGNOSTICS_ORIGIN?.trim();
    let targetUrl: URL;
    try {
      targetUrl = new URL(origin ?? "");
    } catch {
      res.status(503).json({
        error: "Remote production diagnostics are not configured.",
        code: "REMOTE_DIAGNOSTICS_NOT_CONFIGURED",
      });
      return;
    }
    if (
      !secret ||
      targetUrl.protocol !== "https:" ||
      targetUrl.hostname !== EXPECTED_PRODUCTION_HOST ||
      targetUrl.port ||
      targetUrl.username ||
      targetUrl.password ||
      targetUrl.pathname !== "/" ||
      targetUrl.search ||
      targetUrl.hash
    ) {
      res.status(503).json({
        error: "Remote production diagnostics are not configured correctly.",
        code: "REMOTE_DIAGNOSTICS_NOT_CONFIGURED",
      });
      return;
    }

    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = createRemoteDiagnosticsSignature(secret, timestamp, nonce);
    try {
      const upstream = await fetch(`${targetUrl.origin}${REMOTE_DIAGNOSTICS_PATH}`, {
        method: "GET",
        headers: {
          "x-mailflow-diagnostics-timestamp": timestamp,
          "x-mailflow-diagnostics-nonce": nonce,
          "x-mailflow-diagnostics-signature": signature,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!upstream.ok) {
        req.log.warn({ upstreamStatus: upstream.status }, "Remote diagnostics request was rejected");
        res.status(502).json({
          error: "Production rejected or could not complete the signed diagnostics request.",
          code: "REMOTE_DIAGNOSTICS_UPSTREAM_ERROR",
          upstreamStatus: upstream.status,
        });
        return;
      }

      const rawBody = await upstream.text();
      if (Buffer.byteLength(rawBody, "utf8") > 750_000) {
        res.status(502).json({
          error: "Production returned an unexpectedly large diagnostics response.",
          code: "REMOTE_DIAGNOSTICS_RESPONSE_TOO_LARGE",
        });
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody) as unknown;
      } catch {
        payload = null;
      }
      const safePayload = sanitizeRemoteReport(payload);
      if (!safePayload) {
        res.status(502).json({
          error: "Production returned an invalid diagnostics response.",
          code: "REMOTE_DIAGNOSTICS_INVALID_RESPONSE",
        });
        return;
      }
      res.json(safePayload);
    } catch (error) {
      req.log.warn(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Remote production diagnostics could not be reached",
      );
      res.status(502).json({
        error: "The production diagnostics endpoint could not be reached.",
        code: "REMOTE_DIAGNOSTICS_UNREACHABLE",
      });
    }
  },
);

export default router;
