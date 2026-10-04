import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  BackfillMicrosoft365TracesBody,
  BackfillMicrosoft365TracesResponse,
  ConnectMicrosoft365TraceBody,
  ConnectMicrosoft365TraceResponse,
  GetMicrosoft365TraceConnectionResponse,
  TriggerMicrosoft365TraceSyncResponse,
} from "@workspace/api-zod";
import {
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  emailSendAttemptsTable,
  microsoft365MessageTracesTable,
  microsoft365TraceConnectionsTable,
} from "@workspace/db";
import { ingestDeliveryReports } from "./delivery-report-ingestion";
import {
  deriveMicrosoft365Evidence,
  getMicrosoft365TraceDetails,
  listMicrosoft365Traces,
  microsoft365TraceMetadata,
  Microsoft365TraceApiError,
  requestMicrosoft365AccessToken,
} from "./microsoft365-trace-api";
import { decryptSecret, encryptSecret } from "./security";
import { logger } from "./logger";
import { requireUserRole } from "./session";

const router: IRouter = Router();
const POLL_INTERVAL_MS = 60_000;
const LEASE_MS = 180_000;
const MAX_DETAILS_PER_TICK = 4;
const DETAIL_RECHECK_MS = 15 * 60_000;
const MAX_INCREMENTAL_LOOKBACK_MS = 24 * 60 * 60_000;
const MAX_WINDOW_MS = 10 * 24 * 60 * 60_000;
const DEFAULT_ERROR_RETRY_MS = 5 * 60_000;
let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerRunning = false;

type Microsoft365TraceConnection =
  typeof microsoft365TraceConnectionsTable.$inferSelect;
type SafeConnection = Pick<
  Microsoft365TraceConnection,
  | "id"
  | "userId"
  | "tenantId"
  | "clientId"
  | "clientSecretEncrypted"
  | "syncStatus"
  | "backfillStartAt"
  | "backfillEndAt"
  | "pageNextLink"
  | "backfillCompletedAt"
  | "lastSyncAt"
  | "lastSuccessAt"
  | "nextSyncAt"
  | "leaseExpiresAt"
  | "lastError"
>;

function connectionResponse(connection: SafeConnection | null) {
  return {
    configured: Boolean(connection),
    connected: Boolean(connection),
    tenantId: connection?.tenantId ?? null,
    syncStatus: connection?.syncStatus ?? "disconnected",
    source: microsoft365TraceMetadata.source,
    evidenceVerification: microsoft365TraceMetadata.evidenceVerification,
    permission: microsoft365TraceMetadata.permission,
    tenantAdminConsentRequired: true as const,
    exchangeTraceServicePrincipalAppId:
      microsoft365TraceMetadata.traceServicePrincipalAppId,
    backfillStartAt: connection?.backfillStartAt ?? null,
    backfillEndAt: connection?.backfillEndAt ?? null,
    backfillCompletedAt: connection?.backfillCompletedAt ?? null,
    lastSyncAt: connection?.lastSyncAt ?? null,
    lastSuccessAt: connection?.lastSuccessAt ?? null,
    nextSyncAt: connection?.nextSyncAt ?? null,
    lastError: connection?.lastError ?? null,
    pollIntervalSeconds: POLL_INTERVAL_MS / 1000,
    maxHistoryDays: microsoft365TraceMetadata.maxRetentionDays as 90,
    maxQueryWindowDays: microsoft365TraceMetadata.maxWindowDays as 10,
    maxPageSize: microsoft365TraceMetadata.maxPageSize as 5000,
    requestsPerFiveMinutes:
      microsoft365TraceMetadata.listAndDetailsRequestsPerFiveMinutes as 100,
  };
}

async function getUserConnection(
  userId: string,
): Promise<SafeConnection | null> {
  const [connection] = await db
    .select()
    .from(microsoft365TraceConnectionsTable)
    .where(eq(microsoft365TraceConnectionsTable.userId, userId))
    .limit(1);
  return connection ?? null;
}

function graphConnectError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof Microsoft365TraceApiError) {
    if (error.status === 400) {
      return {
        status: 400,
        code: "MICROSOFT_365_CREDENTIALS_REJECTED",
        message:
          "Microsoft rejected the tenant or app credentials. Verify the tenant ID, application ID, and active client secret.",
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        status: 403,
        code: "MICROSOFT_365_TRACE_NOT_AUTHORIZED",
        message: error.message,
      };
    }
    return {
      status: 502,
      code: "MICROSOFT_365_TRACE_UNAVAILABLE",
      message: error.message,
    };
  }
  return {
    status: 502,
    code: "MICROSOFT_365_TRACE_UNAVAILABLE",
    message: "Microsoft trace access could not be verified.",
  };
}

router.get(
  "/sending/microsoft-365/connection",
  requireUserRole,
  async (req, res): Promise<void> => {
    const connection = await getUserConnection(req.authUser!.id);
    res.json(
      GetMicrosoft365TraceConnectionResponse.parse(
        connectionResponse(connection),
      ),
    );
  },
);

router.post(
  "/sending/microsoft-365/connect",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = ConnectMicrosoft365TraceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Provide valid Microsoft Entra tenant, application, and secret details.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const { tenantId, clientId, clientSecret } = parsed.data;
    const existing = await getUserConnection(req.authUser!.id);
    if (existing && existing.tenantId !== tenantId) {
      res.status(409).json({
        error: "Disconnect the currently connected tenant before connecting a different Microsoft 365 tenant.",
        code: "MICROSOFT_365_TENANT_SWITCH_REQUIRES_DISCONNECT",
      });
      return;
    }
    try {
      const accessToken = await requestMicrosoft365AccessToken({
        tenantId,
        clientId,
        clientSecret,
      });
      const now = new Date();
      await listMicrosoft365Traces({
        accessToken,
        startAt: new Date(now.getTime() - 5 * 60_000),
        endAt: now,
        pageSize: 1,
      });

      const backfillEndAt = new Date();
      const backfillStartAt = new Date(
        backfillEndAt.getTime() -
          microsoft365TraceMetadata.maxRetentionDays * 24 * 60 * 60_000,
      );
      const clientSecretEncrypted = encryptSecret(clientSecret);
      const userId = req.authUser!.id;
      await db
        .insert(microsoft365TraceConnectionsTable)
        .values({
          userId,
          tenantId,
          clientId,
          clientSecretEncrypted,
          syncStatus: "connected",
          backfillStartAt,
          backfillEndAt,
          backfillCompletedAt: null,
          pageNextLink: null,
          lastSyncAt: null,
          lastSuccessAt: null,
          nextSyncAt: now,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: microsoft365TraceConnectionsTable.userId,
          set: {
            tenantId,
            clientId,
            clientSecretEncrypted,
            syncStatus: "connected",
            backfillStartAt,
            backfillEndAt,
            backfillCompletedAt: null,
            pageNextLink: null,
            nextSyncAt: now,
            leaseExpiresAt: null,
            lastError: null,
            updatedAt: now,
          },
        });
      const connection = await getUserConnection(userId);
      res.json(
        ConnectMicrosoft365TraceResponse.parse(
          connectionResponse(connection),
        ),
      );
    } catch (error) {
      const failure = graphConnectError(error);
      res.status(failure.status).json({
        error: failure.message,
        code: failure.code,
      });
    }
  },
);

router.delete(
  "/sending/microsoft-365/connection",
  requireUserRole,
  async (req, res): Promise<void> => {
    await db
      .delete(microsoft365TraceConnectionsTable)
      .where(eq(microsoft365TraceConnectionsTable.userId, req.authUser!.id));
    res.status(204).end();
  },
);

router.post(
  "/sending/microsoft-365/sync",
  requireUserRole,
  async (req, res): Promise<void> => {
    const now = new Date();
    const existing = await getUserConnection(req.authUser!.id);
    if (!existing) {
      res.status(404).json({
        error: "Connect a Microsoft 365 tenant before requesting a sync.",
        code: "MICROSOFT_365_TRACE_NOT_CONNECTED",
      });
      return;
    }
    if (existing.leaseExpiresAt && existing.leaseExpiresAt > now) {
      res.status(409).json({
        error: "A Microsoft 365 trace sync is already running for this tenant.",
        code: "MICROSOFT_365_TRACE_SYNC_IN_PROGRESS",
      });
      return;
    }
    const [connection] = await db
      .update(microsoft365TraceConnectionsTable)
      .set({ nextSyncAt: now, updatedAt: now })
      .where(
        and(
          eq(microsoft365TraceConnectionsTable.id, existing.id),
          or(
            isNull(microsoft365TraceConnectionsTable.leaseExpiresAt),
            lte(microsoft365TraceConnectionsTable.leaseExpiresAt, now),
          ),
        ),
      )
      .returning();
    if (!connection) {
      res.status(409).json({
        error: "A Microsoft 365 trace sync started before this request could be scheduled. Try again when it finishes.",
        code: "MICROSOFT_365_TRACE_SYNC_IN_PROGRESS",
      });
      return;
    }
    res.json(
      TriggerMicrosoft365TraceSyncResponse.parse(
        connectionResponse(connection),
      ),
    );
  },
);

router.post(
  "/sending/microsoft-365/backfill",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = BackfillMicrosoft365TracesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose a backfill period from 1 to 90 days.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const now = new Date();
    const existing = await getUserConnection(req.authUser!.id);
    if (!existing) {
      res.status(404).json({
        error: "Connect a Microsoft 365 tenant before starting a backfill.",
        code: "MICROSOFT_365_TRACE_NOT_CONNECTED",
      });
      return;
    }
    if (existing.leaseExpiresAt && existing.leaseExpiresAt > now) {
      res.status(409).json({
        error: "Wait for the current Microsoft 365 trace sync to finish before starting a backfill.",
        code: "MICROSOFT_365_TRACE_SYNC_IN_PROGRESS",
      });
      return;
    }
    const [connection] = await db
      .update(microsoft365TraceConnectionsTable)
      .set({
        backfillStartAt: new Date(
          now.getTime() - parsed.data.days * 24 * 60 * 60_000,
        ),
        backfillEndAt: now,
        backfillCompletedAt: null,
        pageNextLink: null,
        nextSyncAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(microsoft365TraceConnectionsTable.id, existing.id),
          or(
            isNull(microsoft365TraceConnectionsTable.leaseExpiresAt),
            lte(microsoft365TraceConnectionsTable.leaseExpiresAt, now),
          ),
        ),
      )
      .returning();
    if (!connection) {
      res.status(409).json({
        error: "A Microsoft 365 trace sync started before this backfill could be scheduled. Try again when it finishes.",
        code: "MICROSOFT_365_TRACE_SYNC_IN_PROGRESS",
      });
      return;
    }
    res.json(
      BackfillMicrosoft365TracesResponse.parse(
        connectionResponse(connection),
      ),
    );
  },
);

function storedCredentials(connection: SafeConnection) {
  return {
    tenantId: connection.tenantId,
    clientId: connection.clientId,
    clientSecret: decryptSecret(connection.clientSecretEncrypted),
  };
}

function pairKey(messageId: string, recipientEmail: string): string {
  return `${messageId}\u0000${recipientEmail.trim().toLowerCase()}`;
}

async function saveMatchingTracePage(
  connection: SafeConnection,
  traces: Awaited<ReturnType<typeof listMicrosoft365Traces>>["traces"],
  isBackfill: boolean,
): Promise<void> {
  const validTraces = traces.filter(
    (trace) =>
      typeof trace.id === "string" &&
      trace.id.length > 0 &&
      typeof trace.messageId === "string" &&
      trace.messageId.length > 0 &&
      typeof trace.recipientAddress === "string" &&
      trace.recipientAddress.length > 0 &&
      Number.isFinite(new Date(trace.receivedDateTime).getTime()),
  );
  if (!validTraces.length) return;

  const messageIds = [...new Set(validTraces.map((trace) => trace.messageId))];
  const recipientEmails = [
    ...new Set(
      validTraces.map((trace) => trace.recipientAddress.trim().toLowerCase()),
    ),
  ];
  const candidates = await db
    .select({
      messageId: emailSendAttemptsTable.messageId,
      recipientEmail: emailCampaignRecipientsTable.email,
    })
    .from(emailSendAttemptsTable)
    .innerJoin(
      emailCampaignRecipientsTable,
      and(
        eq(emailCampaignRecipientsTable.id, emailSendAttemptsTable.recipientId),
        eq(emailCampaignRecipientsTable.userId, emailSendAttemptsTable.userId),
      ),
    )
    .innerJoin(
      emailCampaignsTable,
      and(
        eq(emailCampaignsTable.id, emailCampaignRecipientsTable.campaignId),
        eq(emailCampaignsTable.userId, connection.userId),
      ),
    )
    .where(
      and(
        eq(emailSendAttemptsTable.userId, connection.userId),
        inArray(emailSendAttemptsTable.messageId, messageIds),
        inArray(
          sql`lower(${emailCampaignRecipientsTable.email})`,
          recipientEmails,
        ),
      ),
    );
  const matchedPairs = new Set(
    candidates
      .filter(
        (candidate): candidate is {
          messageId: string;
          recipientEmail: string;
        } => candidate.messageId !== null,
      )
      .map((candidate) => pairKey(candidate.messageId, candidate.recipientEmail)),
  );
  const now = new Date();
  const rows = validTraces
    .filter((trace) =>
      matchedPairs.has(pairKey(trace.messageId, trace.recipientAddress)),
    )
    .map((trace) => ({
      userId: connection.userId,
      connectionId: connection.id,
      traceId: trace.id,
      messageId: trace.messageId,
      recipientAddress: trace.recipientAddress.trim().toLowerCase(),
      receivedDateTime: new Date(trace.receivedDateTime),
      providerStatus: trace.status?.slice(0, 32) ?? null,
      nextAttemptAt: now,
      updatedAt: now,
    }));
  if (!rows.length) return;

  await db
    .insert(microsoft365MessageTracesTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        microsoft365MessageTracesTable.connectionId,
        microsoft365MessageTracesTable.traceId,
        microsoft365MessageTracesTable.recipientAddress,
      ],
      set: isBackfill
        ? {
            providerStatus: sql`excluded.provider_status`,
            detailsCheckedAt: null,
            nextAttemptAt: now,
            updatedAt: now,
          }
        : { providerStatus: sql`excluded.provider_status`, updatedAt: now },
    });
}

async function listDueDetails(
  connection: SafeConnection,
  accessToken: string,
): Promise<void> {
  const now = new Date();
  const due = await db
    .select()
    .from(microsoft365MessageTracesTable)
    .where(
      and(
        eq(microsoft365MessageTracesTable.userId, connection.userId),
        eq(microsoft365MessageTracesTable.connectionId, connection.id),
        lte(microsoft365MessageTracesTable.nextAttemptAt, now),
      ),
    )
    .orderBy(
      asc(microsoft365MessageTracesTable.nextAttemptAt),
      asc(microsoft365MessageTracesTable.receivedDateTime),
    )
    .limit(MAX_DETAILS_PER_TICK);

  for (const trace of due) {
    const details = await getMicrosoft365TraceDetails({
      accessToken,
      traceId: trace.traceId,
      recipientAddress: trace.recipientAddress,
    });
    const exactMessageDetails = details.filter(
      (detail) => !detail.messageId || detail.messageId === trace.messageId,
    );
    const evidence = deriveMicrosoft365Evidence(exactMessageDetails);
    const checkedAt = new Date();
    if (evidence) {
      await ingestDeliveryReports({
        userId: connection.userId,
        reports: [
          {
            recipientEmail: trace.recipientAddress,
            messageId: trace.messageId,
            envelopeId: null,
            outcome: evidence.outcome,
            source: "microsoft_365_graph",
            diagnostic: evidence.diagnostic,
            enhancedStatus: null,
            occurredAt: evidence.occurredAt,
            deliveryScope: evidence.deliveryScope,
          },
        ],
        receivedAt: checkedAt,
        verification: "microsoft365_authorized",
        microsoft365TraceConnectionId: connection.id,
        microsoft365TenantId: connection.tenantId,
      });
    }
    await db
      .update(microsoft365MessageTracesTable)
      .set({
        detailsCheckedAt: checkedAt,
        nextAttemptAt: evidence?.terminal
          ? new Date("9999-12-31T23:59:59.999Z")
          : new Date(checkedAt.getTime() + DETAIL_RECHECK_MS),
        attemptCount: trace.attemptCount + 1,
        updatedAt: checkedAt,
      })
      .where(
        and(
          eq(microsoft365MessageTracesTable.id, trace.id),
          eq(microsoft365MessageTracesTable.connectionId, connection.id),
          eq(microsoft365MessageTracesTable.userId, connection.userId),
        ),
      );
  }
}

async function discoverTracePage(
  connection: SafeConnection,
  accessToken: string,
): Promise<void> {
  const now = new Date();
  const backfillStartAt = connection.backfillStartAt;
  const backfillEndAt = connection.backfillEndAt;
  let startAt: Date | undefined;
  let endAt: Date | undefined;
  if (!connection.pageNextLink && backfillStartAt && backfillEndAt) {
    startAt = backfillStartAt;
    endAt = new Date(
      Math.min(
        backfillStartAt.getTime() + MAX_WINDOW_MS,
        backfillEndAt.getTime(),
      ),
    );
  } else if (!connection.pageNextLink) {
    startAt = new Date(
      Math.max(
        now.getTime() - MAX_INCREMENTAL_LOOKBACK_MS,
        now.getTime() - microsoft365TraceMetadata.maxRetentionDays * 24 * 60 * 60_000,
      ),
    );
    endAt = now;
  }

  const page = await listMicrosoft365Traces({
    accessToken,
    startAt,
    endAt,
    nextLink: connection.pageNextLink,
  });
  await saveMatchingTracePage(
    connection,
    page.traces,
    Boolean(connection.backfillStartAt),
  );

  const updates: Partial<Microsoft365TraceConnection> = {
    pageNextLink: page.nextLink,
    lastSyncAt: now,
    lastSuccessAt: now,
    lastError: null,
    syncStatus: "connected",
    nextSyncAt: new Date(now.getTime() + POLL_INTERVAL_MS),
    updatedAt: now,
  };
  if (
    !page.nextLink &&
    backfillStartAt &&
    backfillEndAt
  ) {
    const nextStart = new Date(
      Math.min(
        backfillStartAt.getTime() + MAX_WINDOW_MS,
        backfillEndAt.getTime(),
      ),
    );
    if (nextStart.getTime() >= backfillEndAt.getTime()) {
      updates.backfillStartAt = null;
      updates.backfillEndAt = null;
      updates.backfillCompletedAt = now;
    } else {
      updates.backfillStartAt = nextStart;
    }
  }
  await db
    .update(microsoft365TraceConnectionsTable)
    .set(updates)
    .where(eq(microsoft365TraceConnectionsTable.id, connection.id));
}

function retryDelay(error: unknown): number {
  if (
    error instanceof Microsoft365TraceApiError &&
    error.status === 429 &&
    error.retryAfterMs !== undefined
  ) {
    return Math.min(Math.max(error.retryAfterMs, 30_000), 60 * 60_000);
  }
  return DEFAULT_ERROR_RETRY_MS;
}

export async function syncDueMicrosoft365TraceConnections(): Promise<void> {
  const now = new Date();
  const due = await db
    .select()
    .from(microsoft365TraceConnectionsTable)
    .where(
      and(
        inArray(microsoft365TraceConnectionsTable.syncStatus, [
          "connected",
          "error",
        ]),
        lte(microsoft365TraceConnectionsTable.nextSyncAt, now),
        or(
          isNull(microsoft365TraceConnectionsTable.leaseExpiresAt),
          lte(microsoft365TraceConnectionsTable.leaseExpiresAt, now),
        ),
      ),
    )
    .orderBy(asc(microsoft365TraceConnectionsTable.nextSyncAt))
    .limit(20);

  for (const connection of due) {
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
    const claimed = await db
      .update(microsoft365TraceConnectionsTable)
      .set({ leaseExpiresAt, updatedAt: now })
      .where(
        and(
          eq(microsoft365TraceConnectionsTable.id, connection.id),
          inArray(microsoft365TraceConnectionsTable.syncStatus, [
            "connected",
            "error",
          ]),
          lte(microsoft365TraceConnectionsTable.nextSyncAt, now),
          or(
            isNull(microsoft365TraceConnectionsTable.leaseExpiresAt),
            lte(microsoft365TraceConnectionsTable.leaseExpiresAt, now),
          ),
        ),
      )
      .returning({ id: microsoft365TraceConnectionsTable.id });
    if (!claimed.length) continue;

    try {
      const accessToken = await requestMicrosoft365AccessToken(
        storedCredentials(connection),
      );
      await discoverTracePage(connection, accessToken);
      await listDueDetails(connection, accessToken);
      await db
        .update(microsoft365TraceConnectionsTable)
        .set({
          syncStatus: "connected",
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(microsoft365TraceConnectionsTable.id, connection.id));
    } catch (error) {
      const failedAt = new Date();
      const message =
        error instanceof Microsoft365TraceApiError
          ? error.message
          : "Microsoft 365 trace sync failed. Mailflow will retry.";
      await db
        .update(microsoft365TraceConnectionsTable)
        .set({
          syncStatus: "error",
          lastSyncAt: failedAt,
          nextSyncAt: new Date(failedAt.getTime() + retryDelay(error)),
          leaseExpiresAt: null,
          lastError: message.slice(0, 500),
          updatedAt: failedAt,
        })
        .where(eq(microsoft365TraceConnectionsTable.id, connection.id));
      logger.warn(
        {
          connectionId: connection.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
          status: error instanceof Microsoft365TraceApiError ? error.status : undefined,
        },
        "Microsoft 365 trace sync failed",
      );
    }
  }
}

export function startMicrosoft365TraceWorker(): void {
  if (workerTimer) return;
  const tick = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await syncDueMicrosoft365TraceConnections();
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Microsoft 365 trace worker tick failed",
      );
    } finally {
      workerRunning = false;
    }
  };
  void tick();
  workerTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  workerTimer.unref?.();
}

export default router;