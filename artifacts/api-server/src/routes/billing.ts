import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  ActivateFreeSubscriptionBody,
  ActivateFreeSubscriptionResponse,
  CreateSubscriptionOrderBody,
  CreateSubscriptionPackageBody,
  CreateSubscriptionPackageResponse,
  GiftAdminSubscriptionBody,
  GiftAdminSubscriptionResponse,
  GetCurrentSubscriptionResponse,
  GetOnlinePaymentSettingsResponse,
  GetRazorpaySettingsResponse,
  GetSubscriptionPaymentAvailabilityResponse,
  ListAdminSubscriptionPackagesResponse,
  ListAvailableSubscriptionPackagesResponse,
  ListAdminFinancePaymentsQueryParams,
  ListAdminFinancePaymentsResponse,
  ReceiveRazorpayWebhookResponse,
  SetActiveRazorpayEnvironmentBody,
  SetActiveRazorpayEnvironmentResponse,
  TestRazorpayConnectionBody,
  TestRazorpayConnectionResponse,
  UpdateOnlinePaymentSettingsBody,
  UpdateOnlinePaymentSettingsResponse,
  UpdateRazorpaySettingsBody,
  UpdateRazorpaySettingsResponse,
  UpdateSubscriptionPackageBody,
  UpdateSubscriptionPackageParams,
  UpdateSubscriptionPackageResponse,
  VerifyRazorpayPaymentBody,
  VerifyRazorpayPaymentResponse,
} from "@workspace/api-zod";
import {
  db,
  emailCampaignsTable,
  paymentsTable,
  razorpayConfigurationTable,
  razorpayWebhookEventsTable,
  subscriptionPackagesTable,
  systemConfigurationTable,
  tenantSendingConfigurationTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import {
  activateFreePackageForUser,
  activateCapturedPayment,
  getCurrentSubscriptionForUser,
  grantAdminGiftSubscription,
  serializePackage,
} from "../lib/billing";
import { writeAuditLog } from "../lib/audit";
import { encryptSecret } from "../lib/security";
import {
  createRazorpayOrder,
  getRazorpayConfiguration,
  getStoredRazorpayCredentials,
  inferLegacyRazorpayEnvironment,
  getRazorpayPayment,
  RazorpayApiError,
  testRazorpayConnection,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "../lib/razorpay";
import { getPlatformSettings } from "../lib/platform-settings";
import { requireSuperadmin, requireUserRole } from "../lib/session";

const router: IRouter = Router();
const ONLINE_PAYMENT_CONFIGURATION_KEY = "billing_online_payments";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadOnlinePaymentSettings(): Promise<{
  enabled: boolean;
  updatedAt: string | null;
}> {
  const [row] = await db
    .select({
      value: systemConfigurationTable.value,
      updatedAt: systemConfigurationTable.updatedAt,
    })
    .from(systemConfigurationTable)
    .where(eq(systemConfigurationTable.key, ONLINE_PAYMENT_CONFIGURATION_KEY))
    .limit(1);

  if (!row) {
    // Preserve existing checkout behavior when the setting has never been saved.
    return { enabled: true, updatedAt: null };
  }
  return {
    enabled:
      isRecord(row.value) && typeof row.value.enabled === "boolean"
        ? row.value.enabled
        : false,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateSenderAccountRetention(
  userId: string,
  packageLimit: number,
  requestedIds: string[] | undefined,
): Promise<
  | { ok: true; accountIdsToKeep: string[] | null }
  | { ok: false; message: string }
> {
  const accounts = await db
    .select({ id: tenantSendingConfigurationTable.id })
    .from(tenantSendingConfigurationTable)
    .where(eq(tenantSendingConfigurationTable.userId, userId));
  const needsRetention = accounts.length > packageLimit;
  if (needsRetention && requestedIds === undefined) {
    return {
      ok: false,
      message: "Choose which SMTP sender accounts to keep before changing to this package.",
    };
  }
  if (requestedIds !== undefined) {
    const ownedIds = new Set(accounts.map((account) => account.id));
    if (
      new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some((id) => !ownedIds.has(id)) ||
      requestedIds.length > packageLimit ||
      (needsRetention && requestedIds.length !== packageLimit)
    ) {
      return {
        ok: false,
        message: "Choose the number of SMTP sender accounts allowed by this package.",
      };
    }
  }
  if (!needsRetention || requestedIds === undefined) {
    return { ok: true, accountIdsToKeep: null };
  }
  const kept = new Set(requestedIds);
  const removedIds = accounts
    .map((account) => account.id)
    .filter((id) => !kept.has(id));
  if (removedIds.length > 0) {
    const [activeCampaign] = await db
      .select({ id: emailCampaignsTable.id })
      .from(emailCampaignsTable)
      .where(
        and(
          eq(emailCampaignsTable.userId, userId),
          inArray(emailCampaignsTable.senderAccountId, removedIds),
          inArray(emailCampaignsTable.status, ["queued", "sending"]),
        ),
      )
      .limit(1);
    if (activeCampaign) {
      return {
        ok: false,
        message: "Finish or reassign active campaigns before removing their SMTP sender accounts.",
      };
    }
  }
  return { ok: true, accountIdsToKeep: requestedIds };
}

function utcDayStart(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

router.get(
  "/admin/finance/payments",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = ListAdminFinancePaymentsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      invalidInput(res, "One or more finance filters are invalid.");
      return;
    }

    const filters = parsed.data;
    const fromDate = filters.fromDate
      ? utcDayStart(filters.fromDate)
      : null;
    const toDate = filters.toDate ? utcDayStart(filters.toDate) : null;
    if (
      (filters.fromDate && !fromDate) ||
      (filters.toDate && !toDate) ||
      (fromDate && toDate && fromDate > toDate)
    ) {
      invalidInput(res, "Enter a valid UTC date range.");
      return;
    }
    if (
      (filters.minAmountMinor !== undefined ||
        filters.maxAmountMinor !== undefined) &&
      !filters.currency
    ) {
      invalidInput(res, "Choose a currency when filtering by amount.");
      return;
    }
    if (filters.sortBy === "amount" && !filters.currency) {
      invalidInput(res, "Choose a currency before sorting by amount.");
      return;
    }
    if (
      filters.minAmountMinor !== undefined &&
      filters.maxAmountMinor !== undefined &&
      filters.minAmountMinor > filters.maxAmountMinor
    ) {
      invalidInput(res, "Minimum amount cannot exceed maximum amount.");
      return;
    }

    const conditions: SQL[] = [eq(usersTable.role, "USER")];
    if (filters.status === "all") {
      conditions.push(inArray(paymentsTable.status, ["captured", "refunded"]));
    } else {
      conditions.push(eq(paymentsTable.status, filters.status));
    }
    if (filters.packageId) {
      conditions.push(eq(paymentsTable.packageId, filters.packageId));
    }
    if (filters.currency) {
      conditions.push(eq(paymentsTable.currency, filters.currency));
    }
    if (filters.minAmountMinor !== undefined) {
      conditions.push(gte(paymentsTable.amountMinor, filters.minAmountMinor));
    }
    if (filters.maxAmountMinor !== undefined) {
      conditions.push(lte(paymentsTable.amountMinor, filters.maxAmountMinor));
    }
    if (filters.environment === "unrecorded") {
      conditions.push(isNull(paymentsTable.razorpayEnvironment));
    } else if (filters.environment) {
      conditions.push(
        eq(paymentsTable.razorpayEnvironment, filters.environment),
      );
    }
    if (filters.accountStatus === "deleted") {
      conditions.push(isNotNull(usersTable.deletedAt));
    } else if (filters.accountStatus === "disabled") {
      conditions.push(
        and(isNull(usersTable.deletedAt), eq(usersTable.active, false))!,
      );
    } else if (filters.accountStatus === "active") {
      conditions.push(
        and(isNull(usersTable.deletedAt), eq(usersTable.active, true))!,
      );
    }
    const capturedAtExpression = sql<Date>`COALESCE(
      ${userSubscriptionsTable.createdAt}, ${paymentsTable.updatedAt}
    )`;
    if (fromDate) {
      conditions.push(gte(capturedAtExpression, fromDate));
    }
    if (toDate) {
      conditions.push(
        lt(capturedAtExpression, new Date(toDate.getTime() + 24 * 60 * 60 * 1000)),
      );
    }
    const search = filters.search?.trim();
    if (search) {
      const escaped = search.replace(/[\\%_]/g, (value) => `\\${value}`);
      const term = `%${escaped}%`;
      const accountFullName = sql<string>`${usersTable.firstName} || ' ' || ${usersTable.lastName}`;
      conditions.push(
        or(
          ilike(accountFullName, term),
          ilike(usersTable.firstName, term),
          ilike(usersTable.lastName, term),
          ilike(usersTable.username, term),
          ilike(usersTable.email, term),
          ilike(subscriptionPackagesTable.name, term),
          ilike(sql<string>`${paymentsTable.id}::text`, term),
          ilike(sql<string>`${userSubscriptionsTable.id}::text`, term),
          ilike(paymentsTable.receipt, term),
          ilike(paymentsTable.razorpayOrderId, term),
          ilike(paymentsTable.razorpayPaymentId, term),
        )!,
      );
    }
    const where = and(...conditions);

    const sortColumn = {
      capturedAt: capturedAtExpression,
      amount: paymentsTable.amountMinor,
      account: sql<string>`lower(${usersTable.firstName} || ' ' || ${usersTable.lastName})`,
      subscription: sql<string>`lower(${subscriptionPackagesTable.name})`,
    }[filters.sortBy];
    const primaryOrder =
      filters.sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn);
    const offset = (filters.page - 1) * filters.pageSize;

    const [countResult, paymentRows, currencyRows, groupedSummaryRows] =
      await Promise.all([
        db
          .select({ total: count() })
          .from(paymentsTable)
          .innerJoin(usersTable, eq(paymentsTable.userId, usersTable.id))
          .innerJoin(
            subscriptionPackagesTable,
            eq(paymentsTable.packageId, subscriptionPackagesTable.id),
          )
          .leftJoin(
            userSubscriptionsTable,
            eq(userSubscriptionsTable.paymentId, paymentsTable.id),
          )
          .where(where),
        db
          .select({
            payment: paymentsTable,
            account: usersTable,
            subscriptionPackage: subscriptionPackagesTable,
            subscription: userSubscriptionsTable,
          })
          .from(paymentsTable)
          .innerJoin(usersTable, eq(paymentsTable.userId, usersTable.id))
          .innerJoin(
            subscriptionPackagesTable,
            eq(paymentsTable.packageId, subscriptionPackagesTable.id),
          )
          .leftJoin(
            userSubscriptionsTable,
            eq(userSubscriptionsTable.paymentId, paymentsTable.id),
          )
          .where(where)
          .orderBy(primaryOrder, asc(paymentsTable.id))
          .limit(filters.pageSize)
          .offset(offset),
        db
          .selectDistinct({ currency: paymentsTable.currency })
          .from(paymentsTable)
          .innerJoin(usersTable, eq(paymentsTable.userId, usersTable.id))
          .where(
            and(
              eq(usersTable.role, "USER"),
              inArray(paymentsTable.status, ["captured", "refunded"]),
            ),
          )
          .orderBy(asc(paymentsTable.currency)),
        db
          .select({
            currency: paymentsTable.currency,
            status: paymentsTable.status,
            paymentCount: count(),
            amountMinor: sql<string>`COALESCE(SUM(${paymentsTable.amountMinor}), 0)::text`,
          })
          .from(paymentsTable)
          .innerJoin(usersTable, eq(paymentsTable.userId, usersTable.id))
          .innerJoin(
            subscriptionPackagesTable,
            eq(paymentsTable.packageId, subscriptionPackagesTable.id),
          )
          .leftJoin(
            userSubscriptionsTable,
            eq(userSubscriptionsTable.paymentId, paymentsTable.id),
          )
          .where(where)
          .groupBy(paymentsTable.currency, paymentsTable.status)
          .orderBy(asc(paymentsTable.currency)),
      ]);

    const summaryByCurrency = new Map<
      string,
      {
        currency: string;
        paymentCount: number;
        capturedCount: number;
        refundedCount: number;
        capturedAmountMinor: string;
        refundedAmountMinor: string;
      }
    >();
    for (const row of groupedSummaryRows) {
      const summary = summaryByCurrency.get(row.currency) ?? {
        currency: row.currency,
        paymentCount: 0,
        capturedCount: 0,
        refundedCount: 0,
        capturedAmountMinor: "0",
        refundedAmountMinor: "0",
      };
      summary.paymentCount += row.paymentCount;
      if (row.status === "captured") {
        summary.capturedCount = row.paymentCount;
        summary.capturedAmountMinor = String(row.amountMinor);
      } else if (row.status === "refunded") {
        summary.refundedCount = row.paymentCount;
        summary.refundedAmountMinor = String(row.amountMinor);
      }
      summaryByCurrency.set(row.currency, summary);
    }

    const total = countResult[0]?.total ?? 0;
    res.json(
      ListAdminFinancePaymentsResponse.parse({
        rows: paymentRows.map(({ payment, account, subscriptionPackage, subscription }) => ({
          id: payment.id,
          receipt: payment.receipt,
          status: payment.status,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          razorpayEnvironment: payment.razorpayEnvironment,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
          capturedAt: (subscription?.createdAt ?? payment.updatedAt).toISOString(),
          account: {
            id: account.id,
            username: account.username,
            firstName: account.firstName,
            lastName: account.lastName,
            fullName: `${account.firstName} ${account.lastName}`.trim(),
            email: account.email,
            status: account.deletedAt ? "deleted" : account.active ? "active" : "disabled",
            registeredAt: account.createdAt.toISOString(),
          },
          subscriptionPackage: {
            id: subscriptionPackage.id,
            name: subscriptionPackage.name,
          },
          subscription: subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                startsAt: subscription.startsAt.toISOString(),
                endsAt: subscription.endsAt.toISOString(),
              }
            : null,
        })),
        total,
        page: filters.page,
        pageSize: filters.pageSize,
        pageCount: Math.ceil(total / filters.pageSize),
        currencies: currencyRows.map(({ currency }) => currency),
        summaryByCurrency: [...summaryByCurrency.values()],
      }),
    );
  },
);

function invalidInput(res: Response, message: string): void {
  res.status(400).json({ error: message, code: "INVALID_INPUT" });
}

function webhookEntity(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function webhookText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isSupportedCurrency(currency: string): boolean {
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency });
    return true;
  } catch {
    return false;
  }
}

type SubscriptionPackageRow = typeof subscriptionPackagesTable.$inferSelect;

const SINGLE_FREE_PACKAGE_CONSTRAINT =
  "subscription_packages_single_free_unique";
const SINGLE_PREFERRED_PACKAGE_CONSTRAINT =
  "subscription_packages_single_preferred_unique";

function isSingleFreePackageUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== "object") return false;
    const details = candidate as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      details.code === "23505" &&
      details.constraint === SINGLE_FREE_PACKAGE_CONSTRAINT
    ) {
      return true;
    }
    candidate = details.cause;
  }
  return false;
}

function isSinglePreferredPackageUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== "object") return false;
    const details = candidate as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      details.code === "23505" &&
      details.constraint === SINGLE_PREFERRED_PACKAGE_CONSTRAINT
    ) {
      return true;
    }
    candidate = details.cause;
  }
  return false;
}

async function hasOtherFreePackage(exceptPackageId?: string): Promise<boolean> {
  const freePackages = await db
    .select({ id: subscriptionPackagesTable.id })
    .from(subscriptionPackagesTable)
    .where(eq(subscriptionPackagesTable.amountMinor, 0));
  return freePackages.some(({ id }) => id !== exceptPackageId);
}

function respondFreePackageConflict(res: Response): void {
  res.status(409).json({
    error: "Only one zero-price package can exist. Edit the existing free package or change its price.",
    code: "FREE_PACKAGE_ALREADY_EXISTS",
  });
}

function respondPreferredPackageConflict(res: Response): void {
  res.status(409).json({
    error:
      "Only one package can be preferred at a time. Refresh the package list and try again.",
    code: "PREFERRED_PACKAGE_ALREADY_EXISTS",
  });
}

function serializeRazorpaySettings(
  config: typeof razorpayConfigurationTable.$inferSelect | undefined,
) {
  const serializeEnvironment = (environment: "sandbox" | "production") => {
    const stored = config
      ? getStoredRazorpayCredentials(config, environment)
      : {
          keyId: null,
          keySecretEncrypted: null,
          webhookSecretEncrypted: null,
        };
    const legacyEnvironment = config
      ? inferLegacyRazorpayEnvironment(config.keyId)
      : null;
    const environmentUpdatedAt =
      environment === "sandbox"
        ? config?.sandboxUpdatedAt ??
          (legacyEnvironment === environment ? config?.updatedAt ?? null : null)
        : config?.productionUpdatedAt ??
          (legacyEnvironment === environment ? config?.updatedAt ?? null : null);
    return {
      keyId: stored.keyId,
      keySecretConfigured: Boolean(stored.keySecretEncrypted),
      webhookSecretConfigured: Boolean(stored.webhookSecretEncrypted),
      configured: Boolean(
        stored.keyId &&
          stored.keySecretEncrypted &&
          stored.webhookSecretEncrypted,
      ),
      updatedAt: environmentUpdatedAt?.toISOString() ?? null,
    };
  };
  const activeEnvironment =
    config?.activeEnvironment ??
    (config ? inferLegacyRazorpayEnvironment(config.keyId) : null);
  return {
    activeEnvironment,
    sandbox: serializeEnvironment("sandbox"),
    production: serializeEnvironment("production"),
    updatedAt: config?.updatedAt.toISOString() ?? null,
  };
}

async function backfillUnassignedPaymentEnvironment(
  environment: "sandbox" | "production" | null,
): Promise<void> {
  if (!environment) return;
  await db
    .update(paymentsTable)
    .set({ razorpayEnvironment: environment })
    .where(
      and(
        isNull(paymentsTable.razorpayEnvironment),
        isNotNull(paymentsTable.razorpayOrderId),
      ),
    );
}

router.get(
  "/admin/billing/razorpay",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    const [config] = await db
      .select()
      .from(razorpayConfigurationTable)
      .where(eq(razorpayConfigurationTable.id, "platform"))
      .limit(1);
    res.json(GetRazorpaySettingsResponse.parse(serializeRazorpaySettings(config)));
  },
);

router.get(
  "/admin/billing/online-payments",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    res.json(
      GetOnlinePaymentSettingsResponse.parse(await loadOnlinePaymentSettings()),
    );
  },
);

router.put(
  "/admin/billing/online-payments",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateOnlinePaymentSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Choose whether online payments should be enabled.");
      return;
    }

    const updatedAt = new Date();
    await db
      .insert(systemConfigurationTable)
      .values({
        key: ONLINE_PAYMENT_CONFIGURATION_KEY,
        value: { enabled: parsed.data.enabled },
        updatedBy: req.authUser!.id,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: systemConfigurationTable.key,
        set: {
          value: { enabled: parsed.data.enabled },
          updatedBy: req.authUser!.id,
          updatedAt,
        },
      });

    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "online_payments.availability_updated",
      entity: "system_configuration",
      entityId: ONLINE_PAYMENT_CONFIGURATION_KEY,
      ipAddress: req.ip,
      metadata: { enabled: parsed.data.enabled },
    });

    res.json(
      UpdateOnlinePaymentSettingsResponse.parse(
        await loadOnlinePaymentSettings(),
      ),
    );
  },
);

router.put(
  "/admin/billing/razorpay",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateRazorpaySettingsBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Choose an environment and enter a valid Razorpay key ID and credentials.");
      return;
    }

    const [existing] = await db
      .select()
      .from(razorpayConfigurationTable)
      .where(eq(razorpayConfigurationTable.id, "platform"))
      .limit(1);
    const environment = parsed.data.environment;
    const savedCredentials = existing
      ? getStoredRazorpayCredentials(existing, environment)
      : {
          keyId: null,
          keySecretEncrypted: null,
          webhookSecretEncrypted: null,
        };
    const keyId = parsed.data.keyId.trim();
    const keySecret = parsed.data.keySecret?.trim();
    const webhookSecret = parsed.data.webhookSecret?.trim();
    const replacingKeyId =
      Boolean(savedCredentials.keyId) && keyId !== savedCredentials.keyId;
    if (
      !keyId ||
      (!savedCredentials.keySecretEncrypted && !keySecret) ||
      (!savedCredentials.webhookSecretEncrypted && !webhookSecret) ||
      (replacingKeyId && (!keySecret || !webhookSecret))
    ) {
      res.status(400).json({
        error: `Enter the key secret and webhook secret to configure the ${environment} environment.`,
        code: "RAZORPAY_CREDENTIALS_REQUIRED",
      });
      return;
    }

    const keySecretEncrypted = keySecret
      ? encryptSecret(keySecret)
      : savedCredentials.keySecretEncrypted;
    const webhookSecretEncrypted = webhookSecret
      ? encryptSecret(webhookSecret)
      : savedCredentials.webhookSecretEncrypted;
    if (!keySecretEncrypted || !webhookSecretEncrypted) {
      res.status(400).json({
        error: `Both secrets are required for the ${environment} environment.`,
        code: "RAZORPAY_CREDENTIALS_REQUIRED",
      });
      return;
    }

    const now = new Date();
    const activeEnvironment =
      existing?.activeEnvironment ??
      (existing ? inferLegacyRazorpayEnvironment(existing.keyId) : null) ??
      environment;
    await backfillUnassignedPaymentEnvironment(
      existing?.activeEnvironment ??
        (existing ? inferLegacyRazorpayEnvironment(existing.keyId) : null),
    );
    const sandboxCredentials =
      environment === "sandbox"
        ? {
            keyId,
            keySecretEncrypted,
            webhookSecretEncrypted,
          }
        : existing
          ? getStoredRazorpayCredentials(existing, "sandbox")
          : {
              keyId: null,
              keySecretEncrypted: null,
              webhookSecretEncrypted: null,
            };
    const productionCredentials =
      environment === "production"
        ? {
            keyId,
            keySecretEncrypted,
            webhookSecretEncrypted,
          }
        : existing
          ? getStoredRazorpayCredentials(existing, "production")
          : {
              keyId: null,
              keySecretEncrypted: null,
              webhookSecretEncrypted: null,
            };
    const legacyEnvironment = existing
      ? inferLegacyRazorpayEnvironment(existing.keyId)
      : null;
    const legacyActiveCredentials =
      activeEnvironment === environment
        ? { keyId, keySecretEncrypted, webhookSecretEncrypted }
        : {
            keyId: existing?.keyId ?? keyId,
            keySecretEncrypted:
              existing?.keySecretEncrypted ?? keySecretEncrypted,
            webhookSecretEncrypted:
              existing?.webhookSecretEncrypted ?? webhookSecretEncrypted,
          };
    await db
      .insert(razorpayConfigurationTable)
      .values({
        id: "platform",
        ...legacyActiveCredentials,
        activeEnvironment,
        sandboxKeyId: sandboxCredentials.keyId,
        sandboxKeySecretEncrypted: sandboxCredentials.keySecretEncrypted,
        sandboxWebhookSecretEncrypted:
          sandboxCredentials.webhookSecretEncrypted,
        sandboxUpdatedAt:
          environment === "sandbox"
            ? now
            : existing?.sandboxUpdatedAt ??
              (legacyEnvironment === "sandbox" ? existing.updatedAt : null),
        productionKeyId: productionCredentials.keyId,
        productionKeySecretEncrypted:
          productionCredentials.keySecretEncrypted,
        productionWebhookSecretEncrypted:
          productionCredentials.webhookSecretEncrypted,
        productionUpdatedAt:
          environment === "production"
            ? now
            : existing?.productionUpdatedAt ??
              (legacyEnvironment === "production" ? existing.updatedAt : null),
        updatedBy: req.authUser!.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: razorpayConfigurationTable.id,
        set: {
          ...legacyActiveCredentials,
          activeEnvironment,
          sandboxKeyId: sandboxCredentials.keyId,
          sandboxKeySecretEncrypted: sandboxCredentials.keySecretEncrypted,
          sandboxWebhookSecretEncrypted:
            sandboxCredentials.webhookSecretEncrypted,
          sandboxUpdatedAt:
            environment === "sandbox"
              ? now
              : existing?.sandboxUpdatedAt ??
                (legacyEnvironment === "sandbox" ? existing.updatedAt : null),
          productionKeyId: productionCredentials.keyId,
          productionKeySecretEncrypted:
            productionCredentials.keySecretEncrypted,
          productionWebhookSecretEncrypted:
            productionCredentials.webhookSecretEncrypted,
          productionUpdatedAt:
            environment === "production"
              ? now
              : existing?.productionUpdatedAt ??
                (legacyEnvironment === "production" ? existing.updatedAt : null),
          updatedBy: req.authUser!.id,
          updatedAt: now,
        },
      });

    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "razorpay_configuration.updated",
      entity: "razorpay_configuration",
      entityId: "platform",
      ipAddress: req.ip,
      metadata: {
        environment,
        keyId,
        keySecretChanged: Boolean(keySecret),
        webhookSecretChanged: Boolean(webhookSecret),
      },
    });

    const [saved] = await db
      .select()
      .from(razorpayConfigurationTable)
      .where(eq(razorpayConfigurationTable.id, "platform"))
      .limit(1);
    res.json(
      UpdateRazorpaySettingsResponse.parse(serializeRazorpaySettings(saved)),
    );
  },
);

router.put(
  "/admin/billing/razorpay/active",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = SetActiveRazorpayEnvironmentBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Choose sandbox or production as the active environment.");
      return;
    }
    const environment = parsed.data.environment;
    const [existing] = await db
      .select()
      .from(razorpayConfigurationTable)
      .where(eq(razorpayConfigurationTable.id, "platform"))
      .limit(1);
    const credentials = existing
      ? getStoredRazorpayCredentials(existing, environment)
      : null;
    if (
      !credentials?.keyId ||
      !credentials.keySecretEncrypted ||
      !credentials.webhookSecretEncrypted
    ) {
      res.status(400).json({
        error: `Configure all credentials for ${environment} before activating it.`,
        code: "RAZORPAY_ENVIRONMENT_NOT_CONFIGURED",
      });
      return;
    }

    await backfillUnassignedPaymentEnvironment(
      existing.activeEnvironment ??
        inferLegacyRazorpayEnvironment(existing.keyId),
    );
    const now = new Date();
    await db
      .update(razorpayConfigurationTable)
      .set({
        activeEnvironment: environment,
        keyId: credentials.keyId,
        keySecretEncrypted: credentials.keySecretEncrypted,
        webhookSecretEncrypted: credentials.webhookSecretEncrypted,
        updatedBy: req.authUser!.id,
        updatedAt: now,
      })
      .where(eq(razorpayConfigurationTable.id, "platform"));
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "razorpay_environment.activated",
      entity: "razorpay_configuration",
      entityId: "platform",
      ipAddress: req.ip,
      metadata: { environment },
    });
    const [saved] = await db
      .select()
      .from(razorpayConfigurationTable)
      .where(eq(razorpayConfigurationTable.id, "platform"))
      .limit(1);
    res.json(
      SetActiveRazorpayEnvironmentResponse.parse(
        serializeRazorpaySettings(saved),
      ),
    );
  },
);

router.post(
  "/admin/billing/razorpay/test",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    try {
      const parsed = TestRazorpayConnectionBody.safeParse(req.body);
      if (!parsed.success) {
        invalidInput(res, "Choose which Razorpay environment to test.");
        return;
      }
      const config = await getRazorpayConfiguration(parsed.data.environment);
      if (!config) {
        res.status(400).json({
          error: `Save complete credentials for ${parsed.data.environment} before testing the connection.`,
          code: "RAZORPAY_ENVIRONMENT_NOT_CONFIGURED",
        });
        return;
      }
      await testRazorpayConnection(config);
      res.json(
        TestRazorpayConnectionResponse.parse({
          success: true,
          message: "Razorpay accepted the saved API credentials.",
        }),
      );
    } catch (error) {
      req.log.warn(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          providerStatus:
            error instanceof RazorpayApiError ? error.status : undefined,
        },
        "Razorpay connection test failed",
      );
      res.json(
        TestRazorpayConnectionResponse.parse({
          success: false,
          message:
            error instanceof RazorpayApiError
              ? error.message
              : "The saved Razorpay credentials could not be verified.",
        }),
      );
    }
  },
);

router.get(
  "/admin/billing/packages",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    const settings = await getPlatformSettings();
    const packages = await db
      .select()
      .from(subscriptionPackagesTable)
      .orderBy(desc(subscriptionPackagesTable.active), asc(subscriptionPackagesTable.name));
    res.json(
      ListAdminSubscriptionPackagesResponse.parse({
        packages: packages.map(serializePackage),
        sendingLimits: {
          emailsPerHourPerSmtp: settings.defaultEmailsPerHour,
          emailsPerDayPerSmtp: settings.maxEmailsPerDay,
        },
      }),
    );
  },
);

router.post(
  "/admin/billing/subscriptions/gift",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = GiftAdminSubscriptionBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Choose a tenant account and subscription package.");
      return;
    }
    const subscription = await grantAdminGiftSubscription(parsed.data);
    if (!subscription) {
      res.status(404).json({
        error: "Tenant account or subscription package not found.",
        code: "NOT_FOUND",
      });
      return;
    }
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "subscription.gifted",
      entity: "user_subscription",
      entityId: subscription.id,
      ipAddress: req.ip,
      metadata: {
        userId: parsed.data.userId,
        packageId: subscription.package.id,
        packageName: subscription.package.name,
        startsAt: subscription.startsAt,
        endsAt: subscription.endsAt,
      },
    });
    res
      .status(201)
      .json(GiftAdminSubscriptionResponse.parse(subscription));
  },
);

router.post(
  "/admin/billing/packages",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = CreateSubscriptionPackageBody.safeParse(req.body);
    if (!parsed.success || !isSupportedCurrency(parsed.data.currency)) {
      invalidInput(res, "Enter a valid package name, price, currency, and term.");
      return;
    }
    if (
      parsed.data.amountMinor === 0 &&
      (await hasOtherFreePackage())
    ) {
      respondFreePackageConflict(res);
      return;
    }
    let created: SubscriptionPackageRow | undefined;
    try {
      created = await db.transaction(async (tx) => {
        if (parsed.data.preferred) {
          await tx
            .update(subscriptionPackagesTable)
            .set({
              preferred: false,
              updatedBy: req.authUser!.id,
              updatedAt: new Date(),
            })
            .where(eq(subscriptionPackagesTable.preferred, true));
        }
        const [inserted] = await tx
          .insert(subscriptionPackagesTable)
          .values({
            ...parsed.data,
            createdBy: req.authUser!.id,
            updatedBy: req.authUser!.id,
          })
          .returning();
        return inserted;
      });
    } catch (error) {
      if (isSingleFreePackageUniqueViolation(error)) {
        respondFreePackageConflict(res);
        return;
      }
      if (isSinglePreferredPackageUniqueViolation(error)) {
        respondPreferredPackageConflict(res);
        return;
      }
      throw error;
    }
    if (!created) throw new Error("Subscription package was not created.");
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "subscription_package.created",
      entity: "subscription_package",
      entityId: created!.id,
      ipAddress: req.ip,
      metadata: {
        name: created!.name,
        amountMinor: created!.amountMinor,
        currency: created!.currency,
        periodDays: created!.periodDays,
        active: created!.active,
      },
    });
    res.status(201).json(
      CreateSubscriptionPackageResponse.parse(serializePackage(created!)),
    );
  },
);

router.patch(
  "/admin/billing/packages/:packageId",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = UpdateSubscriptionPackageParams.safeParse(req.params);
    const parsed = UpdateSubscriptionPackageBody.safeParse(req.body);
    if (
      !params.success ||
      !parsed.success ||
      Object.keys(parsed.data).length === 0 ||
      (parsed.data.currency !== undefined &&
        !isSupportedCurrency(parsed.data.currency))
    ) {
      invalidInput(res, "Enter at least one valid package value to update.");
      return;
    }
    if (
      parsed.data.amountMinor === 0 &&
      (await hasOtherFreePackage(params.data.packageId))
    ) {
      respondFreePackageConflict(res);
      return;
    }
    let updated: SubscriptionPackageRow | undefined;
    try {
      updated = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: subscriptionPackagesTable.id })
          .from(subscriptionPackagesTable)
          .where(eq(subscriptionPackagesTable.id, params.data.packageId))
          .limit(1);
        if (!existing) return undefined;

        const now = new Date();
        if (parsed.data.preferred) {
          await tx
            .update(subscriptionPackagesTable)
            .set({
              preferred: false,
              updatedBy: req.authUser!.id,
              updatedAt: now,
            })
            .where(eq(subscriptionPackagesTable.preferred, true));
        }
        const [saved] = await tx
          .update(subscriptionPackagesTable)
          .set({
            ...parsed.data,
            updatedBy: req.authUser!.id,
            updatedAt: now,
          })
          .where(eq(subscriptionPackagesTable.id, params.data.packageId))
          .returning();
        return saved;
      });
    } catch (error) {
      if (isSingleFreePackageUniqueViolation(error)) {
        respondFreePackageConflict(res);
        return;
      }
      if (isSinglePreferredPackageUniqueViolation(error)) {
        respondPreferredPackageConflict(res);
        return;
      }
      throw error;
    }
    if (!updated) {
      res.status(404).json({ error: "Subscription package not found.", code: "NOT_FOUND" });
      return;
    }
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "subscription_package.updated",
      entity: "subscription_package",
      entityId: updated.id,
      ipAddress: req.ip,
      metadata: parsed.data,
    });
    res.json(
      UpdateSubscriptionPackageResponse.parse(serializePackage(updated)),
    );
  },
);

router.get(
  "/subscriptions/packages",
  async (_req, res): Promise<void> => {
    const settings = await getPlatformSettings();
    const packages =
      settings.packageVisibility === "hidden"
        ? []
        : await db
            .select()
            .from(subscriptionPackagesTable)
            .where(eq(subscriptionPackagesTable.active, true))
            .orderBy(asc(subscriptionPackagesTable.amountMinor), asc(subscriptionPackagesTable.name));
    res.json(
      ListAvailableSubscriptionPackagesResponse.parse({
        packages: packages.map(serializePackage),
        sendingLimits: {
          emailsPerHourPerSmtp: settings.defaultEmailsPerHour,
          emailsPerDayPerSmtp: settings.maxEmailsPerDay,
        },
      }),
    );
  },
);

router.get(
  "/subscriptions/current",
  requireUserRole,
  async (req, res): Promise<void> => {
    const current = await getCurrentSubscriptionForUser(req.authUser!.id);
    res.json(GetCurrentSubscriptionResponse.parse(current));
  },
);

router.get(
  "/subscriptions/payment-availability",
  requireUserRole,
  async (_req, res): Promise<void> => {
    const [settings, superadmins] = await Promise.all([
      loadOnlinePaymentSettings(),
      db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.role, "SUPERADMIN"),
            eq(usersTable.active, true),
            isNull(usersTable.deletedAt),
          ),
        )
        .orderBy(asc(usersTable.createdAt), asc(usersTable.id))
        .limit(1),
    ]);
    res.json(
      GetSubscriptionPaymentAvailabilityResponse.parse({
        enabled: settings.enabled,
        superadminEmail: superadmins[0]?.email ?? null,
      }),
    );
  },
);

router.post(
  "/subscriptions/free",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = ActivateFreeSubscriptionBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Choose a valid free package.");
      return;
    }
    if (!req.authUser!.emailVerified) {
      res.status(403).json({
        error: "Verify your email before activating a subscription.",
        code: "EMAIL_VERIFICATION_REQUIRED",
      });
      return;
    }
    if ((await getPlatformSettings()).packageVisibility === "hidden") {
      res.status(404).json({
        error: "That package is not available for activation.",
        code: "PACKAGE_NOT_AVAILABLE",
      });
      return;
    }

    const [selectedPackage] = await db
      .select()
      .from(subscriptionPackagesTable)
      .where(
        and(
          eq(subscriptionPackagesTable.id, parsed.data.packageId),
          eq(subscriptionPackagesTable.active, true),
          eq(subscriptionPackagesTable.amountMinor, 0),
        ),
      )
      .limit(1);
    if (!selectedPackage) {
      res.status(404).json({
        error: "That free package is not available for activation.",
        code: "PACKAGE_NOT_AVAILABLE",
      });
      return;
    }
    const retention = await validateSenderAccountRetention(
      req.authUser!.id,
      selectedPackage.emailAccountLimit,
      parsed.data.senderAccountIdsToKeep,
    );
    if (!retention.ok) {
      res.status(409).json({
        error: retention.message,
        code: "SENDER_ACCOUNT_RETENTION_REQUIRED",
      });
      return;
    }
    let subscription;
    try {
      subscription = await activateFreePackageForUser({
        userId: req.authUser!.id,
        packageId: parsed.data.packageId,
        ...(retention.accountIdsToKeep !== null
          ? { senderAccountIdsToKeep: retention.accountIdsToKeep }
          : {}),
      });
    } catch (error) {
      res.status(409).json({
        error:
          error instanceof Error
            ? error.message
            : "Choose the SMTP sender accounts to retain for this package.",
        code: "SENDER_ACCOUNT_RETENTION_REQUIRED",
      });
      return;
    }
    if (!subscription) {
      res.status(404).json({
        error: "That free package is not available for activation.",
        code: "PACKAGE_NOT_AVAILABLE",
      });
      return;
    }
    res.json(
      ActivateFreeSubscriptionResponse.parse({ subscription }),
    );
  },
);

router.post(
  "/subscriptions/orders",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = CreateSubscriptionOrderBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Choose a valid subscription package.");
      return;
    }
    if (!req.authUser!.emailVerified) {
      res.status(403).json({
        error: "Verify your email before purchasing a subscription.",
        code: "EMAIL_VERIFICATION_REQUIRED",
      });
      return;
    }

    const [pkg] = await db
      .select()
      .from(subscriptionPackagesTable)
      .where(
        and(
          eq(subscriptionPackagesTable.id, parsed.data.packageId),
          eq(subscriptionPackagesTable.active, true),
        ),
      )
      .limit(1);
    if (!pkg) {
      res.status(404).json({
        error: "That package is not available for purchase.",
        code: "PACKAGE_NOT_AVAILABLE",
      });
      return;
    }
    if (pkg.amountMinor === 0) {
      res.status(400).json({
        error: "Free packages are activated directly and do not use Razorpay Checkout.",
        code: "FREE_PACKAGE_REQUIRES_DIRECT_ACTIVATION",
      });
      return;
    }
    if (!(await loadOnlinePaymentSettings()).enabled) {
      res.status(503).json({
        error:
          "Online payments are not active at the moment. Contact the platform administrator to activate your account.",
        code: "ONLINE_PAYMENTS_DISABLED",
      });
      return;
    }
    const retention = await validateSenderAccountRetention(
      req.authUser!.id,
      pkg.emailAccountLimit,
      parsed.data.senderAccountIdsToKeep,
    );
    if (!retention.ok) {
      res.status(409).json({
        error: retention.message,
        code: "SENDER_ACCOUNT_RETENTION_REQUIRED",
      });
      return;
    }

    const config = await getRazorpayConfiguration();
    if (!config) {
      res.status(503).json({
        error: "Razorpay is not configured yet. Contact the platform administrator.",
        code: "RAZORPAY_NOT_CONFIGURED",
      });
      return;
    }

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        userId: req.authUser!.id,
        packageId: pkg.id,
        receipt: `mf_${randomUUID().replaceAll("-", "")}`,
        amountMinor: pkg.amountMinor,
        currency: pkg.currency,
        status: "created",
        razorpayEnvironment: config.environment,
        senderAccountIdsToKeep: retention.accountIdsToKeep,
      })
      .returning();
    try {
      const order = await createRazorpayOrder(config, {
        amount: payment!.amountMinor,
        currency: payment!.currency,
        receipt: payment!.receipt,
        notes: {
          mailflow_payment_id: payment!.id,
          mailflow_user_id: payment!.userId,
          mailflow_package_id: payment!.packageId,
        },
      });
      if (
        order.amount !== payment!.amountMinor ||
        order.currency !== payment!.currency ||
        !order.id
      ) {
        await db
          .update(paymentsTable)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(paymentsTable.id, payment!.id));
        res.status(502).json({
          error: "Razorpay returned an order that did not match the package price.",
          code: "RAZORPAY_ORDER_MISMATCH",
        });
        return;
      }
      await db
        .update(paymentsTable)
        .set({ razorpayOrderId: order.id, updatedAt: new Date() })
        .where(eq(paymentsTable.id, payment!.id));
      res.status(201).json({
        paymentId: payment!.id,
        orderId: order.id,
        amountMinor: payment!.amountMinor,
        currency: payment!.currency,
        keyId: config.keyId,
        packageName: pkg.name,
        customerName: `${req.authUser!.firstName} ${req.authUser!.lastName}`.trim(),
        customerEmail: req.authUser!.email,
      });
    } catch (error) {
      await db
        .update(paymentsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(paymentsTable.id, payment!.id));
      req.log.warn(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          providerStatus:
            error instanceof RazorpayApiError ? error.status : undefined,
        },
        "Razorpay order creation failed",
      );
      res.status(502).json({
        error:
          error instanceof RazorpayApiError
            ? error.message
            : "Razorpay could not create the payment order.",
        code: "RAZORPAY_ORDER_FAILED",
      });
    }
  },
);

router.post(
  "/subscriptions/verify",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = VerifyRazorpayPaymentBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "The Razorpay payment response is incomplete.");
      return;
    }
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.id, parsed.data.paymentId),
          eq(paymentsTable.userId, req.authUser!.id),
          eq(paymentsTable.razorpayOrderId, parsed.data.razorpayOrderId),
        ),
      )
      .limit(1);
    if (!payment) {
      res.status(404).json({
        error: "This payment order does not belong to your account.",
        code: "PAYMENT_NOT_FOUND",
      });
      return;
    }
    const config = await getRazorpayConfiguration(
      payment.razorpayEnvironment ?? undefined,
    );
    if (!config) {
      res.status(503).json({
        error: "Razorpay is not configured. Contact the platform administrator.",
        code: "RAZORPAY_NOT_CONFIGURED",
      });
      return;
    }
    if (
      !verifyCheckoutSignature(
        config.keySecret,
        payment.razorpayOrderId!,
        parsed.data.razorpayPaymentId,
        parsed.data.razorpaySignature,
      )
    ) {
      res.status(400).json({
        error: "The Razorpay payment signature could not be verified.",
        code: "INVALID_PAYMENT_SIGNATURE",
      });
      return;
    }

    try {
      const providerPayment = await getRazorpayPayment(
        config,
        parsed.data.razorpayPaymentId,
      );
      if (
        providerPayment.id !== parsed.data.razorpayPaymentId ||
        providerPayment.order_id !== payment.razorpayOrderId ||
        providerPayment.amount !== payment.amountMinor ||
        providerPayment.currency !== payment.currency
      ) {
        res.status(400).json({
          error: "Razorpay payment details did not match the saved order.",
          code: "PAYMENT_DETAILS_MISMATCH",
        });
        return;
      }
      if (providerPayment.status === "captured" || providerPayment.captured) {
        const subscription = await activateCapturedPayment({
          paymentId: payment.id,
          razorpayOrderId: payment.razorpayOrderId!,
          razorpayPaymentId: providerPayment.id,
          amountMinor: providerPayment.amount,
          currency: providerPayment.currency,
        });
        const startsInFuture = new Date(subscription.startsAt) > new Date();
        res.json(
          VerifyRazorpayPaymentResponse.parse({
            status: "active",
            message: startsInFuture
              ? `Payment verified. ${subscription.package.name} starts on ${new Date(subscription.startsAt).toLocaleDateString()} after your current term ends.`
              : "Payment verified. Your subscription is active.",
            subscription,
          }),
        );
        return;
      }
      if (providerPayment.status === "authorized") {
        await db
          .update(paymentsTable)
          .set({
            status: "authorized",
            updatedAt: new Date(),
          })
          .where(eq(paymentsTable.id, payment.id));
      }
      res.json(
        VerifyRazorpayPaymentResponse.parse({
          status: "pending",
          message:
            providerPayment.status === "failed"
              ? "This payment attempt failed and no subscription was activated. You can try checkout again with another payment method."
              : "Razorpay has not confirmed a captured payment yet. Your package will activate after capture is confirmed.",
          subscription: null,
        }),
      );
    } catch (error) {
      req.log.warn(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          providerStatus:
            error instanceof RazorpayApiError ? error.status : undefined,
        },
        "Razorpay payment confirmation could not be completed",
      );
      res.status(502).json({
        error:
          "Razorpay could not confirm this payment yet. The signed webhook will still update the subscription after capture.",
        code: "RAZORPAY_CONFIRMATION_PENDING",
      });
    }
  },
);

router.post(
  "/webhooks/razorpay",
  async (req: Request, res: Response): Promise<void> => {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.header("x-razorpay-signature");
    if (!rawBody || !signature) {
      res.status(400).json({
        error: "A raw request body and Razorpay signature are required.",
        code: "WEBHOOK_SIGNATURE_REQUIRED",
      });
      return;
    }

    const body = webhookEntity(req.body) ?? {};
    const payload = webhookEntity(body.payload) ?? {};
    const orderWrapper = webhookEntity(payload.order);
    const paymentWrapper = webhookEntity(payload.payment);
    const order = webhookEntity(orderWrapper?.entity);
    const providerPayment = webhookEntity(paymentWrapper?.entity);
    const providerOrderId =
      webhookText(order?.id) ?? webhookText(providerPayment?.order_id);
    const providerPaymentId = webhookText(providerPayment?.id);
    const [paymentForWebhook] = providerOrderId
      ? await db
          .select()
          .from(paymentsTable)
          .where(eq(paymentsTable.razorpayOrderId, providerOrderId))
          .limit(1)
      : [];

    let config;
    try {
      config = await getRazorpayConfiguration(
        paymentForWebhook?.razorpayEnvironment ?? undefined,
      );
    } catch (error) {
      req.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Razorpay webhook configuration could not be decrypted",
      );
      res.status(500).json({ error: "Webhook configuration is unavailable." });
      return;
    }
    if (!config) {
      res.status(503).json({
        error: "Razorpay webhook verification is not configured.",
        code: "RAZORPAY_NOT_CONFIGURED",
      });
      return;
    }
    if (!verifyWebhookSignature(config.webhookSecret, rawBody, signature)) {
      res.status(400).json({
        error: "The Razorpay webhook signature is invalid.",
        code: "INVALID_WEBHOOK_SIGNATURE",
      });
      return;
    }

    const eventType = webhookText(body.event)?.slice(0, 100) ?? "unknown";
    const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
    const providerEventId = req.header("x-razorpay-event-id");
    if (providerEventId && providerEventId.length > 128) {
      res.status(400).json({
        error: "The Razorpay event ID is too long.",
        code: "INVALID_WEBHOOK_EVENT_ID",
      });
      return;
    }
    const eventId = providerEventId || bodySha256;

    const [newEvent] = await db
      .insert(razorpayWebhookEventsTable)
      .values({
        eventId,
        eventType,
        razorpayOrderId: providerOrderId,
        razorpayPaymentId: providerPaymentId,
        bodySha256,
      })
      .onConflictDoNothing()
      .returning({ id: razorpayWebhookEventsTable.id });
    if (!newEvent) {
      const [existingEvent] = await db
        .select()
        .from(razorpayWebhookEventsTable)
        .where(eq(razorpayWebhookEventsTable.eventId, eventId))
        .limit(1);
      if (existingEvent?.bodySha256 !== bodySha256) {
        req.log.warn(
          { eventId },
          "Razorpay reused an event ID with a different payload",
        );
        res.status(400).json({
          error: "The webhook event ID did not match its saved payload.",
          code: "WEBHOOK_EVENT_MISMATCH",
        });
        return;
      }
      if (existingEvent?.processedAt) {
        res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Already processed." }));
        return;
      }
    }

    if (
      eventType !== "order.paid" &&
      eventType !== "payment.captured"
    ) {
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Event acknowledged." }));
      return;
    }

    const isCaptured =
      providerPayment?.status === "captured" || providerPayment?.captured === true;
    const amount =
      typeof providerPayment?.amount === "number"
        ? providerPayment.amount
        : typeof order?.amount === "number"
          ? order.amount
          : null;
    const currency =
      webhookText(providerPayment?.currency) ?? webhookText(order?.currency);
    const isPaidOrder =
      eventType !== "order.paid" ||
      (order?.status === "paid" &&
        typeof order.amount === "number" &&
        order.amount === amount &&
        webhookText(order.currency) === currency);
    if (
      !providerOrderId ||
      !providerPaymentId ||
      amount === null ||
      !currency ||
      !isCaptured ||
      !isPaidOrder
    ) {
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Event acknowledged." }));
      return;
    }

    const payment = paymentForWebhook;
    if (!payment) {
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Unmatched event acknowledged." }));
      return;
    }
    if (payment.amountMinor !== amount || payment.currency !== currency) {
      req.log.error(
        { internalPaymentId: payment.id, providerOrderId },
        "Razorpay webhook amount did not match the saved order",
      );
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Mismatched event acknowledged." }));
      return;
    }

    try {
      await activateCapturedPayment({
        paymentId: payment.id,
        razorpayOrderId: providerOrderId,
        razorpayPaymentId: providerPaymentId,
        amountMinor: amount,
        currency,
      });
      await db
        .update(razorpayWebhookEventsTable)
        .set({ processedAt: new Date() })
        .where(eq(razorpayWebhookEventsTable.eventId, eventId));
      res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Payment captured." }));
    } catch (error) {
      req.log.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          internalPaymentId: payment.id,
          providerOrderId,
        },
        "Razorpay webhook payment processing failed",
      );
      res.status(500).json({
        error: "The payment event could not be processed yet.",
        code: "WEBHOOK_PROCESSING_FAILED",
      });
    }
  },
);

export default router;