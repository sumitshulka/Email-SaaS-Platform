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
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [allCount] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(liveUsers);
  const [activeCount] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(and(liveUsers, eq(usersTable.active, true), eq(usersTable.emailVerified, true)));
  const [pendingCount] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(and(liveUsers, eq(usersTable.emailVerified, false)));
  const [disabledCount] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(and(liveUsers, eq(usersTable.active, false), eq(usersTable.emailVerified, true)));
  const [newCount] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(and(liveUsers, gte(usersTable.createdAt, monthStart)));
  const recent = await db
    .select()
    .from(usersTable)
    .where(liveUsers)
    .orderBy(desc(usersTable.createdAt))
    .limit(5);
  const now = new Date();
  const [subscriptionCount] = await db
    .select({ value: count() })
    .from(userSubscriptionsTable)
    .where(
      and(
        eq(userSubscriptionsTable.status, "active"),
        lte(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
      ),
    );
  const platformSettings = await getPlatformSettings();
  const [revenue] = await db
    .select({
      value: sql<number>`coalesce(sum(${paymentsTable.amountMinor}), 0)`,
    })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.status, "captured"),
        eq(paymentsTable.currency, platformSettings.defaultCurrency),
        gte(paymentsTable.updatedAt, monthStart),
      ),
    );
  const [emailAttempts] = await db
    .select({ value: count() })
    .from(emailSendAttemptsTable);
  const minorUnitDigits = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: platformSettings.defaultCurrency,
  }).resolvedOptions().maximumFractionDigits;

  res.json(
    GetAdminDashboardResponse.parse({
      totalUsers: allCount?.value ?? 0,
      activeUsers: activeCount?.value ?? 0,
      pendingUsers: pendingCount?.value ?? 0,
      disabledUsers: disabledCount?.value ?? 0,
      newUsersThisMonth: newCount?.value ?? 0,
      activeSubscriptions: subscriptionCount?.value ?? 0,
      revenueThisMonth:
        Number(revenue?.value ?? 0) / 10 ** (minorUnitDigits ?? 2),
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
  await db
    .insert(systemConfigurationTable)
    .values({ key: "platform", value: parsed.data, updatedBy: req.authUser!.id })
    .onConflictDoUpdate({
      target: systemConfigurationTable.key,
      set: {
        value: parsed.data,
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