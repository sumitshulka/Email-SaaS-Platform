import { and, eq, isNull, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { UpdateProfileBody, UpdateProfileResponse } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { writeAuditLog } from "../lib/audit";
import { getApplicationEmailConfig } from "../lib/application-email";
import { requireAuth } from "../lib/session";
import { toPublicUser } from "./auth";
import { createVerificationCode } from "./auth";

const router: IRouter = Router();

router.patch("/profile", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the profile details and try again.", code: "INVALID_INPUT" });
    return;
  }
  const user = req.authUser!;
  const update: Partial<typeof usersTable.$inferInsert> = { ...parsed.data };
  if (update.username) {
    update.username = update.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(update.username)) {
      res.status(400).json({
        error: "Username may contain lowercase letters, numbers, periods, underscores, and hyphens.",
        code: "INVALID_USERNAME",
      });
      return;
    }
  }
  if (update.email) update.email = update.email.trim().toLowerCase();

  const [duplicate] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        isNull(usersTable.deletedAt),
        ne(usersTable.id, user.id),
        ...(update.username ? [eq(usersTable.username, update.username)] : []),
      ),
    )
    .limit(1);
  if (duplicate && update.username) {
    res.status(409).json({ error: "That username is already in use.", code: "USERNAME_IN_USE" });
    return;
  }

  const emailChanged = update.email != null && update.email !== user.email;
  if (emailChanged) {
    const [emailOwner] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          isNull(usersTable.deletedAt),
          ne(usersTable.id, user.id),
          eq(usersTable.email, update.email!),
        ),
      )
      .limit(1);
    if (emailOwner) {
      res.status(409).json({ error: "That email address is already in use.", code: "EMAIL_IN_USE" });
      return;
    }
    if (!(await getApplicationEmailConfig())) {
      res.status(503).json({
        error: "Email changes require application email verification. Ask the administrator to configure application email.",
        code: "APPLICATION_EMAIL_NOT_CONFIGURED",
      });
      return;
    }
    try {
      await createVerificationCode(user.id, update.email!, "email_change", user.firstName);
    } catch {
      res.status(502).json({ error: "We could not send an email verification code.", code: "VERIFICATION_EMAIL_FAILED" });
      return;
    }
    update.emailVerified = false;
    update.emailVerifiedAt = null;
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set(update)
      .where(and(eq(usersTable.id, user.id), isNull(usersTable.deletedAt)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Account not found.", code: "ACCOUNT_NOT_FOUND" });
      return;
    }
    await writeAuditLog({
      actorId: user.id,
      action: "profile.updated",
      entity: "user",
      entityId: user.id,
      ipAddress: req.ip,
      metadata: {
        changedFields: Object.keys(parsed.data).filter((key) => key !== "email"),
        emailChangePendingVerification: emailChanged,
      },
    });
    res.json(UpdateProfileResponse.parse(toPublicUser(updated)));
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505") {
      res.status(409).json({ error: "That username or email is already in use.", code: "PROFILE_CONFLICT" });
      return;
    }
    throw error;
  }
});

export default router;