import { sql } from "drizzle-orm";
import { apiErrorDiagnosticsTable, db } from "@workspace/db";

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 6_000;

export type SafeApiErrorDetails = {
  errorName: string;
  rootErrorName: string | null;
  errorCode: string | null;
  databaseSchema: string | null;
  databaseTable: string | null;
  databaseColumn: string | null;
  databaseConstraint: string | null;
  errorMessage: string | null;
  stackTrace: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function rootCause(error: unknown): unknown {
  let current = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 4; depth += 1) {
    const record = asRecord(current);
    const cause = record?.cause;
    if (!cause || typeof cause !== "object" || seen.has(cause)) break;
    seen.add(cause);
    current = cause;
  }
  return current;
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /\b((?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/(Key\s*\([^)]+\)\s*=\s*)\([^)]+\)/gi, "$1([redacted])")
    .replace(
      /(invalid input syntax for type [^:]+:\s*)["'][^"']*["']/gi,
      '$1"[redacted]"',
    )
    .replace(/(?:postgres(?:ql)?|mysql):\/\/[^\s"'<>]+/gi, "[redacted database URL]")
    .replace(/([?&](?:token|code|password|secret|key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\bparams?\s*[:=]\s*\[[\s\S]*?\]/gi, "params: [redacted]")
    .replace(/\bparameters?\s*[:=]\s*[\s\S]*$/gi, "parameters: [redacted]")
    .slice(0, maxLength);
}

function safeMetadata(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(value)) return null;
  return value;
}

export function describeApiError(error: unknown): SafeApiErrorDetails {
  const outer = asRecord(error);
  const root = asRecord(rootCause(error));
  const errorName =
    typeof outer?.name === "string" && outer.name
      ? outer.name.slice(0, 160)
      : error instanceof Error
        ? error.name.slice(0, 160)
        : "UnknownError";
  const stack = error instanceof Error ? error.stack : null;
  const stackFrames = typeof stack === "string"
    ? stack.split("\n").slice(1, 28).join("\n")
    : null;

  return {
    errorName,
    rootErrorName:
      typeof root?.name === "string" && root.name
        ? root.name.slice(0, 160)
        : null,
    errorCode: safeMetadata(root, "code") ?? safeMetadata(outer, "code"),
    databaseSchema: safeMetadata(root, "schema"),
    databaseTable: safeMetadata(root, "table"),
    databaseColumn: safeMetadata(root, "column"),
    databaseConstraint: safeMetadata(root, "constraint"),
    errorMessage: safeText(root?.message ?? outer?.message, MAX_MESSAGE_LENGTH),
    stackTrace: safeText(stackFrames, MAX_STACK_LENGTH),
  };
}

export function sanitizeDiagnosticPath(path: string): string {
  return path.split("?")[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .slice(0, 255);
}

export async function storeApiErrorDiagnostic(input: {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  details: SafeApiErrorDetails;
}): Promise<void> {
  await db.insert(apiErrorDiagnosticsTable).values({
    id: input.id,
    method: input.method.slice(0, 10),
    path: sanitizeDiagnosticPath(input.path),
    statusCode: input.statusCode,
    ...input.details,
  });

  await db.execute(sql`
    DELETE FROM api_error_diagnostics
    WHERE occurred_at < now() - interval '14 days'
  `);
  await db.execute(sql`
    DELETE FROM api_error_diagnostics
    WHERE id IN (
      SELECT id
      FROM api_error_diagnostics
      ORDER BY occurred_at DESC, id DESC
      OFFSET 500
    )
  `);
}
