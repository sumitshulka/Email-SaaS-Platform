import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  ChangePasswordBody,
  ChangePasswordResponse,
  GetCurrentUserResponse,
  GetPasswordPolicyResponse,
  LoginBody,
  LoginResponse,
  RequestPackageCheckoutCodeBody,
  RequestPackageCheckoutCodeResponse,
  RequestPasswordResetBody,
  RequestPasswordResetResponse,
  RegisterBody,
  RegisterResponse,
  ResetPasswordBody,
  ResetPasswordResponse,
  VerifyPackageCheckoutCodeBody,
  VerifyPackageCheckoutCodeResponse,
  VerifyRegistrationEmailBody,
  VerifyRegistrationEmailResponse,
} from "@workspace/api-zod";
import {
  db,
  loginAttemptsTable,
  otpVerificationsTable,
  passwordResetRateLimitsTable,
  passwordResetTokensTable,
  userSessionsTable,
  usersTable,
} from "@workspace/db";
import { sendApplicationEmail, getApplicationEmailConfig } from "../lib/application-email";
import { getPlatformSettings } from "../lib/platform-settings";
import {
  clearSessionCookie,
  createUserSession,
  requireAuth,
  revokeCurrentSession,
} from "../lib/session";
import {
  constantTimeEqual,
  hashPassword,
  hmac,
  randomToken,
  sha256,
  sixDigitCode,
  verifyPassword,
} from "../lib/security";

const router: IRouter = Router();
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RESET_RATE_LIMIT_EMAIL_MAX = 3;
const RESET_RATE_LIMIT_IP_MAX = 20;
const RESET_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
let lastPasswordResetRateLimitCleanupAt = 0;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function getPasswordResetOrigin(req: Request): string {
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host")?.trim();
  if (!host || /[\s\\/@?#]/.test(host)) {
    throw new Error("The request did not contain a valid application host.");
  }

  const protocol =
    process.env.NODE_ENV === "production" ? "https" : req.protocol;
  if (protocol !== "http" && protocol !== "https") {
    throw new Error("The request did not contain a valid application protocol.");
  }

  const origin = new URL(`${protocol}://${host}`);
  if (
    !origin.host ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("The request did not contain a valid application origin.");
  }
  return origin.origin;
}

function getPasswordResetUrl(origin: string, token: string): string {
  const url = new URL("/reset-password", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

async function isScopedRateLimited(
  email: string,
  ipAddress: string,
  scope: string,
  emailMaximum = RESET_RATE_LIMIT_EMAIL_MAX,
  ipMaximum = RESET_RATE_LIMIT_IP_MAX,
): Promise<boolean> {
  const now = new Date();
  if (
    now.getTime() - lastPasswordResetRateLimitCleanupAt >=
    60 * 60 * 1000
  ) {
    await db
      .delete(passwordResetRateLimitsTable)
      .where(
        lt(
          passwordResetRateLimitsTable.updatedAt,
          new Date(now.getTime() - RESET_RATE_LIMIT_RETENTION_MS),
        ),
      );
    lastPasswordResetRateLimitCleanupAt = now.getTime();
  }

  const emailScopeHash = hmac(email, `${scope}-email-rate-limit`);
  const ipScopeHash = hmac(ipAddress, `${scope}-ip-rate-limit`);
  const windowFloor = new Date(now.getTime() - RESET_RATE_LIMIT_WINDOW_MS);
  const counts = await db.transaction(async (tx) => {
    const incrementBucket = async (scopeHash: string): Promise<number> => {
      const [bucket] = await tx
        .insert(passwordResetRateLimitsTable)
        .values({
          scopeHash,
          requestCount: 1,
          windowStartedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: passwordResetRateLimitsTable.scopeHash,
          set: {
            requestCount: sql<number>`CASE WHEN ${passwordResetRateLimitsTable.windowStartedAt} <= ${windowFloor} THEN 1 ELSE ${passwordResetRateLimitsTable.requestCount} + 1 END`,
            windowStartedAt: sql<Date>`CASE WHEN ${passwordResetRateLimitsTable.windowStartedAt} <= ${windowFloor} THEN ${now} ELSE ${passwordResetRateLimitsTable.windowStartedAt} END`,
            updatedAt: now,
          },
        })
        .returning({
          requestCount: passwordResetRateLimitsTable.requestCount,
        });
      return bucket.requestCount;
    };

    return {
      email: await incrementBucket(emailScopeHash),
      ip: await incrementBucket(ipScopeHash),
    };
  });

  return (
    counts.email > emailMaximum ||
    counts.ip > ipMaximum
  );
}

function toPublicUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    active: user.active,
    emailVerified: user.emailVerified,
    mustChangeCredentials: user.mustChangeCredentials,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function createVerificationCode(
  userId: string,
  email: string,
  purpose: "registration" | "email_change",
  firstName: string,
): Promise<void> {
  const settings = await getPlatformSettings();
  const code = sixDigitCode();
  await db
    .update(otpVerificationsTable)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(otpVerificationsTable.email, email),
        eq(otpVerificationsTable.purpose, purpose),
        isNull(otpVerificationsTable.consumedAt),
      ),
    );
  await db.insert(otpVerificationsTable).values({
    userId,
    email,
    purpose,
    codeHash: hmac(`${email}:${code}`, `otp:${purpose}`),
    expiresAt: new Date(Date.now() + settings.otpExpiryMinutes * 60 * 1000),
  });
  await sendApplicationEmail(
    email,
    purpose === "registration" ? "Verify your Mailflow account" : "Confirm your email change",
    `Hello ${firstName},\n\nYour verification code is ${code}. It expires in ${settings.otpExpiryMinutes} minutes.\n\nIf you did not request this, you can ignore this email.`,
  );
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your username/email and password.", code: "INVALID_INPUT" });
    return;
  }

  const identifier = parsed.data.identifier.trim().toLowerCase();
  const ipAddress = req.ip?.slice(0, 80) ?? "unknown";
  const settings = await getPlatformSettings();
  const [attempt] = await db
    .select()
    .from(loginAttemptsTable)
    .where(
      and(
        eq(loginAttemptsTable.identifier, identifier),
        eq(loginAttemptsTable.ipAddress, ipAddress),
      ),
    )
    .limit(1);
  const now = new Date();
  if (attempt?.lockedUntil && attempt.lockedUntil > now) {
    res.status(429).json({
      error: "Too many sign-in attempts. Please try again later.",
      code: "LOGIN_RATE_LIMITED",
    });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        or(eq(usersTable.username, identifier), eq(usersTable.email, identifier)),
        isNull(usersTable.deletedAt),
      ),
    )
    .limit(1);
  const passwordValid =
    user != null && (await verifyPassword(parsed.data.password, user.passwordHash));

  if (!user || !passwordValid || !user.active || !user.emailVerified) {
    const sameWindow =
      attempt != null && now.getTime() - attempt.windowStartedAt.getTime() < LOGIN_WINDOW_MS;
    const failedCount = sameWindow ? (attempt?.failedCount ?? 0) + 1 : 1;
    const lockedUntil =
      failedCount >= settings.loginAttemptThreshold
        ? new Date(now.getTime() + LOGIN_LOCK_MS)
        : null;
    await db
      .insert(loginAttemptsTable)
      .values({
        identifier,
        ipAddress,
        failedCount,
        windowStartedAt: sameWindow ? attempt!.windowStartedAt : now,
        lockedUntil,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [loginAttemptsTable.identifier, loginAttemptsTable.ipAddress],
        set: {
          failedCount,
          windowStartedAt: sameWindow ? attempt!.windowStartedAt : now,
          lockedUntil,
          updatedAt: now,
        },
      });
    req.log.warn({ reason: "authentication_failed" }, "Authentication failed");
    res.status(401).json({
      error: "The username/email or password is incorrect, or the account is not verified.",
      code: "INVALID_CREDENTIALS",
    });
    return;
  }

  if (settings.maintenanceMode && user.role !== "SUPERADMIN") {
    res.status(503).json({
      error: "Mailflow is under maintenance. Only a superadmin can sign in right now.",
      code: "MAINTENANCE_MODE",
    });
    return;
  }

  await db
    .delete(loginAttemptsTable)
    .where(
      and(
        eq(loginAttemptsTable.identifier, identifier),
        eq(loginAttemptsTable.ipAddress, ipAddress),
      ),
    );
  const [updatedUser] = await db
    .update(usersTable)
    .set({ lastLoginAt: now })
    .where(eq(usersTable.id, user.id))
    .returning();
  await createUserSession(updatedUser, req, res);
  req.log.info({ userId: user.id, role: user.role }, "User signed in");
  res.json(LoginResponse.parse({ user: toPublicUser(updatedUser) }));
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const settings = await getPlatformSettings();
  if (settings.maintenanceMode) {
    res.status(503).json({
      error: "Registration is unavailable while Mailflow is under maintenance.",
      code: "MAINTENANCE_MODE",
    });
    return;
  }

  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the registration details and try again.", code: "INVALID_INPUT" });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  if (parsed.data.password.length < settings.passwordMinimumLength) {
    res.status(400).json({
      error: `Password must be at least ${settings.passwordMinimumLength} characters.`,
      code: "PASSWORD_TOO_SHORT",
    });
    return;
  }

  if (parsed.data.emailVerificationProof) {
    const proofToken = parsed.data.emailVerificationProof;
    const proofHash = sha256(proofToken);
    const [candidateProof] = await db
      .select({ id: otpVerificationsTable.id })
      .from(otpVerificationsTable)
      .where(
        and(
          eq(otpVerificationsTable.email, email),
          eq(otpVerificationsTable.purpose, "package_checkout_proof"),
          eq(otpVerificationsTable.codeHash, proofHash),
          isNull(otpVerificationsTable.consumedAt),
          gt(otpVerificationsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!candidateProof) {
      res.status(400).json({
        error: "Email verification expired. Return to package checkout and verify your email again.",
        code: "PACKAGE_CHECKOUT_PROOF_INVALID",
      });
      return;
    }

    const usernameBase =
      email.split("@")[0]!.replace(/[^a-z0-9._-]/g, "").slice(0, 38) || "user";
    const username = `${usernameBase}-${randomToken(5).slice(0, 7)}`;
    const passwordHash = await hashPassword(parsed.data.password);
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [proof] = await tx
        .select()
        .from(otpVerificationsTable)
        .where(
          and(
            eq(otpVerificationsTable.id, candidateProof.id),
            eq(otpVerificationsTable.email, email),
            eq(otpVerificationsTable.purpose, "package_checkout_proof"),
            eq(otpVerificationsTable.codeHash, proofHash),
            isNull(otpVerificationsTable.consumedAt),
            gt(otpVerificationsTable.expiresAt, now),
          ),
        )
        .for("update")
        .limit(1);
      if (!proof) return { kind: "invalid" as const };

      const [existing] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)))
        .limit(1);
      if (existing) {
        await tx
          .update(otpVerificationsTable)
          .set({ consumedAt: now })
          .where(eq(otpVerificationsTable.id, proof.id));
        return { kind: "exists" as const };
      }

      const [createdUser] = await tx
        .insert(usersTable)
        .values({
          username,
          firstName: parsed.data.firstName.trim(),
          lastName: parsed.data.lastName.trim(),
          email,
          passwordHash,
          role: "USER",
          timezone: settings.defaultTimezone,
          active: true,
          emailVerified: true,
          emailVerifiedAt: now,
        })
        .returning();
      await tx
        .update(otpVerificationsTable)
        .set({ consumedAt: now })
        .where(eq(otpVerificationsTable.id, proof.id));
      return { kind: "created" as const, user: createdUser };
    });

    if (result.kind === "invalid") {
      res.status(400).json({
        error: "Email verification expired. Return to package checkout and verify your email again.",
        code: "PACKAGE_CHECKOUT_PROOF_INVALID",
      });
      return;
    }
    if (result.kind === "exists") {
      res.status(409).json({
        error: "An account with this email already exists. Sign in to continue.",
        code: "EMAIL_IN_USE",
      });
      return;
    }
    await createUserSession(result.user, req, res);
    res.status(201).json(
      RegisterResponse.parse({
        message: "Your account is ready. Continue to package checkout.",
      }),
    );
    return;
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists.", code: "EMAIL_IN_USE" });
    return;
  }

  if (!(await getApplicationEmailConfig())) {
    res.status(503).json({
      error: "Account verification is not available yet. Ask the administrator to configure application email.",
      code: "APPLICATION_EMAIL_NOT_CONFIGURED",
    });
    return;
  }

  const usernameBase = email.split("@")[0]!.replace(/[^a-z0-9._-]/g, "").slice(0, 38) || "user";
  const username = `${usernameBase}-${randomToken(5).slice(0, 7)}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      firstName: parsed.data.firstName.trim(),
      lastName: parsed.data.lastName.trim(),
      email,
      passwordHash: await hashPassword(parsed.data.password),
      role: "USER",
      timezone: settings.defaultTimezone,
      active: true,
      emailVerified: false,
    })
    .returning();

  try {
    await createVerificationCode(user.id, email, "registration", user.firstName);
  } catch {
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    req.log.warn({ userId: user.id }, "Registration email could not be sent");
    res.status(502).json({
      error: "We could not send a verification email. Please try again later.",
      code: "VERIFICATION_EMAIL_FAILED",
    });
    return;
  }

  res.status(201).json(
    RegisterResponse.parse({
      message: "A verification code has been sent to your email address.",
    }),
  );
});

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const parsed = VerifyRegistrationEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the six-digit code sent to your email.", code: "INVALID_INPUT" });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const [otp] = await db
    .select()
    .from(otpVerificationsTable)
    .where(
      and(
        eq(otpVerificationsTable.email, email),
        or(
          eq(otpVerificationsTable.purpose, "registration"),
          eq(otpVerificationsTable.purpose, "email_change"),
        ),
        isNull(otpVerificationsTable.consumedAt),
        gt(otpVerificationsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpVerificationsTable.createdAt))
    .limit(1);

  if (!otp) {
    res.status(400).json({ error: "This code is invalid or expired. Request a new code.", code: "OTP_INVALID" });
    return;
  }
  const settings = await getPlatformSettings();
  if (otp.attempts >= settings.maxOtpAttempts) {
    res.status(400).json({ error: "Too many code attempts. Request a new code.", code: "OTP_ATTEMPTS_EXCEEDED" });
    return;
  }
  const expected = hmac(`${email}:${parsed.data.code}`, `otp:${otp.purpose}`);
  if (!constantTimeEqual(expected, otp.codeHash)) {
    await db
      .update(otpVerificationsTable)
      .set({ attempts: otp.attempts + 1 })
      .where(eq(otpVerificationsTable.id, otp.id));
    res.status(400).json({ error: "The verification code is incorrect.", code: "OTP_INVALID" });
    return;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(otpVerificationsTable)
      .set({ consumedAt: now })
      .where(eq(otpVerificationsTable.id, otp.id));
    await tx
      .update(usersTable)
      .set({ emailVerified: true, emailVerifiedAt: now, active: true })
      .where(and(eq(usersTable.id, otp.userId!), isNull(usersTable.deletedAt)));
  });
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, otp.userId!))
    .limit(1);
  if (!user || user.deletedAt) {
    res.status(400).json({ error: "This account is no longer available.", code: "ACCOUNT_UNAVAILABLE" });
    return;
  }
  await createUserSession(user, req, res);
  res.json(VerifyRegistrationEmailResponse.parse({ user: toPublicUser(user) }));
});

router.post("/auth/package-checkout/request-code", async (req, res): Promise<void> => {
  const settings = await getPlatformSettings();
  if (settings.maintenanceMode) {
    res.status(503).json({
      error: "Package checkout is unavailable while Mailflow is under maintenance.",
      code: "MAINTENANCE_MODE",
    });
    return;
  }
  const parsed = RequestPackageCheckoutCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address.", code: "INVALID_INPUT" });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const ipAddress = req.ip?.slice(0, 80) ?? "unknown";
  if (await isScopedRateLimited(email, ipAddress, "package-checkout-request")) {
    res.setHeader("Retry-After", String(Math.ceil(RESET_RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({
      error: "Too many verification requests. Wait before trying again.",
      code: "PACKAGE_CHECKOUT_RATE_LIMITED",
    });
    return;
  }
  if (!(await getApplicationEmailConfig())) {
    res.status(503).json({
      error: "Email verification is temporarily unavailable. Please try again later.",
      code: "APPLICATION_EMAIL_NOT_CONFIGURED",
    });
    return;
  }

  const code = sixDigitCode();
  const now = new Date();
  const [challenge] = await db.transaction(async (tx) => {
    await tx
      .update(otpVerificationsTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(otpVerificationsTable.email, email),
          or(
            eq(otpVerificationsTable.purpose, "package_checkout"),
            eq(otpVerificationsTable.purpose, "package_checkout_proof"),
          ),
          isNull(otpVerificationsTable.consumedAt),
        ),
      );
    return tx
      .insert(otpVerificationsTable)
      .values({
        userId: null,
        email,
        purpose: "package_checkout",
        codeHash: hmac(`${email}:${code}`, "otp:package_checkout"),
        expiresAt: new Date(now.getTime() + settings.otpExpiryMinutes * 60 * 1000),
      })
      .returning({ id: otpVerificationsTable.id });
  });

  try {
    await sendApplicationEmail(
      email,
      "Verify your email for Mailflow",
      `Your verification code is ${code}. Use it to continue with Mailflow package checkout. It expires in ${settings.otpExpiryMinutes} minutes.\n\nIf you did not request this, you can ignore this email.`,
    );
  } catch (error) {
    await db
      .update(otpVerificationsTable)
      .set({ consumedAt: new Date() })
      .where(eq(otpVerificationsTable.id, challenge.id));
    req.log.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Package checkout verification email could not be sent",
    );
    res.status(502).json({
      error: "We could not send a verification email. Please try again later.",
      code: "VERIFICATION_EMAIL_FAILED",
    });
    return;
  }

  res.json(
    RequestPackageCheckoutCodeResponse.parse({
      message: "If this address can receive Mailflow email, a verification code has been sent.",
    }),
  );
});

router.post("/auth/package-checkout/verify-code", async (req, res): Promise<void> => {
  const settings = await getPlatformSettings();
  if (settings.maintenanceMode) {
    res.status(503).json({
      error: "Package checkout is unavailable while Mailflow is under maintenance.",
      code: "MAINTENANCE_MODE",
    });
    return;
  }
  const parsed = VerifyPackageCheckoutCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the six-digit code sent to your email.", code: "INVALID_INPUT" });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const ipAddress = req.ip?.slice(0, 80) ?? "unknown";
  if (await isScopedRateLimited(email, ipAddress, "package-checkout-verify", 20, 50)) {
    res.setHeader("Retry-After", String(Math.ceil(RESET_RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({
      error: "Too many verification attempts. Wait before trying again.",
      code: "PACKAGE_CHECKOUT_RATE_LIMITED",
    });
    return;
  }

  const now = new Date();
  const expected = hmac(`${email}:${parsed.data.code}`, "otp:package_checkout");
  const result = await db.transaction(async (tx) => {
    const [challenge] = await tx
      .select()
      .from(otpVerificationsTable)
      .where(
        and(
          eq(otpVerificationsTable.email, email),
          eq(otpVerificationsTable.purpose, "package_checkout"),
          isNull(otpVerificationsTable.consumedAt),
          gt(otpVerificationsTable.expiresAt, now),
        ),
      )
      .orderBy(desc(otpVerificationsTable.createdAt))
      .for("update")
      .limit(1);
    if (!challenge) return { kind: "invalid" as const };
    if (challenge.attempts >= settings.maxOtpAttempts) {
      return { kind: "attempts" as const };
    }
    if (!constantTimeEqual(expected, challenge.codeHash)) {
      await tx
        .update(otpVerificationsTable)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(otpVerificationsTable.id, challenge.id));
      return { kind: "wrong" as const };
    }

    await tx
      .update(otpVerificationsTable)
      .set({ consumedAt: now })
      .where(eq(otpVerificationsTable.id, challenge.id));
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)))
      .limit(1);
    if (user) {
      if (user.role === "SUPERADMIN") {
        return { kind: "superadmin" as const };
      }
      if (!user.emailVerified) {
        await tx
          .update(usersTable)
          .set({ emailVerified: true, emailVerifiedAt: now })
          .where(eq(usersTable.id, user.id));
      }
      return { kind: "existing" as const };
    }

    const proofToken = randomToken(32);
    await tx.insert(otpVerificationsTable).values({
      userId: null,
      email,
      purpose: "package_checkout_proof",
      codeHash: sha256(proofToken),
      expiresAt: new Date(now.getTime() + settings.otpExpiryMinutes * 60 * 1000),
    });
    return { kind: "new" as const, proofToken };
  });

  if (result.kind === "invalid") {
    res.status(400).json({ error: "This code is invalid or expired. Request a new one.", code: "OTP_INVALID" });
    return;
  }
  if (result.kind === "attempts") {
    res.status(400).json({ error: "Too many code attempts. Request a new code.", code: "OTP_ATTEMPTS_EXCEEDED" });
    return;
  }
  if (result.kind === "wrong") {
    res.status(400).json({ error: "The verification code is incorrect.", code: "OTP_INVALID" });
    return;
  }
  if (result.kind === "superadmin") {
    res.status(403).json({
      error: "This email belongs to a superadmin account and cannot be used to purchase customer plans. Sign in to the superadmin workspace or use a customer email address.",
      code: "SUPERADMIN_PACKAGE_PURCHASE_FORBIDDEN",
    });
    return;
  }
  res.json(
    VerifyPackageCheckoutCodeResponse.parse(
      result.kind === "existing"
        ? { accountExists: true }
        : { accountExists: false, registrationProofToken: result.proofToken },
    ),
  );
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = RequestPasswordResetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address.", code: "INVALID_INPUT" });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const emailConfig = await getApplicationEmailConfig();
  if (!emailConfig) {
    req.log.error("Password reset requested while application email is not configured");
    res.status(503).json({
      error: "Password recovery email is temporarily unavailable. Please contact support.",
      code: "PASSWORD_RESET_EMAIL_UNAVAILABLE",
    });
    return;
  }

  let origin: string;
  try {
    origin = getPasswordResetOrigin(req);
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Password reset link host could not be determined",
    );
    res.status(503).json({
      error: "Password recovery is temporarily unavailable. Please contact support.",
      code: "PASSWORD_RESET_EMAIL_UNAVAILABLE",
    });
    return;
  }

  const ipAddress = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (await isScopedRateLimited(email, ipAddress, "password-reset")) {
    res.setHeader(
      "Retry-After",
      String(Math.ceil(RESET_RATE_LIMIT_WINDOW_MS / 1000)),
    );
    res.status(429).json({
      error: "Too many reset requests. Wait before trying again.",
      code: "PASSWORD_RESET_RATE_LIMITED",
    });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)))
    .limit(1);
  if (user) {
    const token = randomToken(32);
    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    try {
      await sendApplicationEmail(
        email,
        "Reset your Mailflow password",
        `Use this link to set a new password. The link expires in 30 minutes:\n\n${getPasswordResetUrl(origin, token)}\n\nIf you did not request this, ignore this email.`,
      );
    } catch (error) {
      req.log.error(
        {
          userId: user.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Password reset email could not be sent",
      );
    }
  }
  res.json(
    RequestPasswordResetResponse.parse({
      message: "If an account matches that email, password reset instructions have been sent.",
    }),
  );
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the reset token and new password.", code: "INVALID_INPUT" });
    return;
  }
  const settings = await getPlatformSettings();
  if (parsed.data.password.length < settings.passwordMinimumLength) {
    res.status(400).json({
      error: `Password must be at least ${settings.passwordMinimumLength} characters.`,
      code: "PASSWORD_TOO_SHORT",
    });
    return;
  }
  const [token] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, sha256(parsed.data.token)),
        isNull(passwordResetTokensTable.consumedAt),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!token) {
    res.status(400).json({ error: "This reset link is invalid or expired.", code: "RESET_TOKEN_INVALID" });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const now = new Date();
  let consumed = false;
  await db.transaction(async (tx) => {
    const [claimedToken] = await tx
      .update(passwordResetTokensTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(passwordResetTokensTable.id, token.id),
          isNull(passwordResetTokensTable.consumedAt),
          gt(passwordResetTokensTable.expiresAt, now),
        ),
      )
      .returning({ userId: passwordResetTokensTable.userId });
    if (!claimedToken) return;

    consumed = true;
    await tx
      .update(usersTable)
      .set({ passwordHash, mustChangeCredentials: false })
      .where(eq(usersTable.id, claimedToken.userId));
    await tx
      .update(userSessionsTable)
      .set({ revokedAt: now })
      .where(and(eq(userSessionsTable.userId, claimedToken.userId), isNull(userSessionsTable.revokedAt)));
  });
  if (!consumed) {
    res.status(400).json({ error: "This reset link is invalid or expired.", code: "RESET_TOKEN_INVALID" });
    return;
  }
  res.json(ResetPasswordResponse.parse({ message: "Your password has been updated. Please sign in." }));
});

router.get("/auth/password-policy", async (_req, res): Promise<void> => {
  const settings = await getPlatformSettings();
  res.json(
    GetPasswordPolicyResponse.parse({
      passwordMinimumLength: settings.passwordMinimumLength,
    }),
  );
});

router.get("/auth/me", requireAuth, (req, res): void => {
  res.json(GetCurrentUserResponse.parse(toPublicUser(req.authUser!)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await revokeCurrentSession(req);
  clearSessionCookie(res, req);
  res.sendStatus(204);
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your current password and a valid new password.", code: "INVALID_INPUT" });
    return;
  }
  const user = req.authUser!;
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "Current password is incorrect.", code: "CURRENT_PASSWORD_INCORRECT" });
    return;
  }
  const settings = await getPlatformSettings();
  if (parsed.data.newPassword.length < settings.passwordMinimumLength) {
    res.status(400).json({
      error: `Password must be at least ${settings.passwordMinimumLength} characters.`,
      code: "PASSWORD_TOO_SHORT",
    });
    return;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({
        passwordHash: await hashPassword(parsed.data.newPassword),
        mustChangeCredentials: false,
      })
      .where(eq(usersTable.id, user.id));
    await tx
      .update(userSessionsTable)
      .set({ revokedAt: now })
      .where(
        and(
          eq(userSessionsTable.userId, user.id),
          isNull(userSessionsTable.revokedAt),
          req.sessionTokenHash
            ? ne(userSessionsTable.tokenHash, req.sessionTokenHash)
            : eq(userSessionsTable.userId, user.id),
        ),
      );
  });
  res.json(ChangePasswordResponse.parse({ message: "Password changed successfully." }));
});

export { toPublicUser };
export default router;