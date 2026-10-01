import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { DataType, newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://mailflow-test:mailflow-test@127.0.0.1/mailflow_test";
process.env.SESSION_SECRET = "test-only-session-secret-that-is-long-enough";
process.env.LOG_LEVEL = "silent";

const memory = newDb({ autoCreateForeignKeyIndices: true });
memory.public.registerFunction({
  name: "gen_random_uuid",
  returns: DataType.uuid,
  implementation: () => randomUUID(),
  impure: true,
});

memory.public.none(`
  CREATE TYPE user_role AS ENUM ('SUPERADMIN', 'USER');
  CREATE TYPE razorpay_environment AS ENUM ('sandbox', 'production');
  CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username varchar(50) NOT NULL,
    first_name varchar(80) NOT NULL,
    last_name varchar(80) NOT NULL,
    email varchar(254) NOT NULL,
    password_hash text NOT NULL,
    role user_role NOT NULL DEFAULT 'USER',
    timezone varchar(80) NOT NULL DEFAULT 'Asia/Kolkata',
    active boolean NOT NULL DEFAULT true,
    email_verified boolean NOT NULL DEFAULT false,
    must_change_credentials boolean NOT NULL DEFAULT false,
    last_login_at timestamptz,
    email_verified_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX users_username_active_unique ON users(username) WHERE deleted_at IS NULL;
  CREATE UNIQUE INDEX users_email_active_unique ON users(email) WHERE deleted_at IS NULL;
  CREATE TABLE user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL UNIQUE,
    ip_address varchar(80),
    user_agent varchar(512),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE otp_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    email varchar(254) NOT NULL,
    purpose varchar(40) NOT NULL,
    code_hash varchar(64) NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE login_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier varchar(254) NOT NULL,
    ip_address varchar(80) NOT NULL,
    failed_count integer NOT NULL DEFAULT 0,
    window_started_at timestamptz NOT NULL,
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (identifier, ip_address)
  );
  CREATE TABLE system_configuration (
    key varchar(100) PRIMARY KEY,
    value jsonb NOT NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE application_email_configuration (
    id varchar(30) PRIMARY KEY DEFAULT 'platform',
    provider varchar(32) NOT NULL DEFAULT 'other',
    host varchar(255) NOT NULL,
    port integer NOT NULL,
    encryption varchar(10) NOT NULL,
    username varchar(512) NOT NULL,
    password_encrypted text NOT NULL,
    from_name varchar(120) NOT NULL,
    from_email varchar(254) NOT NULL,
    reply_to varchar(254),
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE razorpay_configuration (
    id varchar(30) PRIMARY KEY DEFAULT 'platform',
    key_id varchar(255) NOT NULL,
    key_secret_encrypted text NOT NULL,
    webhook_secret_encrypted text NOT NULL,
    active_environment razorpay_environment,
    sandbox_key_id varchar(255),
    sandbox_key_secret_encrypted text,
    sandbox_webhook_secret_encrypted text,
    sandbox_updated_at timestamptz,
    production_key_id varchar(255),
    production_key_secret_encrypted text,
    production_webhook_secret_encrypted text,
    production_updated_at timestamptz,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    razorpay_environment razorpay_environment,
    razorpay_order_id varchar(80),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action varchar(100) NOT NULL,
    entity varchar(100) NOT NULL,
    entity_id varchar(100),
    ip_address varchar(80),
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  );
`);

const schema = await import("@workspace/db/schema");
const { Pool: MemoryPool } = memory.adapters.createPg();
const memoryPool = new MemoryPool();
function adaptMemoryQuery(client) {
  const query = client.query.bind(client);
  client.query = (config, ...args) => {
    const arrayMode = config && typeof config === "object" && config.rowMode === "array";
    if (config && typeof config === "object" && (config.types || config.rowMode)) {
      config = { ...config };
      delete config.types;
      delete config.rowMode;
    }
    const result = query(config, ...args);
    const normalize = (queryResult) => {
      if (
        arrayMode &&
        queryResult?.rows?.length &&
        !Array.isArray(queryResult.rows[0])
      ) {
        queryResult.rows = queryResult.rows.map((row) => Object.values(row));
      }
      return queryResult;
    };
    return result?.then ? result.then(normalize) : normalize(result);
  };
  return client;
}
adaptMemoryQuery(memoryPool);
const connectMemoryClient = memoryPool.connect.bind(memoryPool);
memoryPool.connect = (...args) => {
  const connection = connectMemoryClient(...args);
  return connection?.then ? connection.then(adaptMemoryQuery) : connection;
};
const testDb = drizzle(memoryPool, { schema });
const dbModule = await import("@workspace/db");
dbModule.setTestDatabase(testDb);

const [{ default: app }, emailModule, securityModule, seedModule, razorpayModule] = await Promise.all([
  import("../src/app.ts"),
  import("../src/lib/application-email.ts"),
  import("../src/lib/security.ts"),
  import("../src/lib/seed.ts"),
  import("../src/lib/razorpay.ts"),
]);

const { db, usersTable, userSessionsTable, loginAttemptsTable, otpVerificationsTable } =
  dbModule;
const emails = [];
emailModule.setApplicationEmailTransportForTests(async (message) => {
  emails.push(message);
});

let server;
let baseUrl;
let commonPasswordHash;

before(async () => {
  commonPasswordHash = await securityModule.hashPassword("Initial-user-password-2026!");
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  dbModule.pool.on("error", () => {});
  await dbModule.pool.end();
  await memoryPool.end();
});

beforeEach(async () => {
  await db.delete(dbModule.auditLogsTable);
  await db.delete(dbModule.paymentsTable);
  await db.delete(dbModule.razorpayConfigurationTable);
  await db.delete(dbModule.passwordResetTokensTable);
  await db.delete(dbModule.otpVerificationsTable);
  await db.delete(dbModule.userSessionsTable);
  await db.delete(dbModule.loginAttemptsTable);
  await db.delete(dbModule.systemConfigurationTable);
  await db.delete(dbModule.applicationEmailConfigurationTable);
  await db.delete(dbModule.usersTable);
  await db.insert(dbModule.applicationEmailConfigurationTable).values({
    host: "mail.test.invalid",
    port: 2525,
    encryption: "none",
    username: "test-user",
    passwordEncrypted: "test-only-placeholder",
    fromName: "Mailflow Test",
    fromEmail: "no-reply@mailflow.test",
  });
  emails.length = 0;
});

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  return {
    response,
    body: text ? JSON.parse(text) : undefined,
    cookie: setCookie?.split(";", 1)[0],
  };
}

async function createUser({
  username = "customer",
  email = `${username}@example.test`,
  role = "USER",
  active = true,
  emailVerified = true,
  mustChangeCredentials = false,
  passwordHash = commonPasswordHash,
} = {}) {
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      firstName: "Test",
      lastName: "Account",
      email,
      passwordHash,
      role,
      active,
      emailVerified,
      mustChangeCredentials,
    })
    .returning();
  return user;
}

async function login(identifier, password = "Initial-user-password-2026!") {
  return api("/auth/login", {
    method: "POST",
    body: { identifier, password },
  });
}

async function loggedInUser(options = {}) {
  const user = await createUser(options);
  const result = await login(user.email);
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.ok(result.cookie, "login should set the session cookie");
  return { user, cookie: result.cookie };
}

async function getEmailCode() {
  const email = emails.at(-1);
  assert.ok(email, "expected a verification email to be captured");
  const match = email.text.match(/verification code is (\d{6})/i);
  assert.ok(match, "verification email should contain a six-digit code");
  return match[1];
}

describe("Razorpay environment configuration", { concurrency: false }, () => {
  it("keeps one active mode, preserves old payment mode, and tests saved inactive credentials", async () => {
    const admin = await createUser({
      username: "billing-admin",
      role: "SUPERADMIN",
    });
    const session = await login(admin.email);
    assert.equal(session.response.status, 200);

    await db.insert(dbModule.razorpayConfigurationTable).values({
      id: "platform",
      keyId: "rzp_test_legacy",
      keySecretEncrypted: securityModule.encryptSecret("legacy-key-secret"),
      webhookSecretEncrypted: securityModule.encryptSecret("legacy-webhook-secret"),
      updatedAt: new Date(),
    });
    memory.public.none(
      `INSERT INTO payments (id, razorpay_order_id) VALUES ('${randomUUID()}', 'order_before_switch')`,
    );

    const productionSave = await api("/admin/billing/razorpay", {
      method: "PUT",
      cookie: session.cookie,
      body: {
        environment: "production",
        keyId: "rzp_live_production",
        keySecret: "production-key-secret",
        webhookSecret: "production-webhook-secret",
      },
    });
    assert.equal(productionSave.response.status, 200, JSON.stringify(productionSave.body));
    assert.equal(productionSave.body.activeEnvironment, "sandbox");
    assert.equal(productionSave.body.sandbox.configured, true);
    assert.equal(productionSave.body.production.configured, true);
    const responseJson = JSON.stringify(productionSave.body);
    for (const secret of [
      "legacy-key-secret",
      "legacy-webhook-secret",
      "production-key-secret",
      "production-webhook-secret",
    ]) {
      assert.equal(responseJson.includes(secret), false, "gateway secrets must not be returned");
    }

    const [savedConfig] = await db
      .select()
      .from(dbModule.razorpayConfigurationTable);
    assert.equal(savedConfig.activeEnvironment, "sandbox");
    assert.equal(savedConfig.sandboxKeyId, "rzp_test_legacy");
    assert.equal(savedConfig.productionKeyId, "rzp_live_production");
    assert.notEqual(savedConfig.productionKeySecretEncrypted, "production-key-secret");

    const activated = await api("/admin/billing/razorpay/active", {
      method: "PUT",
      cookie: session.cookie,
      body: { environment: "production" },
    });
    assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
    assert.equal(activated.body.activeEnvironment, "production");
    const activeConfig = await razorpayModule.getRazorpayConfiguration();
    assert.equal(activeConfig.environment, "production");
    assert.equal(activeConfig.keyId, "rzp_live_production");

    const [oldPayment] = memory.public.many(
      "SELECT razorpay_environment FROM payments WHERE razorpay_order_id = 'order_before_switch'",
    );
    assert.equal(oldPayment.razorpay_environment, "sandbox");

    const originalFetch = globalThis.fetch;
    let testedAuthorization;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith("https://api.razorpay.com/v1/payments?count=1")) {
        testedAuthorization = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
    try {
      const tested = await api("/admin/billing/razorpay/test", {
        method: "POST",
        cookie: session.cookie,
        body: { environment: "sandbox" },
      });
      assert.equal(tested.response.status, 200, JSON.stringify(tested.body));
      assert.equal(tested.body.success, true);
      assert.equal(
        testedAuthorization,
        `Basic ${Buffer.from("rzp_test_legacy:legacy-key-secret").toString("base64")}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("authentication and account recovery", { concurrency: false }, () => {
  it("requires seeded superadmins to rotate the initial password before admin access", async () => {
    await seedModule.ensureSeedSuperadmin();
    const loginResult = await login("superadmin", "superadmin123");
    assert.equal(loginResult.response.status, 200);
    assert.equal(loginResult.body.user.mustChangeCredentials, true);

    const blocked = await api("/admin/settings", { cookie: loginResult.cookie });
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.body.code, "CREDENTIAL_CHANGE_REQUIRED");

    const changed = await api("/auth/change-password", {
      method: "POST",
      cookie: loginResult.cookie,
      body: {
        currentPassword: "superadmin123",
        newPassword: "Rotated-admin-password-2026!",
      },
    });
    assert.equal(changed.response.status, 200);

    const allowed = await api("/admin/settings", { cookie: loginResult.cookie });
    assert.equal(allowed.response.status, 200);
    const sessions = await db
      .select()
      .from(userSessionsTable);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].revokedAt, null);
  });

  it("throttles repeated sign-in failures until the lock expires", async () => {
    await createUser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await login("customer@example.test", "wrong-password");
      assert.equal(failed.response.status, 401);
      assert.equal(failed.body.code, "INVALID_CREDENTIALS");
    }

    const locked = await login("customer@example.test");
    assert.equal(locked.response.status, 429);
    assert.equal(locked.body.code, "LOGIN_RATE_LIMITED");
    const [attempt] = await db.select().from(loginAttemptsTable);
    assert.equal(attempt.failedCount, 5);
    assert.ok(attempt.lockedUntil > new Date());
  });

  it("registers accounts and verifies the address with the captured test email code", async () => {
    const registration = await api("/auth/register", {
      method: "POST",
      body: {
        firstName: "New",
        lastName: "Customer",
        email: "new.customer@example.test",
        password: "New-customer-password-2026!",
      },
    });
    assert.equal(registration.response.status, 201);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /verify/i);

    const [unverified] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, "new.customer@example.test"));
    assert.equal(unverified.emailVerified, false);

    const correctCode = await getEmailCode();
    const wrongCode = await api("/auth/verify-email", {
      method: "POST",
      body: {
        email: unverified.email,
        code: correctCode === "000000" ? "000001" : "000000",
      },
    });
    assert.equal(wrongCode.response.status, 400);
    assert.equal(wrongCode.body.code, "OTP_INVALID");

    const verified = await api("/auth/verify-email", {
      method: "POST",
      body: { email: unverified.email, code: correctCode },
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.body.user.emailVerified, true);
    assert.ok(verified.cookie);
    const me = await api("/auth/me", { cookie: verified.cookie });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.email, "new.customer@example.test");
    const [otp] = await db.select().from(otpVerificationsTable);
    assert.ok(otp.consumedAt);
  });

  it("verifies an email change before restoring the account's verified state", async () => {
    const { cookie } = await loggedInUser();
    const changed = await api("/profile", {
      method: "PATCH",
      cookie,
      body: { email: "updated@example.test" },
    });
    assert.equal(changed.response.status, 200);
    assert.equal(changed.body.email, "updated@example.test");
    assert.equal(changed.body.emailVerified, false);
    assert.match(emails.at(-1).subject, /email change/i);

    const verified = await api("/auth/verify-email", {
      method: "POST",
      body: { email: "updated@example.test", code: await getEmailCode() },
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.body.user.email, "updated@example.test");
    assert.equal(verified.body.user.emailVerified, true);
    const me = await api("/auth/me", { cookie });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.emailVerified, true);
  });

  it("creates a session on login and revokes it on logout", async () => {
    const { user, cookie } = await loggedInUser();
    const current = await api("/auth/me", { cookie });
    assert.equal(current.response.status, 200);
    const [session] = await db
      .select()
      .from(userSessionsTable)
      .where(eq(userSessionsTable.userId, user.id));
    assert.ok(session);
    assert.equal(session.revokedAt, null);

    const logout = await api("/auth/logout", { method: "POST", cookie });
    assert.equal(logout.response.status, 204);
    assert.match(logout.response.headers.get("set-cookie") ?? "", /mailflow_session=;/);
    const afterLogout = await api("/auth/me", { cookie });
    assert.equal(afterLogout.response.status, 401);
    const [revoked] = await db
      .select()
      .from(userSessionsTable)
      .where(eq(userSessionsTable.id, session.id));
    assert.ok(revoked.revokedAt);
  });

  it("sends password resets through the test transport, rotates the password, and revokes sessions", async () => {
    const { user, cookie } = await loggedInUser();
    const resetRequest = await api("/auth/forgot-password", {
      method: "POST",
      body: { email: user.email },
    });
    assert.equal(resetRequest.response.status, 200);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /reset/i);
    const link = emails[0].text.match(/https?:\/\/\S+/)?.[0];
    assert.ok(link, "reset email should contain a reset URL");
    const resetToken = new URL(link).searchParams.get("token");
    assert.ok(resetToken);

    const reset = await api("/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password: "Replacement-password-2026!" },
    });
    assert.equal(reset.response.status, 200);
    const oldSession = await api("/auth/me", { cookie });
    assert.equal(oldSession.response.status, 401);
    const reusedToken = await api("/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password: "Another-password-2026!" },
    });
    assert.equal(reusedToken.response.status, 400);

    const oldPassword = await login(user.email);
    assert.equal(oldPassword.response.status, 401);
    const newPassword = await login(user.email, "Replacement-password-2026!");
    assert.equal(newPassword.response.status, 200);
  });

  it("keeps the password-changing session and revokes other active sessions", async () => {
    const user = await createUser();
    const firstSession = await login(user.email);
    const secondSession = await login(user.email);
    assert.equal(firstSession.response.status, 200);
    assert.equal(secondSession.response.status, 200);

    const changed = await api("/auth/change-password", {
      method: "POST",
      cookie: firstSession.cookie,
      body: {
        currentPassword: "Initial-user-password-2026!",
        newPassword: "Changed-account-password-2026!",
      },
    });
    assert.equal(changed.response.status, 200);

    const currentSession = await api("/auth/me", { cookie: firstSession.cookie });
    const otherSession = await api("/auth/me", { cookie: secondSession.cookie });
    assert.equal(currentSession.response.status, 200);
    assert.equal(otherSession.response.status, 401);
    const sessions = await db
      .select()
      .from(userSessionsTable)
      .where(eq(userSessionsTable.userId, user.id));
    assert.equal(sessions.length, 2);
    assert.equal(sessions.filter((session) => session.revokedAt == null).length, 1);
  });

  it("protects admin routes from anonymous and customer accounts", async () => {
    const anonymous = await api("/admin/settings");
    assert.equal(anonymous.response.status, 401);

    await createUser();
    const customer = await login("customer@example.test");
    const customerAccess = await api("/admin/settings", { cookie: customer.cookie });
    assert.equal(customerAccess.response.status, 403);

    await createUser({
      username: "platform-admin",
      email: "admin@example.test",
      role: "SUPERADMIN",
    });
    const admin = await login("admin@example.test");
    const adminAccess = await api("/admin/settings", { cookie: admin.cookie });
    assert.equal(adminAccess.response.status, 200);
  });

  it("invalidates sessions when accounts are disabled or deleted", async () => {
    const adminUser = await createUser({
      username: "platform-admin",
      email: "admin@example.test",
      role: "SUPERADMIN",
    });
    const admin = await login(adminUser.email);
    assert.equal(admin.response.status, 200);

    const disabledUser = await createUser({ username: "disabled-user" });
    const disabledLogin = await login(disabledUser.email);
    assert.equal(disabledLogin.response.status, 200);
    const disabled = await api(`/admin/users/${disabledUser.id}/status`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { active: false },
    });
    assert.equal(disabled.response.status, 200);
    const disabledMe = await api("/auth/me", { cookie: disabledLogin.cookie });
    assert.equal(disabledMe.response.status, 401);
    const [disabledSession] = await db
      .select()
      .from(userSessionsTable)
      .where(eq(userSessionsTable.userId, disabledUser.id));
    assert.ok(disabledSession.revokedAt);
    const disabledAgain = await login(disabledUser.email);
    assert.equal(disabledAgain.response.status, 401);

    const deletedUser = await createUser({
      username: "deleted-user",
      email: "deleted@example.test",
    });
    const deletedLogin = await login(deletedUser.email);
    assert.equal(deletedLogin.response.status, 200);
    const deleted = await api(`/admin/users/${deletedUser.id}`, {
      method: "DELETE",
      cookie: admin.cookie,
    });
    assert.equal(deleted.response.status, 204);
    const deletedMe = await api("/auth/me", { cookie: deletedLogin.cookie });
    assert.equal(deletedMe.response.status, 401);
    const [deletedSession] = await db
      .select()
      .from(userSessionsTable)
      .where(eq(userSessionsTable.userId, deletedUser.id));
    assert.ok(deletedSession.revokedAt);
    const deletedAgain = await login(deletedUser.email);
    assert.equal(deletedAgain.response.status, 401);
  });
});