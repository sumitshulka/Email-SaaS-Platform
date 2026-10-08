import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  gt,
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
  ActivateFreeAddOnBody,
  ActivateFreeAddOnResponse,
  CreateSubscriptionOrderBody,
  CreateSubscriptionPackageBody,
  CreateSubscriptionPackageResponse,
  GiftAdminSubscriptionBody,
  GiftAdminSubscriptionResponse,
  GetCurrentSubscriptionResponse,
  GetOnlinePaymentSettingsResponse,
  GetRazorpaySettingsResponse,
  GetSubscriptionAddOnsResponse,
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
  addOnEntitlementsTable,
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
  activateNoCostPrimaryPlanChange,
  activateCapturedPayment,
  calculateProratedUpgradeAmountMinor,
  comparePrimaryPlanLimits,
  getCurrentSubscriptionForUser,
  grantAdminGiftSubscription,
  markRefundedPayment,
  PlanChangeError,
  serializePackage,
} from "../lib/billing";
import { writeAuditLog } from "../lib/audit";
import { getSubscriptionAddOnsDashboard } from "../lib/add-on-entitlements";
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
    .where(
      and(
        eq(subscriptionPackagesTable.amountMinor, 0),
        eq(subscriptionPackagesTable.packageType, "primary"),
      ),
    );
  return freePackages.some(({ id }) => id !== exceptPackageId);
}

function packageConfigurationError(input: {
  packageType: "primary" | "addon";
  periodDays: number;
  contactLimit: number;
  emailAccountLimit: number;
  researchAllowance: number;
  aiEmailAssistAllowance: number;
  additionalMailboxCount: number;
  preferred: boolean;
}): string | null {
  if (input.packageType === "primary") {
    if (input.periodDays < 1) return "A primary package must have a term of at least one day.";
    if (input.aiEmailAssistAllowance > 0 || input.additionalMailboxCount > 0) {
      return "AI email assist and additional mailbox allowances belong to add-on packages.";
    }
    return null;
  }
  if (
    input.periodDays !== 0 ||
    input.contactLimit !== 0 ||
    input.emailAccountLimit !== 0 ||
    input.preferred
  ) {
    return "Add-on packages do not set a term, contact limit, primary SMTP limit, or preferred badge.";
  }
  if (
    input.researchAllowance === 0 &&
    input.aiEmailAssistAllowance === 0 &&
    input.additionalMailboxCount === 0
  ) {
    return "An add-on package must include at least one allowance.";
  }
  return null;
}

function respondFreePackageConflict(res: Response): void {
  res.status(409).json({
    error: "Only one zero-price primary package can exist. Edit the existing free primary package or change its price.",
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
    const packageType = parsed.data.packageType ?? "primary";
    const normalized = {
      ...parsed.data,
      packageType,
      periodDays: packageType === "addon" ? 0 : parsed.data.periodDays,
      contactLimit: packageType === "addon" ? 0 : parsed.data.contactLimit,
      emailAccountLimit:
        packageType === "addon" ? 0 : (parsed.data.emailAccountLimit ?? 0),
      researchAllowance: parsed.data.researchAllowance ?? 0,
      aiEmailAssistAllowance: parsed.data.aiEmailAssistAllowance ?? 0,
      additionalMailboxCount: parsed.data.additionalMailboxCount ?? 0,
      preferred: packageType === "primary" && (parsed.data.preferred ?? false),
    };
    const configurationError = packageConfigurationError(normalized);
    if (configurationError) {
      invalidInput(res, configurationError);
      return;
    }
    if (
      packageType === "primary" &&
      normalized.amountMinor === 0 &&
      (await hasOtherFreePackage())
    ) {
      respondFreePackageConflict(res);
      return;
    }
    let created: SubscriptionPackageRow | undefined;
    try {
      created = await db.transaction(async (tx) => {
        if (normalized.preferred) {
          await tx
            .update(subscriptionPackagesTable)
            .set({
              preferred: false,
              updatedBy: req.authUser!.id,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(subscriptionPackagesTable.preferred, true),
                eq(subscriptionPackagesTable.packageType, "primary"),
              ),
            );
        }
        const [inserted] = await tx
          .insert(subscriptionPackagesTable)
          .values({
            ...normalized,
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
        packageType: created!.packageType,
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
    const [currentPackage] = await db
      .select()
      .from(subscriptionPackagesTable)
      .where(eq(subscriptionPackagesTable.id, params.data.packageId))
      .limit(1);
    if (!currentPackage) {
      res.status(404).json({ error: "Subscription package not found.", code: "NOT_FOUND" });
      return;
    }
    const effectivePackage = {
      ...currentPackage,
      ...parsed.data,
      aiEmailAssistAllowance:
        parsed.data.aiEmailAssistAllowance ??
        currentPackage.aiEmailAssistAllowance,
      additionalMailboxCount:
        parsed.data.additionalMailboxCount ??
        currentPackage.additionalMailboxCount,
      researchAllowance:
        parsed.data.researchAllowance ?? currentPackage.researchAllowance,
    };
    const configurationError = packageConfigurationError(effectivePackage);
    if (configurationError) {
      invalidInput(res, configurationError);
      return;
    }
    if (
      currentPackage.packageType === "primary" &&
      effectivePackage.amountMinor === 0 &&
      (await hasOtherFreePackage(params.data.packageId))
    ) {
      respondFreePackageConflict(res);
      return;
    }
    let updated: SubscriptionPackageRow | undefined;
    try {
      updated = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: subscriptionPackagesTable.id, packageType: subscriptionPackagesTable.packageType })
          .from(subscriptionPackagesTable)
          .where(eq(subscriptionPackagesTable.id, params.data.packageId))
          .limit(1);
        if (!existing) return undefined;

        const now = new Date();
        if (parsed.data.preferred && existing.packageType === "primary") {
          await tx
            .update(subscriptionPackagesTable)
            .set({
              preferred: false,
              updatedBy: req.authUser!.id,
              updatedAt: now,
            })
            .where(
              and(
                eq(subscriptionPackagesTable.preferred, true),
                eq(subscriptionPackagesTable.packageType, "primary"),
              ),
            );
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
            .where(
              and(
                eq(subscriptionPackagesTable.active, true),
                eq(subscriptionPackagesTable.packageType, "primary"),
              ),
            )
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
  "/subscriptions/add-ons",
  requireUserRole,
  async (req, res): Promise<void> => {
    const dashboard = await getSubscriptionAddOnsDashboard(req.authUser!.id);
    res.json(GetSubscriptionAddOnsResponse.parse(dashboard));
  },
);

router.post(
  "/subscriptions/add-ons/free",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = ActivateFreeAddOnBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInput(res, "Choose a valid free add-on package.");
      return;
    }
    if (!req.authUser!.emailVerified) {
      res.status(403).json({
        error: "Verify your email before activating an add-on.",
        code: "EMAIL_VERIFICATION_REQUIRED",
      });
      return;
    }

    try {
      const entitlement = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.id, req.authUser!.id))
          .limit(1)
          .for("update");
        if (!user) return { error: "ACCOUNT_NOT_FOUND" as const };

        const now = new Date();
        const [active] = await tx
          .select({ pkg: subscriptionPackagesTable })
          .from(userSubscriptionsTable)
          .innerJoin(
            subscriptionPackagesTable,
            eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
          )
          .where(
            and(
              eq(userSubscriptionsTable.userId, user.id),
              eq(userSubscriptionsTable.status, "active"),
              lte(userSubscriptionsTable.startsAt, now),
              gt(userSubscriptionsTable.endsAt, now),
            ),
          )
          .orderBy(desc(userSubscriptionsTable.endsAt))
          .limit(1)
          .for("update");
        if (
          !active ||
          active.pkg.packageType !== "primary" ||
          active.pkg.amountMinor <= 0
        ) {
          return { error: "PAID_PRIMARY_REQUIRED" as const };
        }

        const [pkg] = await tx
          .select()
          .from(subscriptionPackagesTable)
          .where(
            and(
              eq(subscriptionPackagesTable.id, parsed.data.packageId),
              eq(subscriptionPackagesTable.packageType, "addon"),
              eq(subscriptionPackagesTable.active, true),
            ),
          )
          .limit(1)
          .for("update");
        if (!pkg || pkg.amountMinor !== 0) {
          return { error: "PACKAGE_NOT_AVAILABLE" as const };
        }

        const [claimed] = await tx
          .select({ id: addOnEntitlementsTable.id })
          .from(addOnEntitlementsTable)
          .where(
            and(
              eq(addOnEntitlementsTable.userId, user.id),
              eq(addOnEntitlementsTable.packageId, pkg.id),
              isNull(addOnEntitlementsTable.paymentId),
            ),
          )
          .limit(1);
        if (claimed) return { error: "ALREADY_CLAIMED" as const };

        const [created] = await tx
          .insert(addOnEntitlementsTable)
          .values({
            userId: user.id,
            packageId: pkg.id,
            paymentId: null,
            researchAllowance: pkg.researchAllowance,
            aiEmailAssistAllowance: pkg.aiEmailAssistAllowance,
            additionalMailboxCount: pkg.additionalMailboxCount,
          })
          .returning({ id: addOnEntitlementsTable.id });
        return created
          ? { entitlementId: created.id, package: pkg }
          : { error: "PACKAGE_NOT_AVAILABLE" as const };
      });

      if ("error" in entitlement) {
        const status = entitlement.error === "PACKAGE_NOT_AVAILABLE" ? 404 :
          entitlement.error === "PAID_PRIMARY_REQUIRED" ? 403 :
            entitlement.error === "ACCOUNT_NOT_FOUND" ? 404 : 409;
        res.status(status).json({
          error:
            entitlement.error === "PAID_PRIMARY_REQUIRED"
              ? "An active paid primary package is required to activate add-ons."
              : entitlement.error === "ALREADY_CLAIMED"
                ? "This free add-on has already been claimed."
                : "That free add-on is not available.",
          code: entitlement.error,
        });
        return;
      }
      await writeAuditLog({
        actorId: req.authUser!.id,
        action: "subscription_addon.activated_free",
        entity: "add_on_entitlement",
        entityId: entitlement.entitlementId,
        ipAddress: req.ip,
        metadata: { packageId: entitlement.package.id },
      });
      res.status(201).json(
        ActivateFreeAddOnResponse.parse({
          entitlementId: entitlement.entitlementId,
          message: "Free add-on activated.",
        }),
      );
    } catch (error) {
      const details = error as { code?: unknown; constraint?: unknown };
      if (
        details.code === "23505" &&
        details.constraint === "add_on_entitlements_free_claim_unique"
      ) {
        res.status(409).json({
          error: "This free add-on has already been claimed.",
          code: "ALREADY_CLAIMED",
        });
        return;
      }
      throw error;
    }
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
          eq(subscriptionPackagesTable.packageType, "primary"),
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
    const currentState = await getCurrentSubscriptionForUser(req.authUser!.id);
    const activeSubscription =
      currentState.subscription?.status === "active"
        ? currentState.subscription
        : null;
    if (
      currentState.scheduledSubscription &&
      currentState.scheduledSubscription.package.id !== selectedPackage.id
    ) {
      res.status(409).json({
        error:
          "A primary plan change is already scheduled. It must start before another change can be made.",
        code: "PLAN_CHANGE_ALREADY_SCHEDULED",
      });
      return;
    }
    if (selectedPackage.amountMinor > 0) {
      if (!activeSubscription) {
        res.status(409).json({
          error: "This paid package requires checkout.",
          code: "UPGRADE_REQUIRES_PAYMENT",
        });
        return;
      }
      const changeKind = comparePrimaryPlanLimits(
        activeSubscription.package,
        selectedPackage,
      );
      const amountDue = calculateProratedUpgradeAmountMinor({
        currentPackage: activeSubscription.package,
        targetPackage: selectedPackage,
        endsAt: new Date(activeSubscription.endsAt),
        now: new Date(),
      });
      if (changeKind !== "upgrade" || amountDue !== 0) {
        res.status(409).json({
          error: "This plan change requires payment through checkout.",
          code: "UPGRADE_REQUIRES_PAYMENT",
        });
        return;
      }
    }
    const addOnDashboard =
      selectedPackage.amountMinor > 0
        ? await getSubscriptionAddOnsDashboard(req.authUser!.id)
        : null;
    const effectiveEmailAccountLimit =
      selectedPackage.emailAccountLimit +
      (selectedPackage.amountMinor > 0
        ? addOnDashboard?.balances.mailboxes.additionalSlots ?? 0
        : 0);
    const retention = await validateSenderAccountRetention(
      req.authUser!.id,
      effectiveEmailAccountLimit,
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
      subscription = await activateNoCostPrimaryPlanChange({
        userId: req.authUser!.id,
        packageId: parsed.data.packageId,
        effectiveEmailAccountLimit,
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
        code:
          error instanceof PlanChangeError
            ? error.code
            : "SENDER_ACCOUNT_RETENTION_REQUIRED",
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
    if (pkg.packageType === "addon") {
      if (pkg.amountMinor === 0) {
        res.status(400).json({
          error: "Free add-ons are activated directly without Razorpay Checkout.",
          code: "FREE_ADDON_REQUIRES_DIRECT_ACTIVATION",
        });
        return;
      }
      const { subscription } = await getCurrentSubscriptionForUser(
        req.authUser!.id,
      );
      if (
        !subscription ||
        subscription.status !== "active" ||
        subscription.package.packageType !== "primary" ||
        subscription.package.amountMinor <= 0
      ) {
        res.status(403).json({
          error: "An active paid primary package is required to purchase add-ons.",
          code: "PAID_PRIMARY_REQUIRED",
        });
        return;
      }
    } else if (pkg.packageType !== "primary") {
      invalidInput(res, "This package cannot be purchased as a primary plan.");
      return;
    } else if (pkg.amountMinor === 0) {
      res.status(400).json({
        error: "Free packages are activated directly and do not use Razorpay Checkout.",
        code: "FREE_PACKAGE_REQUIRES_DIRECT_ACTIVATION",
      });
      return;
    }

    let amountMinor = pkg.amountMinor;
    let subscriptionChangeType: "upgrade" | "scheduled" | null = null;
    let sourceSubscriptionId: string | null = null;
    let planChangeEffectiveAt: Date | null = null;
    if (pkg.packageType === "primary") {
      const currentState = await getCurrentSubscriptionForUser(
        req.authUser!.id,
      );
      if (currentState.scheduledSubscription) {
        res.status(409).json({
          error:
            "A primary plan change is already scheduled. It must start before another change can be made.",
          code: "PLAN_CHANGE_ALREADY_SCHEDULED",
        });
        return;
      }
      const current =
        currentState.subscription?.status === "active"
          ? currentState.subscription
          : null;
      if (current?.package.id === pkg.id) {
        res.status(409).json({
          error: "This package is already active on your workspace.",
          code: "CURRENT_PLAN",
        });
        return;
      }
      if (current) {
        sourceSubscriptionId = current.id;
        planChangeEffectiveAt = new Date(current.endsAt);
        const changeKind = comparePrimaryPlanLimits(current.package, pkg);
        const proratedAmount =
          changeKind === "upgrade"
            ? calculateProratedUpgradeAmountMinor({
                currentPackage: current.package,
                targetPackage: pkg,
                endsAt: planChangeEffectiveAt,
                now: new Date(),
              })
            : null;
        if (proratedAmount !== null) {
          amountMinor = proratedAmount;
          subscriptionChangeType = "upgrade";
          if (amountMinor === 0) {
            res.status(409).json({
              error:
                "No payment is due for this upgrade. Activate it directly from the plan page.",
              code: "ZERO_COST_UPGRADE_REQUIRES_DIRECT_ACTIVATION",
            });
            return;
          }
        } else {
          subscriptionChangeType = "scheduled";
        }
      }
    }

    if (!(await loadOnlinePaymentSettings()).enabled) {
      res.status(503).json({
        error:
          "Online payments are not active at the moment. Contact the platform administrator to activate your account.",
        code: "ONLINE_PAYMENTS_DISABLED",
      });
      return;
    }
    const addOnDashboard = pkg.packageType === "primary" && pkg.amountMinor > 0
      ? await getSubscriptionAddOnsDashboard(req.authUser!.id)
      : null;
    const retention = pkg.packageType === "addon"
      ? { ok: true as const, accountIdsToKeep: null }
      : await validateSenderAccountRetention(
          req.authUser!.id,
          pkg.emailAccountLimit +
            (pkg.amountMinor > 0
              ? addOnDashboard?.balances.mailboxes.additionalSlots ?? 0
              : 0),
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
        amountMinor,
        currency: pkg.currency,
        status: "created",
        subscriptionChangeType,
        sourceSubscriptionId,
        planChangeEffectiveAt,
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
          error:
            "Razorpay returned an order that did not match the server-calculated plan amount.",
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
        const activation = await activateCapturedPayment({
          paymentId: payment.id,
          razorpayOrderId: payment.razorpayOrderId!,
          razorpayPaymentId: providerPayment.id,
          amountMinor: providerPayment.amount,
          currency: providerPayment.currency,
        });
        const subscription = activation.subscription;
        const startsInFuture = subscription
          ? new Date(subscription.startsAt) > new Date()
          : false;
        res.json(
          VerifyRazorpayPaymentResponse.parse({
            status: "active",
            message: activation.addOnEntitlement
              ? "Payment verified. Your add-on allowances are available."
              : startsInFuture
                ? `Payment verified. ${subscription!.package.name} starts on ${new Date(subscription!.startsAt).toLocaleDateString()} after your current term ends.`
                : "Payment verified. Your subscription is active.",
            subscription,
            addOnEntitlement: activation.addOnEntitlement,
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
          addOnEntitlement: null,
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
    const refundWrapper = webhookEntity(payload.refund);
    const order = webhookEntity(orderWrapper?.entity);
    const providerPayment = webhookEntity(paymentWrapper?.entity);
    const providerRefund = webhookEntity(refundWrapper?.entity);
    const providerOrderId =
      webhookText(order?.id) ?? webhookText(providerPayment?.order_id);
    const providerPaymentId =
      webhookText(providerPayment?.id) ?? webhookText(providerRefund?.payment_id);
    const [paymentForWebhook] =
      providerOrderId
        ? await db
          .select()
          .from(paymentsTable)
          .where(eq(paymentsTable.razorpayOrderId, providerOrderId))
          .limit(1)
        : providerPaymentId
          ? await db
              .select()
              .from(paymentsTable)
              .where(eq(paymentsTable.razorpayPaymentId, providerPaymentId))
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

    if (eventType === "payment.refunded" || eventType === "refund.processed") {
      const amount =
        typeof providerPayment?.amount === "number"
          ? providerPayment.amount
          : null;
      const refundAmount =
        eventType === "payment.refunded"
          ? amount
          : typeof providerRefund?.amount === "number"
            ? providerRefund.amount
            : null;
      const reportedRefundTotal =
        typeof providerPayment?.amount_refunded === "number"
          ? providerPayment.amount_refunded
          : null;
      const currency = webhookText(providerPayment?.currency);
      const refundCurrency = webhookText(providerRefund?.currency);
      const isProcessedRefund =
        eventType === "payment.refunded"
          ? providerPayment?.status === "refunded"
          : providerRefund?.status === "processed" &&
            refundAmount !== null &&
            Number.isInteger(refundAmount) &&
            refundAmount > 0 &&
            amount !== null &&
            refundAmount <= amount &&
            (reportedRefundTotal === null ||
              (Number.isInteger(reportedRefundTotal) &&
                reportedRefundTotal >= 0 &&
                reportedRefundTotal <= amount));
      const refundOrderId =
        providerOrderId ?? paymentForWebhook?.razorpayOrderId ?? null;
      if (
        !isProcessedRefund ||
        (eventType === "refund.processed" &&
          (!refundCurrency || refundCurrency !== currency)) ||
        !refundOrderId ||
        !providerPaymentId ||
        amount === null ||
        !currency ||
        !paymentForWebhook ||
        paymentForWebhook.amountMinor !== amount ||
        paymentForWebhook.currency !== currency
      ) {
        await db
          .update(razorpayWebhookEventsTable)
          .set({ processedAt: new Date() })
          .where(eq(razorpayWebhookEventsTable.eventId, eventId));
        res.json(ReceiveRazorpayWebhookResponse.parse({ message: "Refund event acknowledged." }));
        return;
      }

      try {
        const marked = await markRefundedPayment({
          paymentId: paymentForWebhook.id,
          razorpayOrderId: refundOrderId,
          razorpayPaymentId: providerPaymentId,
          amountMinor: amount,
          currency,
          refundAmountMinor: refundAmount!,
          totalRefundedAmountMinor:
            reportedRefundTotal !== null &&
            reportedRefundTotal >= refundAmount! &&
            reportedRefundTotal <= amount
              ? reportedRefundTotal
              : null,
        });
        await db
          .update(razorpayWebhookEventsTable)
          .set({ processedAt: new Date() })
          .where(eq(razorpayWebhookEventsTable.eventId, eventId));
        res.json(
          ReceiveRazorpayWebhookResponse.parse({
            message: marked
              ? "Payment refund recorded."
              : "Refund event acknowledged.",
          }),
        );
      } catch (error) {
        req.log.error(
          {
            errorName: error instanceof Error ? error.name : "UnknownError",
            internalPaymentId: paymentForWebhook.id,
            providerOrderId,
          },
          "Razorpay refund processing failed",
        );
        res.status(500).json({
          error: "The refund event could not be processed yet.",
          code: "WEBHOOK_PROCESSING_FAILED",
        });
      }
      return;
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
      const [latestPayment] = await db
        .select({ status: paymentsTable.status })
        .from(paymentsTable)
        .where(eq(paymentsTable.id, payment.id))
        .limit(1);
      if (
        latestPayment?.status === "refunded" ||
        latestPayment?.status === "failed"
      ) {
        await db
          .update(razorpayWebhookEventsTable)
          .set({ processedAt: new Date() })
          .where(eq(razorpayWebhookEventsTable.eventId, eventId));
        res.json(
          ReceiveRazorpayWebhookResponse.parse({
            message: "A failed or refunded payment cannot activate an add-on.",
          }),
        );
        return;
      }
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