import {
  and,
  count,
  desc,
  eq,
  gte,
  gt,
  inArray,
  ilike,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetAdminDashboardResponse,
  GetAdminSettingsResponse,
  GetApplicationEmailSettingsResponse,
  GetGoogleOAuthSettingsResponse,
  ListAdminUsersQueryParams,
  ListAdminUsersResponse,
  SendApplicationEmailTestBody,
  SendApplicationEmailTestResponse,
  UpdateAdminSettingsBody,
  UpdateAdminSettingsResponse,
  UpdateAdminUserStatusBody,
  UpdateAdminUserStatusParams,
  UpdateAdminUserStatusResponse,
  DeleteAdminUserParams,
  DeleteAdminUserResponse,
  UpdateApplicationEmailSettingsBody,
  UpdateApplicationEmailSettingsResponse,
  UpdateGoogleOAuthSettingsBody,
  UpdateGoogleOAuthSettingsResponse,
} from "@workspace/api-zod";
import {
  applicationEmailConfigurationTable,
  auditLogsTable,
  db,
  emailSendAttemptsTable,
  paymentsTable,
  razorpayConfigurationTable,
  subscriptionPackagesTable,
  systemConfigurationTable,
  userSubscriptionsTable,
  userSessionsTable,
  usersTable,
} from "@workspace/db";
import { writeAuditLog } from "../lib/audit";
import {
  decryptSecret,
  encryptSecret,
} from "../lib/security";
import { sendApplicationEmail } from "../lib/application-email";
import { getPlatformSettings } from "../lib/platform-settings";
import { getCurrentSubscriptionForUser } from "../lib/billing";
import {
  getGoogleOAuthSettingsStatus,
  isValidGoogleOAuthRedirectUri,
  saveGoogleOAuthConfiguration,
} from "../lib/google-oauth-configuration";
import { requireSuperadmin } from "../lib/session";

const router: IRouter = Router();

const SMTP_PROVIDER_PRESETS = {
  google_workspace: { host: "smtp.gmail.com", port: 587, encryption: "tls" },
  gmail: { host: "smtp.gmail.com", port: 587, encryption: "tls" },
  microsoft_365: { host: "smtp.office365.com", port: 587, encryption: "tls" },
  zeptomail: { host: "smtp.zeptomail.com", port: 587, encryption: "tls" },
} as const;

function toAdminUser(
  user: typeof usersTable.$inferSelect,
  subscriptionStatus: string | null = null,
) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    emailVerified: user.emailVerified,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    subscriptionStatus,
  };
}

async function toAdminUsers(users: Array<typeof usersTable.$inferSelect>) {
  if (users.length === 0) return [];
  const now = new Date();
  const subscriptionRows = await db
    .select({
      userId: userSubscriptionsTable.userId,
      packageName: subscriptionPackagesTable.name,
      endsAt: userSubscriptionsTable.endsAt,
    })
    .from(userSubscriptionsTable)
    .innerJoin(
      subscriptionPackagesTable,
      eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
    )
    .where(
      and(
        inArray(userSubscriptionsTable.userId, users.map((user) => user.id)),
        eq(userSubscriptionsTable.status, "active"),
        lte(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
      ),
    )
    .orderBy(desc(userSubscriptionsTable.endsAt));
  const statusByUser = new Map<string, string>();
  for (const row of subscriptionRows) {
    if (!statusByUser.has(row.userId)) {
      statusByUser.set(row.userId, `Active · ${row.packageName}`);
    }
  }
  return users.map((user) => toAdminUser(user, statusByUser.get(user.id) ?? null));
}

router.get("/admin/dashboard", requireSuperadmin, async (_req, res): Promise<void> => {
  const liveUsers = and(
    eq(usersTable.role, "USER"),
    isNull(usersTable.deletedAt),
  );
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const monthKeys = Array.from({ length: 6 }, (_, index) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1))
      .toISOString()
      .slice(0, 7),
  );
  const currentMonthKey = monthKeys[monthKeys.length - 1] ?? now.toISOString().slice(0, 7);
  const currentMonthExpression = sql<string>`to_char(date_trunc('month', ${usersTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM')`;
  const capturedAtExpression = sql<Date>`COALESCE(
    ${userSubscriptionsTable.createdAt}, ${paymentsTable.updatedAt}
  )`;
  const paymentMonthExpression = sql<string>`to_char(date_trunc('month', ${capturedAtExpression} AT TIME ZONE 'UTC'), 'YYYY-MM')`;
  const activeSubscriptionConditions = and(
    eq(userSubscriptionsTable.status, "active"),
    eq(usersTable.role, "USER"),
    isNull(usersTable.deletedAt),
    lte(userSubscriptionsTable.startsAt, now),
    gt(userSubscriptionsTable.endsAt, now),
  );
  const [gatewayConfig] = await db
    .select({ activeEnvironment: razorpayConfigurationTable.activeEnvironment })
    .from(razorpayConfigurationTable)
    .where(eq(razorpayConfigurationTable.id, "platform"))
    .limit(1);
  const billingEnvironment = gatewayConfig?.activeEnvironment ?? null;
  const paymentEnvironmentCondition = billingEnvironment
    ? eq(paymentsTable.razorpayEnvironment, billingEnvironment)
    : sql`false`;

  const [
    [allCount],
    [activeCount],
    [pendingCount],
    [disabledCount],
    [newCount],
    recent,
    [subscriptionCounts],
    [activePackageCount],
    endingSoonRows,
    packageActivityRows,
    registrationRows,
    monthlyRevenueRows,
    lifetimeRevenueRows,
    [emailConfig],
    platformSettings,
    [emailAttempts],
  ] = await Promise.all([
    db.select({ value: count() }).from(usersTable).where(liveUsers),
    db
      .select({ value: count() })
      .from(usersTable)
      .where(and(liveUsers, eq(usersTable.active, true), eq(usersTable.emailVerified, true))),
    db
      .select({ value: count() })
      .from(usersTable)
      .where(and(liveUsers, eq(usersTable.emailVerified, false))),
    db
      .select({ value: count() })
      .from(usersTable)
      .where(and(liveUsers, eq(usersTable.active, false), eq(usersTable.emailVerified, true))),
    db
      .select({ value: count() })
      .from(usersTable)
      .where(and(liveUsers, gte(usersTable.createdAt, monthStart), lt(usersTable.createdAt, nextMonthStart))),
    db
      .select()
      .from(usersTable)
      .where(liveUsers)
      .orderBy(desc(usersTable.createdAt))
      .limit(5),
    db
      .select({
        subscriptions: count(),
        customers: sql<number>`count(distinct ${userSubscriptionsTable.userId})`.mapWith(Number),
      })
      .from(userSubscriptionsTable)
      .innerJoin(usersTable, eq(userSubscriptionsTable.userId, usersTable.id))
      .where(activeSubscriptionConditions),
    db
      .select({ value: count() })
      .from(subscriptionPackagesTable)
      .where(eq(subscriptionPackagesTable.active, true)),
    db
      .select({ value: count() })
      .from(userSubscriptionsTable)
      .innerJoin(usersTable, eq(userSubscriptionsTable.userId, usersTable.id))
      .where(
        and(
          activeSubscriptionConditions,
          lte(userSubscriptionsTable.endsAt, nextWeek),
        ),
      ),
    db
      .select({
        packageName: subscriptionPackagesTable.name,
        activeSubscriptions: count(),
      })
      .from(userSubscriptionsTable)
      .innerJoin(usersTable, eq(userSubscriptionsTable.userId, usersTable.id))
      .innerJoin(
        subscriptionPackagesTable,
        eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
      )
      .where(activeSubscriptionConditions)
      .groupBy(subscriptionPackagesTable.id, subscriptionPackagesTable.name)
      .orderBy(desc(count())),
    db
      .select({
        month: currentMonthExpression,
        registrations: count(),
      })
      .from(usersTable)
      .where(and(liveUsers, gte(usersTable.createdAt, trendStart), lt(usersTable.createdAt, nextMonthStart)))
      .groupBy(currentMonthExpression)
      .orderBy(currentMonthExpression),
    db
      .select({
        month: paymentMonthExpression,
        currency: paymentsTable.currency,
        capturedMinor: sql<string>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'captured' THEN ${paymentsTable.amountMinor} ELSE 0 END), 0)::text`,
        refundedMinor: sql<string>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'refunded' THEN ${paymentsTable.amountMinor} ELSE 0 END), 0)::text`,
        capturedPayments: sql<number>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'captured' THEN 1 ELSE 0 END), 0)::int`,
        refundedPayments: sql<number>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'refunded' THEN 1 ELSE 0 END), 0)::int`,
      })
      .from(paymentsTable)
      .innerJoin(usersTable, eq(paymentsTable.userId, usersTable.id))
      .leftJoin(userSubscriptionsTable, eq(userSubscriptionsTable.paymentId, paymentsTable.id))
      .where(
        and(
          eq(usersTable.role, "USER"),
          paymentEnvironmentCondition,
          inArray(paymentsTable.status, ["captured", "refunded"]),
          gte(capturedAtExpression, trendStart),
          lt(capturedAtExpression, nextMonthStart),
        ),
      )
      .groupBy(paymentsTable.currency, paymentMonthExpression)
      .orderBy(paymentsTable.currency, paymentMonthExpression),
    db
      .select({
        currency: paymentsTable.currency,
        capturedMinor: sql<string>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'captured' THEN ${paymentsTable.amountMinor} ELSE 0 END), 0)::text`,
        refundedMinor: sql<string>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'refunded' THEN ${paymentsTable.amountMinor} ELSE 0 END), 0)::text`,
        capturedPayments: sql<number>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'captured' THEN 1 ELSE 0 END), 0)::int`,
        refundedPayments: sql<number>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'refunded' THEN 1 ELSE 0 END), 0)::int`,
      })
      .from(paymentsTable)
      .innerJoin(usersTable, eq(paymentsTable.userId, usersTable.id))
      .where(
        and(
          eq(usersTable.role, "USER"),
          paymentEnvironmentCondition,
          inArray(paymentsTable.status, ["captured", "refunded"]),
        ),
      )
      .groupBy(paymentsTable.currency)
      .orderBy(paymentsTable.currency),
    db
      .select({
        host: applicationEmailConfigurationTable.host,
        username: applicationEmailConfigurationTable.username,
        passwordEncrypted: applicationEmailConfigurationTable.passwordEncrypted,
        fromEmail: applicationEmailConfigurationTable.fromEmail,
      })
      .from(applicationEmailConfigurationTable)
      .where(eq(applicationEmailConfigurationTable.id, "platform"))
      .limit(1),
    getPlatformSettings(),
    db.select({ value: count() }).from(emailSendAttemptsTable),
  ]);

  const registrationCounts = new Map(registrationRows.map((row) => [row.month, row.registrations]));
  const registrationsByMonth = monthKeys.map((month) => ({
    month,
    registrations: registrationCounts.get(month) ?? 0,
  }));
  const monthlyRevenueByCurrency = new Map<
    string,
    Map<string, { capturedMinor: bigint; refundedMinor: bigint; capturedPayments: number; refundedPayments: number }>
  >();
  for (const row of monthlyRevenueRows) {
    const monthData = monthlyRevenueByCurrency.get(row.currency) ?? new Map();
    monthData.set(row.month, {
      capturedMinor: BigInt(row.capturedMinor),
      refundedMinor: BigInt(row.refundedMinor),
      capturedPayments: row.capturedPayments,
      refundedPayments: row.refundedPayments,
    });
    monthlyRevenueByCurrency.set(row.currency, monthData);
  }
  const amountFromMinor = (minor: bigint, currency: string) => {
    const digits = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return Number(minor) / 10 ** digits;
  };
  const revenueByCurrency = lifetimeRevenueRows.map((row) => {
    const lifetimeCapturedMinor = BigInt(row.capturedMinor);
    const lifetimeRefundedMinor = BigInt(row.refundedMinor);
    const currentMonth = monthlyRevenueByCurrency.get(row.currency)?.get(currentMonthKey);
    const capturedThisMonthMinor = currentMonth?.capturedMinor ?? 0n;
    const refundedThisMonthMinor = currentMonth?.refundedMinor ?? 0n;
    return {
      currency: row.currency,
      revenueThisMonth: amountFromMinor(capturedThisMonthMinor - refundedThisMonthMinor, row.currency),
      totalRevenue: amountFromMinor(lifetimeCapturedMinor - lifetimeRefundedMinor, row.currency),
      capturedThisMonth: amountFromMinor(capturedThisMonthMinor, row.currency),
      refundedThisMonth: amountFromMinor(refundedThisMonthMinor, row.currency),
      capturedLifetime: amountFromMinor(lifetimeCapturedMinor, row.currency),
      refundedLifetime: amountFromMinor(lifetimeRefundedMinor, row.currency),
      capturedPaymentsThisMonth: currentMonth?.capturedPayments ?? 0,
      refundedPaymentsThisMonth: currentMonth?.refundedPayments ?? 0,
      capturedPaymentsTotal: row.capturedPayments,
      refundedPaymentsTotal: row.refundedPayments,
    };
  });
  const defaultCurrencyRevenue = revenueByCurrency.find(
    (summary) => summary.currency === platformSettings.defaultCurrency,
  );
  const defaultCurrencyTrend = monthKeys.map((month) => {
    const data = monthlyRevenueByCurrency.get(platformSettings.defaultCurrency)?.get(month);
    return {
      month,
      revenue: amountFromMinor(
        (data?.capturedMinor ?? 0n) - (data?.refundedMinor ?? 0n),
        platformSettings.defaultCurrency,
      ),
    };
  });
  const packageVisibility = platformSettings.packageVisibility;

  res.json(
    GetAdminDashboardResponse.parse({
      totalUsers: allCount?.value ?? 0,
      activeUsers: activeCount?.value ?? 0,
      pendingUsers: pendingCount?.value ?? 0,
      disabledUsers: disabledCount?.value ?? 0,
      newUsersThisMonth: newCount?.value ?? 0,
      activeSubscriptions: subscriptionCounts?.subscriptions ?? 0,
      activeCustomers: subscriptionCounts?.customers ?? 0,
      activePackages: activePackageCount?.value ?? 0,
      subscriptionsEndingSoon: endingSoonRows[0]?.value ?? 0,
      defaultCurrency: platformSettings.defaultCurrency,
      revenueThisMonth: defaultCurrencyRevenue?.revenueThisMonth ?? 0,
      totalRevenue: defaultCurrencyRevenue?.totalRevenue ?? 0,
      revenueByCurrency,
      registrationsByMonth,
      revenueTrend: defaultCurrencyTrend,
      activeSubscriptionsByPackage: packageActivityRows,
      billingEnvironment,
      applicationEmailConfigured: Boolean(
        emailConfig?.host &&
          emailConfig.username &&
          emailConfig.passwordEncrypted &&
          emailConfig.fromEmail,
      ),
      maintenanceMode: platformSettings.maintenanceMode,
      packageVisibility,
      emailsSent: emailAttempts?.value ?? 0,
      recentUsers: await toAdminUsers(recent),
    }),
  );
});

router.get("/admin/users", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = ListAdminUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid user search or pagination options.", code: "INVALID_INPUT" });
    return;
  }
  const { page, pageSize, status, search } = parsed.data;
  const conditions = [
    eq(usersTable.role, "USER" as const),
    isNull(usersTable.deletedAt),
  ];
  if (status === "active") {
    conditions.push(eq(usersTable.active, true), eq(usersTable.emailVerified, true));
  } else if (status === "inactive") {
    conditions.push(eq(usersTable.active, false));
  } else if (status === "pending") {
    conditions.push(eq(usersTable.emailVerified, false));
  }
  const normalizedSearch = search?.trim();
  if (normalizedSearch) {
    const term = `%${normalizedSearch}%`;
    const match = or(
      ilike(usersTable.firstName, term),
      ilike(usersTable.lastName, term),
      ilike(usersTable.email, term),
      ilike(usersTable.username, term),
    );
    if (match) conditions.push(match);
  }
  const where = and(...conditions);
  const [totalResult] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(where);
  const rows = await db
    .select()
    .from(usersTable)
    .where(where)
    .orderBy(desc(usersTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json(
    ListAdminUsersResponse.parse({
      items: await toAdminUsers(rows),
      total: totalResult?.value ?? 0,
      page,
      pageSize,
    }),
  );
});

router.patch("/admin/users/:userId/status", requireSuperadmin, async (req, res): Promise<void> => {
  const params = UpdateAdminUserStatusParams.safeParse(req.params);
  const body = UpdateAdminUserStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid account status request.", code: "INVALID_INPUT" });
    return;
  }
  const [target] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, params.data.userId),
        eq(usersTable.role, "USER"),
        isNull(usersTable.deletedAt),
      ),
    )
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Customer account not found.", code: "USER_NOT_FOUND" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ active: body.data.active })
    .where(eq(usersTable.id, target.id))
    .returning();
  if (!body.data.active) {
    await db
      .update(userSessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessionsTable.userId, target.id), isNull(userSessionsTable.revokedAt)));
  }
  await writeAuditLog({
    actorId: req.authUser!.id,
    action: body.data.active ? "user.activated" : "user.deactivated",
    entity: "user",
    entityId: target.id,
    ipAddress: req.ip,
  });
  res.json(UpdateAdminUserStatusResponse.parse(toAdminUser(updated)));
});

router.delete("/admin/users/:userId", requireSuperadmin, async (req, res): Promise<void> => {
  const params = DeleteAdminUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid account identifier.", code: "INVALID_INPUT" });
    return;
  }
  const [target] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, params.data.userId),
        eq(usersTable.role, "USER"),
        isNull(usersTable.deletedAt),
      ),
    )
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Customer account not found.", code: "USER_NOT_FOUND" });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ active: false, deletedAt: now })
      .where(eq(usersTable.id, target.id));
    await tx
      .update(userSessionsTable)
      .set({ revokedAt: now })
      .where(and(eq(userSessionsTable.userId, target.id), isNull(userSessionsTable.revokedAt)));
    await tx.insert(auditLogsTable).values({
      actorId: req.authUser!.id,
      action: "user.deleted",
      entity: "user",
      entityId: target.id,
      ipAddress: req.ip?.slice(0, 80) ?? null,
      metadata: {},
    });
  });
  res.status(204).json(DeleteAdminUserResponse.parse(undefined));
});

router.get("/admin/settings", requireSuperadmin, async (_req, res): Promise<void> => {
  const settings = await getPlatformSettings();
  res.json(GetAdminSettingsResponse.parse(settings));
});

router.put("/admin/settings", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Some configuration values are invalid.", code: "INVALID_SETTINGS" });
    return;
  }
  if (
    parsed.data.subjectVariantMinimum > parsed.data.subjectVariantMaximum ||
    parsed.data.greetingVariantMinimum > parsed.data.greetingVariantMaximum ||
    parsed.data.signatureVariantMinimum > parsed.data.signatureVariantMaximum
  ) {
    res.status(400).json({
      error: "Each campaign test minimum must be less than or equal to its maximum.",
      code: "INVALID_CAMPAIGN_VARIANT_LIMITS",
    });
    return;
  }
  const currentSettings = await getPlatformSettings();
  const settingsToSave = {
    ...parsed.data,
    // Preserve this policy when an older client omits the newly added field.
    prohibitedEmailKeywords:
      parsed.data.prohibitedEmailKeywords ??
      currentSettings.prohibitedEmailKeywords,
  };
  await db
    .insert(systemConfigurationTable)
    .values({ key: "platform", value: settingsToSave, updatedBy: req.authUser!.id })
    .onConflictDoUpdate({
      target: systemConfigurationTable.key,
      set: {
        value: settingsToSave,
        updatedBy: req.authUser!.id,
        updatedAt: new Date(),
      },
    });
  await writeAuditLog({
    actorId: req.authUser!.id,
    action: "system_configuration.updated",
    entity: "system_configuration",
    entityId: "platform",
    ipAddress: req.ip,
    metadata: { changedFields: Object.keys(parsed.data) },
  });
  res.json(UpdateAdminSettingsResponse.parse(await getPlatformSettings()));
});

router.get("/admin/settings/email", requireSuperadmin, async (_req, res): Promise<void> => {
  const [config] = await db
    .select()
    .from(applicationEmailConfigurationTable)
    .where(eq(applicationEmailConfigurationTable.id, "platform"));
  res.json(
    GetApplicationEmailSettingsResponse.parse({
      provider: config?.provider ?? "other",
      host: config?.host ?? null,
      port: config?.port ?? null,
      encryption: config?.encryption ?? null,
      username: config?.username ? "••••••" : null,
      passwordConfigured: Boolean(config?.passwordEncrypted),
      fromName: config?.fromName ?? null,
      fromEmail: config?.fromEmail ?? null,
      replyTo: config?.replyTo ?? null,
      updatedAt: config?.updatedAt?.toISOString() ?? null,
    }),
  );
});

router.put("/admin/settings/email", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = UpdateApplicationEmailSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Some application email values are invalid.", code: "INVALID_SETTINGS" });
    return;
  }
  const [existing] = await db
    .select()
    .from(applicationEmailConfigurationTable)
    .where(eq(applicationEmailConfigurationTable.id, "platform"));
  const suppliedUsername = parsed.data.username?.trim();
  const suppliedPassword = parsed.data.password?.trim();
  const preset =
    parsed.data.provider === "other"
      ? null
      : SMTP_PROVIDER_PRESETS[parsed.data.provider];
  const host = preset?.host ?? parsed.data.host;
  const port = preset?.port ?? parsed.data.port;
  const encryption = preset?.encryption ?? parsed.data.encryption;
  if (!existing && (!suppliedPassword || !suppliedUsername)) {
    res.status(400).json({
      error: "Enter the SMTP username and password to configure application email.",
      code: "SMTP_CREDENTIALS_REQUIRED",
    });
    return;
  }
  const username =
    suppliedUsername && suppliedUsername !== "••••••"
      ? encryptSecret(suppliedUsername)
      : existing?.username;
  if (!username) {
    res.status(400).json({ error: "Enter the SMTP username.", code: "SMTP_USERNAME_REQUIRED" });
    return;
  }
  const passwordEncrypted = suppliedPassword
    ? encryptSecret(suppliedPassword)
    : existing!.passwordEncrypted;
  await db
    .insert(applicationEmailConfigurationTable)
    .values({
      id: "platform",
      provider: parsed.data.provider,
      host,
      port,
      encryption,
      username,
      passwordEncrypted,
      fromName: parsed.data.fromName,
      fromEmail: parsed.data.fromEmail.trim().toLowerCase(),
      replyTo: parsed.data.replyTo?.trim().toLowerCase() ?? null,
      updatedBy: req.authUser!.id,
    })
    .onConflictDoUpdate({
      target: applicationEmailConfigurationTable.id,
      set: {
        provider: parsed.data.provider,
        host,
        port,
        encryption,
        username,
        passwordEncrypted,
        fromName: parsed.data.fromName,
        fromEmail: parsed.data.fromEmail.trim().toLowerCase(),
        replyTo: parsed.data.replyTo?.trim().toLowerCase() ?? null,
        updatedBy: req.authUser!.id,
        updatedAt: new Date(),
      },
    });
  await writeAuditLog({
    actorId: req.authUser!.id,
    action: "application_email_configuration.updated",
    entity: "application_email_configuration",
    entityId: "platform",
    ipAddress: req.ip,
    metadata: {
      host,
      provider: parsed.data.provider,
      fromEmail: parsed.data.fromEmail,
      passwordChanged: Boolean(suppliedPassword),
    },
  });
  const [saved] = await db
    .select()
    .from(applicationEmailConfigurationTable)
    .where(eq(applicationEmailConfigurationTable.id, "platform"));
  res.json(
    UpdateApplicationEmailSettingsResponse.parse({
      provider: saved!.provider,
      host: saved!.host,
      port: saved!.port,
      encryption: saved!.encryption,
      username: "••••••",
      passwordConfigured: true,
      fromName: saved!.fromName,
      fromEmail: saved!.fromEmail,
      replyTo: saved!.replyTo,
      updatedAt: saved!.updatedAt.toISOString(),
    }),
  );
});

router.post("/admin/settings/email/test", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = SendApplicationEmailTestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid destination email.", code: "INVALID_INPUT" });
    return;
  }
  try {
    const [config] = await db
      .select()
      .from(applicationEmailConfigurationTable)
      .where(eq(applicationEmailConfigurationTable.id, "platform"));
    if (!config) {
      res.status(400).json({ error: "Save application email settings before sending a test.", code: "SMTP_NOT_CONFIGURED" });
      return;
    }
    // Decrypt here to verify the stored ciphertext before the mail service is invoked.
    decryptSecret(config.passwordEncrypted);
    await sendApplicationEmail(
      parsed.data.toEmail,
      "Mailflow application email test",
      "Your application email settings are working.",
    );
    res.json(SendApplicationEmailTestResponse.parse({ message: "Test email sent successfully." }));
  } catch (error) {
    req.log.warn(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Application email test failed",
    );
    res.status(502).json({
      error: "The test message could not be sent. Verify the SMTP host, port, encryption, and credentials.",
      code: "SMTP_TEST_FAILED",
    });
  }
});

router.get(
  "/admin/settings/google-oauth",
  requireSuperadmin,
  async (_req, res): Promise<void> => {
    res.json(
      GetGoogleOAuthSettingsResponse.parse(
        await getGoogleOAuthSettingsStatus(),
      ),
    );
  },
);

router.put(
  "/admin/settings/google-oauth",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateGoogleOAuthSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Some Google OAuth settings are invalid.",
        code: "INVALID_GOOGLE_OAUTH_SETTINGS",
      });
      return;
    }

    const clientId = parsed.data.clientId.trim();
    const redirectUri = parsed.data.redirectUri.trim();
    const clientSecret = parsed.data.clientSecret?.trim();
    if (!clientId || !isValidGoogleOAuthRedirectUri(redirectUri)) {
      res.status(400).json({
        error:
          "Enter a client ID and an HTTPS callback URL ending in /api/sending/gmail/oauth/callback.",
        code: "INVALID_GOOGLE_OAUTH_SETTINGS",
      });
      return;
    }

    const currentStatus = await getGoogleOAuthSettingsStatus();
    if (!clientSecret && !currentStatus.clientSecretConfigured) {
      res.status(400).json({
        error: "Enter the Google OAuth client secret to finish setup.",
        code: "GOOGLE_OAUTH_SECRET_REQUIRED",
      });
      return;
    }

    await saveGoogleOAuthConfiguration({
      clientId,
      clientSecret,
      redirectUri,
      updatedBy: req.authUser!.id,
    });
    await writeAuditLog({
      actorId: req.authUser!.id,
      action: "google_oauth_configuration.updated",
      entity: "system_configuration",
      entityId: "google_oauth",
      ipAddress: req.ip,
      metadata: { clientSecretChanged: Boolean(clientSecret) },
    });
    res.json(
      UpdateGoogleOAuthSettingsResponse.parse(
        await getGoogleOAuthSettingsStatus(),
      ),
    );
  },
);

export default router;