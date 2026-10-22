import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateEmailTemplateBody,
  DeleteEmailTemplateParams,
  DeleteEmailTemplateResponse,
  SendInactivityNoticeBody,
  ListInactiveUsersParams,
  ListInactiveUsersResponse,
  ListEmailTemplatesResponse,
  UpdateEmailTemplateBody,
  UpdateEmailTemplateParams,
  UpdateEmailTemplateResponse,
  CreateEmailTemplateResponse,
  SendInactivityNoticeParams,
  SendInactivityNoticeResponse,
  RemoveInactiveUserParams,
  RemoveInactiveUserResponse,
} from "@workspace/api-zod";
import { db, auditLogsTable, emailTemplatesTable, userSessionsTable, usersTable } from "@workspace/db";
import { sendApplicationEmail } from "../lib/application-email";
import { getPlatformSettings } from "../lib/platform-settings";
import { requireSuperadmin } from "../lib/session";

const router: IRouter = Router();
type Stage = "warning" | "suspension" | "removal";
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);
const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};
const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function lifecycleDate(user: typeof usersTable.$inferSelect): Date {
  return user.lastLoginAt ?? user.inactivityResetAt ?? user.createdAt;
}

function stageEligible(user: typeof usersTable.$inferSelect, stage: Stage, now: Date, settings: Awaited<ReturnType<typeof getPlatformSettings>>) {
  const lastActivity = lifecycleDate(user);
  if (user.role !== "USER" || !user.emailVerified || user.deletedAt) return false;
  if (stage === "warning") {
    return user.active && !user.inactivityWarningSentAt && lastActivity <= addMonths(now, -settings.inactiveUserMonths);
  }
  if (stage === "suspension") {
    return user.active && !!user.inactivityWarningSentAt && !user.suspensionEmailSentAt &&
      user.inactivityWarningSentAt <= addDays(now, -settings.inactivityWarningDays) &&
      lastActivity <= user.inactivityWarningSentAt;
  }
  return !!user.suspendedAt && user.suspendedAt <= addDays(now, -settings.inactivityRemovalDays);
}

function toInactiveUser(user: typeof usersTable.$inferSelect, stage: Stage) {
  return {
    id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName,
    email: user.email, lastActivityAt: lifecycleDate(user).toISOString(),
    inactivityWarningSentAt: user.inactivityWarningSentAt?.toISOString() ?? null,
    suspensionEmailSentAt: user.suspensionEmailSentAt?.toISOString() ?? null,
    suspendedAt: user.suspendedAt?.toISOString() ?? null, stage,
  };
}

router.get("/admin/inactivity/:stage", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = ListInactiveUsersParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid inactivity stage.", code: "INVALID_INPUT" }); return;
  }
  const [users, settings] = await Promise.all([db.select().from(usersTable), getPlatformSettings()]);
  const now = new Date();
  const result = users.filter(user => stageEligible(user, parsed.data.stage as Stage, now, settings))
    .map(user => toInactiveUser(user, parsed.data.stage as Stage));
  res.json(ListInactiveUsersResponse.parse(result));
});

router.get("/admin/email-templates", requireSuperadmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(emailTemplatesTable).orderBy(emailTemplatesTable.createdAt);
  res.json(ListEmailTemplatesResponse.parse(rows));
});

router.post("/admin/email-templates", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = CreateEmailTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter valid template details.", code: "INVALID_INPUT" }); return; }
  const [row] = await db.insert(emailTemplatesTable).values({ ...parsed.data, createdBy: req.authUser!.id }).returning();
  res.status(201).json(CreateEmailTemplateResponse.parse(row));
});

router.patch("/admin/email-templates/:templateId", requireSuperadmin, async (req, res): Promise<void> => {
  const params = UpdateEmailTemplateParams.safeParse(req.params);
  const body = UpdateEmailTemplateBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Enter valid template details.", code: "INVALID_INPUT" }); return; }
  const [row] = await db.update(emailTemplatesTable).set(body.data).where(eq(emailTemplatesTable.id, params.data.templateId)).returning();
  if (!row) { res.status(404).json({ error: "Template not found.", code: "TEMPLATE_NOT_FOUND" }); return; }
  res.json(UpdateEmailTemplateResponse.parse(row));
});

router.delete("/admin/email-templates/:templateId", requireSuperadmin, async (req, res): Promise<void> => {
  const params = DeleteEmailTemplateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid template identifier.", code: "INVALID_INPUT" }); return; }
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, params.data.templateId));
  res.status(204).json(DeleteEmailTemplateResponse.parse(undefined));
});

router.post("/admin/inactivity/:userId/send", requireSuperadmin, async (req, res): Promise<void> => {
  const params = SendInactivityNoticeParams.safeParse(req.params);
  const body = SendInactivityNoticeBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid notice request.", code: "INVALID_INPUT" }); return; }
  const settings = await getPlatformSettings();
  const now = new Date();
  let result: ReturnType<typeof toInactiveUser> | null = null;
  await db.transaction(async tx => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, params.data.userId)).for("update");
    if (!user || !stageEligible(user, body.data.stage, now, settings)) return;
    const [template] = await tx.select().from(emailTemplatesTable).where(and(
      eq(emailTemplatesTable.id, body.data.templateId),
      eq(emailTemplatesTable.kind, body.data.stage === "warning" ? "inactive_warning" : "suspension_notice"),
    ));
    if (!template) throw new Error("A matching email template is required.");
    const values: Record<string, string> = {
      firstName: user.firstName, lastName: user.lastName, email: user.email, username: user.username,
      applicationName: settings.applicationName,
    };
    const replace = (source: string, escape: (value: string) => string) =>
      source.replace(/\{\{(firstName|lastName|email|username|applicationName)\}\}/g, (_match, key: string) => escape(values[key] ?? ""));
    const renderedHtml = replace(template.htmlBody, escapeHtml);
    const renderedText = renderedHtml
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    await sendApplicationEmail(user.email, replace(template.subject, value => value), renderedText || "Please view this email in an HTML-capable email client.", renderedHtml);
    if (body.data.stage === "warning") {
      await tx.update(usersTable).set({ inactivityWarningSentAt: now }).where(eq(usersTable.id, user.id));
    } else {
      await tx.update(usersTable).set({ suspensionEmailSentAt: now, suspendedAt: now, active: false }).where(eq(usersTable.id, user.id));
      await tx.update(userSessionsTable).set({ revokedAt: now }).where(and(eq(userSessionsTable.userId, user.id), isNull(userSessionsTable.revokedAt)));
    }
    await tx.insert(auditLogsTable).values({
      actorId: req.authUser!.id, action: body.data.stage === "warning" ? "user.inactivity_warning_sent" : "user.suspended",
      entity: "user", entityId: user.id, ipAddress: req.ip?.slice(0, 80) ?? null, metadata: {},
    });
    result = toInactiveUser({ ...user, ...(body.data.stage === "warning" ? { inactivityWarningSentAt: now } : { suspensionEmailSentAt: now, suspendedAt: now }) }, body.data.stage);
  });
  if (!result) { res.status(409).json({ error: "This account is no longer eligible for that inactivity action.", code: "NOT_ELIGIBLE" }); return; }
  res.json(SendInactivityNoticeResponse.parse(result));
});

router.post("/admin/inactivity/:userId/remove", requireSuperadmin, async (req, res): Promise<void> => {
  const params = RemoveInactiveUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid account identifier.", code: "INVALID_INPUT" }); return; }
  const settings = await getPlatformSettings();
  const now = new Date();
  let eligible = false;
  await db.transaction(async tx => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, params.data.userId)).for("update");
    if (!user || !stageEligible(user, "removal", now, settings)) return;
    eligible = true;
    await tx.update(usersTable).set({ active: false, deletedAt: now }).where(eq(usersTable.id, user.id));
    await tx.update(userSessionsTable).set({ revokedAt: now }).where(and(eq(userSessionsTable.userId, user.id), isNull(userSessionsTable.revokedAt)));
    await tx.insert(auditLogsTable).values({ actorId: req.authUser!.id, action: "user.deleted", entity: "user", entityId: user.id, ipAddress: req.ip?.slice(0, 80) ?? null, metadata: { reason: "inactivity" } });
  });
  if (!eligible) {
    res.status(409).json({ error: "This account is not eligible for inactivity removal.", code: "NOT_ELIGIBLE" }); return;
  }
  res.status(204).json(RemoveInactiveUserResponse.parse(undefined));
});

export default router;
