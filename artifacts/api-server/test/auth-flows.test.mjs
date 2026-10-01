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
  CREATE TYPE subscription_status AS ENUM ('active', 'superseded', 'cancelled');
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
  CREATE TABLE subscription_packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL,
    description text NOT NULL DEFAULT '',
    amount_minor integer NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'INR',
    period_days integer NOT NULL,
    contact_limit integer NOT NULL DEFAULT 5000,
    active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    razorpay_environment razorpay_environment,
    razorpay_order_id varchar(80),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE user_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_id uuid NOT NULL REFERENCES subscription_packages(id) ON DELETE RESTRICT,
    payment_id uuid NOT NULL,
    status subscription_status NOT NULL DEFAULT 'active',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
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
  CREATE TYPE email_campaign_status AS ENUM ('draft', 'queued', 'sending', 'completed');
  CREATE TYPE email_campaign_recipient_status AS ENUM ('queued', 'sending', 'delivered', 'bounced', 'suppressed', 'unknown');
  CREATE TABLE tenant_sending_configurations (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    provider varchar(32) NOT NULL DEFAULT 'other',
    host varchar(255) NOT NULL,
    port integer NOT NULL,
    encryption varchar(10) NOT NULL,
    username_encrypted text NOT NULL,
    password_encrypted text NOT NULL,
    from_name varchar(120) NOT NULL,
    from_email varchar(254) NOT NULL,
    reply_to varchar(254),
    verified_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(201) NOT NULL DEFAULT '',
    email varchar(254) NOT NULL,
    first_name varchar(100) NOT NULL DEFAULT '',
    last_name varchar(100) NOT NULL DEFAULT '',
    company_name varchar(200),
    linkedin_url varchar(2048),
    phone_number varchar(40),
    subscribed boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, email),
    UNIQUE (id, user_id)
  );
  CREATE TABLE contact_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(120) NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name),
    UNIQUE (id, user_id)
  );
  CREATE TABLE contact_list_members (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (list_id, user_id) REFERENCES contact_lists(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id, user_id) REFERENCES contacts(id, user_id) ON DELETE CASCADE,
    UNIQUE (user_id, list_id, contact_id)
  );
  CREATE TABLE email_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id uuid REFERENCES contact_lists(id) ON DELETE SET NULL,
    name varchar(160) NOT NULL,
    subject varchar(200) NOT NULL,
    text_body text NOT NULL,
    status email_campaign_status NOT NULL DEFAULT 'draft',
    queued_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id)
  );
  CREATE TABLE email_campaign_recipients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
    email varchar(254) NOT NULL,
    first_name varchar(100) NOT NULL DEFAULT '',
    last_name varchar(100) NOT NULL DEFAULT '',
    status email_campaign_recipient_status NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE email_send_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES email_campaign_recipients(id) ON DELETE CASCADE,
    attempted_at timestamptz NOT NULL DEFAULT now()
  );
`);

const schema = await import("@workspace/db/schema");
const { Pool: MemoryPool } = memory.adapters.createPg();
const memoryPool = new MemoryPool();
function adaptMemoryQuery(client) {
  const query = client.query.bind(client);
  client.query = (config, ...args) => {
    const arrayMode = config && typeof config === "object" && config.rowMode === "array";
    if (typeof config === "string") {
      config = config.replace(/\s+for update skip locked\b/gi, " for update");
    } else if (config && typeof config === "object" && typeof config.text === "string") {
      config = {
        ...config,
        text: config.text.replace(/\s+for update skip locked\b/gi, " for update"),
      };
    }
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

const [
  { default: app },
  emailModule,
  securityModule,
  seedModule,
  razorpayModule,
  campaignWorkerModule,
] = await Promise.all([
  import("../src/app.ts"),
  import("../src/lib/application-email.ts"),
  import("../src/lib/security.ts"),
  import("../src/lib/seed.ts"),
  import("../src/lib/razorpay.ts"),
  import("../src/lib/campaign-worker.ts"),
]);

const { db, usersTable, userSessionsTable, loginAttemptsTable, otpVerificationsTable } =
  dbModule;
const emails = [];
const tenantDeliveries = [];
emailModule.setApplicationEmailTransportForTests(async (message) => {
  emails.push(message);
});
emailModule.setTenantEmailTransportForTests(async (message) => {
  tenantDeliveries.push(message);
  return { accepted: true };
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
  await db.delete(dbModule.emailSendAttemptsTable);
  await db.delete(dbModule.emailCampaignRecipientsTable);
  await db.delete(dbModule.emailCampaignsTable);
  await db.delete(dbModule.contactListMembersTable);
  await db.delete(dbModule.contactsTable);
  await db.delete(dbModule.contactListsTable);
  await db.delete(dbModule.tenantSendingConfigurationTable);
  await db.delete(dbModule.auditLogsTable);
  await db.delete(dbModule.contactsTable);
  await db.delete(dbModule.userSubscriptionsTable);
  await db.delete(dbModule.paymentsTable);
  await db.delete(dbModule.subscriptionPackagesTable);
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
  tenantDeliveries.length = 0;
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

async function uploadCsv(path, csvText, cookie) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "text/csv",
      ...(cookie ? { cookie } : {}),
    },
    body: csvText,
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
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

describe("tenant contact management and package quotas", { concurrency: false }, () => {
  it("assigns CSV imports to a tenant-owned list and preserves quota and tenant isolation", async () => {
    const owner = await loggedInUser({ username: "csv-list-owner" });
    const other = await loggedInUser({ username: "csv-list-other" });
    const [pkg] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "One Contact CSV List Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 1,
      })
      .returning();
    await db.insert(dbModule.userSubscriptionsTable).values({
      userId: owner.user.id,
      packageId: pkg.id,
      paymentId: "55555555-5555-4555-8555-555555555555",
      status: "active",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });

    const ownerList = await api("/contact-lists", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Imported contacts" },
    });
    const otherList = await api("/contact-lists", {
      method: "POST",
      cookie: other.cookie,
      body: { name: "Other tenant list" },
    });
    assert.equal(ownerList.response.status, 201, JSON.stringify(ownerList.body));
    assert.equal(otherList.response.status, 201, JSON.stringify(otherList.body));

    const imported = await uploadCsv(
      `/contacts/import?listId=${ownerList.body.id}`,
      "name,email\nFirst Contact,first@owner.test\nOver Quota,second@owner.test",
      owner.cookie,
    );
    assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.imported, 1);
    assert.equal(imported.body.rejected.length, 1);
    assert.match(imported.body.rejected[0].reason, /contact limit/i);
    assert.deepEqual(imported.body.quota, {
      used: 1,
      limit: 1,
      remaining: 0,
      canAdd: false,
      requiresSubscription: false,
    });

    const savedMemberships = await db
      .select()
      .from(dbModule.contactListMembersTable)
      .where(eq(dbModule.contactListMembersTable.userId, owner.user.id));
    assert.equal(savedMemberships.length, 1);
    assert.equal(savedMemberships[0].listId, ownerList.body.id);
    const lists = await api("/contact-lists", { cookie: owner.cookie });
    assert.equal(
      lists.body.find((list) => list.id === ownerList.body.id).contactCount,
      1,
    );

    const foreignListImport = await uploadCsv(
      `/contacts/import?listId=${otherList.body.id}`,
      "name,email\nMust Not Import,blocked@owner.test",
      owner.cookie,
    );
    assert.equal(foreignListImport.response.status, 400);
    assert.equal(foreignListImport.body.code, "INVALID_LIST");
    const ownerContacts = await api("/contacts", { cookie: owner.cookie });
    assert.deepEqual(
      new Set(ownerContacts.body.contacts.map((contact) => contact.email)),
      new Set(["first@owner.test"]),
    );
    const otherLists = await api("/contact-lists", { cookie: other.cookie });
    assert.equal(
      otherLists.body.find((list) => list.id === otherList.body.id).contactCount,
      0,
    );

    const malformedListImport = await uploadCsv(
      "/contacts/import?listId=not-a-uuid",
      "name,email\nMust Not Import,malformed-list@owner.test",
      owner.cookie,
    );
    assert.equal(malformedListImport.response.status, 400);
    assert.equal(malformedListImport.body.code, "INVALID_INPUT");
    const afterInvalidImports = await api("/contacts", { cookie: owner.cookie });
    assert.equal(afterInvalidImports.body.contacts.length, 1);
  });

  it("stores package contact limits and returns them from create and update", async () => {
    const admin = await loggedInUser({
      username: "package-limit-admin",
      role: "SUPERADMIN",
    });
    const created = await api("/admin/billing/packages", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Contact Starter",
        description: "Test package",
        amountMinor: 19900,
        currency: "INR",
        periodDays: 30,
        contactLimit: 1250,
        active: true,
      },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.contactLimit, 1250);

    const updated = await api(`/admin/billing/packages/${created.body.id}`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { contactLimit: 2400 },
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.contactLimit, 2400);
    const [saved] = await db
      .select()
      .from(dbModule.subscriptionPackagesTable)
      .where(eq(dbModule.subscriptionPackagesTable.id, created.body.id));
    assert.equal(saved.contactLimit, 2400);
  });

  it("isolates contacts by tenant and enforces package limits on every create", async () => {
    const owner = await loggedInUser({
      username: "contacts-owner",
      email: "contacts-owner@example.test",
    });
    const other = await loggedInUser({
      username: "contacts-other",
      email: "contacts-other@example.test",
    });
    const [pkg] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Two Contact Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 2,
      })
      .returning();
    await db.insert(dbModule.userSubscriptionsTable).values({
      userId: owner.user.id,
      packageId: pkg.id,
      paymentId: "11111111-1111-4111-8111-111111111111",
      status: "active",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });

    const first = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Alex",
        lastName: "Morgan",
        email: "ALEX@example.test",
      },
    });
    assert.equal(first.response.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.email, "alex@example.test");
    const duplicate = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Alex",
        lastName: "Again",
        email: "alex@example.test",
      },
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.code, "CONTACT_ALREADY_EXISTS");

    const second = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: { firstName: "Jamie", lastName: "Lee", email: "jamie@example.test" },
    });
    assert.equal(second.response.status, 201, JSON.stringify(second.body));
    const blockedByLimit = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Taylor",
        lastName: "Reed",
        email: "taylor@example.test",
      },
    });
    assert.equal(blockedByLimit.response.status, 409);
    assert.equal(blockedByLimit.body.code, "CONTACT_LIMIT_REACHED");

    const ownerList = await api("/contacts", { cookie: owner.cookie });
    assert.equal(ownerList.response.status, 200, JSON.stringify(ownerList.body));
    assert.deepEqual(
      new Set(ownerList.body.contacts.map((contact) => contact.email)),
      new Set(["alex@example.test", "jamie@example.test"]),
    );
    assert.deepEqual(ownerList.body.quota, {
      used: 2,
      limit: 2,
      remaining: 0,
      canAdd: false,
      requiresSubscription: false,
    });

    const otherList = await api("/contacts", { cookie: other.cookie });
    assert.equal(otherList.response.status, 200, JSON.stringify(otherList.body));
    assert.equal(otherList.body.contacts.length, 0);
    assert.equal(otherList.body.quota.requiresSubscription, true);
    const subscriptionRequired = await api("/contacts", {
      method: "POST",
      cookie: other.cookie,
      body: {
        firstName: "No",
        lastName: "Plan",
        email: "no-plan@example.test",
      },
    });
    assert.equal(subscriptionRequired.response.status, 403);
    assert.equal(subscriptionRequired.body.code, "SUBSCRIPTION_REQUIRED");

    const crossTenantDelete = await api(`/contacts/${first.body.id}`, {
      method: "DELETE",
      cookie: other.cookie,
    });
    assert.equal(crossTenantDelete.response.status, 404);
    const deleted = await api(`/contacts/${first.body.id}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    assert.equal(deleted.response.status, 204);
    const allowedAfterDelete = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Taylor",
        lastName: "Reed",
        email: "taylor@example.test",
      },
    });
    assert.equal(allowedAfterDelete.response.status, 201, JSON.stringify(allowedAfterDelete.body));
  });

  it("imports partial batches with required names, optional fields, duplicate protection, and quota results", async () => {
    const owner = await loggedInUser({
      username: "contact-import-owner",
      email: "contact-import-owner@example.test",
    });
    const noPlan = await loggedInUser({
      username: "contact-import-no-plan",
      email: "contact-import-no-plan@example.test",
    });
    const [pkg] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Two Contact Import Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 2,
      })
      .returning();
    await db.insert(dbModule.userSubscriptionsTable).values({
      userId: owner.user.id,
      packageId: pkg.id,
      paymentId: "22222222-2222-4222-8222-222222222222",
      status: "active",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });

    const legacyNameOnly = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Legacy Name", email: "legacy@example.test" },
    });
    assert.equal(legacyNameOnly.response.status, 400);
    const whitespaceName = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "  ",
        lastName: "Contact",
        email: "blank-name@example.test",
      },
    });
    assert.equal(whitespaceName.response.status, 400);

    const existing = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Existing",
        lastName: "Person",
        name: "Ignored legacy name",
        email: "existing@example.test",
        companyName: "Original Company",
        linkedinUrl: "https://linkedin.example/original",
        phoneNumber: "555-0100",
      },
    });
    assert.equal(existing.response.status, 201, JSON.stringify(existing.body));
    assert.equal(existing.body.name, "Existing Person");

    const unauthenticated = await api("/contacts/import", {
      method: "POST",
      body: { contacts: [{ rowNumber: 2 }] },
    });
    assert.equal(unauthenticated.response.status, 401);
    const malformed = await api("/contacts/import", {
      method: "POST",
      cookie: owner.cookie,
      body: { contacts: [] },
    });
    assert.equal(malformed.response.status, 400);
    const subscriptionRequired = await api("/contacts/import", {
      method: "POST",
      cookie: noPlan.cookie,
      body: {
        contacts: [
          {
            rowNumber: 2,
            firstName: "No",
            lastName: "Plan",
            email: "no-plan-import@example.test",
          },
        ],
      },
    });
    assert.equal(subscriptionRequired.response.status, 403);

    const imported = await api("/contacts/import", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        contacts: [
          {
            rowNumber: 2,
            firstName: "Changed",
            lastName: "Duplicate",
            email: " EXISTING@EXAMPLE.TEST ",
            companyName: "Replacement Company",
          },
          {
            rowNumber: 3,
            firstName: " New ",
            lastName: " Contact ",
            name: "Ignored import name",
            email: " New@Example.Test ",
            companyName: " Example Co ",
            linkedinUrl: "",
            phoneNumber: " 555-0199 ",
          },
          {
            rowNumber: 4,
            firstName: "   ",
            lastName: "Invalid",
            email: "invalid-name@example.test",
          },
          {
            rowNumber: 5,
            firstName: "Over",
            lastName: "Limit",
            email: "over-limit@example.test",
          },
          {
            rowNumber: 6,
            firstName: "Too",
            lastName: "Long",
            email: "too-long-company@example.test",
            companyName: "C".repeat(201),
          },
        ],
      },
    });
    assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
    assert.deepEqual(
      {
        imported: imported.body.imported,
        duplicate: imported.body.duplicate,
        invalid: imported.body.invalid,
        limitReached: imported.body.limitReached,
      },
      { imported: 1, duplicate: 1, invalid: 2, limitReached: 1 },
    );
    assert.deepEqual(
      imported.body.issues.map(({ rowNumber }) => rowNumber),
      [2, 4, 5, 6],
    );
    assert.deepEqual(imported.body.quota, {
      used: 2,
      limit: 2,
      remaining: 0,
      canAdd: false,
      requiresSubscription: false,
    });

    const contacts = await api("/contacts", { cookie: owner.cookie });
    assert.equal(contacts.response.status, 200);
    const importedContact = contacts.body.contacts.find(
      (contact) => contact.email === "new@example.test",
    );
    const unchangedDuplicate = contacts.body.contacts.find(
      (contact) => contact.email === "existing@example.test",
    );
    assert.ok(importedContact);
    assert.equal(importedContact.name, "New Contact");
    assert.equal(importedContact.companyName, "Example Co");
    assert.equal(importedContact.linkedinUrl, null);
    assert.equal(importedContact.phoneNumber, "555-0199");
    assert.equal(importedContact.subscribed, false);
    assert.equal(unchangedDuplicate.companyName, "Original Company");
    assert.equal(unchangedDuplicate.firstName, "Existing");

    const blankUpdateName = await api(`/contacts/${importedContact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { firstName: "   " },
    });
    assert.equal(blankUpdateName.response.status, 400);
    const clearedOptionalFields = await api(`/contacts/${importedContact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: {
        companyName: null,
        linkedinUrl: null,
        phoneNumber: null,
      },
    });
    assert.equal(
      clearedOptionalFields.response.status,
      200,
      JSON.stringify(clearedOptionalFields.body),
    );
    assert.equal(clearedOptionalFields.body.companyName, null);
    assert.equal(clearedOptionalFields.body.linkedinUrl, null);
    assert.equal(clearedOptionalFields.body.phoneNumber, null);
  });

  it("imports CSV rows without crossing tenant or package limits", async () => {
    const owner = await loggedInUser({ username: "csv-owner" });
    const other = await loggedInUser({ username: "csv-other" });
    const [pkg] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Three Contact CSV Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 3,
      })
      .returning();
    await db.insert(dbModule.userSubscriptionsTable).values({
      userId: owner.user.id,
      packageId: pkg.id,
      paymentId: "33333333-3333-4333-8333-333333333333",
      status: "active",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });
    const existing = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Already",
        lastName: "Saved",
        email: "saved@example.test",
      },
    });
    assert.equal(existing.response.status, 201, JSON.stringify(existing.body));

    const importSettings = await api("/contacts", { cookie: owner.cookie });
    assert.equal(importSettings.response.status, 200);
    assert.ok(importSettings.body.uploadSettings.allowedFileTypes.includes("csv"));

    const imported = await uploadCsv(
      "/contacts/import",
      [
        "name,email",
        "Already Saved,saved@example.test",
        "New Person,New@example.test",
        "Bad Address,not-an-email",
        "Malformed Row",
        "Duplicate In File,new@example.test",
        "Second Person,second@example.test",
        "Beyond Limit,extra@example.test",
      ].join("\n"),
      owner.cookie,
    );
    assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.imported, 2);
    assert.deepEqual(
      imported.body.rejected.map((row) => row.rowNumber),
      [2, 4, 5, 6, 8],
    );
    assert.match(imported.body.rejected[0].reason, /already in your contacts/i);
    assert.match(imported.body.rejected[1].reason, /valid email/i);
    assert.match(imported.body.rejected[2].reason, /columns/i);
    assert.match(imported.body.rejected[3].reason, /more than once/i);
    assert.match(imported.body.rejected[4].reason, /contact limit/i);
    assert.equal(
      imported.body.rejectedCsv.split("\r\n")[0],
      '"name","email","Import rejection reason"',
    );
    assert.match(
      imported.body.rejectedCsv,
      /"Already Saved","saved@example\.test","This email address is already in your contacts\."/,
    );
    assert.deepEqual(imported.body.quota, {
      used: 3,
      limit: 3,
      remaining: 0,
      canAdd: false,
      requiresSubscription: false,
    });

    const ownerContacts = await api("/contacts", { cookie: owner.cookie });
    assert.deepEqual(
      new Set(ownerContacts.body.contacts.map((contact) => contact.email)),
      new Set(["saved@example.test", "new@example.test", "second@example.test"]),
    );
    const blockedImport = await uploadCsv(
      "/contacts/import",
      "name,email\nNo Package,no-package@example.test",
      other.cookie,
    );
    assert.equal(blockedImport.response.status, 403);
    assert.equal(blockedImport.body.code, "SUBSCRIPTION_REQUIRED");
    const otherContacts = await api("/contacts", { cookie: other.cookie });
    assert.equal(otherContacts.body.contacts.length, 0);

    const malformedCsv = await uploadCsv(
      "/contacts/import",
      'name,email\n"Unclosed name,broken@example.test',
      owner.cookie,
    );
    assert.equal(malformedCsv.response.status, 400);
    assert.equal(malformedCsv.body.code, "INVALID_CSV");
    const afterMalformedCsv = await api("/contacts", { cookie: owner.cookie });
    assert.equal(afterMalformedCsv.body.contacts.length, 3);
  });

  it("rejects CSV uploads larger than the configured platform file limit", async () => {
    const owner = await loggedInUser({ username: "csv-size-owner" });
    await db.insert(dbModule.systemConfigurationTable).values({
      key: "platform",
      value: { maxUploadFileSizeMb: 1 },
    });
    const tooLarge = await uploadCsv(
      "/contacts/import",
      "x".repeat(1024 * 1024 + 1),
      owner.cookie,
    );
    assert.equal(tooLarge.response.status, 413);
    assert.equal(tooLarge.body.code, "FILE_TOO_LARGE");
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

describe("tenant sending and campaign delivery", { concurrency: false }, () => {
  it("isolates tenant data, encrypts SMTP credentials, and enforces worker rate limits", async () => {
    const owner = await loggedInUser({ username: "sending-owner" });
    const other = await loggedInUser({ username: "sending-other" });
    const [sendingPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Sending Test Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 10,
      })
      .returning();
    await db.insert(dbModule.userSubscriptionsTable).values([
      {
        userId: owner.user.id,
        packageId: sendingPackage.id,
        paymentId: "33333333-3333-4333-8333-333333333333",
        status: "active",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60_000),
      },
      {
        userId: other.user.id,
        packageId: sendingPackage.id,
        paymentId: "44444444-4444-4444-8444-444444444444",
        status: "active",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60_000),
      },
    ]);

    const ownerList = await api("/contact-lists", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Owner audience" },
    });
    const otherList = await api("/contact-lists", {
      method: "POST",
      cookie: other.cookie,
      body: { name: "Other audience" },
    });
    assert.equal(ownerList.response.status, 201);
    assert.equal(otherList.response.status, 201);

    const ownerContacts = await Promise.all(
      ["one@owner.test", "two@owner.test", "three@owner.test"].map((email) =>
        api("/contacts", {
          method: "POST",
          cookie: owner.cookie,
          body: {
            email,
            firstName: "Owner",
            lastName: "Contact",
            subscribed: true,
            listIds: [ownerList.body.id],
          },
        }),
      ),
    );
    const otherContact = await api("/contacts", {
      method: "POST",
      cookie: other.cookie,
      body: {
        email: "person@other.test",
        firstName: "Other",
        lastName: "Contact",
        subscribed: true,
        listIds: [otherList.body.id],
      },
    });
    assert.ok(ownerContacts.every((result) => result.response.status === 201));
    assert.equal(otherContact.response.status, 201);

    const isolatedContacts = await api("/contacts", { cookie: owner.cookie });
    assert.equal(isolatedContacts.response.status, 200);
    assert.equal(isolatedContacts.body.contacts.length, 3);
    assert.ok(
      isolatedContacts.body.contacts.every((contact) =>
        contact.email.endsWith("@owner.test"),
      ),
    );
    const crossTenantMembership = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        email: "intruder@owner.test",
        firstName: "Invalid",
        lastName: "Membership",
        subscribed: true,
        listIds: [otherList.body.id],
      },
    });
    assert.equal(crossTenantMembership.response.status, 400);
    const crossTenantEdit = await api(`/contacts/${otherContact.body.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { firstName: "Changed by another tenant" },
    });
    assert.equal(crossTenantEdit.response.status, 404);

    const savedSender = await api("/sending/settings", {
      method: "PUT",
      cookie: owner.cookie,
      body: {
        provider: "other",
        host: "smtp.owner.test",
        port: 2525,
        encryption: "none",
        username: "smtp-owner-user",
        password: "smtp-owner-secret",
        fromName: "Owner Mail",
        fromEmail: "mail@owner.test",
      },
    });
    assert.equal(savedSender.response.status, 200, JSON.stringify(savedSender.body));
    assert.equal(savedSender.body.username, "••••••");
    assert.equal("password" in savedSender.body, false);
    const [storedSender] = await db
      .select()
      .from(dbModule.tenantSendingConfigurationTable)
      .where(eq(dbModule.tenantSendingConfigurationTable.userId, owner.user.id));
    assert.notEqual(storedSender.usernameEncrypted, "smtp-owner-user");
    assert.notEqual(storedSender.passwordEncrypted, "smtp-owner-secret");
    assert.equal(securityModule.decryptSecret(storedSender.usernameEncrypted), "smtp-owner-user");
    assert.equal(securityModule.decryptSecret(storedSender.passwordEncrypted), "smtp-owner-secret");

    emailModule.setTenantEmailTransportForTests(async (message) => {
      tenantDeliveries.push(message);
      if (message.subject === "Mailflow sender identity test") {
        return { accepted: true };
      }
      if (message.to === "one@owner.test") return { accepted: true };
      return { accepted: false, error: "Recipient rejected by test transport." };
    });
    const testedSender = await api("/sending/settings/test", {
      method: "POST",
      cookie: owner.cookie,
      body: { toEmail: "owner@owner.test" },
    });
    assert.equal(testedSender.response.status, 200, JSON.stringify(testedSender.body));
    assert.ok(testedSender.body.verifiedAt);
    assert.equal(emails.length, 0, "tenant test mail must not use platform notification SMTP");
    const otherSender = await api("/sending/settings", { cookie: other.cookie });
    assert.equal(otherSender.body.credentialsConfigured, false);

    const campaign = await api("/campaigns", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        name: "Owner campaign",
        subject: "A workspace update",
        textBody: "A short plain-text campaign.",
        listId: ownerList.body.id,
      },
    });
    assert.equal(campaign.response.status, 201, JSON.stringify(campaign.body));

    await db.insert(dbModule.systemConfigurationTable).values({
      key: "platform",
      value: { defaultEmailsPerHour: 1, maxEmailsPerDay: 10 },
    });
    const queued = await api(`/campaigns/${campaign.body.id}/send`, {
      method: "POST",
      cookie: owner.cookie,
    });
    assert.equal(queued.response.status, 202, JSON.stringify(queued.body));
    assert.equal(queued.body.recipients, 3);
    const unsubscribed = await api(`/contacts/${ownerContacts[2].body.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { subscribed: false },
    });
    assert.equal(unsubscribed.response.status, 200);

    const firstBatch = await campaignWorkerModule.processPendingCampaignDeliveries();
    assert.equal(firstBatch, 1);
    const afterRateLimit = await api("/campaigns", { cookie: owner.cookie });
    const partialCampaign = afterRateLimit.body.find((item) => item.id === campaign.body.id);
    assert.equal(partialCampaign.delivered, 1);
    assert.equal(partialCampaign.queued, 1);
    assert.equal(partialCampaign.suppressed, 1);
    assert.equal(partialCampaign.status, "sending");

    await db
      .update(dbModule.systemConfigurationTable)
      .set({ value: { defaultEmailsPerHour: 100, maxEmailsPerDay: 10 } })
      .where(eq(dbModule.systemConfigurationTable.key, "platform"));
    await db
      .update(dbModule.emailCampaignRecipientsTable)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(dbModule.emailCampaignRecipientsTable.status, "queued"));
    const secondBatch = await campaignWorkerModule.processPendingCampaignDeliveries();
    assert.equal(secondBatch, 1);

    const finalCampaigns = await api("/campaigns", { cookie: owner.cookie });
    const finalCampaign = finalCampaigns.body.find((item) => item.id === campaign.body.id);
    assert.equal(finalCampaign.status, "completed");
    assert.equal(finalCampaign.delivered, 1);
    assert.equal(finalCampaign.bounced, 1);
    assert.equal(finalCampaign.suppressed, 1);
    assert.equal(finalCampaign.queued, 0);
    assert.equal(tenantDeliveries.filter((message) => message.subject === "A workspace update").length, 2);

    const ownerDashboard = await api("/dashboard", { cookie: owner.cookie });
    const otherDashboard = await api("/dashboard", { cookie: other.cookie });
    assert.equal(ownerDashboard.response.status, 200);
    assert.equal(ownerDashboard.body.contacts, 3);
    assert.equal(ownerDashboard.body.activeLists, 1);
    assert.equal(ownerDashboard.body.emailsSent, 2);
    assert.equal(ownerDashboard.body.delivered, 1);
    assert.equal(ownerDashboard.body.bounced, 1);
    assert.equal(otherDashboard.body.contacts, 1);
    assert.equal(otherDashboard.body.emailsSent, 0);
  });
});