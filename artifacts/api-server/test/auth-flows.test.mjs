import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { DataType, newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq } from "drizzle-orm";
import express from "express";
import cookieParser from "cookie-parser";
import ExcelJS from "exceljs";

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
memory.public.registerOperator({
  operator: "AT TIME ZONE",
  left: DataType.timestamptz,
  right: DataType.text,
  returns: DataType.timestamp,
  implementation: (value) => value,
});
memory.public.registerFunction({
  name: "date_trunc",
  args: [DataType.text, DataType.timestamp],
  returns: DataType.timestamp,
  implementation: (unit, value) => {
    const date = new Date(value);
    if (unit !== "month") throw new Error(`Unsupported test date_trunc unit: ${unit}`);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  },
});
memory.public.registerFunction({
  name: "to_char",
  args: [DataType.timestamp, DataType.text],
  returns: DataType.text,
  implementation: (value, format) => {
    if (format !== "YYYY-MM") throw new Error(`Unsupported test to_char format: ${format}`);
    const date = new Date(value);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  },
});

memory.public.none(`
  CREATE TYPE user_role AS ENUM ('SUPERADMIN', 'USER');
  CREATE TYPE payment_status AS ENUM ('created', 'authorized', 'captured', 'failed', 'refunded');
  CREATE TYPE razorpay_environment AS ENUM ('sandbox', 'production');
  CREATE TYPE subscription_status AS ENUM ('active', 'superseded', 'cancelled');
  CREATE TYPE platform_notification_audience AS ENUM ('broadcast', 'focused');
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
  CREATE TABLE platform_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(120) NOT NULL,
    message text NOT NULL,
    audience platform_notification_audience NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    starts_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE platform_notification_recipients (
    notification_id uuid NOT NULL REFERENCES platform_notifications(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id)
  );
  CREATE TABLE platform_notification_reads (
    notification_id uuid NOT NULL REFERENCES platform_notifications(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id)
  );
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
  CREATE TABLE password_reset_rate_limits (
    scope_hash varchar(64) PRIMARY KEY,
    request_count integer NOT NULL DEFAULT 0,
    window_started_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
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
    email_account_limit integer NOT NULL DEFAULT 1,
    active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX subscription_packages_single_free_unique
    ON subscription_packages (amount_minor)
    WHERE amount_minor = 0;
  CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_id uuid NOT NULL REFERENCES subscription_packages(id) ON DELETE RESTRICT,
    receipt varchar(40) NOT NULL,
    amount_minor integer NOT NULL,
    currency varchar(3) NOT NULL,
    status payment_status NOT NULL DEFAULT 'created',
    sender_account_ids_to_keep uuid[],
    razorpay_environment razorpay_environment,
    razorpay_order_id varchar(80),
    razorpay_payment_id varchar(80),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE user_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_id uuid NOT NULL REFERENCES subscription_packages(id) ON DELETE RESTRICT,
    payment_id uuid,
    status subscription_status NOT NULL DEFAULT 'active',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    sender_account_ids_to_keep uuid[],
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
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary boolean NOT NULL DEFAULT true,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
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
    connection_check_status varchar(16),
    connection_check_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name varchar(200) NOT NULL,
    company_website_url varchar(2048),
    company_domain varchar(255),
    company_domain_key varchar(255),
    company_industry varchar(120),
    company_size varchar(80),
    company_revenue_range varchar(80),
    company_description text,
    company_phone_number varchar(40),
    company_linkedin_url varchar(2048),
    company_location varchar(200),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id),
    UNIQUE (user_id, company_domain_key)
  );
  CREATE TABLE contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id uuid,
    company_link_suppressed boolean NOT NULL DEFAULT false,
    name varchar(201) NOT NULL DEFAULT '',
    email varchar(254) NOT NULL,
    first_name varchar(100) NOT NULL DEFAULT '',
    last_name varchar(100) NOT NULL DEFAULT '',
    company_name varchar(200),
    linkedin_url varchar(2048),
    phone_number varchar(40),
    job_title varchar(200),
    department varchar(120),
    seniority varchar(80),
    mobile_phone varchar(40),
    website_url varchar(2048),
    twitter_url varchar(2048),
    facebook_url varchar(2048),
    instagram_url varchar(2048),
    location varchar(200),
    preferred_language varchar(80),
    time_zone varchar(100),
    lifecycle_stage varchar(80),
    lead_status varchar(80),
    lead_source varchar(120),
    interests text,
    goals text,
    pain_points text,
    personalization_context text,
    notes text,
    company_website_url varchar(2048),
    company_domain varchar(255),
    company_industry varchar(120),
    company_size varchar(80),
    company_revenue_range varchar(80),
    company_description text,
    company_phone_number varchar(40),
    company_linkedin_url varchar(2048),
    company_location varchar(200),
    subscribed boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, email),
    UNIQUE (id, user_id),
    FOREIGN KEY (company_id, user_id) REFERENCES companies(id, user_id) ON DELETE RESTRICT
  );
  CREATE TABLE contact_lead_status_updates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL,
    previous_status varchar(80),
    new_status varchar(80),
    reason text NOT NULL,
    changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    changed_by_name varchar(161) NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (contact_id, user_id) REFERENCES contacts(id, user_id) ON DELETE CASCADE
  );
  CREATE TABLE contact_field_options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    field_key varchar(40) NOT NULL,
    value varchar(200) NOT NULL,
    normalized_value varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, field_key, normalized_value),
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
  CREATE TABLE contact_segments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    filters jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
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
    sender_account_id uuid REFERENCES tenant_sending_configurations(id) ON DELETE SET NULL,
    list_id uuid REFERENCES contact_lists(id) ON DELETE SET NULL,
    list_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    name varchar(160) NOT NULL,
    objective text NOT NULL DEFAULT '',
    subject varchar(200) NOT NULL,
    text_body text NOT NULL,
    html_body text,
    status email_campaign_status NOT NULL DEFAULT 'draft',
    queued_at timestamptz,
    scheduled_at timestamptz,
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
    report_outcome varchar(24) NOT NULL DEFAULT 'unconfirmed',
    report_source varchar(32),
    report_diagnostic text,
    report_status_code varchar(64),
    report_at timestamptz,
    report_delivery_scope varchar(24),
    report_evidence_verification varchar(32),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE email_send_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES email_campaign_recipients(id) ON DELETE CASCADE,
    message_id varchar(512),
    smtp_response text,
    smtp_code integer,
    enhanced_status varchar(24),
    outcome varchar(24) NOT NULL DEFAULT 'pending',
    error_message text,
    dsn_requested boolean NOT NULL DEFAULT false,
    attempted_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
  );
  CREATE TABLE gmail_mailbox_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    email_address varchar(254) NOT NULL,
    refresh_token_encrypted text NOT NULL,
    history_id varchar(64) NOT NULL,
    sync_status varchar(32) NOT NULL DEFAULT 'connected',
    last_sync_at timestamptz,
    last_success_at timestamptz,
    next_sync_at timestamptz NOT NULL DEFAULT now(),
    lease_expires_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE gmail_oauth_states (
    nonce varchar(64) PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
  );
  CREATE INDEX gmail_oauth_states_expiry_idx
    ON gmail_oauth_states(expires_at);
  CREATE TABLE microsoft365_trace_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    tenant_id varchar(36) NOT NULL,
    client_id varchar(36) NOT NULL,
    client_secret_encrypted text NOT NULL,
    sync_status varchar(32) NOT NULL DEFAULT 'connected',
    backfill_start_at timestamptz,
    backfill_end_at timestamptz,
    page_next_link text,
    backfill_completed_at timestamptz,
    last_sync_at timestamptz,
    last_success_at timestamptz,
    next_sync_at timestamptz NOT NULL DEFAULT now(),
    lease_expires_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE microsoft365_message_traces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id uuid NOT NULL REFERENCES microsoft365_trace_connections(id) ON DELETE CASCADE,
    trace_id varchar(128) NOT NULL,
    message_id varchar(512) NOT NULL,
    recipient_address varchar(254) NOT NULL,
    received_date_time timestamptz NOT NULL,
    provider_status varchar(32),
    details_checked_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (connection_id, trace_id, recipient_address)
  );
  CREATE TABLE email_delivery_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES email_campaign_recipients(id) ON DELETE CASCADE,
    attempt_id uuid NOT NULL REFERENCES email_send_attempts(id) ON DELETE CASCADE,
    fingerprint varchar(64) NOT NULL,
    outcome varchar(24) NOT NULL,
    source varchar(32) NOT NULL,
    diagnostic text,
    status_code varchar(64),
    occurred_at timestamptz,
    received_at timestamptz NOT NULL DEFAULT now(),
    delivery_scope varchar(24) NOT NULL DEFAULT 'unspecified',
    evidence_verification varchar(32) NOT NULL DEFAULT 'user_imported',
    gmail_mailbox_connection_id uuid REFERENCES gmail_mailbox_connections(id) ON DELETE SET NULL,
    microsoft365_trace_connection_id uuid REFERENCES microsoft365_trace_connections(id) ON DELETE SET NULL,
    UNIQUE (user_id, fingerprint)
  );
`);

const schema = await import("@workspace/db/schema");
const { Pool: MemoryPool } = memory.adapters.createPg();
const memoryPool = new MemoryPool();
function adaptMemoryQuery(client) {
  const query = client.query.bind(client);
  client.query = (config, ...args) => {
    const arrayMode = config && typeof config === "object" && config.rowMode === "array";
    const queryText =
      typeof config === "string" ? config : config?.text ?? "";
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
      if (
        !arrayMode &&
        /count\s*\(\s*distinct/i.test(queryText) &&
        Array.isArray(queryResult?.rows)
      ) {
        queryResult.rows = queryResult.rows.map((row) =>
          row && !Array.isArray(row) && Object.hasOwn(row, "customers")
            ? { ...row, customers: String(row.customers) }
            : row,
        );
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
  deliveryReportIngestionModule,
  deliveryParserModule,
  gmailMailboxModule,
  googleOAuthConfigurationModule,
  loggerModule,
  microsoft365TraceModule,
] = await Promise.all([
  import("../src/app.ts"),
  import("../src/lib/application-email.ts"),
  import("../src/lib/security.ts"),
  import("../src/lib/seed.ts"),
  import("../src/lib/razorpay.ts"),
  import("../src/lib/campaign-worker.ts"),
  import("../src/lib/delivery-report-ingestion.ts"),
  import("../src/lib/delivery-report-parser.ts"),
  import("../src/lib/gmail-mailbox.ts"),
  import("../src/lib/google-oauth-configuration.ts"),
  import("../src/lib/logger.ts"),
  import("../src/lib/microsoft365-trace.ts"),
]);

const {
  db,
  usersTable,
  userSessionsTable,
  loginAttemptsTable,
  otpVerificationsTable,
  passwordResetRateLimitsTable,
} = dbModule;
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
  await db.delete(dbModule.platformNotificationReadsTable);
  await db.delete(dbModule.platformNotificationRecipientsTable);
  await db.delete(dbModule.platformNotificationsTable);
  await db.delete(dbModule.emailDeliveryReportsTable);
  await db.delete(dbModule.microsoft365MessageTracesTable);
  await db.delete(dbModule.microsoft365TraceConnectionsTable);
  await db.delete(dbModule.gmailOAuthStatesTable);
  await db.delete(dbModule.gmailMailboxConnectionsTable);
  await db.delete(dbModule.emailSendAttemptsTable);
  await db.delete(dbModule.emailCampaignRecipientsTable);
  await db.delete(dbModule.emailCampaignsTable);
  await db.delete(dbModule.contactListMembersTable);
  await db.delete(dbModule.contactSegmentsTable);
  await db.delete(dbModule.contactsTable);
  await db.delete(dbModule.contactFieldOptionsTable);
  await db.delete(dbModule.companiesTable);
  await db.delete(dbModule.contactListsTable);
  await db.delete(dbModule.tenantSendingConfigurationTable);
  await db.delete(dbModule.auditLogsTable);
  await db.delete(dbModule.contactsTable);
  await db.delete(dbModule.userSubscriptionsTable);
  await db.delete(dbModule.paymentsTable);
  await db.delete(dbModule.subscriptionPackagesTable);
  await db.delete(dbModule.razorpayConfigurationTable);
  await db.delete(dbModule.passwordResetTokensTable);
  await db.delete(passwordResetRateLimitsTable);
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

async function api(
  path,
  { method = "GET", body, cookie, redirect = "follow", headers: extraHeaders = {} } = {},
) {
  const headers = { ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  const text = await response.text();
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  const responseBody = text
    ? response.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(text)
      : text
    : undefined;
  return {
    response,
    body: responseBody,
    cookie: setCookie?.split(";", 1)[0],
  };
}

async function apiBinary(path, { body, cookie, method = "POST" } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

describe("contact and company workbook exports", () => {
  it("exports filtered and all-row Excel workbooks without crossing tenant boundaries", async () => {
    const owner = await loggedInUser({
      username: "workbook-export-owner",
      email: "workbook-export-owner@example.test",
    });
    const other = await loggedInUser({
      username: "workbook-export-other",
      email: "workbook-export-other@example.test",
    });
    const [list] = await dbModule.db
      .insert(dbModule.contactListsTable)
      .values({ userId: owner.user.id, name: "Priority list" })
      .returning();
    const [company] = await dbModule.db
      .insert(dbModule.companiesTable)
      .values({
        userId: owner.user.id,
        companyName: "Northstar Systems",
        companyDomain: "northstar.test",
        companyLocation: "Austin, TX",
        companyIndustry: "Technology",
      })
      .returning();
    const [secondCompany] = await dbModule.db
      .insert(dbModule.companiesTable)
      .values({
        userId: owner.user.id,
        companyName: "Blue Harbor",
        companyLocation: "London",
        companyIndustry: "Finance",
      })
      .returning();
    const [foreignCompany] = await dbModule.db
      .insert(dbModule.companiesTable)
      .values({
        userId: other.user.id,
        companyName: "Private Workspace Company",
        companyLocation: "Austin, TX",
        companyIndustry: "Technology",
      })
      .returning();
    const [filteredContact, unsubscribedContact, otherContact] =
      await dbModule.db
        .insert(dbModule.contactsTable)
        .values([
          {
            userId: owner.user.id,
            companyId: company.id,
            name: "Charlie Filtered",
            firstName: "Charlie",
            lastName: "Filtered",
            email: "charlie@northstar.test",
            location: "Austin, TX",
            subscribed: true,
          },
          {
            userId: owner.user.id,
            companyId: company.id,
            name: "Casey Unsubscribed",
            firstName: "Casey",
            lastName: "Unsubscribed",
            email: "casey@northstar.test",
            subscribed: false,
            location: "Austin, TX",
          },
          {
            userId: owner.user.id,
            companyId: secondCompany.id,
            name: "Taylor Other",
            firstName: "Taylor",
            lastName: "Other",
            email: "taylor@blueharbor.test",
            subscribed: true,
          },
        ])
        .returning();
    const [foreignContact] = await dbModule.db
      .insert(dbModule.contactsTable)
      .values({
        userId: other.user.id,
        companyId: foreignCompany.id,
        name: "Foreign Contact",
        firstName: "Foreign",
        lastName: "Contact",
        email: "foreign@private.test",
      })
      .returning();
    await dbModule.db.insert(dbModule.contactListMembersTable).values({
      userId: owner.user.id,
      listId: list.id,
      contactId: filteredContact.id,
    });

    const filteredExport = await apiBinary("/contacts/export", {
      cookie: owner.cookie,
      body: {
        scope: "filtered",
        columns: ["name", "email", "listNames", "companyName"],
        filters: {
          search: "Charlie",
          status: "subscribed",
          listId: list.id,
          companyId: company.id,
          addedWithin: "any",
        },
      },
    });
    assert.equal(filteredExport.response.status, 200);
    assert.match(
      filteredExport.response.headers.get("content-type"),
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
    assert.match(
      filteredExport.response.headers.get("content-disposition"),
      /attachment; filename="contacts-/,
    );
    const contactWorkbook = new ExcelJS.Workbook();
    await contactWorkbook.xlsx.load(filteredExport.bytes);
    const contactSheet = contactWorkbook.getWorksheet("Contacts");
    assert.ok(contactSheet);
    assert.deepEqual(contactSheet.getRow(1).values.slice(1), [
      "Name",
      "Email",
      "Lists",
      "Company",
    ]);
    assert.deepEqual(contactSheet.getRow(2).values.slice(1), [
      "Charlie Filtered",
      "charlie@northstar.test",
      "Priority list",
      "Northstar Systems",
    ]);
    assert.equal(contactSheet.rowCount, 2);

    const allContactsExport = await apiBinary("/contacts/export", {
      cookie: owner.cookie,
      body: {
        scope: "all",
        columns: ["email"],
        filters: { search: "no-match" },
      },
    });
    assert.equal(allContactsExport.response.status, 200);
    const allContactsWorkbook = new ExcelJS.Workbook();
    await allContactsWorkbook.xlsx.load(allContactsExport.bytes);
    const contactEmails = allContactsWorkbook
      .getWorksheet("Contacts")
      .getColumn(1)
      .values.slice(2);
    assert.deepEqual(new Set(contactEmails), new Set([
      "charlie@northstar.test",
      "casey@northstar.test",
      "taylor@blueharbor.test",
    ]));
    assert.equal(contactEmails.includes(foreignContact.email), false);

    const filteredCompaniesExport = await apiBinary("/companies/export", {
      cookie: owner.cookie,
      body: {
        scope: "filtered",
        columns: ["companyName", "companyLocation", "contactCount"],
        filters: {
          search: "Northstar",
          industry: "Technology",
          location: "Austin",
        },
      },
    });
    assert.equal(filteredCompaniesExport.response.status, 200);
    const companyWorkbook = new ExcelJS.Workbook();
    await companyWorkbook.xlsx.load(filteredCompaniesExport.bytes);
    const companySheet = companyWorkbook.getWorksheet("Companies");
    assert.ok(companySheet);
    assert.deepEqual(companySheet.getRow(1).values.slice(1), [
      "Company name",
      "Location",
      "Contacts",
    ]);
    assert.deepEqual(companySheet.getRow(2).values.slice(1), [
      "Northstar Systems",
      "Austin, TX",
      2,
    ]);
    assert.equal(companySheet.rowCount, 2);

    const allCompaniesExport = await apiBinary("/companies/export", {
      cookie: owner.cookie,
      body: {
        scope: "all",
        columns: ["companyName"],
        filters: { search: "no-match" },
      },
    });
    assert.equal(allCompaniesExport.response.status, 200);
    const allCompaniesWorkbook = new ExcelJS.Workbook();
    await allCompaniesWorkbook.xlsx.load(allCompaniesExport.bytes);
    const companyNames = allCompaniesWorkbook
      .getWorksheet("Companies")
      .getColumn(1)
      .values.slice(2);
    assert.deepEqual(new Set(companyNames), new Set([
      "Northstar Systems",
      "Blue Harbor",
    ]));
    assert.equal(companyNames.includes(foreignCompany.companyName), false);
  });
});

async function withGmailOAuthConfig(run, { verified = true } = {}) {
  const key = "google_oauth";
  const config = {
    clientId: "mailflow-test-client",
    clientSecret: "mailflow-test-secret",
    redirectUri: "http://localhost/api/sending/gmail/oauth/callback",
  };
  const value = {
    clientId: config.clientId,
    clientSecretEncrypted: securityModule.encryptSecret(config.clientSecret),
    redirectUri: config.redirectUri,
    ...(verified
      ? {
          verifiedFingerprint:
            googleOAuthConfigurationModule.googleOAuthConfigurationFingerprint(
              config,
            ),
          verifiedAt: new Date().toISOString(),
        }
      : {}),
  };
  await db
    .insert(dbModule.systemConfigurationTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: dbModule.systemConfigurationTable.key,
      set: { value, updatedAt: new Date() },
    });
  try {
    return await run();
  } finally {
    await db
      .delete(dbModule.systemConfigurationTable)
      .where(eq(dbModule.systemConfigurationTable.key, key));
  }
}

async function withGoogleFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      ["oauth2.googleapis.com", "openidconnect.googleapis.com", "gmail.googleapis.com"].includes(
        url.hostname,
      )
    ) {
      return handler(url, init);
    }
    return originalFetch(input, init);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withMicrosoft365Fetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.hostname === "login.microsoftonline.com" ||
      url.hostname === "graph.microsoft.com"
    ) {
      return handler(url, init);
    }
    return originalFetch(input, init);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function googleJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function microsoftJson(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function startGmailOAuth(sessionCookie) {
  const connected = await api("/sending/gmail/connect", {
    method: "POST",
    cookie: sessionCookie,
  });
  assert.equal(connected.response.status, 200, JSON.stringify(connected.body));
  assert.ok(connected.cookie);
  const setCookie = connected.response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\/api\/sending\/gmail\/oauth\/callback/i);
  const oauthCookieValue = connected.cookie.slice(
    connected.cookie.indexOf("=") + 1,
  );
  return {
    authorizationUrl: connected.body.authorizationUrl,
    state: new URL(connected.body.authorizationUrl).searchParams.get("state"),
    cookie: connected.cookie,
    nonce: oauthCookieValue,
  };
}

async function finishGmailOAuth(
  sessionCookie,
  flow,
  { state = flow.state, oauthCookie = flow.cookie, code = "gmail-auth-code" } = {},
) {
  const query = new URLSearchParams({ code, state });
  return api(`/sending/gmail/oauth/callback?${query}`, {
    cookie: oauthCookie
      ? `${sessionCookie}; ${oauthCookie}`
      : sessionCookie,
    redirect: "manual",
  });
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

async function createMicrosoft365Connection(userId, overrides = {}) {
  const [connection] = await db
    .insert(dbModule.microsoft365TraceConnectionsTable)
    .values({
      userId,
      tenantId: "12345678-1234-4234-8234-123456789abc",
      clientId: "22345678-1234-4234-8234-123456789abc",
      clientSecretEncrypted: securityModule.encryptSecret("m365-test-secret"),
      syncStatus: "connected",
      nextSyncAt: new Date(Date.now() - 60_000),
      ...overrides,
    })
    .returning();
  return connection;
}

async function createMicrosoft365Candidate(userId, { email, messageId }) {
  const [campaign] = await db
    .insert(dbModule.emailCampaignsTable)
    .values({
      userId,
      name: `Microsoft trace ${messageId}`,
      subject: "Test message",
      textBody: "Test message body",
    })
    .returning();
  const [recipient] = await db
    .insert(dbModule.emailCampaignRecipientsTable)
    .values({ campaignId: campaign.id, userId, email })
    .returning();
  const [attempt] = await db
    .insert(dbModule.emailSendAttemptsTable)
    .values({
      userId,
      recipientId: recipient.id,
      messageId,
      outcome: "sent",
      attemptedAt: new Date(Date.now() - 3 * 60_000),
    })
    .returning();
  return { campaign, recipient, attempt };
}

async function getEmailCode() {
  const email = emails.at(-1);
  assert.ok(email, "expected a verification email to be captured");
  const match = email.text.match(/verification code is (\d{6})/i);
  assert.ok(match, "verification email should contain a six-digit code");
  return match[1];
}

describe("Superadmin overview", { concurrency: false }, () => {
  it("reports revenue only for the active payment environment and current operations", async () => {
    const admin = await createUser({
      username: "overview-admin",
      role: "SUPERADMIN",
    });
    const session = await login(admin.email);
    assert.equal(session.response.status, 200, JSON.stringify(session.body));

    const currentCustomer = await createUser({ username: "overview-current" });
    const refundedCustomer = await createUser({ username: "overview-refunded" });
    const [inrPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Overview INR",
        description: "",
        amountMinor: 15000,
        currency: "INR",
        periodDays: 30,
      })
      .returning();
    const [usdPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Overview USD",
        description: "",
        amountMinor: 1999,
        currency: "USD",
        periodDays: 30,
      })
      .returning();
    const [capturedInr, refundedInr, capturedUsd, currentRefundInr, sandboxInr] = await db
      .insert(dbModule.paymentsTable)
      .values([
        {
          userId: currentCustomer.id,
          packageId: inrPackage.id,
          receipt: "overview-captured-inr",
          amountMinor: 15000,
          currency: "INR",
          status: "captured",
          razorpayEnvironment: "production",
          updatedAt: new Date(),
        },
        {
          userId: refundedCustomer.id,
          packageId: inrPackage.id,
          receipt: "overview-refunded-inr",
          amountMinor: 2500,
          currency: "INR",
          status: "refunded",
          razorpayEnvironment: "production",
          updatedAt: new Date(),
        },
        {
          userId: currentCustomer.id,
          packageId: usdPackage.id,
          receipt: "overview-captured-usd",
          amountMinor: 1999,
          currency: "USD",
          status: "captured",
          razorpayEnvironment: "production",
          updatedAt: new Date(),
        },
        {
          userId: currentCustomer.id,
          packageId: inrPackage.id,
          receipt: "overview-current-refund-inr",
          amountMinor: 5000,
          currency: "INR",
          status: "refunded",
          razorpayEnvironment: "production",
          updatedAt: new Date(),
        },
        {
          userId: currentCustomer.id,
          packageId: inrPackage.id,
          receipt: "overview-sandbox-inr",
          amountMinor: 900000,
          currency: "INR",
          status: "captured",
          razorpayEnvironment: "sandbox",
          updatedAt: new Date(),
        },
      ])
      .returning();
    const now = new Date();
    const priorMonthCapture = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
    );
    await db.insert(dbModule.userSubscriptionsTable).values([
      {
        userId: currentCustomer.id,
        packageId: inrPackage.id,
        paymentId: capturedInr.id,
        status: "active",
        startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
      {
        userId: refundedCustomer.id,
        packageId: inrPackage.id,
        paymentId: refundedInr.id,
        status: "cancelled",
        startsAt: new Date(priorMonthCapture.getTime() - 30 * 24 * 60 * 60 * 1000),
        endsAt: priorMonthCapture,
        createdAt: priorMonthCapture,
      },
    ]);
    await db.insert(dbModule.razorpayConfigurationTable).values({
      id: "platform",
      keyId: "rzp_live_overview",
      keySecretEncrypted: securityModule.encryptSecret("overview-key-secret"),
      webhookSecretEncrypted: securityModule.encryptSecret("overview-webhook-secret"),
      activeEnvironment: "production",
    });

    const dashboard = await api("/admin/dashboard", { cookie: session.cookie });
    assert.equal(dashboard.response.status, 200, JSON.stringify(dashboard.body));
    assert.equal(dashboard.body.newUsersThisMonth, 2);
    assert.equal(dashboard.body.activeSubscriptions, 1);
    assert.equal(dashboard.body.activeCustomers, 1);
    assert.equal(dashboard.body.activePackages, 2);
    assert.equal(dashboard.body.subscriptionsEndingSoon, 1);
    assert.equal(dashboard.body.defaultCurrency, "INR");
    assert.equal(dashboard.body.revenueThisMonth, 100);
    assert.equal(dashboard.body.totalRevenue, 75);
    assert.deepEqual(dashboard.body.revenueByCurrency.map(({ currency }) => currency), [
      "INR",
      "USD",
    ]);
    assert.deepEqual(
      dashboard.body.revenueByCurrency.map(({ currency, revenueThisMonth }) => ({
        currency,
        revenueThisMonth,
      })),
      [
        { currency: "INR", revenueThisMonth: 100 },
        { currency: "USD", revenueThisMonth: 19.99 },
      ],
    );
    assert.equal(dashboard.body.revenueByCurrency[0].refundedThisMonth, 50);
    assert.equal(dashboard.body.revenueByCurrency[0].totalRevenue, 75);
    assert.equal(dashboard.body.revenueByCurrency[0].refundedLifetime, 75);
    assert.equal(dashboard.body.revenueByCurrency[0].capturedPaymentsTotal, 1);
    assert.equal(dashboard.body.revenueByCurrency[0].refundedPaymentsTotal, 2);
    assert.equal(dashboard.body.revenueByCurrency[0].revenueThisMonth, 100);
    assert.equal(dashboard.body.revenueTrend.at(-1).revenue, 100);
    assert.equal(dashboard.body.registrationsByMonth.at(-1).registrations, 2);
    assert.deepEqual(dashboard.body.activeSubscriptionsByPackage, [
      { packageName: "Overview INR", activeSubscriptions: 1 },
    ]);
    assert.equal(dashboard.body.billingEnvironment, "production");
    assert.equal(dashboard.body.applicationEmailConfigured, true);
    assert.equal(dashboard.body.maintenanceMode, false);
    assert.equal(dashboard.body.packageVisibility, "public");

    await db
      .update(dbModule.razorpayConfigurationTable)
      .set({ activeEnvironment: "sandbox" })
      .where(eq(dbModule.razorpayConfigurationTable.id, "platform"));
    const sandboxDashboard = await api("/admin/dashboard", {
      cookie: session.cookie,
    });
    assert.equal(
      sandboxDashboard.response.status,
      200,
      JSON.stringify(sandboxDashboard.body),
    );
    assert.equal(sandboxDashboard.body.billingEnvironment, "sandbox");
    assert.equal(sandboxDashboard.body.revenueThisMonth, 9000);
    assert.equal(sandboxDashboard.body.totalRevenue, 9000);
    assert.deepEqual(
      sandboxDashboard.body.revenueByCurrency.map(({ currency }) => currency),
      ["INR"],
    );
    assert.equal(
      sandboxDashboard.body.revenueByCurrency[0].capturedPaymentsTotal,
      1,
    );
    assert.equal(sandboxDashboard.body.revenueTrend.at(-1).revenue, 9000);

    await db
      .update(dbModule.razorpayConfigurationTable)
      .set({ activeEnvironment: null })
      .where(eq(dbModule.razorpayConfigurationTable.id, "platform"));
    const unconfiguredDashboard = await api("/admin/dashboard", {
      cookie: session.cookie,
    });
    assert.equal(
      unconfiguredDashboard.response.status,
      200,
      JSON.stringify(unconfiguredDashboard.body),
    );
    assert.equal(unconfiguredDashboard.body.billingEnvironment, null);
    assert.deepEqual(unconfiguredDashboard.body.revenueByCurrency, []);
    assert.ok(
      unconfiguredDashboard.body.revenueTrend.every((month) => month.revenue === 0),
    );
  });

  it("returns explicit zero and unconfigured states before customers or payments exist", async () => {
    const admin = await createUser({
      username: "overview-empty-admin",
      role: "SUPERADMIN",
    });
    const session = await login(admin.email);
    assert.equal(session.response.status, 200, JSON.stringify(session.body));

    const dashboard = await api("/admin/dashboard", { cookie: session.cookie });
    assert.equal(dashboard.response.status, 200, JSON.stringify(dashboard.body));
    assert.equal(dashboard.body.totalUsers, 0);
    assert.equal(dashboard.body.newUsersThisMonth, 0);
    assert.equal(dashboard.body.activeSubscriptions, 0);
    assert.equal(dashboard.body.activeCustomers, 0);
    assert.equal(dashboard.body.activePackages, 0);
    assert.equal(dashboard.body.subscriptionsEndingSoon, 0);
    assert.equal(dashboard.body.billingEnvironment, null);
    assert.equal(dashboard.body.revenueThisMonth, 0);
    assert.equal(dashboard.body.totalRevenue, 0);
    assert.deepEqual(dashboard.body.revenueByCurrency, []);
    assert.ok(dashboard.body.revenueTrend.every((month) => month.revenue === 0));
    assert.deepEqual(dashboard.body.activeSubscriptionsByPackage, []);
    assert.equal(dashboard.body.registrationsByMonth.length, 6);
    assert.ok(dashboard.body.registrationsByMonth.every((month) => month.registrations === 0));
    assert.equal(dashboard.body.revenueTrend.length, 6);
    assert.ok(dashboard.body.revenueTrend.every((month) => month.revenue === 0));
    assert.equal(dashboard.body.billingEnvironment, null);
    assert.equal(dashboard.body.applicationEmailConfigured, true);
    assert.equal(dashboard.body.maintenanceMode, false);
    assert.equal(dashboard.body.packageVisibility, "public");
    assert.equal(dashboard.body.emailsSent, 0);
    assert.deepEqual(dashboard.body.recentUsers, []);
  });
});

describe("Platform notifications", { concurrency: false }, () => {
  const activeWindow = () => ({
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });

  it("broadcasts to each customer and keeps read state account-specific", async () => {
    const admin = await createUser({
      username: "notification-broadcast-admin",
      role: "SUPERADMIN",
    });
    const firstCustomer = await createUser({
      username: "notification-broadcast-first",
    });
    const secondCustomer = await createUser({
      username: "notification-broadcast-second",
    });
    const adminSession = await login(admin.email);
    const firstSession = await login(firstCustomer.email);
    const secondSession = await login(secondCustomer.email);

    const created = await api("/admin/notifications", {
      method: "POST",
      cookie: adminSession.cookie,
      body: {
        title: "Service update",
        message: "The platform will be briefly unavailable tonight.",
        audience: "broadcast",
        recipientUserIds: [],
        ...activeWindow(),
      },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, "active");
    assert.equal(created.body.recipientCount, 2);
    assert.equal(created.body.readCount, 0);

    const firstList = await api("/notifications", { cookie: firstSession.cookie });
    const secondList = await api("/notifications", { cookie: secondSession.cookie });
    assert.equal(firstList.response.status, 200, JSON.stringify(firstList.body));
    assert.equal(secondList.response.status, 200, JSON.stringify(secondList.body));
    assert.deepEqual(firstList.body.unread.map(({ id }) => id), [created.body.id]);
    assert.deepEqual(secondList.body.unread.map(({ id }) => id), [created.body.id]);
    assert.deepEqual(firstList.body.history, []);

    const marked = await api(`/notifications/${created.body.id}/read`, {
      method: "POST",
      cookie: firstSession.cookie,
    });
    assert.equal(marked.response.status, 200, JSON.stringify(marked.body));
    assert.equal(marked.body.notificationId, created.body.id);
    assert.ok(marked.body.readAt);

    const firstAfterRead = await api("/notifications", {
      cookie: firstSession.cookie,
    });
    const secondAfterRead = await api("/notifications", {
      cookie: secondSession.cookie,
    });
    assert.deepEqual(firstAfterRead.body.unread, []);
    assert.equal(firstAfterRead.body.history.length, 1);
    assert.equal(firstAfterRead.body.history[0].id, created.body.id);
    assert.equal(secondAfterRead.body.unread.length, 1);
    assert.deepEqual(secondAfterRead.body.history, []);

    const repeatedRead = await api(`/notifications/${created.body.id}/read`, {
      method: "POST",
      cookie: firstSession.cookie,
    });
    assert.equal(repeatedRead.response.status, 200);
    const adminList = await api("/admin/notifications", {
      cookie: adminSession.cookie,
    });
    const broadcastSummary = adminList.body.items.find(
      ({ id }) => id === created.body.id,
    );
    assert.equal(broadcastSummary.recipientCount, 2);
    assert.equal(broadcastSummary.readCount, 1);
  });

  it("limits focused notices to selected customers and retains read history when disabled", async () => {
    const admin = await createUser({
      username: "notification-focused-admin",
      role: "SUPERADMIN",
    });
    const target = await createUser({ username: "notification-focused-target" });
    const other = await createUser({ username: "notification-focused-other" });
    const adminSession = await login(admin.email);
    const targetSession = await login(target.email);
    const otherSession = await login(other.email);

    const selectedSuperadmin = await api("/admin/notifications", {
      method: "POST",
      cookie: adminSession.cookie,
      body: {
        title: "Invalid target",
        message: "This must not be assigned to a superadmin.",
        audience: "focused",
        recipientUserIds: [admin.id],
        ...activeWindow(),
      },
    });
    assert.equal(selectedSuperadmin.response.status, 400);

    const created = await api("/admin/notifications", {
      method: "POST",
      cookie: adminSession.cookie,
      body: {
        title: "Account-specific notice",
        message: "Please review your account settings.",
        audience: "focused",
        recipientUserIds: [target.id],
        ...activeWindow(),
      },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.recipientCount, 1);

    const targetList = await api("/notifications", { cookie: targetSession.cookie });
    const otherList = await api("/notifications", { cookie: otherSession.cookie });
    assert.deepEqual(targetList.body.unread.map(({ id }) => id), [created.body.id]);
    assert.deepEqual(otherList.body.unread, []);

    const unauthorizedRead = await api(
      `/notifications/${created.body.id}/read`,
      { method: "POST", cookie: otherSession.cookie },
    );
    assert.equal(unauthorizedRead.response.status, 404);

    const marked = await api(`/notifications/${created.body.id}/read`, {
      method: "POST",
      cookie: targetSession.cookie,
    });
    assert.equal(marked.response.status, 200);
    const disabled = await api(
      `/admin/notifications/${created.body.id}/status`,
      {
        method: "PATCH",
        cookie: adminSession.cookie,
        body: { enabled: false },
      },
    );
    assert.equal(disabled.response.status, 200, JSON.stringify(disabled.body));
    assert.equal(disabled.body.status, "disabled");

    const targetAfterDisable = await api("/notifications", {
      cookie: targetSession.cookie,
    });
    assert.deepEqual(targetAfterDisable.body.unread, []);
    assert.equal(targetAfterDisable.body.history.length, 1);

    const scheduledWindow = {
      startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    };
    const scheduled = await api("/admin/notifications", {
      method: "POST",
      cookie: adminSession.cookie,
      body: {
        title: "Upcoming notice",
        message: "This message is not active yet.",
        audience: "focused",
        recipientUserIds: [target.id],
        ...scheduledWindow,
      },
    });
    assert.equal(scheduled.response.status, 201, JSON.stringify(scheduled.body));
    assert.equal(scheduled.body.status, "scheduled");
    const targetBeforeStart = await api("/notifications", {
      cookie: targetSession.cookie,
    });
    assert.deepEqual(targetBeforeStart.body.unread, []);
  });

  it("keeps notification administration superadmin-only", async () => {
    const customer = await createUser({
      username: "notification-route-customer",
    });
    const customerSession = await login(customer.email);
    const list = await api("/admin/notifications", {
      cookie: customerSession.cookie,
    });
    assert.equal(list.response.status, 403);
  });

  it("searches notices and permits deletion only after 90 days expired", async () => {
    const admin = await createUser({
      username: "notification-retention-admin",
      role: "SUPERADMIN",
    });
    const customer = await createUser({
      username: "notification-retention-customer",
    });
    const adminSession = await login(admin.email);
    const customerSession = await login(customer.email);
    const retentionMs = 90 * 24 * 60 * 60 * 1000;
    const oldExpiry = new Date(Date.now() - retentionMs - 60_000);
    const recentExpiry = new Date(Date.now() - retentionMs + 60_000);
    const createNotice = (title, expiresAt, audience, recipientUserIds) =>
      api("/admin/notifications", {
        method: "POST",
        cookie: adminSession.cookie,
        body: {
          title,
          message: "Notification retention test",
          audience,
          recipientUserIds,
          startsAt: new Date(expiresAt.getTime() - 60 * 60_000).toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });
    const oldNotice = await createNotice(
      "Archive search target",
      oldExpiry,
      "focused",
      [customer.id],
    );
    const recentNotice = await createNotice(
      "Recent expired notice",
      recentExpiry,
      "broadcast",
      [],
    );
    assert.equal(oldNotice.response.status, 201);
    assert.equal(recentNotice.response.status, 201);
    await db.insert(dbModule.platformNotificationReadsTable).values({
      notificationId: oldNotice.body.id,
      userId: customer.id,
      readAt: new Date(oldExpiry.getTime() - 30 * 60_000),
    });

    const matching = await api("/admin/notifications?search=ARCHIVE", {
      cookie: adminSession.cookie,
    });
    assert.equal(matching.response.status, 200);
    assert.deepEqual(matching.body.items.map(({ id }) => id), [oldNotice.body.id]);

    const unauthorized = await api(
      `/admin/notifications/${oldNotice.body.id}`,
      { method: "DELETE", cookie: customerSession.cookie },
    );
    assert.equal(unauthorized.response.status, 403);

    const tooEarly = await api(
      `/admin/notifications/${recentNotice.body.id}`,
      { method: "DELETE", cookie: adminSession.cookie },
    );
    assert.equal(tooEarly.response.status, 409);

    const deleted = await api(
      `/admin/notifications/${oldNotice.body.id}`,
      { method: "DELETE", cookie: adminSession.cookie },
    );
    assert.equal(deleted.response.status, 204);
    const recipients = await db
      .select()
      .from(dbModule.platformNotificationRecipientsTable)
      .where(eq(dbModule.platformNotificationRecipientsTable.notificationId, oldNotice.body.id));
    const reads = await db
      .select()
      .from(dbModule.platformNotificationReadsTable)
      .where(eq(dbModule.platformNotificationReadsTable.notificationId, oldNotice.body.id));
    assert.deepEqual(recipients, []);
    assert.deepEqual(reads, []);

    const removedFromSearch = await api("/admin/notifications?search=archive", {
      cookie: adminSession.cookie,
    });
    assert.deepEqual(removedFromSearch.body.items, []);
  });
});

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
    const [legacyPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Legacy payment package",
        description: "",
        amountMinor: 9900,
        currency: "INR",
        periodDays: 30,
      })
      .returning();
    await db.insert(dbModule.paymentsTable).values({
      userId: admin.id,
      packageId: legacyPackage.id,
      receipt: "legacy-order-test",
      amountMinor: 9900,
      currency: "INR",
      status: "created",
      razorpayOrderId: "order_before_switch",
    });

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
  it("stores full contact filters and scopes saved segment CRUD by tenant", async () => {
    const owner = await loggedInUser({ username: "segment-owner" });
    const other = await loggedInUser({ username: "segment-other" });
    const filters = {
      search: "product launch",
      status: "subscribed",
      listId: "all",
      companyId: "company-id",
      lifecycleStage: "Lead",
      leadStatus: "Qualified",
      leadSource: "Webinar",
      addedWithin: "30",
    };

    const created = await api("/contact-segments", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Recent qualified leads", filters },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.name, "Recent qualified leads");
    assert.deepEqual(created.body.filters, filters);

    const duplicate = await api("/contact-segments", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Recent qualified leads", filters },
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.code, "CONTACT_SEGMENT_EXISTS");

    const otherSegment = await api("/contact-segments", {
      method: "POST",
      cookie: other.cookie,
      body: { name: "Recent qualified leads", filters },
    });
    assert.equal(otherSegment.response.status, 201, JSON.stringify(otherSegment.body));

    const ownerSegments = await api("/contact-segments", { cookie: owner.cookie });
    const otherSegments = await api("/contact-segments", { cookie: other.cookie });
    assert.deepEqual(ownerSegments.body.map((segment) => segment.id), [created.body.id]);
    assert.deepEqual(otherSegments.body.map((segment) => segment.id), [otherSegment.body.id]);

    const renamed = await api(`/contact-segments/${created.body.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { name: "Webinar leads" },
    });
    assert.equal(renamed.response.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.name, "Webinar leads");
    assert.deepEqual(renamed.body.filters, filters);

    const foreignRename = await api(`/contact-segments/${created.body.id}`, {
      method: "PATCH",
      cookie: other.cookie,
      body: { name: "Not yours" },
    });
    assert.equal(foreignRename.response.status, 404);
    const foreignDelete = await api(`/contact-segments/${created.body.id}`, {
      method: "DELETE",
      cookie: other.cookie,
    });
    assert.equal(foreignDelete.response.status, 404);

    const invalidFilters = await api("/contact-segments", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Invalid filters", filters: { ...filters, status: "pending" } },
    });
    assert.equal(invalidFilters.response.status, 400);

    const deleted = await api(`/contact-segments/${created.body.id}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    assert.equal(deleted.response.status, 204);
    const ownerAfterDelete = await api("/contact-segments", { cookie: owner.cookie });
    assert.deepEqual(ownerAfterDelete.body, []);
  });

  it("requires a reason and records tenant-scoped contact lead status history", async () => {
    const owner = await loggedInUser({ username: "lead-history-owner" });
    const other = await loggedInUser({ username: "lead-history-other" });
    const [contact] = await db
      .insert(dbModule.contactsTable)
      .values({
        userId: owner.user.id,
        name: "Maya Chen",
        firstName: "Maya",
        lastName: "Chen",
        email: "maya.chen@lead-history.test",
        leadStatus: "New",
      })
      .returning();
    await db.insert(dbModule.contactFieldOptionsTable).values([
      {
        userId: owner.user.id,
        fieldKey: "leadStatus",
        value: "New",
        normalizedValue: "new",
      },
      {
        userId: owner.user.id,
        fieldKey: "leadStatus",
        value: "Qualified",
        normalizedValue: "qualified",
      },
      {
        userId: owner.user.id,
        fieldKey: "leadStatus",
        value: "Customer",
        normalizedValue: "customer",
      },
    ]);

    const missingReason = await api(`/contacts/${contact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { leadStatus: "Qualified" },
    });
    assert.equal(missingReason.response.status, 400);
    assert.equal(missingReason.body.code, "LEAD_STATUS_CHANGE_REASON_REQUIRED");

    const whitespaceReason = await api(`/contacts/${contact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { leadStatus: "Qualified", leadStatusChangeReason: "   " },
    });
    assert.equal(whitespaceReason.response.status, 400);
    assert.equal(whitespaceReason.body.code, "LEAD_STATUS_CHANGE_REASON_REQUIRED");

    const qualified = await api(`/contacts/${contact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: {
        leadStatus: "Qualified",
        leadStatusChangeReason: "Requested a product demonstration.",
      },
    });
    assert.equal(qualified.response.status, 200, JSON.stringify(qualified.body));
    assert.equal(qualified.body.leadStatus, "Qualified");

    const noOp = await api(`/contacts/${contact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { leadStatus: "Qualified" },
    });
    assert.equal(noOp.response.status, 200, JSON.stringify(noOp.body));

    const customer = await api(`/contacts/${contact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: {
        leadStatus: "Customer",
        leadStatusChangeReason: "Converted after a successful trial.",
      },
    });
    assert.equal(customer.response.status, 200, JSON.stringify(customer.body));
    assert.equal(customer.body.leadStatus, "Customer");

    const history = await api(`/contacts/${contact.id}/lead-status-updates`, {
      cookie: owner.cookie,
    });
    assert.equal(history.response.status, 200, JSON.stringify(history.body));
    assert.equal(history.body.length, 2);
    assert.deepEqual(
      history.body.map(({ previousStatus, newStatus, reason }) => ({
        previousStatus,
        newStatus,
        reason,
      })),
      [
        {
          previousStatus: "Qualified",
          newStatus: "Customer",
          reason: "Converted after a successful trial.",
        },
        {
          previousStatus: "New",
          newStatus: "Qualified",
          reason: "Requested a product demonstration.",
        },
      ],
    );
    assert.equal(
      history.body[0].changedByName,
      [owner.user.firstName, owner.user.lastName].filter(Boolean).join(" ") ||
        owner.user.username,
    );
    assert.ok(Number.isFinite(Date.parse(history.body[0].changedAt)));

    const currentContact = await api(`/contacts/${contact.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(currentContact.body.leadStatus, "Customer");

    const otherTenantHistory = await api(
      `/contacts/${contact.id}/lead-status-updates`,
      { cookie: other.cookie },
    );
    assert.equal(otherTenantHistory.response.status, 404);
  });

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
    const secondOwnerList = await api("/contact-lists", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Additional audience" },
    });
    const otherList = await api("/contact-lists", {
      method: "POST",
      cookie: other.cookie,
      body: { name: "Other tenant list" },
    });
    assert.equal(ownerList.response.status, 201, JSON.stringify(ownerList.body));
    assert.equal(secondOwnerList.response.status, 201, JSON.stringify(secondOwnerList.body));
    assert.equal(otherList.response.status, 201, JSON.stringify(otherList.body));

    const imported = await uploadCsv(
      `/contacts/import?listIds=${ownerList.body.id}&listIds=${secondOwnerList.body.id}`,
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
    assert.equal(savedMemberships.length, 2);
    assert.deepEqual(
      new Set(savedMemberships.map((membership) => membership.listId)),
      new Set([ownerList.body.id, secondOwnerList.body.id]),
    );
    const lists = await api("/contact-lists", { cookie: owner.cookie });
    assert.equal(
      lists.body.find((list) => list.id === ownerList.body.id).contactCount,
      1,
    );
    assert.equal(
      lists.body.find((list) => list.id === secondOwnerList.body.id).contactCount,
      1,
    );

    const foreignListImport = await uploadCsv(
      `/contacts/import?listId=${otherList.body.id}`,
      "name,email\nMust Not Import,blocked@owner.test",
      owner.cookie,
    );
    assert.equal(foreignListImport.response.status, 400);
    assert.equal(foreignListImport.body.code, "INVALID_LIST");
    const mixedTenantListImport = await uploadCsv(
      `/contacts/import?listIds=${ownerList.body.id}&listIds=${otherList.body.id}`,
      "name,email\nMust Not Partially Import,mixed-list@owner.test",
      owner.cookie,
    );
    assert.equal(mixedTenantListImport.response.status, 400);
    assert.equal(mixedTenantListImport.body.code, "INVALID_LIST");
    const ownerContacts = await api("/contacts", { cookie: owner.cookie });
    assert.deepEqual(
      new Set(ownerContacts.body.contacts.map((contact) => contact.email)),
      new Set(["first@owner.test"]),
    );
    const membershipsAfterInvalidImports = await db
      .select()
      .from(dbModule.contactListMembersTable)
      .where(eq(dbModule.contactListMembersTable.userId, owner.user.id));
    assert.equal(membershipsAfterInvalidImports.length, 2);
    const otherLists = await api("/contact-lists", { cookie: other.cookie });
    assert.equal(
      otherLists.body.find((list) => list.id === otherList.body.id).contactCount,
      0,
    );

    const malformedListImport = await uploadCsv(
      "/contacts/import?listIds=not-a-uuid",
      "name,email\nMust Not Import,malformed-list@owner.test",
      owner.cookie,
    );
    assert.equal(malformedListImport.response.status, 400);
    assert.equal(malformedListImport.body.code, "INVALID_INPUT");
    const afterInvalidImports = await api("/contacts", { cookie: owner.cookie });
    assert.equal(afterInvalidImports.body.contacts.length, 1);
  });

  it("stores package contact and SMTP account limits and returns them from create and update", async () => {
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
        emailAccountLimit: 2,
        active: true,
      },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.contactLimit, 1250);
    assert.equal(created.body.emailAccountLimit, 2);

    const updated = await api(`/admin/billing/packages/${created.body.id}`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { contactLimit: 2400, emailAccountLimit: 4 },
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.contactLimit, 2400);
    assert.equal(updated.body.emailAccountLimit, 4);
    const [saved] = await db
      .select()
      .from(dbModule.subscriptionPackagesTable)
      .where(eq(dbModule.subscriptionPackagesTable.id, created.body.id));
    assert.equal(saved.contactLimit, 2400);
    assert.equal(saved.emailAccountLimit, 4);
  });

  it("creates and activates free packages without a payment or Razorpay order", async () => {
    const admin = await loggedInUser({
      username: "free-package-admin",
      role: "SUPERADMIN",
    });
    const user = await loggedInUser({ username: "free-package-user" });
    const created = await api("/admin/billing/packages", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Free Starter",
        description: "Free workspace access",
        amountMinor: 0,
        currency: "INR",
        periodDays: 30,
        contactLimit: 500,
        active: true,
      },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.amountMinor, 0);

    const duplicateFreePackage = await api("/admin/billing/packages", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Second Free",
        description: "A second free package",
        amountMinor: 0,
        currency: "INR",
        periodDays: 30,
        contactLimit: 500,
        active: true,
      },
    });
    assert.equal(duplicateFreePackage.response.status, 409);
    assert.equal(
      duplicateFreePackage.body.code,
      "FREE_PACKAGE_ALREADY_EXISTS",
    );

    const keepExistingFree = await api(
      `/admin/billing/packages/${created.body.id}`,
      {
        method: "PATCH",
        cookie: admin.cookie,
        body: { amountMinor: 0 },
      },
    );
    assert.equal(keepExistingFree.response.status, 200);

    const activation = await api("/subscriptions/free", {
      method: "POST",
      cookie: user.cookie,
      body: { packageId: created.body.id },
    });
    assert.equal(activation.response.status, 200, JSON.stringify(activation.body));
    assert.equal(activation.body.subscription.package.id, created.body.id);
    assert.equal(activation.body.subscription.package.amountMinor, 0);

    const repeatedActivation = await api("/subscriptions/free", {
      method: "POST",
      cookie: user.cookie,
      body: { packageId: created.body.id },
    });
    assert.equal(repeatedActivation.response.status, 200);
    assert.equal(
      repeatedActivation.body.subscription.id,
      activation.body.subscription.id,
    );

    const directOrder = await api("/subscriptions/orders", {
      method: "POST",
      cookie: user.cookie,
      body: { packageId: created.body.id },
    });
    assert.equal(directOrder.response.status, 400);
    assert.equal(
      directOrder.body.code,
      "FREE_PACKAGE_REQUIRES_DIRECT_ACTIVATION",
    );

    const paidPackage = await api("/admin/billing/packages", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Paid Starter",
        description: "Paid workspace access",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 500,
        active: true,
      },
    });
    assert.equal(paidPackage.response.status, 201);
    const updatePaidPackageToFree = await api(
      `/admin/billing/packages/${paidPackage.body.id}`,
      {
        method: "PATCH",
        cookie: admin.cookie,
        body: { amountMinor: 0 },
      },
    );
    assert.equal(updatePaidPackageToFree.response.status, 409);
    assert.equal(
      updatePaidPackageToFree.body.code,
      "FREE_PACKAGE_ALREADY_EXISTS",
    );

    const invalidFreeActivation = await api("/subscriptions/free", {
      method: "POST",
      cookie: user.cookie,
      body: { packageId: paidPackage.body.id },
    });
    assert.equal(invalidFreeActivation.response.status, 404);
    assert.equal(invalidFreeActivation.body.code, "PACKAGE_NOT_AVAILABLE");

    const payments = await db
      .select()
      .from(dbModule.paymentsTable)
      .where(eq(dbModule.paymentsTable.userId, user.user.id));
    assert.deepEqual(payments, []);
    const subscriptions = await db
      .select()
      .from(dbModule.userSubscriptionsTable)
      .where(eq(dbModule.userSubscriptionsTable.userId, user.user.id));
    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].paymentId, null);
    const current = await api("/subscriptions/current", { cookie: user.cookie });
    assert.equal(current.body.subscription.package.id, created.body.id);

    await api(`/admin/billing/packages/${created.body.id}`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { active: false },
    });
    const duplicateWhileExistingIsInactive = await api(
      "/admin/billing/packages",
      {
        method: "POST",
        cookie: admin.cookie,
        body: {
          name: "Free While Hidden Exists",
          description: "Inactive zero-price package still occupies the slot",
          amountMinor: 0,
          currency: "INR",
          periodDays: 30,
          contactLimit: 500,
          active: true,
        },
      },
    );
    assert.equal(duplicateWhileExistingIsInactive.response.status, 409);

    await assert.rejects(
      db
        .insert(dbModule.subscriptionPackagesTable)
        .values({
          name: "Direct Duplicate",
          description: "Database index check",
          amountMinor: 0,
          currency: "INR",
          periodDays: 30,
          contactLimit: 500,
          active: true,
        })
        .returning(),
    );
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
    assert.ok(ownerList.body.contacts.every((contact) => contact.listIds.length === 0));
    assert.deepEqual(ownerList.body.quota, {
      used: 2,
      limit: 2,
      remaining: 0,
      canAdd: false,
      requiresSubscription: false,
    });
    const firstPage = await api("/contacts?page=1&pageSize=1&includeHistory=false", {
      cookie: owner.cookie,
    });
    assert.equal(firstPage.response.status, 200, JSON.stringify(firstPage.body));
    assert.equal(firstPage.body.contacts.length, 1);
    assert.equal(firstPage.body.total, 2);
    assert.equal(firstPage.body.page, 1);
    assert.equal(firstPage.body.pageSize, 1);
    assert.equal(firstPage.body.pageCount, 2);
    assert.equal(firstPage.body.workspaceTotal, 2);
    const secondPage = await api("/contacts?page=2&pageSize=1&includeHistory=false", {
      cookie: owner.cookie,
    });
    assert.equal(secondPage.response.status, 200, JSON.stringify(secondPage.body));
    assert.equal(secondPage.body.contacts.length, 1);
    assert.notEqual(firstPage.body.contacts[0].id, secondPage.body.contacts[0].id);
    const filteredPage = await api("/contacts?search=Jamie&pageSize=1", {
      cookie: owner.cookie,
    });
    assert.equal(filteredPage.response.status, 200, JSON.stringify(filteredPage.body));
    assert.equal(filteredPage.body.total, 1);
    assert.equal(filteredPage.body.contacts[0].email, "jamie@example.test");
    const contactOptions = await api("/contacts/options?search=Jamie&limit=1", {
      cookie: owner.cookie,
    });
    assert.equal(contactOptions.response.status, 200, JSON.stringify(contactOptions.body));
    assert.equal(contactOptions.body.total, 1);
    assert.equal(contactOptions.body.contacts.length, 1);
    assert.equal(contactOptions.body.contacts[0].email, "jamie@example.test");
    assert.equal("notes" in contactOptions.body.contacts[0], false);
    const filterOptions = await api("/contacts/filter-options", {
      cookie: owner.cookie,
    });
    assert.equal(filterOptions.response.status, 200, JSON.stringify(filterOptions.body));
    assert.deepEqual(filterOptions.body.lifecycleStages, []);
    assert.deepEqual(filterOptions.body.leadStatuses, []);
    assert.deepEqual(filterOptions.body.leadSources, []);

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

  it("keeps large contact directory and picker responses bounded with exact tenant totals", async (t) => {
    const owner = await loggedInUser({ username: "large-contact-directory-owner" });
    const other = await loggedInUser({ username: "large-contact-directory-other" });
    const [priorityList] = await db
      .insert(dbModule.contactListsTable)
      .values({ userId: owner.user.id, name: "Priority contacts" })
      .returning();
    const ownerCount = 1200;
    const otherCount = 48;
    const idByIndex = new Map();
    const seededAt = Date.now();

    const ownerRows = Array.from({ length: ownerCount }, (_, index) => {
      const id = randomUUID();
      idByIndex.set(index, id);
      return {
        id,
        userId: owner.user.id,
        name: `Person ${index} LargeTenant`,
        email: `person-${String(index).padStart(4, "0")}@large-tenant.test`,
        firstName: `Person${index}`,
        lastName: "LargeTenant",
        companyName: index % 10 === 0 ? "Priority Partner Group" : "General Account",
        jobTitle: "Operations Manager",
        lifecycleStage: index % 3 === 0 ? "Customer" : "Lead",
        leadStatus: index % 2 === 0 ? "Qualified" : "New",
        leadSource: index % 5 === 0 ? "Webinar" : "Import",
        notes: `Synthetic large-tenant contact record ${index} with a short realistic note.`,
        subscribed: index % 2 === 0,
        createdAt: new Date(seededAt - index * 1000),
      };
    });
    const ownerContactIds = new Set(ownerRows.map((contact) => contact.id));
    for (let offset = 0; offset < ownerRows.length; offset += 200) {
      await db
        .insert(dbModule.contactsTable)
        .values(ownerRows.slice(offset, offset + 200));
    }

    const ownerMemberships = ownerRows
      .filter((_, index) => index % 4 === 0)
      .map((contact) => ({
        userId: owner.user.id,
        listId: priorityList.id,
        contactId: contact.id,
      }));
    for (let offset = 0; offset < ownerMemberships.length; offset += 200) {
      await db
        .insert(dbModule.contactListMembersTable)
        .values(ownerMemberships.slice(offset, offset + 200));
    }

    const otherRows = Array.from({ length: otherCount }, (_, index) => ({
      id: randomUUID(),
      userId: other.user.id,
      name: `Outside Tenant ${index}`,
      email: `outside-${String(index).padStart(3, "0")}@other-tenant.test`,
      firstName: `Outside${index}`,
      lastName: "Tenant",
      companyName: "Priority Partner Group",
      lifecycleStage: "Customer",
      leadSource: "Webinar",
      subscribed: true,
      createdAt: new Date(seededAt - index * 1000),
    }));
    await db.insert(dbModule.contactsTable).values(otherRows);

    const measurements = [];
    const measuredGet = async (label, path, cookie, kind) => {
      const startedAt = performance.now();
      const result = await api(path, { cookie });
      const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
      const responseBytes = Buffer.byteLength(JSON.stringify(result.body));
      const responseBudgetBytes =
        kind === "directory" ? 128 * 1024 : 32 * 1024;
      measurements.push({
        endpoint: label,
        responseBytes,
        responseBudgetBytes,
        elapsedMs,
      });
      assert.ok(
        responseBytes <= responseBudgetBytes,
        `${label} response was ${responseBytes} bytes; expected at most ${responseBudgetBytes}`,
      );
      return result;
    };

    const firstPage = await measuredGet(
      "directory page 1",
      "/contacts?page=1&pageSize=40&includeHistory=false",
      owner.cookie,
      "directory",
    );
    assert.equal(firstPage.response.status, 200, JSON.stringify(firstPage.body));
    assert.equal(firstPage.body.contacts.length, 40);
    assert.equal(firstPage.body.total, ownerCount);
    assert.equal(firstPage.body.page, 1);
    assert.equal(firstPage.body.pageSize, 40);
    assert.equal(firstPage.body.pageCount, 30);
    assert.equal(firstPage.body.workspaceTotal, ownerCount);
    assert.equal(firstPage.body.workspaceSubscribed, ownerCount / 2);
    assert.deepEqual(
      firstPage.body.contacts.map((contact) => contact.id),
      Array.from({ length: 40 }, (_, index) => idByIndex.get(index)),
    );

    const secondPage = await measuredGet(
      "directory page 2",
      "/contacts?page=2&pageSize=40&includeHistory=false",
      owner.cookie,
      "directory",
    );
    assert.equal(secondPage.response.status, 200, JSON.stringify(secondPage.body));
    assert.equal(secondPage.body.contacts.length, 40);
    assert.equal(secondPage.body.total, ownerCount);
    assert.equal(secondPage.body.page, 2);
    assert.deepEqual(
      secondPage.body.contacts.map((contact) => contact.id),
      Array.from({ length: 40 }, (_, index) => idByIndex.get(index + 40)),
    );

    const lastPage = await measuredGet(
      "directory last page",
      "/contacts?page=30&pageSize=40&includeHistory=false",
      owner.cookie,
      "directory",
    );
    assert.equal(lastPage.response.status, 200, JSON.stringify(lastPage.body));
    assert.equal(lastPage.body.contacts.length, 40);
    assert.equal(lastPage.body.total, ownerCount);
    assert.deepEqual(
      lastPage.body.contacts.map((contact) => contact.id),
      Array.from({ length: 40 }, (_, index) => idByIndex.get(index + 1160)),
    );

    const filteredDirectory = await measuredGet(
      "filtered directory",
      "/contacts?search=priority&status=subscribed&lifecycleStage=Customer&leadSource=Webinar&page=2&pageSize=7&includeHistory=false",
      owner.cookie,
      "directory",
    );
    assert.equal(
      filteredDirectory.response.status,
      200,
      JSON.stringify(filteredDirectory.body),
    );
    assert.equal(filteredDirectory.body.total, 40);
    assert.equal(filteredDirectory.body.page, 2);
    assert.equal(filteredDirectory.body.pageSize, 7);
    assert.equal(filteredDirectory.body.pageCount, 6);
    assert.equal(filteredDirectory.body.contacts.length, 7);
    assert.deepEqual(
      filteredDirectory.body.contacts.map((contact) => contact.id),
      Array.from({ length: 7 }, (_, index) => idByIndex.get(210 + index * 30)),
    );

    const listDirectory = await measuredGet(
      "list-filtered directory",
      `/contacts?listId=${priorityList.id}&page=4&pageSize=11&includeHistory=false`,
      owner.cookie,
      "directory",
    );
    assert.equal(listDirectory.response.status, 200, JSON.stringify(listDirectory.body));
    assert.equal(listDirectory.body.total, 300);
    assert.equal(listDirectory.body.pageCount, 28);
    assert.equal(listDirectory.body.contacts.length, 11);
    assert.deepEqual(
      listDirectory.body.contacts.map((contact) => contact.id),
      Array.from({ length: 11 }, (_, index) => idByIndex.get(132 + index * 4)),
    );

    const matchingPicker = await measuredGet(
      "search-filtered picker",
      "/contacts/options?search=priority&limit=17",
      owner.cookie,
      "picker",
    );
    assert.equal(matchingPicker.response.status, 200, JSON.stringify(matchingPicker.body));
    assert.equal(matchingPicker.body.total, 120);
    assert.equal(matchingPicker.body.limit, 17);
    assert.equal(matchingPicker.body.contacts.length, 17);
    assert.ok(
      matchingPicker.body.contacts.every((contact) =>
        ownerContactIds.has(contact.id),
      ),
      "picker results should contain only the signed-in tenant's contacts",
    );

    const listPicker = await measuredGet(
      "list-filtered picker",
      `/contacts/options?listId=${priorityList.id}&limit=19`,
      owner.cookie,
      "picker",
    );
    assert.equal(listPicker.response.status, 200, JSON.stringify(listPicker.body));
    assert.equal(listPicker.body.total, 300);
    assert.equal(listPicker.body.limit, 19);
    assert.equal(listPicker.body.contacts.length, 19);
    assert.ok(
      listPicker.body.contacts.every((contact) =>
        contact.listIds.includes(priorityList.id),
      ),
    );

    const otherDirectory = await measuredGet(
      "other tenant directory",
      "/contacts?page=1&pageSize=20&includeHistory=false",
      other.cookie,
      "directory",
    );
    assert.equal(otherDirectory.response.status, 200, JSON.stringify(otherDirectory.body));
    assert.equal(otherDirectory.body.total, otherCount);
    assert.equal(otherDirectory.body.workspaceTotal, otherCount);
    assert.equal(otherDirectory.body.contacts.length, 20);
    assert.ok(
      otherDirectory.body.contacts.every((contact) =>
        contact.email.endsWith("@other-tenant.test"),
      ),
    );

    const otherPicker = await measuredGet(
      "other tenant picker",
      "/contacts/options?search=priority&limit=20",
      other.cookie,
      "picker",
    );
    assert.equal(otherPicker.response.status, 200, JSON.stringify(otherPicker.body));
    assert.equal(otherPicker.body.total, otherCount);
    assert.equal(otherPicker.body.contacts.length, 20);
    assert.ok(
      otherPicker.body.contacts.every((contact) =>
        contact.email.endsWith("@other-tenant.test"),
      ),
    );

    t.diagnostic(
      `Large-tenant contact endpoint measurements (1200 owner contacts): ${JSON.stringify(measurements)}`,
    );
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
    const configuredTitle = await api("/contact-field-options", {
      method: "POST",
      cookie: owner.cookie,
      body: { field: "jobTitle", value: "Product Lead" },
    });
    assert.equal(configuredTitle.response.status, 201, JSON.stringify(configuredTitle.body));

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
            jobTitle: " Product Lead ",
            websiteUrl: "https://people.example.test/alex?profile=full",
            companyDomain: " example.test ",
            companyLinkedinUrl: "https://www.linkedin.com/company/example-inc",
            interests: " Product strategy ",
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
    assert.equal(importedContact.jobTitle, "Product Lead");
    assert.equal(
      importedContact.websiteUrl,
      "https://people.example.test/alex?profile=full",
    );
    assert.equal(importedContact.companyDomain, "example.test");
    assert.equal(
      importedContact.companyLinkedinUrl,
      "https://www.linkedin.com/company/example-inc",
    );
    assert.equal(importedContact.interests, "Product strategy");
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

  it("reads and updates tenant-scoped contact enrichment", async () => {
    const owner = await loggedInUser({
      username: "contact-detail-owner",
      email: "contact-detail-owner@example.test",
    });
    const other = await loggedInUser({
      username: "contact-detail-other",
      email: "contact-detail-other@example.test",
    });
    const [contact] = await db
      .insert(dbModule.contactsTable)
      .values({
        userId: owner.user.id,
        email: "enriched@example.test",
        name: "Avery Chen",
        firstName: "Avery",
        lastName: "Chen",
      })
      .returning();

    const ownDetail = await api(`/contacts/${contact.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(ownDetail.response.status, 200, JSON.stringify(ownDetail.body));
    assert.equal(ownDetail.body.id, contact.id);
    assert.equal(ownDetail.body.jobTitle, null);
    assert.deepEqual(ownDetail.body.listIds, []);

    const configuredTitle = await api("/contact-field-options", {
      method: "POST",
      cookie: owner.cookie,
      body: { field: "jobTitle", value: "Product Lead" },
    });
    assert.equal(configuredTitle.response.status, 201, JSON.stringify(configuredTitle.body));

    const otherTenantDetail = await api(`/contacts/${contact.id}`, {
      cookie: other.cookie,
    });
    assert.equal(otherTenantDetail.response.status, 404);

    const updated = await api(`/contacts/${contact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: {
        jobTitle: " Product Lead ",
        department: " Product ",
        websiteUrl: "https://people.example.test/avery-chen?profile=full",
        companyDomain: " example.test ",
        companyLinkedinUrl: "https://www.linkedin.com/company/example-inc",
        interests: "Accessibility; product strategy",
        notes: "Prefers concise product updates.",
      },
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.jobTitle, "Product Lead");
    assert.equal(updated.body.department, "Product");
    assert.equal(
      updated.body.websiteUrl,
      "https://people.example.test/avery-chen?profile=full",
    );
    assert.equal(updated.body.companyDomain, "example.test");
    assert.equal(
      updated.body.companyLinkedinUrl,
      "https://www.linkedin.com/company/example-inc",
    );
    assert.equal(updated.body.interests, "Accessibility; product strategy");

    const saved = await api(`/contacts/${contact.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.notes, "Prefers concise product updates.");

    const cleared = await api(`/contacts/${contact.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { jobTitle: null, websiteUrl: "  " },
    });
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.body.jobTitle, null);
    assert.equal(cleared.body.websiteUrl, null);
  });

  it("imports CRM enrichment fields from CSV and rejects overlong field values per row", async () => {
    const owner = await loggedInUser({
      username: "csv-enrichment-owner",
      email: "csv-enrichment-owner@example.test",
    });
    const [pkg] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "CRM CSV Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 5,
      })
      .returning();
    await db.insert(dbModule.userSubscriptionsTable).values({
      userId: owner.user.id,
      packageId: pkg.id,
      paymentId: "44444444-4444-4444-8444-444444444444",
      status: "active",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });
    for (const option of [
      { field: "jobTitle", value: "Director of Product" },
      { field: "preferredLanguage", value: "English" },
      { field: "lifecycleStage", value: "Customer" },
      { field: "leadStatus", value: "Qualified" },
      { field: "leadSource", value: "Partner referral" },
    ]) {
      const configured = await api("/contact-field-options", {
        method: "POST",
        cookie: owner.cookie,
        body: option,
      });
      assert.equal(configured.response.status, 201, JSON.stringify(configured.body));
    }

    const source = {
      first_name: " Avery ",
      last_name: " Chen ",
      email: " Avery.CRM@Example.Test ",
      company_name: " Northwind Analytics ",
      linkedin_url: " https://www.linkedin.com/in/avery-chen?view=full ",
      phone_number: " +1-555-0100 ",
      job_title: " Director of Product ",
      department: " Product ",
      seniority: " Director ",
      mobile_phone: " +1-555-0101 ",
      website_url: " https://avery.example.test/profile?source=crm ",
      twitter_url: " https://x.example.test/avery ",
      facebook_url: " https://facebook.example.test/avery ",
      instagram_url: " https://instagram.example.test/avery ",
      location: " Toronto, ON ",
      preferred_language: " English ",
      time_zone: " America/Toronto ",
      lifecycle_stage: " Customer ",
      lead_status: " Qualified ",
      lead_source: " Partner referral ",
      interests: " AI; accessibility ",
      goals: " Improve onboarding ",
      pain_points: " Manual entry, repetitive exports ",
      personalization_context: " Mention their new product ",
      notes: " Follow up in Q4 ",
      company_website_url: " https://northwind.example.test/about ",
      company_domain: " northwind.example.test ",
      company_industry: " Software ",
      company_size: " 201-500 ",
      company_revenue_range: " $10M-$50M ",
      company_description: " Builds workflow software, with a focus on analytics ",
      company_phone_number: " +1-555-0199 ",
      company_linkedin_url: " https://www.linkedin.com/company/northwind?tab=about ",
      company_location: " Toronto, Canada ",
    };
    const invalidSource = {
      first_name: "Over",
      last_name: "Limit",
      email: "overlong-field@example.test",
      job_title: "J".repeat(201),
    };
    const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const headers = [...new Set([...Object.keys(source), ...Object.keys(invalidSource)])];
    const csv = [
      headers.map(csvCell).join(","),
      [source, invalidSource]
        .map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(","))
        .join("\n"),
    ].join("\n");

    const imported = await uploadCsv("/contacts/import", csv, owner.cookie);
    assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.imported, 1);
    assert.equal(imported.body.rejected.length, 1);
    assert.equal(imported.body.rejected[0].rowNumber, 3);
    assert.match(imported.body.rejected[0].reason, /job title can be up to 200 characters/i);

    const contacts = await api("/contacts", { cookie: owner.cookie });
    assert.equal(contacts.response.status, 200);
    assert.equal(contacts.body.contacts.length, 1);
    const saved = contacts.body.contacts[0];
    const expected = {
      firstName: "Avery",
      lastName: "Chen",
      email: "avery.crm@example.test",
      companyName: "Northwind Analytics",
      linkedinUrl: "https://www.linkedin.com/in/avery-chen?view=full",
      phoneNumber: "+1-555-0100",
      jobTitle: "Director of Product",
      department: "Product",
      seniority: "Director",
      mobilePhone: "+1-555-0101",
      websiteUrl: "https://avery.example.test/profile?source=crm",
      twitterUrl: "https://x.example.test/avery",
      facebookUrl: "https://facebook.example.test/avery",
      instagramUrl: "https://instagram.example.test/avery",
      location: "Toronto, ON",
      preferredLanguage: "English",
      timeZone: "America/Toronto",
      lifecycleStage: "Customer",
      leadStatus: "Qualified",
      leadSource: "Partner referral",
      interests: "AI; accessibility",
      goals: "Improve onboarding",
      painPoints: "Manual entry, repetitive exports",
      personalizationContext: "Mention their new product",
      notes: "Follow up in Q4",
      companyWebsiteUrl: "https://northwind.example.test/about",
      companyDomain: "northwind.example.test",
      companyIndustry: "Software",
      companySize: "201-500",
      companyRevenueRange: "$10M-$50M",
      companyDescription: "Builds workflow software, with a focus on analytics",
      companyPhoneNumber: "+1-555-0199",
      companyLinkedinUrl: "https://www.linkedin.com/company/northwind?tab=about",
      companyLocation: "Toronto, Canada",
    };
    for (const [field, value] of Object.entries(expected)) {
      assert.equal(saved[field], value, `${field} should be imported and returned`);
    }
    const detail = await api(`/contacts/${saved.id}`, { cookie: owner.cookie });
    assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
    assert.equal(
      detail.body.linkedinUrl,
      "https://www.linkedin.com/in/avery-chen?view=full",
    );
    assert.equal(
      detail.body.companyLinkedinUrl,
      "https://www.linkedin.com/company/northwind?tab=about",
    );
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

  it("replaces conflicting legacy company details only on confirmed linking and persists the association", async () => {
    const owner = await loggedInUser({ username: "confirmed-company-owner" });
    const other = await loggedInUser({ username: "confirmed-company-other" });
    const [company] = await db.insert(dbModule.companiesTable).values({
      userId: owner.user.id, companyName: "Tomahawk Corporation Inc",
      companyDomain: "tomahawk.test", companyDomainKey: "tomahawk.test",
      companyIndustry: "Electrical",
    }).returning();
    const [foreign] = await db.insert(dbModule.companiesTable).values({
      userId: other.user.id, companyName: "Foreign Company",
    }).returning();
    const [another] = await db.insert(dbModule.companiesTable).values({
      userId: owner.user.id, companyName: "Another Company",
    }).returning();
    const [contact] = await db.insert(dbModule.contactsTable).values({
      userId: owner.user.id, name: "Casey Contact", firstName: "Casey", lastName: "Contact",
      email: "casey@company-confirmation.test", companyName: "Linden Freight",
      companyDomain: "linden.test", companyIndustry: "Freight", notes: "Keep my contact notes",
    }).returning();
    const patch = (body) => api(`/contacts/${contact.id}`, { method: "PATCH", cookie: owner.cookie, body });
    const rejected = await patch({ companyId: company.id });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.body.code, "COMPANY_PROFILE_CONFLICT");
    const unchanged = await api(`/contacts/${contact.id}`, { cookie: owner.cookie });
    assert.equal(unchanged.body.companyId, null);
    assert.equal(unchanged.body.companyName, "Linden Freight");
    assert.equal(unchanged.body.companyDomain, "linden.test");
    const unconfirmed = await patch({ companyId: company.id, replaceLegacyCompanyProfile: false });
    assert.equal(unconfirmed.response.status, 409);
    for (const companyId of [undefined, null]) {
      const invalid = await patch({ companyId, replaceLegacyCompanyProfile: true });
      assert.equal(invalid.response.status, 400);
    }
    const inaccessible = await patch({ companyId: foreign.id, replaceLegacyCompanyProfile: true });
    assert.equal(inaccessible.response.status, 404);
    const wrongTenant = await api(`/contacts/${contact.id}`, {
      method: "PATCH", cookie: other.cookie, body: { companyId: foreign.id, replaceLegacyCompanyProfile: true },
    });
    assert.equal(wrongTenant.response.status, 404);
    const confirmed = await patch({ companyId: company.id, replaceLegacyCompanyProfile: true });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.companyId, company.id);
    assert.equal(confirmed.body.company.id, company.id);
    assert.equal(confirmed.body.company.companyName, "Tomahawk Corporation Inc");
    assert.equal(confirmed.body.companyName, null);
    assert.equal(confirmed.body.companyDomain, null);
    assert.equal(confirmed.body.notes, "Keep my contact notes");
    const reloaded = await api(`/contacts/${contact.id}`, { cookie: owner.cookie });
    assert.equal(reloaded.body.companyId, company.id);
    const detail = await api(`/companies/${company.id}`, { cookie: owner.cookie });
    assert.deepEqual(detail.body.contacts.map(item => item.id), [contact.id]);
    assert.equal(detail.body.company.companyIndustry, "Electrical");
    assert.equal(detail.body.company.companyDomain, "tomahawk.test");
    const directory = await api("/companies", { cookie: owner.cookie });
    assert.equal(directory.body.companies.find(item => item.id === company.id).contactCount, 1);
    const move = await patch({ companyId: another.id, replaceLegacyCompanyProfile: true });
    assert.equal(move.response.status, 409);
    assert.equal(move.body.code, "CONTACT_ALREADY_LINKED");
    const afterMove = await api(`/contacts/${contact.id}`, { cookie: owner.cookie });
    assert.equal(afterMove.body.companyId, company.id);
  });

  it("lists only each workspace's companies and counts only its contacts", async () => {
    const owner = await loggedInUser({
      username: "company-list-owner",
      email: "company-list-owner@example.test",
    });
    const other = await loggedInUser({
      username: "company-list-other",
      email: "company-list-other@example.test",
    });
    const [ownerCompany] = await db.insert(dbModule.companiesTable).values({
      userId: owner.user.id,
      companyName: "Shared Company Name",
      companyDomain: "owner-shared.test",
      companyDomainKey: "owner-shared.test",
    }).returning();
    const [otherCompany] = await db.insert(dbModule.companiesTable).values({
      userId: other.user.id,
      companyName: "Shared Company Name",
      companyDomain: "other-shared.test",
      companyDomainKey: "other-shared.test",
    }).returning();

    const addContacts = async (userId, companyId, prefix, count) => {
      await db.insert(dbModule.contactsTable).values(
        Array.from({ length: count }, (_, index) => ({
          userId,
          companyId,
          email: `${prefix}-${index}@company-list.test`,
        })),
      );
      await db.insert(dbModule.contactsTable).values({
        userId,
        email: `${prefix}-unlinked@company-list.test`,
        companyName: "Shared Company Name",
      });
    };
    await addContacts(owner.user.id, ownerCompany.id, "owner-contact", 2);
    await addContacts(other.user.id, otherCompany.id, "other-contact", 3);

    const ownerCompanies = await api("/companies", { cookie: owner.cookie });
    assert.equal(ownerCompanies.response.status, 200, JSON.stringify(ownerCompanies.body));
    assert.deepEqual(
      ownerCompanies.body.companies.map(({ id, companyName, contactCount }) => ({
        id,
        companyName,
        contactCount,
      })),
      [{
        id: ownerCompany.id,
        companyName: "Shared Company Name",
        contactCount: 2,
      }],
    );

    const otherCompanies = await api("/companies", { cookie: other.cookie });
    assert.equal(otherCompanies.response.status, 200, JSON.stringify(otherCompanies.body));
    assert.deepEqual(
      otherCompanies.body.companies.map(({ id, companyName, contactCount }) => ({
        id,
        companyName,
        contactCount,
      })),
      [{
        id: otherCompany.id,
        companyName: "Shared Company Name",
        contactCount: 3,
      }],
    );
  });

  it("keeps company detail, updates, and deletion scoped to the owning workspace", async () => {
    const owner = await loggedInUser({
      username: "company-private-owner",
      email: "company-private-owner@example.test",
    });
    const other = await loggedInUser({
      username: "company-private-other",
      email: "company-private-other@example.test",
    });
    const [ownerCompany] = await db.insert(dbModule.companiesTable).values({
      userId: owner.user.id,
      companyName: "Owner Company",
      companyDomain: "owner-private.test",
      companyDomainKey: "owner-private.test",
      companyIndustry: "Technology",
    }).returning();
    const [otherCompany] = await db.insert(dbModule.companiesTable).values({
      userId: other.user.id,
      companyName: "Other Workspace Company",
      companyDomain: "other-private.test",
      companyDomainKey: "other-private.test",
      companyIndustry: "Finance",
    }).returning();

    const ownerDetail = await api(`/companies/${ownerCompany.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(ownerDetail.response.status, 200, JSON.stringify(ownerDetail.body));
    assert.equal(ownerDetail.body.company.id, ownerCompany.id);
    assert.equal(ownerDetail.body.company.companyName, "Owner Company");

    const foreignDetail = await api(`/companies/${otherCompany.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(foreignDetail.response.status, 404);
    assert.equal(foreignDetail.body.code, "COMPANY_NOT_FOUND");

    const foreignUpdate = await api(`/companies/${otherCompany.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: {
        companyName: "Changed by another workspace",
        companyDomain: "changed-private.test",
      },
    });
    assert.equal(foreignUpdate.response.status, 404);
    assert.equal(foreignUpdate.body.code, "COMPANY_NOT_FOUND");

    const foreignDelete = await api(`/companies/${otherCompany.id}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    assert.equal(foreignDelete.response.status, 404);
    assert.equal(foreignDelete.body.code, "COMPANY_NOT_FOUND");

    const ownerUpdate = await api(`/companies/${ownerCompany.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: {
        companyName: "Updated Owner Company",
        companyIndustry: "Aerospace",
      },
    });
    assert.equal(ownerUpdate.response.status, 200, JSON.stringify(ownerUpdate.body));
    assert.equal(ownerUpdate.body.companyName, "Updated Owner Company");
    assert.equal(ownerUpdate.body.companyIndustry, "Aerospace");

    const otherOwnerDetail = await api(`/companies/${otherCompany.id}`, {
      cookie: other.cookie,
    });
    assert.equal(otherOwnerDetail.response.status, 200, JSON.stringify(otherOwnerDetail.body));
    assert.equal(otherOwnerDetail.body.company.companyName, "Other Workspace Company");
    assert.equal(otherOwnerDetail.body.company.companyDomain, "other-private.test");
    assert.equal(otherOwnerDetail.body.company.companyIndustry, "Finance");

    const [storedForeignCompany] = await db
      .select()
      .from(dbModule.companiesTable)
      .where(eq(dbModule.companiesTable.id, otherCompany.id));
    assert.ok(storedForeignCompany, "a foreign delete must not remove the company");
    assert.equal(storedForeignCompany.userId, other.user.id);
    assert.equal(storedForeignCompany.companyName, "Other Workspace Company");
    assert.equal(storedForeignCompany.companyDomain, "other-private.test");
    assert.equal(storedForeignCompany.companyIndustry, "Finance");
  });

  it("searches a bounded page of tenant-owned companies by name or domain", async () => {
    const owner = await loggedInUser({
      username: "company-search-owner",
      email: "company-search-owner@example.test",
    });
    const other = await loggedInUser({
      username: "company-search-other",
      email: "company-search-other@example.test",
    });
    const insertCompany = async (userId, companyName, companyDomain) => {
      const [created] = await db.insert(dbModule.companiesTable).values({
        userId,
        companyName,
        companyDomain,
        companyDomainKey: companyDomain,
      }).returning();
      return created;
    };
    const ownerBeta = await insertCompany(owner.user.id, "Acme Beta", "beta.owner-search.test");
    const ownerOrbit = await insertCompany(owner.user.id, "Acme Orbit", "orbit.owner-search.test");
    const ownerDomainMatch = await insertCompany(owner.user.id, "Northstar", "acme-special.owner-search.test");
    const ownerBothMatch = await insertCompany(
      owner.user.id,
      "Dualmatch Holdings",
      "dualmatch.owner-search.test",
    );
    const otherCompany = await insertCompany(other.user.id, "Acme Foreign", "foreign-search.test");

    const firstPage = await api("/companies/search?search=ACME&page=1&pageSize=1", {
      cookie: owner.cookie,
    });
    assert.equal(firstPage.response.status, 200, JSON.stringify(firstPage.body));
    assert.deepEqual(firstPage.body, {
      companies: [{
        id: ownerBeta.id,
        companyName: "Acme Beta",
        companyDomain: "beta.owner-search.test",
      }],
      total: 3,
      page: 1,
      pageSize: 1,
    });

    const secondPage = await api("/companies/search?search=ACME&page=2&pageSize=1", {
      cookie: owner.cookie,
    });
    assert.equal(secondPage.response.status, 200, JSON.stringify(secondPage.body));
    assert.deepEqual(secondPage.body.companies.map(company => company.id), [ownerOrbit.id]);
    assert.equal(secondPage.body.total, 3, "the total should cover all matching pages");

    const thirdPage = await api("/companies/search?search=ACME&page=3&pageSize=1", {
      cookie: owner.cookie,
    });
    assert.equal(thirdPage.response.status, 200, JSON.stringify(thirdPage.body));
    assert.deepEqual(thirdPage.body.companies.map(company => company.id), [ownerDomainMatch.id]);

    const domainSearch = await api("/companies/search?search=ACME-SPECIAL", {
      cookie: owner.cookie,
    });
    assert.equal(domainSearch.response.status, 200, JSON.stringify(domainSearch.body));
    assert.equal(domainSearch.body.total, 1);
    assert.equal(domainSearch.body.companies[0].id, ownerDomainMatch.id);

    const bothFieldsSearch = await api("/companies/search?search=DUALMATCH", {
      cookie: owner.cookie,
    });
    assert.equal(bothFieldsSearch.response.status, 200);
    assert.equal(
      bothFieldsSearch.body.total,
      1,
      "a company matching both name and domain should only count once",
    );
    assert.deepEqual(
      bothFieldsSearch.body.companies.map((company) => company.id),
      [ownerBothMatch.id],
    );

    const foreignDomain = await api("/companies/search?search=foreign-search.test", {
      cookie: owner.cookie,
    });
    assert.equal(foreignDomain.response.status, 200);
    assert.equal(foreignDomain.body.total, 0, "search results and count must be tenant-scoped");
    const otherTenantSearch = await api("/companies/search?search=ACME", {
      cookie: other.cookie,
    });
    assert.equal(otherTenantSearch.response.status, 200);
    assert.deepEqual(otherTenantSearch.body.companies.map(company => company.id), [otherCompany.id]);
    assert.equal(otherTenantSearch.body.total, 1);

    const oversizedPage = await api("/companies/search?pageSize=101", {
      cookie: owner.cookie,
    });
    assert.equal(oversizedPage.response.status, 400);
  });

  it("creates tenant-scoped shared companies from matching domains and preserves conflicts", async () => {
    const owner = await loggedInUser({ username: "company-owner" });
    const other = await loggedInUser({ username: "company-other" });
    const [companyTestPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Shared Company Test Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 10,
      })
      .returning();
    for (const [userId, paymentId] of [
      [owner.user.id, "66666666-6666-4666-8666-666666666666"],
      [other.user.id, "77777777-7777-4777-8777-777777777777"],
    ]) {
      await db.insert(dbModule.userSubscriptionsTable).values({
        userId,
        packageId: companyTestPackage.id,
        paymentId,
        status: "active",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60_000),
      });
    }
    const createLegacyContact = (cookie, email, companyName) =>
      api("/contacts", {
        method: "POST",
        cookie,
        body: {
          email,
          firstName: "Casey",
          lastName: "Contact",
          companyName,
          companyDomain: "HTTPS://WWW.acme-company.test/about",
          companyIndustry: "Software",
        },
      });

    const first = await createLegacyContact(owner.cookie, "first@acme.test", "Acme");
    const second = await createLegacyContact(owner.cookie, "second@acme.test", "ACME");
    for (const result of [first, second]) {
      assert.equal(result.response.status, 201, JSON.stringify(result.body));
    }

    const backfill = await api("/companies/backfill", {
      method: "POST",
      cookie: owner.cookie,
    });
    assert.equal(backfill.response.status, 200, JSON.stringify(backfill.body));
    assert.deepEqual(backfill.body, {
      linkedContacts: 2,
      createdCompanies: 1,
      skippedContacts: 0,
    });

    const conflict = await createLegacyContact(owner.cookie, "conflict@acme.test", "Different Co");
    const otherContact = await createLegacyContact(other.cookie, "other@acme.test", "Acme");
    for (const result of [conflict, otherContact]) {
      assert.equal(result.response.status, 201, JSON.stringify(result.body));
    }
    const secondBackfill = await api("/companies/backfill", {
      method: "POST",
      cookie: owner.cookie,
    });
    assert.equal(secondBackfill.response.status, 200, JSON.stringify(secondBackfill.body));
    assert.deepEqual(secondBackfill.body, {
      linkedContacts: 0,
      createdCompanies: 0,
      skippedContacts: 1,
    });

    const ownerReview = await api("/companies/unlinked-profiles", {
      cookie: owner.cookie,
    });
    assert.equal(ownerReview.response.status, 200, JSON.stringify(ownerReview.body));
    assert.deepEqual(ownerReview.body.profiles.map((profile) => profile.contactId), [
      conflict.body.id,
    ]);
    assert.match(ownerReview.body.profiles[0].reason, /shared company.*company name/i);
    const stillUnlinked = await api(`/contacts/${conflict.body.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(stillUnlinked.body.companyId, null);

    const otherReview = await api("/companies/unlinked-profiles", {
      cookie: other.cookie,
    });
    assert.equal(otherReview.response.status, 200, JSON.stringify(otherReview.body));
    assert.deepEqual(otherReview.body.profiles.map((profile) => profile.contactId), [
      otherContact.body.id,
    ]);

    const companies = await api("/companies", { cookie: owner.cookie });
    assert.equal(companies.response.status, 200, JSON.stringify(companies.body));
    assert.equal(companies.body.companies.length, 1);
    const company = companies.body.companies[0];
    assert.equal(company.companyDomain, "HTTPS://WWW.acme-company.test/about");
    assert.equal(company.contactCount, 2);

    const otherBackfill = await api("/companies/backfill", {
      method: "POST",
      cookie: other.cookie,
    });
    assert.equal(otherBackfill.response.status, 200, JSON.stringify(otherBackfill.body));
    assert.equal(otherBackfill.body.createdCompanies, 1);
    const otherCompanies = await api("/companies", { cookie: other.cookie });
    assert.equal(otherCompanies.body.companies.length, 1);
    assert.notEqual(otherCompanies.body.companies[0].id, company.id);

    const ownerContacts = await api("/contacts", { cookie: owner.cookie });
    const linked = ownerContacts.body.contacts.find((contact) => contact.email === "first@acme.test");
    const unlinked = ownerContacts.body.contacts.find((contact) => contact.email === "conflict@acme.test");
    assert.equal(linked.companyId, company.id);
    assert.equal(linked.company.companyName, "Acme");
    assert.equal(unlinked.companyId, null);
    assert.equal(unlinked.company, null);
    assert.equal(unlinked.companyName, "Different Co");

    const linkConflict = await api(`/contacts/${unlinked.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: { companyId: company.id },
    });
    assert.equal(linkConflict.response.status, 409);
    assert.equal(linkConflict.body.code, "COMPANY_PROFILE_CONFLICT");

    const blockedDelete = await api(`/companies/${company.id}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    assert.equal(blockedDelete.response.status, 409);
    assert.equal(blockedDelete.body.code, "COMPANY_HAS_CONTACTS");

    for (const email of ["first@acme.test", "second@acme.test"]) {
      const contact = ownerContacts.body.contacts.find((item) => item.email === email);
      const unlinkedResult = await api(`/contacts/${contact.id}`, {
        method: "PATCH",
        cookie: owner.cookie,
        body: { companyId: null },
      });
      assert.equal(unlinkedResult.response.status, 200, JSON.stringify(unlinkedResult.body));
      assert.equal(unlinkedResult.body.companyId, null);
      assert.equal(unlinkedResult.body.companyName, "Acme");
      assert.equal(
        unlinkedResult.body.companyDomain,
        "HTTPS://WWW.acme-company.test/about",
      );
    }
    const backfillAfterUnlink = await api("/companies/backfill", {
      method: "POST",
      cookie: owner.cookie,
    });
    assert.deepEqual(backfillAfterUnlink.body, {
      linkedContacts: 0,
      createdCompanies: 0,
      skippedContacts: 1,
    });
    const deleted = await api(`/companies/${company.id}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    assert.equal(deleted.response.status, 204);
  });
});

describe("tenant contact field option masters", { concurrency: false }, () => {
  it("scopes masters by tenant, validates contact values, and protects values already in use", async () => {
    const owner = await loggedInUser({ username: "contact-options-owner" });
    const other = await loggedInUser({ username: "contact-options-other" });
    const [pkg] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Contact Options Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 5,
      })
      .returning();
    await db.insert(dbModule.userSubscriptionsTable).values({
      userId: owner.user.id,
      packageId: pkg.id,
      paymentId: "88888888-8888-4888-8888-888888888888",
      status: "active",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });

    const added = await api("/contact-field-options", {
      method: "POST",
      cookie: owner.cookie,
      body: { field: "jobTitle", value: "Director" },
    });
    assert.equal(added.response.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.option.value, "Director");

    const duplicate = await api("/contact-field-options", {
      method: "POST",
      cookie: owner.cookie,
      body: { field: "jobTitle", value: " director " },
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.code, "CONTACT_FIELD_OPTION_EXISTS");

    const ownerOptions = await api("/contact-field-options", { cookie: owner.cookie });
    const otherOptions = await api("/contact-field-options", { cookie: other.cookie });
    assert.deepEqual(ownerOptions.body.options.map(({ field, value }) => ({ field, value })), [
      { field: "jobTitle", value: "Director" },
    ]);
    assert.deepEqual(otherOptions.body.options, []);

    const invalidJobTitle = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Alex",
        lastName: "Morgan",
        email: "alex.morgan@options.test",
        jobTitle: "Architect",
      },
    });
    assert.equal(invalidJobTitle.response.status, 400);
    assert.equal(invalidJobTitle.body.code, "INVALID_CONTACT_FIELD_VALUE");
    assert.match(invalidJobTitle.body.error, /Contact field settings/);

    const invalidTimeZone = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Alex",
        lastName: "Morgan",
        email: "alex.morgan@options.test",
        timeZone: "Mars/Olympus",
      },
    });
    assert.equal(invalidTimeZone.response.status, 400);
    assert.equal(invalidTimeZone.body.field, "timeZone");

    const created = await api("/contacts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        firstName: "Alex",
        lastName: "Morgan",
        email: "alex.morgan@options.test",
        jobTitle: "director",
        timeZone: "Asia/Kolkata",
      },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.jobTitle, "director");
    assert.equal(created.body.timeZone, "Asia/Kolkata");

    const inUseDelete = await api(`/contact-field-options/${added.body.option.id}`, {
      method: "DELETE",
      cookie: owner.cookie,
    });
    assert.equal(inUseDelete.response.status, 409);
    assert.equal(inUseDelete.body.code, "CONTACT_FIELD_OPTION_IN_USE");

    const foreignDelete = await api(`/contact-field-options/${added.body.option.id}`, {
      method: "DELETE",
      cookie: other.cookie,
    });
    assert.equal(foreignDelete.response.status, 404);
  });

  it("rejects CSV CRM values that have not been added to the tenant master", async () => {
    const owner = await loggedInUser({ username: "contact-options-import" });
    const [pkg] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Contact Options Import Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 5,
      })
      .returning();
    await db.insert(dbModule.userSubscriptionsTable).values({
      userId: owner.user.id,
      packageId: pkg.id,
      paymentId: "99999999-9999-4999-8999-999999999999",
      status: "active",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
    });
    const list = await api("/contact-lists", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Imported leads" },
    });
    assert.equal(list.response.status, 201, JSON.stringify(list.body));
    const configuredStatus = await api("/contact-field-options", {
      method: "POST",
      cookie: owner.cookie,
      body: { field: "leadStatus", value: "Qualified" },
    });
    assert.equal(configuredStatus.response.status, 201, JSON.stringify(configuredStatus.body));

    const result = await uploadCsv(
      `/contacts/import?listIds=${list.body.id}`,
      "name,email,lead_status,time_zone\nJamie Taylor,jamie@options.test,Unconfigured,UTC\nRae Taylor,rae@options.test,Qualified,Mars/Olympus",
      owner.cookie,
    );
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.imported, 0);
    assert.equal(result.body.rejected.length, 2);
    assert.match(result.body.rejected[0].reason, /Contact field settings/);
    assert.match(result.body.rejected[1].reason, /standard time zone/i);
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

  it("issues an iframe-compatible session cookie for secure development previews", async () => {
    const user = await createUser({
      username: "secure-preview-cookie",
      email: "secure-preview-cookie@example.test",
    });
    const loginResult = await api("/auth/login", {
      method: "POST",
      body: {
        identifier: user.email,
        password: "Initial-user-password-2026!",
      },
      headers: { "x-forwarded-proto": "https" },
    });

    assert.equal(loginResult.response.status, 200);
    const setCookie = loginResult.response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /SameSite=None/i);
    assert.match(setCookie, /Secure/i);

    const current = await api("/auth/me", { cookie: loginResult.cookie });
    assert.equal(current.response.status, 200);
  });

  it("sends password resets through the test transport, rotates the password, and revokes sessions", async () => {
    const { user, cookie } = await loggedInUser();
    const resetRequest = await api("/auth/forgot-password", {
      method: "POST",
      body: { email: user.email },
      headers: {
        "x-forwarded-host": "mailflow.example.test",
        "x-forwarded-proto": "https",
      },
    });
    assert.equal(resetRequest.response.status, 200);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, user.email);
    assert.match(emails[0].subject, /reset/i);
    const link = emails[0].text.match(/https?:\/\/\S+/)?.[0];
    assert.ok(link, "reset email should contain a reset URL");
    assert.equal(new URL(link).origin, "https://mailflow.example.test");
    const resetToken = new URL(link).searchParams.get("token");
    assert.ok(resetToken);

    const unknownAccount = await api("/auth/forgot-password", {
      method: "POST",
      body: { email: "missing-account@mailflow.test" },
    });
    assert.equal(unknownAccount.response.status, 200);
    assert.deepEqual(unknownAccount.body, resetRequest.body);
    assert.equal(emails.length, 1);

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

  it("limits password reset requests by email and returns the same limit before account lookup", async () => {
    const { user } = await loggedInUser();
    for (let request = 0; request < 3; request += 1) {
      const allowed = await api("/auth/forgot-password", {
        method: "POST",
        body: { email: user.email },
      });
      assert.equal(allowed.response.status, 200);
    }

    const limited = await api("/auth/forgot-password", {
      method: "POST",
      body: { email: user.email },
    });
    assert.equal(limited.response.status, 429);
    assert.equal(limited.response.headers.get("retry-after"), "900");
    assert.equal(limited.body.code, "PASSWORD_RESET_RATE_LIMITED");
    assert.equal(emails.length, 3);
  });

  it("reports when the platform application email is not configured", async () => {
    await db.delete(dbModule.applicationEmailConfigurationTable);
    const response = await api("/auth/forgot-password", {
      method: "POST",
      body: { email: "unknown@mailflow.test" },
    });
    assert.equal(response.response.status, 503);
    assert.equal(response.body.code, "PASSWORD_RESET_EMAIL_UNAVAILABLE");
    assert.equal(emails.length, 0);
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

describe("superadmin Google OAuth setup", { concurrency: false }, () => {
  it("restricts setup to superadmins, encrypts credentials, and keeps mailbox connection disabled until verification", async () => {
    const admin = await loggedInUser({
      username: "google-oauth-superadmin",
      role: "SUPERADMIN",
    });
    const user = await loggedInUser({ username: "google-oauth-regular-user" });
    const settingsPath = "/admin/settings/google-oauth";

    const deniedRead = await api(settingsPath, { cookie: user.cookie });
    assert.equal(deniedRead.response.status, 403);
    const initial = await api(settingsPath, { cookie: admin.cookie });
    assert.equal(initial.response.status, 200);
    assert.equal(initial.body.configured, false);
    assert.equal(initial.body.clientSecretConfigured, false);

    const rejectedCallback = await api(settingsPath, {
      method: "PUT",
      cookie: admin.cookie,
      body: {
        clientId: "mailflow-test-client",
        clientSecret: "mailflow-test-secret",
        redirectUri: "https://example.test/not-the-google-callback",
      },
    });
    assert.equal(rejectedCallback.response.status, 400);

    const input = {
      clientId: "mailflow-test-client",
      clientSecret: "mailflow-test-secret",
      redirectUri: "http://localhost/api/sending/gmail/oauth/callback",
    };
    const saved = await api(settingsPath, {
      method: "PUT",
      cookie: admin.cookie,
      body: input,
    });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.configured, true);
    assert.equal(saved.body.verified, false);
    assert.equal(saved.body.clientSecretConfigured, true);
    assert.equal(Object.hasOwn(saved.body, "clientSecret"), false);
    assert.equal(JSON.stringify(saved.body).includes(input.clientSecret), false);

    const [stored] = await db
      .select()
      .from(dbModule.systemConfigurationTable)
      .where(eq(dbModule.systemConfigurationTable.key, "google_oauth"));
    assert.ok(stored);
    assert.notEqual(stored.value.clientSecretEncrypted, input.clientSecret);
    assert.equal(Object.hasOwn(stored.value, "clientSecret"), false);
    assert.equal(JSON.stringify(stored.value).includes(input.clientSecret), false);

    const deniedWrite = await api(settingsPath, {
      method: "PUT",
      cookie: user.cookie,
      body: input,
    });
    assert.equal(deniedWrite.response.status, 403);

    const connectionStatus = await api("/sending/gmail/connection", {
      cookie: user.cookie,
    });
    assert.equal(connectionStatus.body.configured, false);
    assert.equal(connectionStatus.body.redirectUri, null);
    assert.equal(Object.hasOwn(connectionStatus.body, "clientId"), false);

    const connect = await api("/sending/gmail/connect", {
      method: "POST",
      cookie: user.cookie,
    });
    assert.equal(connect.response.status, 503);
    assert.equal(connect.body.code, "GMAIL_OAUTH_NOT_VERIFIED");

    const updated = await api(settingsPath, {
      method: "PUT",
      cookie: admin.cookie,
      body: {
        clientId: "mailflow-updated-client",
        redirectUri: input.redirectUri,
      },
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.configured, true);
    const [updatedStored] = await db
      .select()
      .from(dbModule.systemConfigurationTable)
      .where(eq(dbModule.systemConfigurationTable.key, "google_oauth"));
    assert.equal(
      updatedStored.value.clientSecretEncrypted,
      stored.value.clientSecretEncrypted,
      "leaving the secret blank should preserve the existing encrypted secret",
    );
    assert.equal(updated.body.verified, false);
  });

  it("verifies saved credentials through Google consent without storing a mailbox or refresh token", async () => {
    const admin = await loggedInUser({
      username: "google-oauth-test-admin",
      role: "SUPERADMIN",
    });
    const user = await loggedInUser({ username: "google-oauth-test-user" });
    const settingsPath = "/admin/settings/google-oauth";
    const config = {
      clientId: "mailflow-test-client",
      clientSecret: "mailflow-test-secret",
      redirectUri: "http://localhost/api/sending/gmail/oauth/callback",
    };
    const saved = await api(settingsPath, {
      method: "PUT",
      cookie: admin.cookie,
      body: config,
    });
    assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.configured, true);
    assert.equal(saved.body.verified, false);

    const deniedTest = await api(`${settingsPath}/test`, {
      method: "POST",
      cookie: user.cookie,
    });
    assert.equal(deniedTest.response.status, 403);
    const beforeTestConnect = await api("/sending/gmail/connect", {
      method: "POST",
      cookie: user.cookie,
    });
    assert.equal(beforeTestConnect.response.status, 503);
    assert.equal(beforeTestConnect.body.code, "GMAIL_OAUTH_NOT_VERIFIED");

    const accessToken = "google-oauth-setup-test-access-token";
    const requests = [];
    await withGoogleFetch(async (url, init) => {
      requests.push({ url, init });
      if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
        const fields = new URLSearchParams(init?.body);
        assert.equal(fields.get("client_id"), config.clientId);
        assert.equal(fields.get("client_secret"), config.clientSecret);
        assert.equal(fields.get("redirect_uri"), config.redirectUri);
        if (fields.get("code") === "google-oauth-invalid-code") {
          return googleJson({ error: "invalid_client" }, 401);
        }
        assert.equal(fields.get("code"), "google-oauth-setup-code");
        return googleJson({ access_token: accessToken, token_type: "Bearer" });
      }
      if (url.hostname === "openidconnect.googleapis.com") {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer ${accessToken}`,
        );
        return googleJson({
          email: admin.user.email,
          email_verified: true,
        });
      }
      if (
        url.hostname === "gmail.googleapis.com" &&
        url.pathname.endsWith("/users/me/profile")
      ) {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer ${accessToken}`,
        );
        return googleJson({
          emailAddress: admin.user.email,
          historyId: "google-oauth-setup-history",
        });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    }, async () => {
      const completeConsent = async (code) => {
        const start = await api(`${settingsPath}/test`, {
          method: "POST",
          cookie: admin.cookie,
        });
        assert.equal(start.response.status, 200, JSON.stringify(start.body));
        assert.ok(start.cookie);
        const authorizationUrl = new URL(start.body.authorizationUrl);
        assert.equal(
          authorizationUrl.searchParams.get("client_id"),
          config.clientId,
        );
        assert.equal(
          authorizationUrl.searchParams.get("redirect_uri"),
          config.redirectUri,
        );
        assert.equal(authorizationUrl.searchParams.get("access_type"), "online");
        assert.match(authorizationUrl.searchParams.get("prompt"), /consent/);
        assert.match(
          authorizationUrl.searchParams.get("prompt"),
          /select_account/,
        );
        assert.match(
          authorizationUrl.searchParams.get("scope"),
          /gmail\.readonly/,
        );
        const state = authorizationUrl.searchParams.get("state");
        const callback = await api(
          `/sending/gmail/oauth/callback?${new URLSearchParams({
            code,
            state,
          })}`,
          {
            cookie: `${admin.cookie}; ${start.cookie}`,
            redirect: "manual",
          },
        );
        assert.equal(callback.response.status, 303);
        const returnUrl = new URL(callback.response.headers.get("location"));
        assert.ok(returnUrl.pathname.endsWith("/admin/google-oauth"));
        return returnUrl.searchParams.get("googleOauthTest");
      };

      assert.equal(
        await completeConsent("google-oauth-invalid-code"),
        "failed",
        "Google rejecting the client credentials must not verify setup",
      );
      const stillUnverified = await api(settingsPath, { cookie: admin.cookie });
      assert.equal(stillUnverified.body.verified, false);
      assert.equal(
        await completeConsent("google-oauth-setup-code"),
        "verified",
      );
    });

    const verified = await api(settingsPath, { cookie: admin.cookie });
    assert.equal(verified.body.configured, true);
    assert.equal(verified.body.verified, true);
    assert.ok(verified.body.verifiedAt);
    const connectionStatus = await api("/sending/gmail/connection", {
      cookie: user.cookie,
    });
    assert.equal(connectionStatus.body.configured, true);
    const connect = await api("/sending/gmail/connect", {
      method: "POST",
      cookie: user.cookie,
    });
    assert.equal(connect.response.status, 200);
    assert.equal(
      new URL(connect.body.authorizationUrl).searchParams.get("access_type"),
      "offline",
    );
    assert.equal(
      await db
        .select()
        .from(dbModule.gmailMailboxConnectionsTable)
        .then((rows) => rows.length),
      0,
      "the credential test must not create a mailbox connection",
    );
    assert.equal(
      JSON.stringify(
        await db
          .select()
          .from(dbModule.systemConfigurationTable)
          .where(eq(dbModule.systemConfigurationTable.key, "google_oauth")),
      ).includes(accessToken),
      false,
      "the transient access token must not be stored",
    );
    assert.equal(
      requests.some(
        ({ url }) =>
          url.hostname === "oauth2.googleapis.com" &&
          url.pathname === "/revoke",
      ),
      false,
      "online access should not leave a refresh token to revoke",
    );

    const changedClientId = await api(settingsPath, {
      method: "PUT",
      cookie: admin.cookie,
      body: {
        clientId: "mailflow-replaced-client",
        redirectUri: config.redirectUri,
      },
    });
    assert.equal(changedClientId.response.status, 200);
    assert.equal(changedClientId.body.verified, false);
    const changedClientStatus = await api("/sending/gmail/connection", {
      cookie: user.cookie,
    });
    assert.equal(changedClientStatus.body.configured, false);
    const changedClientConfig =
      await googleOAuthConfigurationModule.getGoogleOAuthConfiguration();
    assert.ok(changedClientConfig);
    assert.equal(
      await googleOAuthConfigurationModule.markGoogleOAuthConfigurationVerified(
        googleOAuthConfigurationModule.googleOAuthConfigurationFingerprint(
          changedClientConfig,
        ),
      ),
      true,
    );
    const reverified = await api(settingsPath, { cookie: admin.cookie });
    assert.equal(reverified.body.verified, true);
    const changedSecret = await api(settingsPath, {
      method: "PUT",
      cookie: admin.cookie,
      body: {
        clientId: "mailflow-replaced-client",
        clientSecret: "mailflow-replaced-secret",
        redirectUri: config.redirectUri,
      },
    });
    assert.equal(changedSecret.response.status, 200);
    assert.equal(changedSecret.body.verified, false);
    const changedSecretStatus = await api("/sending/gmail/connection", {
      cookie: user.cookie,
    });
    assert.equal(changedSecretStatus.body.configured, false);
  });
});

describe("Gmail OAuth consent and token lifecycle", { concurrency: false }, () => {
  it("atomically rejects a callback replay sent to an independent app instance", async () => {
    await withGmailOAuthConfig(async () => {
      const owner = await loggedInUser({ username: "gmail-replica-owner" });
      const tokenCodes = [];
      const expiredNonce = "expired-gmail-oauth-nonce";
      await db.insert(dbModule.gmailOAuthStatesTable).values({
        nonce: expiredNonce,
        expiresAt: new Date(Date.now() - 60_000),
        consumedAt: new Date(Date.now() - 120_000),
      });

      const startReplica = async () => {
        const replicaApp = express();
        replicaApp.use(cookieParser());
        replicaApp.use((req, _res, next) => {
          req.authUser = owner.user;
          next();
        });
        replicaApp.use(gmailMailboxModule.createGmailMailboxRouter());
        const replicaServer = replicaApp.listen(0);
        await once(replicaServer, "listening");
        return {
          baseUrl: `http://127.0.0.1:${replicaServer.address().port}`,
          close: () =>
            new Promise((resolve, reject) => {
              replicaServer.close((error) =>
                error ? reject(error) : resolve(),
              );
            }),
        };
      };

      const replicas = await Promise.all([startReplica(), startReplica()]);
      try {
        await withGoogleFetch(async (url, init) => {
          if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
            const fields = new URLSearchParams(init?.body);
            tokenCodes.push(fields.get("code"));
            return googleJson({
              access_token: "replica-test-access-token",
              refresh_token: "replica-test-refresh-token",
            });
          }
          if (url.hostname === "openidconnect.googleapis.com") {
            return googleJson({
              email: owner.user.email,
              email_verified: true,
            });
          }
          if (
            url.hostname === "gmail.googleapis.com" &&
            url.pathname.endsWith("/users/me/profile")
          ) {
            return googleJson({
              emailAddress: owner.user.email,
              historyId: "replica-test-history",
            });
          }
          throw new Error(`Unexpected Google request: ${url}`);
        }, async () => {
          const connectResponse = await fetch(
            `${replicas[0].baseUrl}/sending/gmail/connect`,
            { method: "POST" },
          );
          assert.equal(connectResponse.status, 200);
          const { authorizationUrl } = await connectResponse.json();
          const state = new URL(authorizationUrl).searchParams.get("state");
          const setCookie = connectResponse.headers.getSetCookie()[0];
          const oauthCookie = setCookie.split(";", 1)[0];
          const nonce = oauthCookie.slice(oauthCookie.indexOf("=") + 1);

          const callback = (replica, code) => {
            const query = new URLSearchParams({ code, state });
            return fetch(
              `${replica.baseUrl}/sending/gmail/oauth/callback?${query}`,
              {
                headers: { cookie: oauthCookie },
                redirect: "manual",
              },
            );
          };
          const [first, second] = await Promise.all([
            callback(replicas[0], "replica-code-one"),
            callback(replicas[1], "replica-code-two"),
          ]);
          const results = [first, second].map((response) =>
            new URL(response.headers.get("location")).searchParams.get("gmail"),
          );
          assert.deepEqual(results.sort(), ["connected", "failed"]);
          assert.equal(tokenCodes.length, 1);
          assert.ok(
            ["replica-code-one", "replica-code-two"].includes(tokenCodes[0]),
          );

          const replay = await callback(replicas[1], "replay-authorization-code");
          assert.equal(
            new URL(replay.headers.get("location")).searchParams.get("gmail"),
            "failed",
          );
          assert.equal(
            tokenCodes.length,
            1,
            "a replay on another app instance must not exchange a second authorization code",
          );

          const consumedStates = await db
            .select()
            .from(dbModule.gmailOAuthStatesTable);
          assert.equal(consumedStates.length, 1);
          assert.equal(consumedStates[0].nonce, nonce);
          assert.ok(consumedStates[0].consumedAt);
          assert.ok(
            !consumedStates.some((entry) => entry.nonce === expiredNonce),
            "expired consumed-state records should be cleaned during consumption",
          );
        });
      } finally {
        await Promise.all(replicas.map((replica) => replica.close()));
      }
    });
  });

  it("exchanges consent, protects the saved token, rejects replay, and revokes on disconnect", async () => {
    await withGmailOAuthConfig(async () => {
      const owner = await loggedInUser({ username: "gmail-oauth-owner" });
      const accessToken = "mock-google-access-token";
      const refreshToken = "mock-google-refresh-token";
      const googleRequests = [];

      await withGoogleFetch(async (url, init) => {
        googleRequests.push({ url, init });
        if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
          const fields = new URLSearchParams(init?.body);
          assert.equal(fields.get("grant_type"), "authorization_code");
          assert.equal(fields.get("code"), "gmail-auth-code");
          assert.equal(fields.get("client_id"), "mailflow-test-client");
          assert.equal(fields.get("client_secret"), "mailflow-test-secret");
          assert.equal(
            fields.get("redirect_uri"),
            "http://localhost/api/sending/gmail/oauth/callback",
          );
          return googleJson({
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: "Bearer",
          });
        }
        if (url.hostname === "openidconnect.googleapis.com") {
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            `Bearer ${accessToken}`,
          );
          return googleJson({
            email: owner.user.email.toUpperCase(),
            email_verified: true,
          });
        }
        if (
          url.hostname === "gmail.googleapis.com" &&
          url.pathname.endsWith("/users/me/profile")
        ) {
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            `Bearer ${accessToken}`,
          );
          return googleJson({
            emailAddress: owner.user.email,
            historyId: "gmail-history-baseline",
          });
        }
        if (
          url.hostname === "oauth2.googleapis.com" &&
          url.pathname === "/revoke"
        ) {
          assert.equal(init?.method, "POST");
          assert.equal(url.searchParams.get("token"), refreshToken);
          return new Response(null, { status: 200 });
        }
        throw new Error(`Unexpected Google request: ${url}`);
      }, async () => {
        const flow = await startGmailOAuth(owner.cookie);
        const authorizationUrl = new URL(flow.authorizationUrl);
        assert.equal(
          authorizationUrl.searchParams.get("access_type"),
          "offline",
        );
        assert.equal(authorizationUrl.searchParams.get("prompt"), "consent");
        assert.match(authorizationUrl.searchParams.get("scope"), /openid/);
        assert.match(authorizationUrl.searchParams.get("scope"), /email/);
        assert.match(authorizationUrl.searchParams.get("scope"), /gmail\.readonly/);

        const callback = await finishGmailOAuth(owner.cookie, flow);
        assert.equal(
          callback.response.status,
          303,
          JSON.stringify(callback.body),
        );
        assert.equal(
          new URL(callback.response.headers.get("location")).searchParams.get(
            "gmail",
          ),
          "connected",
        );
        assert.match(
          callback.response.headers.get("set-cookie") ?? "",
          /mailflow_gmail_oauth_state=;/,
        );
        assert.equal(
          googleRequests.filter(
            ({ url }) =>
              url.hostname === "oauth2.googleapis.com" &&
              url.pathname === "/token",
          ).length,
          1,
        );

        const [saved] = await db
          .select()
          .from(dbModule.gmailMailboxConnectionsTable)
          .where(eq(dbModule.gmailMailboxConnectionsTable.userId, owner.user.id));
        assert.equal(saved.emailAddress, owner.user.email);
        assert.match(saved.refreshTokenEncrypted, /^v1\./);
        assert.notEqual(saved.refreshTokenEncrypted, refreshToken);
        assert.equal(
          securityModule.decryptSecret(saved.refreshTokenEncrypted),
          refreshToken,
        );

        const status = await api("/sending/gmail/connection", {
          cookie: owner.cookie,
        });
        assert.equal(status.response.status, 200);
        assert.equal(status.body.connected, true);
        const statusJson = JSON.stringify(status.body);
        assert.equal(statusJson.includes(refreshToken), false);
        assert.equal(statusJson.toLowerCase().includes("refreshtoken"), false);

        const replay = await finishGmailOAuth(owner.cookie, flow);
        assert.equal(replay.response.status, 303);
        assert.equal(
          new URL(replay.response.headers.get("location")).searchParams.get(
            "gmail",
          ),
          "failed",
        );
        assert.equal(
          googleRequests.filter(
            ({ url }) =>
              url.hostname === "oauth2.googleapis.com" &&
              url.pathname === "/token",
          ).length,
          1,
          "a consumed OAuth state must not exchange a second authorization code",
        );
        const [stillSaved] = await db
          .select()
          .from(dbModule.gmailMailboxConnectionsTable)
          .where(eq(dbModule.gmailMailboxConnectionsTable.userId, owner.user.id));
        assert.equal(stillSaved.id, saved.id);

        const disconnected = await api("/sending/gmail/connection", {
          method: "DELETE",
          cookie: owner.cookie,
        });
        assert.equal(disconnected.response.status, 204);
        assert.equal(
          await db
            .select()
            .from(dbModule.gmailMailboxConnectionsTable)
            .where(eq(dbModule.gmailMailboxConnectionsTable.userId, owner.user.id))
            .then((rows) => rows.length),
          0,
        );
        assert.equal(
          googleRequests.filter(
            ({ url }) =>
              url.hostname === "oauth2.googleapis.com" &&
              url.pathname === "/revoke",
          ).length,
          1,
        );
      });
    });
  });

  it("keeps a saved mailbox and grant untouched when replacement identity verification fails", async () => {
    await withGmailOAuthConfig(async () => {
      const owner = await loggedInUser({ username: "gmail-replacement-owner" });
      const savedRefreshToken = "saved-google-refresh-token";
      const replacementAccessToken = "replacement-google-access-token";
      const replacementRefreshToken = "replacement-google-refresh-token";
      await db.insert(dbModule.gmailMailboxConnectionsTable).values({
        userId: owner.user.id,
        emailAddress: "saved-mailbox@example.test",
        refreshTokenEncrypted: securityModule.encryptSecret(savedRefreshToken),
        historyId: "saved-mailbox-history",
      });
      const [before] = await db
        .select()
        .from(dbModule.gmailMailboxConnectionsTable)
        .where(eq(dbModule.gmailMailboxConnectionsTable.userId, owner.user.id));
      const googleRequests = [];

      await withGoogleFetch(async (url, init) => {
        googleRequests.push({ url, init });
        if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
          return googleJson({
            access_token: replacementAccessToken,
            refresh_token: replacementRefreshToken,
          });
        }
        if (url.hostname === "openidconnect.googleapis.com") {
          return googleJson({
            email: "replacement-mailbox@example.test",
            email_verified: false,
          });
        }
        throw new Error(`Unexpected Google request: ${url}`);
      }, async () => {
        const flow = await startGmailOAuth(owner.cookie);
        const callback = await finishGmailOAuth(owner.cookie, flow);
        assert.equal(callback.response.status, 303);
        assert.equal(
          new URL(callback.response.headers.get("location")).searchParams.get("gmail"),
          "failed",
        );
        assert.equal(
          googleRequests.filter(
            ({ url }) =>
              url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke",
          ).length,
          0,
          "rejecting an unverified replacement must not revoke a Google grant",
        );

        const [after] = await db
          .select()
          .from(dbModule.gmailMailboxConnectionsTable)
          .where(eq(dbModule.gmailMailboxConnectionsTable.userId, owner.user.id));
        assert.equal(after.id, before.id);
        assert.equal(after.emailAddress, before.emailAddress);
        assert.equal(after.refreshTokenEncrypted, before.refreshTokenEncrypted);
        assert.equal(after.historyId, before.historyId);

        const callbackContent = JSON.stringify({
          location: callback.response.headers.get("location"),
          body: callback.body,
        });
        for (const token of [
          savedRefreshToken,
          replacementRefreshToken,
          replacementAccessToken,
        ]) {
          assert.equal(callbackContent.includes(token), false);
        }
      });
    });
  });

  it("rejects invalid OAuth state and identity failures while revoking unverified grants", async () => {
    await withGmailOAuthConfig(async () => {
      const owner = await loggedInUser({ username: "gmail-state-owner" });
      const other = await loggedInUser({ username: "gmail-state-other" });
      const externalRequests = [];
      let identityMode = "unverified";
      const accessToken = "identity-check-access-token";
      const refreshToken = "identity-check-refresh-token";

      await withGoogleFetch(async (url, init) => {
        externalRequests.push({ url, init });
        if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
          return googleJson({
            access_token: accessToken,
            ...(identityMode === "profile-error"
              ? {}
              : { refresh_token: refreshToken }),
          });
        }
        if (url.hostname === "openidconnect.googleapis.com") {
          return googleJson({
            email: owner.user.email,
            email_verified: identityMode !== "unverified",
          });
        }
        if (
          url.hostname === "gmail.googleapis.com" &&
          url.pathname.endsWith("/users/me/profile")
        ) {
          if (identityMode === "profile-error") {
            return googleJson({ error: "profile unavailable" }, 503);
          }
          return googleJson({
            emailAddress:
              identityMode === "mailbox-mismatch"
                ? "different-mailbox@example.test"
                : owner.user.email,
            historyId: "gmail-identity-history",
          });
        }
        if (
          url.hostname === "oauth2.googleapis.com" &&
          url.pathname === "/revoke"
        ) {
          assert.equal(init?.method, "POST");
          assert.equal(
            url.searchParams.get("token"),
            identityMode === "profile-error" ? accessToken : refreshToken,
          );
          if (identityMode === "mailbox-mismatch") {
            throw new Error("simulated Google revocation outage");
          }
          return new Response(null, { status: 200 });
        }
        throw new Error(`Unexpected Google request: ${url}`);
      }, async () => {
        const mismatchedCookieFlow = await startGmailOAuth(owner.cookie);
        const badCookie = `${mismatchedCookieFlow.cookie.split("=")[0]}=wrong-nonce`;
        let callback = await finishGmailOAuth(owner.cookie, mismatchedCookieFlow, {
          oauthCookie: badCookie,
        });
        assert.equal(
          callback.response.status,
          303,
          JSON.stringify(callback.body),
        );
        assert.equal(
          new URL(callback.response.headers.get("location")).searchParams.get(
            "gmail",
          ),
          "failed",
        );
        assert.equal(externalRequests.length, 0);

        const expiredFlow = await startGmailOAuth(owner.cookie);
        const expiredPayload = Buffer.from(
          JSON.stringify({
            userId: owner.user.id,
            nonce: expiredFlow.nonce,
            expiresAt: Date.now() - 1,
          }),
        ).toString("base64url");
        const expiredState = `${expiredPayload}.${securityModule.hmac(
          expiredPayload,
          "gmail-mailbox-oauth-state",
        )}`;
        callback = await finishGmailOAuth(owner.cookie, expiredFlow, {
          state: expiredState,
        });
        assert.equal(
          new URL(callback.response.headers.get("location")).searchParams.get(
            "gmail",
          ),
          "failed",
        );
        assert.equal(externalRequests.length, 0);

        const wrongUserFlow = await startGmailOAuth(owner.cookie);
        callback = await finishGmailOAuth(other.cookie, wrongUserFlow);
        assert.equal(
          new URL(callback.response.headers.get("location")).searchParams.get(
            "gmail",
          ),
          "failed",
        );
        assert.equal(externalRequests.length, 0);

        const unverifiedFlow = await startGmailOAuth(owner.cookie);
        identityMode = "unverified";
        const unverifiedRequestStart = externalRequests.length;
        callback = await finishGmailOAuth(owner.cookie, unverifiedFlow);
        assert.equal(
          new URL(callback.response.headers.get("location")).searchParams.get(
            "gmail",
          ),
          "failed",
        );
        assert.equal(
          externalRequests.some(
            ({ url }, index) =>
              index >= unverifiedRequestStart &&
              url.hostname === "gmail.googleapis.com" &&
              url.pathname.endsWith("/users/me/profile"),
          ),
          false,
          "an unverified account must be rejected before mailbox metadata is trusted",
        );
        assert.equal(
          externalRequests.filter(
            ({ url }, index) =>
              index >= unverifiedRequestStart &&
              url.hostname === "oauth2.googleapis.com" &&
              url.pathname === "/revoke",
          ).length,
          1,
          "an unverified grant must be revoked",
        );
        assert.equal(
          JSON.stringify({
            location: callback.response.headers.get("location"),
            body: callback.body,
          }).includes(refreshToken),
          false,
          "the callback must not expose the refresh token",
        );
        assert.equal(
          JSON.stringify({
            location: callback.response.headers.get("location"),
            body: callback.body,
          }).includes(accessToken),
          false,
          "the callback must not expose the access token",
        );

        const mismatchedMailboxFlow = await startGmailOAuth(owner.cookie);
        identityMode = "mailbox-mismatch";
        const mismatchRequestStart = externalRequests.length;
        callback = await finishGmailOAuth(owner.cookie, mismatchedMailboxFlow);
        assert.equal(
          new URL(callback.response.headers.get("location")).searchParams.get(
            "gmail",
          ),
          "failed",
        );
        assert.equal(
          externalRequests.filter(
            ({ url }, index) =>
              index >= mismatchRequestStart &&
              url.hostname === "oauth2.googleapis.com" &&
              url.pathname === "/revoke",
          ).length,
          1,
          "a mailbox mismatch must attempt revocation even if Google is unavailable",
        );
        assert.equal(
          JSON.stringify({
            location: callback.response.headers.get("location"),
            body: callback.body,
          }).includes(refreshToken),
          false,
          "the callback must not expose the refresh token",
        );
        assert.equal(
          JSON.stringify({
            location: callback.response.headers.get("location"),
            body: callback.body,
          }).includes(accessToken),
          false,
          "the callback must not expose the access token",
        );

        const profileErrorFlow = await startGmailOAuth(owner.cookie);
        identityMode = "profile-error";
        const profileErrorRequestStart = externalRequests.length;
        callback = await finishGmailOAuth(owner.cookie, profileErrorFlow);
        assert.equal(
          new URL(callback.response.headers.get("location")).searchParams.get(
            "gmail",
          ),
          "failed",
        );
        assert.equal(
          externalRequests.filter(
            ({ url }, index) =>
              index >= profileErrorRequestStart &&
              url.hostname === "oauth2.googleapis.com" &&
              url.pathname === "/revoke",
          ).length,
          1,
          "a Gmail profile error must attempt revocation",
        );
        assert.equal(
          JSON.stringify({
            location: callback.response.headers.get("location"),
            body: callback.body,
          }).includes(refreshToken),
          false,
          "the callback must not expose the refresh token",
        );
        assert.equal(
          JSON.stringify({
            location: callback.response.headers.get("location"),
            body: callback.body,
          }).includes(accessToken),
          false,
          "the callback must not expose the access token",
        );
        assert.equal(
          await db
            .select()
            .from(dbModule.gmailMailboxConnectionsTable)
            .then((rows) => rows.length),
          0,
        );
      });
    });
  });

  it("warns safely when grant revocation fails without changing the failed callback result", async () => {
    await withGmailOAuthConfig(async () => {
      const owner = await loggedInUser({ username: "gmail-revocation-warning-owner" });
      const originalWarn = loggerModule.logger.warn;
      const warnings = [];
      loggerModule.logger.warn = (...args) => warnings.push(args);

      try {
        for (const failureType of ["network", "http"]) {
          const accessToken = `revocation-warning-access-${failureType}`;
          const refreshToken = `revocation-warning-refresh-${failureType}`;
          await withGoogleFetch(async (url) => {
            if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
              return googleJson({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
            }
            if (url.hostname === "openidconnect.googleapis.com") {
              return googleJson({
                email: owner.user.email,
                email_verified: false,
              });
            }
            if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") {
              assert.equal(url.searchParams.get("token"), refreshToken);
              if (failureType === "network") {
                throw new Error(`revocation request failed: ${url.toString()}`);
              }
              return new Response(null, { status: 503 });
            }
            throw new Error(`Unexpected Google request: ${url}`);
          }, async () => {
            const flow = await startGmailOAuth(owner.cookie);
            const callback = await finishGmailOAuth(owner.cookie, flow);
            assert.equal(callback.response.status, 303);
            assert.equal(
              new URL(callback.response.headers.get("location")).searchParams.get("gmail"),
              "failed",
            );
          });
        }
      } finally {
        loggerModule.logger.warn = originalWarn;
      }

      const revocationWarnings = warnings.filter(
        ([, message]) => message === "Google grant revocation failed",
      );
      assert.equal(revocationWarnings.length, 2);
      assert.deepEqual(
        revocationWarnings.map(([fields]) => fields),
        [
          { failureType: "network" },
          { failureType: "http", statusCode: 503 },
        ],
      );
      const serializedWarnings = JSON.stringify(warnings);
      for (const token of [
        "revocation-warning-access-network",
        "revocation-warning-refresh-network",
        "revocation-warning-access-http",
        "revocation-warning-refresh-http",
      ]) {
        assert.equal(serializedWarnings.includes(token), false);
      }
      assert.equal(
        serializedWarnings.includes("https://oauth2.googleapis.com/revoke?token="),
        false,
      );
    });
  });

  it("requires reconnection after refresh failure without advancing the Gmail checkpoint", async () => {
    await withGmailOAuthConfig(async () => {
      const owner = await loggedInUser({ username: "gmail-refresh-owner" });
      const refreshToken = "refresh-token-that-google-rejects";
      const originalHistoryId = "gmail-history-before-refresh-failure";
      await db.insert(dbModule.gmailMailboxConnectionsTable).values({
        userId: owner.user.id,
        emailAddress: owner.user.email,
        refreshTokenEncrypted: securityModule.encryptSecret(refreshToken),
        historyId: originalHistoryId,
        syncStatus: "connected",
        nextSyncAt: new Date(Date.now() - 60_000),
      });

      const refreshRequests = [];
      await withGoogleFetch(async (url, init) => {
        refreshRequests.push({ url, init });
        assert.equal(url.hostname, "oauth2.googleapis.com");
        assert.equal(url.pathname, "/token");
        const fields = new URLSearchParams(init?.body);
        assert.equal(fields.get("grant_type"), "refresh_token");
        assert.equal(fields.get("refresh_token"), refreshToken);
        return googleJson({ error: "invalid_grant" }, 400);
      }, async () => {
        await gmailMailboxModule.syncDueGmailMailboxes();
      });

      assert.equal(refreshRequests.length, 1);
      const [afterFailure] = await db
        .select()
        .from(dbModule.gmailMailboxConnectionsTable)
        .where(eq(dbModule.gmailMailboxConnectionsTable.userId, owner.user.id));
      assert.equal(afterFailure.syncStatus, "reauthorization_required");
      assert.equal(afterFailure.historyId, originalHistoryId);
      assert.match(afterFailure.lastError, /Reconnect the mailbox/i);
      assert.ok(afterFailure.nextSyncAt.getTime() > Date.now());

      const status = await api("/sending/gmail/connection", {
        cookie: owner.cookie,
      });
      assert.equal(status.response.status, 200);
      assert.equal(status.body.syncStatus, "reauthorization_required");
      assert.match(status.body.lastError, /Reconnect the mailbox/i);
      assert.equal(JSON.stringify(status.body).includes(refreshToken), false);
    });
  });
});

describe("tenant sending and campaign delivery", { concurrency: false }, () => {
  it("isolates tenant data, encrypts SMTP credentials, and enforces worker rate limits", async () => {
    const owner = await loggedInUser({ username: "sending-owner" });
    const other = await loggedInUser({ username: "sending-other" });
    const gmailStatus = await api("/sending/gmail/connection", {
      cookie: owner.cookie,
    });
    assert.equal(gmailStatus.response.status, 200);
    assert.equal(gmailStatus.body.connected, false);
    assert.equal(gmailStatus.body.syncStatus, "disconnected");
    assert.equal(gmailStatus.body.pollIntervalSeconds, 120);
    const microsoftStatus = await api("/sending/microsoft-365/connection", {
      cookie: owner.cookie,
    });
    assert.equal(microsoftStatus.response.status, 200);
    assert.equal(microsoftStatus.body.connected, false);
    assert.equal(microsoftStatus.body.syncStatus, "disconnected");
    assert.equal(microsoftStatus.body.permission, "ExchangeMessageTrace.Read.All");
    assert.equal(microsoftStatus.body.source, "microsoft_365_graph");
    assert.equal(microsoftStatus.body.maxHistoryDays, 90);
    assert.equal(
      (await api("/sending/microsoft-365/connection")).response.status,
      401,
    );
    assert.equal(
      (await api("/sending/microsoft-365/sync", {
        method: "POST",
        cookie: owner.cookie,
      })).response.status,
      404,
    );
    const anonymousGmailStatus = await api("/sending/gmail/connection");
    assert.equal(anonymousGmailStatus.response.status, 401);
    const gmailConnect = await api("/sending/gmail/connect", {
      method: "POST",
      cookie: owner.cookie,
    });
    if (gmailStatus.body.configured) {
      assert.equal(gmailConnect.response.status, 200);
      const authorizationUrl = new URL(gmailConnect.body.authorizationUrl);
      assert.match(
        authorizationUrl.searchParams.get("scope"),
        /gmail\.readonly/,
      );
      assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
      assert.equal(authorizationUrl.searchParams.get("prompt"), "consent");
    } else {
      assert.equal(gmailConnect.response.status, 503);
    }
    const gmailDisconnect = await api("/sending/gmail/connection", {
      method: "DELETE",
      cookie: owner.cookie,
    });
    assert.equal(gmailDisconnect.response.status, 204);
    const [sendingPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Sending Test Package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 10,
        emailAccountLimit: 2,
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
            ...(email === "one@owner.test" ? { companyName: "Acme & Sons" } : {}),
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
    assert.ok(
      isolatedContacts.body.contacts.every((contact) =>
        contact.listIds.includes(ownerList.body.id) &&
        !contact.listIds.includes(otherList.body.id),
      ),
    );
    const ownerVisibleLists = await api("/contact-lists", { cookie: owner.cookie });
    assert.deepEqual(
      ownerVisibleLists.body.map((list) => list.name),
      ["Owner audience"],
    );
    const otherContacts = await api("/contacts", { cookie: other.cookie });
    assert.deepEqual(otherContacts.body.contacts[0].listIds, [otherList.body.id]);
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

    const verifiedConnections = [];
    emailModule.setTenantEmailVerifierForTests(async (configuration) => {
      verifiedConnections.push(configuration);
    });
    const deliveriesBeforeConnectionCheck = tenantDeliveries.length;
    const connectionCheck = await api("/sending/settings/connection-test", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        settings: {
          provider: "other",
          host: "smtp.draft.owner.test",
          port: 2526,
          encryption: "tls",
          fromName: "Draft Owner Mail",
          fromEmail: "draft@owner.test",
        },
      },
    });
    assert.equal(connectionCheck.response.status, 200, JSON.stringify(connectionCheck.body));
    assert.match(connectionCheck.body.message, /No email was sent/i);
    assert.equal(tenantDeliveries.length, deliveriesBeforeConnectionCheck);
    assert.equal(verifiedConnections.length, 1);
    assert.equal(verifiedConnections[0].host, "smtp.draft.owner.test");
    assert.equal(verifiedConnections[0].port, 2526);
    assert.equal(
      securityModule.decryptSecret(verifiedConnections[0].usernameEncrypted),
      "smtp-owner-user",
    );
    const unsavedConnectionCheck = await api("/sending/settings/connection-test", {
      method: "POST",
      cookie: other.cookie,
      body: {
        settings: {
          provider: "other",
          host: "smtp.new-owner.test",
          port: 587,
          encryption: "tls",
          username: "new-owner-user",
          password: "new-owner-secret",
          fromName: "New Owner",
          fromEmail: "new-owner@owner.test",
        },
      },
    });
    assert.equal(
      unsavedConnectionCheck.response.status,
      200,
      JSON.stringify(unsavedConnectionCheck.body),
    );
    assert.equal(verifiedConnections.length, 2);
    assert.equal(verifiedConnections[1].userId, other.user.id);
    assert.equal(verifiedConnections[1].host, "smtp.new-owner.test");
    assert.equal(
      securityModule.decryptSecret(verifiedConnections[1].usernameEncrypted),
      "new-owner-user",
    );
    const [otherSavedSenderAfterConnectionCheck] = await db
      .select()
      .from(dbModule.tenantSendingConfigurationTable)
      .where(eq(dbModule.tenantSendingConfigurationTable.userId, other.user.id));
    assert.equal(otherSavedSenderAfterConnectionCheck, undefined);
    const [senderAfterConnectionCheck] = await db
      .select()
      .from(dbModule.tenantSendingConfigurationTable)
      .where(eq(dbModule.tenantSendingConfigurationTable.userId, owner.user.id));
    assert.equal(senderAfterConnectionCheck.host, "smtp.owner.test");
    assert.equal(senderAfterConnectionCheck.verifiedAt, null);
    assert.equal(senderAfterConnectionCheck.connectionCheckStatus, null);
    assert.equal(senderAfterConnectionCheck.connectionCheckAt, null);

    const savedConnectionSettings = {
      provider: "other",
      host: "smtp.owner.test",
      port: 2525,
      encryption: "none",
      fromName: "Owner Mail",
      fromEmail: "mail@owner.test",
    };
    emailModule.setTenantEmailVerifierForTests(async () => {
      throw new Error("SMTP authentication rejected");
    });
    const failedSavedConnectionCheck = await api(
      "/sending/settings/connection-test",
      {
        method: "POST",
        cookie: owner.cookie,
        body: { settings: savedConnectionSettings },
      },
    );
    assert.equal(
      failedSavedConnectionCheck.response.status,
      502,
      JSON.stringify(failedSavedConnectionCheck.body),
    );
    assert.equal(failedSavedConnectionCheck.body.savedSettingsUpdated, true);
    const [senderAfterFailedConnectionCheck] = await db
      .select()
      .from(dbModule.tenantSendingConfigurationTable)
      .where(eq(dbModule.tenantSendingConfigurationTable.userId, owner.user.id));
    assert.equal(
      senderAfterFailedConnectionCheck.connectionCheckStatus,
      "failure",
    );
    assert.ok(senderAfterFailedConnectionCheck.connectionCheckAt);
    const failedConnectionCheckAt = new Date(
      senderAfterFailedConnectionCheck.connectionCheckAt,
    ).getTime();
    assert.equal(
      new Date(senderAfterFailedConnectionCheck.connectionCheckAt).toISOString(),
      failedSavedConnectionCheck.body.checkedAt,
    );
    assert.equal(senderAfterFailedConnectionCheck.verifiedAt, null);

    emailModule.setTenantEmailVerifierForTests(async () => {});
    const successfulSavedConnectionCheck = await api(
      "/sending/settings/connection-test",
      {
        method: "POST",
        cookie: owner.cookie,
        body: { settings: savedConnectionSettings },
      },
    );
    assert.equal(
      successfulSavedConnectionCheck.response.status,
      200,
      JSON.stringify(successfulSavedConnectionCheck.body),
    );
    assert.equal(
      successfulSavedConnectionCheck.body.savedSettingsUpdated,
      true,
    );
    const [senderAfterSuccessfulConnectionCheck] = await db
      .select()
      .from(dbModule.tenantSendingConfigurationTable)
      .where(eq(dbModule.tenantSendingConfigurationTable.userId, owner.user.id));
    assert.equal(
      senderAfterSuccessfulConnectionCheck.connectionCheckStatus,
      "success",
    );
    assert.equal(
      new Date(senderAfterSuccessfulConnectionCheck.connectionCheckAt).toISOString(),
      successfulSavedConnectionCheck.body.checkedAt,
    );
    assert.ok(
      new Date(senderAfterSuccessfulConnectionCheck.connectionCheckAt).getTime() >=
        failedConnectionCheckAt,
    );
    assert.equal(senderAfterSuccessfulConnectionCheck.verifiedAt, null);
    assert.equal(tenantDeliveries.length, deliveriesBeforeConnectionCheck);

    const testedEmailConfigurations = [];
    emailModule.setTenantEmailTransportForTests(async (message, configuration) => {
      tenantDeliveries.push(message);
      testedEmailConfigurations.push(configuration);
      if (message.subject === "Mailflow sender identity test") {
        return { accepted: true };
      }
      if (message.to === "one@owner.test") {
        return {
          accepted: true,
          smtpResponse: "250 2.0.0 SMTP accepted",
          smtpCode: 250,
          enhancedStatus: "2.0.0",
        };
      }
      return {
        accepted: false,
        error: "Recipient rejected by test transport.",
        smtpResponse: "550 5.1.1 recipient unavailable",
        smtpCode: 550,
        enhancedStatus: "5.1.1",
      };
    });
    const unsavedEmailTest = await api("/sending/settings/test", {
      method: "POST",
      cookie: other.cookie,
      body: {
        toEmail: "new-owner@owner.test",
        settings: {
          provider: "other",
          host: "smtp.new-owner.test",
          port: 587,
          encryption: "tls",
          username: "new-owner-user",
          password: "new-owner-secret",
          fromName: "New Owner",
          fromEmail: "new-owner@owner.test",
        },
      },
    });
    assert.equal(
      unsavedEmailTest.response.status,
      200,
      JSON.stringify(unsavedEmailTest.body),
    );
    assert.equal(unsavedEmailTest.body.verifiedAt, null);
    assert.equal(testedEmailConfigurations.at(-1).host, "smtp.new-owner.test");
    const [otherSavedSenderAfterEmailTest] = await db
      .select()
      .from(dbModule.tenantSendingConfigurationTable)
      .where(eq(dbModule.tenantSendingConfigurationTable.userId, other.user.id));
    assert.equal(otherSavedSenderAfterEmailTest, undefined);
    const testedSender = await api("/sending/settings/test", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        toEmail: "draft@owner.test",
        settings: {
          provider: "other",
          host: "smtp.draft.owner.test",
          port: 2526,
          encryption: "tls",
          fromName: "Draft Owner Mail",
          fromEmail: "draft@owner.test",
        },
      },
    });
    assert.equal(testedSender.response.status, 200, JSON.stringify(testedSender.body));
    assert.equal(testedSender.body.verifiedAt, null);
    assert.equal(testedEmailConfigurations.at(-1).host, "smtp.draft.owner.test");
    assert.equal(testedEmailConfigurations.at(-1).fromName, "Draft Owner Mail");
    const [senderAfterDraftTest] = await db
      .select()
      .from(dbModule.tenantSendingConfigurationTable)
      .where(eq(dbModule.tenantSendingConfigurationTable.userId, owner.user.id));
    assert.equal(senderAfterDraftTest.host, "smtp.owner.test");
    assert.equal(senderAfterDraftTest.verifiedAt, null);

    const testedSavedSender = await api("/sending/settings/test", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        toEmail: "owner@owner.test",
        settings: {
          provider: "other",
          host: "smtp.owner.test",
          port: 2525,
          encryption: "none",
          fromName: "Owner Mail",
          fromEmail: "mail@owner.test",
        },
      },
    });
    assert.equal(testedSavedSender.response.status, 200, JSON.stringify(testedSavedSender.body));
    assert.ok(testedSavedSender.body.verifiedAt);
    assert.equal(testedEmailConfigurations.at(-1).host, "smtp.owner.test");
    assert.ok(
      testedEmailConfigurations.at(-1).usernameEncrypted,
      "saved SMTP credentials should be available to the transient test",
    );
    assert.equal(emails.length, 0, "tenant test mail must not use platform notification SMTP");
    const otherSender = await api("/sending/settings", { cookie: other.cookie });
    assert.equal(otherSender.body.credentialsConfigured, false);

    const ownerSecondaryList = await api("/contact-lists", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Owner secondary audience" },
    });
    assert.equal(ownerSecondaryList.response.status, 201);
    await db.insert(dbModule.contactListMembersTable).values({
      userId: owner.user.id,
      listId: ownerSecondaryList.body.id,
      contactId: ownerContacts[0].body.id,
    });
    const summaryParams = new URLSearchParams();
    summaryParams.append("listIds", ownerSecondaryList.body.id);
    summaryParams.append("listIds", ownerList.body.id);
    const recipientSummary = await api(
      `/campaigns/recipient-summary?${summaryParams}`,
      { cookie: owner.cookie },
    );
    assert.equal(
      recipientSummary.response.status,
      200,
      JSON.stringify(recipientSummary.body),
    );
    assert.deepEqual(recipientSummary.body, {
      uniqueRecipients: 3,
      overlappingRecipients: 1,
    });
    const crossTenantRecipientSummary = await api(
      `/campaigns/recipient-summary?listIds=${otherList.body.id}`,
      { cookie: owner.cookie },
    );
    assert.equal(crossTenantRecipientSummary.response.status, 400);

    const backupSender = await api("/sending/accounts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        provider: "other",
        host: "smtp.backup.owner.test",
        port: 465,
        encryption: "ssl",
        username: "smtp-backup-user",
        password: "smtp-backup-secret",
        fromName: "Backup Owner Mail",
        fromEmail: "backup@owner.test",
      },
    });
    assert.equal(backupSender.response.status, 201, JSON.stringify(backupSender.body));
    assert.equal(backupSender.body.account.isPrimary, false);
    assert.equal(backupSender.body.account.fromEmail, "backup@owner.test");
    await db
      .update(dbModule.tenantSendingConfigurationTable)
      .set({ verifiedAt: new Date() })
      .where(eq(dbModule.tenantSendingConfigurationTable.id, backupSender.body.account.id));
    const sendingAccounts = await api("/sending/accounts", { cookie: owner.cookie });
    assert.equal(sendingAccounts.response.status, 200);
    assert.equal(sendingAccounts.body.emailAccountLimit, 2);
    assert.equal(sendingAccounts.body.configuredCount, 2);
    assert.equal(sendingAccounts.body.overLimit, false);
    const thirdSender = await api("/sending/accounts", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        provider: "other",
        host: "smtp.third.owner.test",
        port: 587,
        encryption: "tls",
        username: "smtp-third-user",
        password: "smtp-third-secret",
        fromName: "Third Owner Mail",
        fromEmail: "third@owner.test",
      },
    });
    assert.equal(thirdSender.response.status, 409);
    assert.equal(thirdSender.body.code, "SENDER_ACCOUNT_LIMIT_REACHED");

    const campaign = await api("/campaigns", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        name: "Owner campaign",
        objective: "Share the launch update with active subscribers.",
          subject: "A workspace update for {{firstName}}",
          textBody: "Hello {{firstName}} from the campaign.",
          htmlBody: "<p>Draft <em>format</em></p>",
        listIds: [ownerSecondaryList.body.id, ownerList.body.id],
        senderAccountId: backupSender.body.account.id,
      },
    });
    assert.equal(campaign.response.status, 201, JSON.stringify(campaign.body));
    assert.equal(campaign.body.senderAccountId, backupSender.body.account.id);
    assert.equal(campaign.body.objective, "Share the launch update with active subscribers.");
    assert.equal(campaign.body.htmlBody, "<p>Draft <em>format</em></p>");
    assert.equal(campaign.body.listId, ownerSecondaryList.body.id);
    assert.deepEqual(campaign.body.listIds, [
      ownerSecondaryList.body.id,
      ownerList.body.id,
    ]);
    const updatedCampaign = await api(`/campaigns/${campaign.body.id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: {
        objective: "Remind existing customers about the launch.",
        htmlBody:
          "<p><strong>Hi {{firstName}}</strong>, welcome to {{companyName}}.</p><script>alert(1)</script>",
      },
    });
    assert.equal(updatedCampaign.response.status, 200, JSON.stringify(updatedCampaign.body));
    assert.equal(updatedCampaign.body.objective, "Remind existing customers about the launch.");
    assert.equal(
      updatedCampaign.body.htmlBody,
      "<p><strong>Hi {{firstName}}</strong>, welcome to {{companyName}}.</p>",
    );
    const samplePreview = await api("/campaigns/preview", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        listIds: [ownerSecondaryList.body.id, ownerList.body.id],
        contactId: ownerContacts[0].body.id,
        subject: "Hello {{fullName}} ({{missing}})",
        textBody: "A note for {{fullName}} at {{companyName}} from {{email}}.",
        htmlBody:
          "<p><strong>Hi {{firstName}}</strong>, welcome to {{companyName}}. {{missing}}</p><script>alert(1)</script>",
      },
    });
    assert.equal(samplePreview.response.status, 200, JSON.stringify(samplePreview.body));
    assert.equal(samplePreview.body.subject, "Hello Owner Contact ({{missing}})");
    assert.equal(
      samplePreview.body.textBody,
      "A note for Owner Contact at Acme & Sons from one@owner.test.",
    );
    assert.equal(
      samplePreview.body.htmlBody,
      "<p><strong>Hi Owner</strong>, welcome to Acme &amp; Sons. {{missing}}</p>",
    );
    const outOfListPreview = await api("/campaigns/preview", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        listIds: [ownerSecondaryList.body.id, ownerList.body.id],
        contactId: otherContact.body.id,
        subject: "Hello",
        textBody: "Hello",
        htmlBody: "<p>Hello</p>",
      },
    });
    assert.equal(outOfListPreview.response.status, 404);
    const savedAfterPreview = await api(`/campaigns/${campaign.body.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(savedAfterPreview.body.campaign.subject, campaign.body.subject);
    assert.equal(savedAfterPreview.body.campaign.textBody, campaign.body.textBody);
    assert.equal(savedAfterPreview.body.campaign.htmlBody, updatedCampaign.body.htmlBody);
    assert.equal(campaign.body.recipients, 3);
    assert.equal(campaign.body.estimatedDurationSeconds, 108);
    const draftDashboard = await api(`/campaigns/${campaign.body.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(draftDashboard.response.status, 200, JSON.stringify(draftDashboard.body));
    assert.equal(draftDashboard.body.targetList.name, ownerSecondaryList.body.name);
    assert.deepEqual(
      draftDashboard.body.targetLists.map((list) => list.name),
      [ownerSecondaryList.body.name, ownerList.body.name],
    );
    assert.equal(draftDashboard.body.targetLists[0].totalContacts, 1);
    assert.equal(draftDashboard.body.targetLists[0].eligibleContacts, 1);
    assert.equal(draftDashboard.body.pacing.remainingEmails, 3);
    assert.equal(draftDashboard.body.pacing.minimumSpacingSeconds, 36);

    await db.insert(dbModule.systemConfigurationTable).values({
      key: "platform",
      value: {
        defaultEmailsPerHour: 1,
        deliveryTrackingEnabled: true,
        maxEmailsPerDay: 2,
        maxConcurrentCampaigns: 2,
      },
    });
    const queued = await api(`/campaigns/${campaign.body.id}/send`, {
      method: "POST",
      cookie: owner.cookie,
      body: {},
    });
    assert.equal(queued.response.status, 202, JSON.stringify(queued.body));
    assert.equal(queued.body.recipients, 3);
    assert.ok(queued.body.scheduledAt);
    const inUseSenderDeletion = await api(
      `/sending/accounts/${backupSender.body.account.id}`,
      { method: "DELETE", cookie: owner.cookie },
    );
    assert.equal(inUseSenderDeletion.response.status, 409);
    const queuedRecipients = await db
      .select({
        email: dbModule.emailCampaignRecipientsTable.email,
        contactId: dbModule.emailCampaignRecipientsTable.contactId,
      })
      .from(dbModule.emailCampaignRecipientsTable)
      .where(
        eq(
          dbModule.emailCampaignRecipientsTable.campaignId,
          campaign.body.id,
        ),
      );
    assert.equal(queuedRecipients.length, 3);
    assert.equal(
      new Set(queuedRecipients.map((recipient) => recipient.email.toLowerCase()))
        .size,
      3,
      "an address selected through more than one list is queued only once",
    );
    const scheduledRecipients = await db
      .select({ nextAttemptAt: dbModule.emailCampaignRecipientsTable.nextAttemptAt })
      .from(dbModule.emailCampaignRecipientsTable)
      .where(eq(dbModule.emailCampaignRecipientsTable.campaignId, campaign.body.id));
    assert.equal(scheduledRecipients.length, 3);
    assert.ok(
      scheduledRecipients.every(
        (recipient) =>
          recipient.nextAttemptAt.getTime() ===
          new Date(queued.body.scheduledAt).getTime(),
      ),
      "recipient delivery eligibility matches the requested campaign start",
    );
    const queuedDashboard = await api(`/campaigns/${campaign.body.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(queuedDashboard.body.pacing.emailsPerHour, 1);
    assert.equal(queuedDashboard.body.pacing.remainingEmails, 3);

    const backlogCampaign = await api("/campaigns", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        name: "Campaign behind the queue",
        subject: "A later workspace update",
        textBody: "This message waits behind existing campaign work.",
        listId: ownerList.body.id,
      },
    });
    assert.equal(backlogCampaign.response.status, 201, JSON.stringify(backlogCampaign.body));
    assert.ok(
      backlogCampaign.body.estimatedDurationSeconds >
        queuedDashboard.body.pacing.estimatedDurationSeconds,
      "a draft estimate includes already queued work ahead of it",
    );
    const tooEarly = await api(`/campaigns/${backlogCampaign.body.id}/send`, {
      method: "POST",
      cookie: owner.cookie,
      body: { scheduledAt: new Date(Date.now() + 60_000).toISOString() },
    });
    assert.equal(tooEarly.response.status, 409, JSON.stringify(tooEarly.body));
    assert.equal(tooEarly.body.code, "CAMPAIGN_START_TOO_EARLY");
    assert.ok(new Date(tooEarly.body.earliestStartAt).getTime() > Date.now());

    const backlogScheduledAt = new Date(
      new Date(tooEarly.body.earliestStartAt).getTime() + 60_000,
    );
    const queuedBacklog = await api(`/campaigns/${backlogCampaign.body.id}/send`, {
      method: "POST",
      cookie: owner.cookie,
      body: { scheduledAt: backlogScheduledAt.toISOString() },
    });
    assert.equal(queuedBacklog.response.status, 202, JSON.stringify(queuedBacklog.body));
    assert.equal(
      new Date(queuedBacklog.body.scheduledAt).getTime(),
      backlogScheduledAt.getTime(),
    );
    const backlogRecipients = await db
      .select({ nextAttemptAt: dbModule.emailCampaignRecipientsTable.nextAttemptAt })
      .from(dbModule.emailCampaignRecipientsTable)
      .where(eq(dbModule.emailCampaignRecipientsTable.campaignId, backlogCampaign.body.id));
    assert.ok(
      backlogRecipients.every(
        (recipient) => recipient.nextAttemptAt.getTime() === backlogScheduledAt.getTime(),
      ),
      "future-scheduled recipients remain ineligible until the selected start",
    );
    await db
      .update(dbModule.emailCampaignRecipientsTable)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(
        eq(
          dbModule.emailCampaignRecipientsTable.campaignId,
          backlogCampaign.body.id,
        ),
      );
    const campaignsWithBacklog = await api("/campaigns", {
      cookie: owner.cookie,
    });
    const firstCampaignEstimate = campaignsWithBacklog.body.find(
      (item) => item.id === campaign.body.id,
    );
    const laterCampaignEstimate = campaignsWithBacklog.body.find(
      (item) => item.id === backlogCampaign.body.id,
    );
    assert.ok(
      laterCampaignEstimate.estimatedDurationSeconds >
        firstCampaignEstimate.estimatedDurationSeconds,
      "a later campaign estimate includes earlier queued recipients and shared hourly/daily caps",
    );
    const backlogDashboard = await api(
      `/campaigns/${backlogCampaign.body.id}`,
      { cookie: owner.cookie },
    );
    assert.equal(
      backlogDashboard.body.pacing.estimatedDurationSeconds,
      laterCampaignEstimate.estimatedDurationSeconds,
    );
    assert.ok(backlogDashboard.body.pacing.estimatedCompletionAt);

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
    const scheduledCampaign = afterRateLimit.body.find(
      (item) => item.id === backlogCampaign.body.id,
    );
    assert.equal(scheduledCampaign.delivered, 0);
    assert.equal(scheduledCampaign.queued, 2);
    assert.equal(scheduledCampaign.suppressed, 1);
    const progressDashboard = await api(`/campaigns/${campaign.body.id}`, {
      cookie: owner.cookie,
    });
    assert.equal(progressDashboard.body.pacing.remainingEmails, 1);
    assert.ok(progressDashboard.body.pacing.estimatedDurationSeconds >= 3600);

    await db
      .update(dbModule.systemConfigurationTable)
      .set({ value: { defaultEmailsPerHour: 100, maxEmailsPerDay: 10, deliveryTrackingEnabled: true } })
      .where(eq(dbModule.systemConfigurationTable.key, "platform"));
    await db
      .update(dbModule.emailCampaignRecipientsTable)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(dbModule.emailCampaignRecipientsTable.status, "queued"));
    const pacedBatch = await campaignWorkerModule.processPendingCampaignDeliveries();
    assert.equal(pacedBatch, 0, "a raised hourly cap must not send before the minimum spacing interval");
    await db
      .update(dbModule.emailSendAttemptsTable)
      .set({ attemptedAt: new Date(Date.now() - 60_000) })
      .where(eq(dbModule.emailSendAttemptsTable.userId, owner.user.id));
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
    assert.equal(
      tenantDeliveries.filter((message) =>
        message.subject.startsWith("A workspace update for "),
      ).length,
      2,
    );
    assert.ok(
      testedEmailConfigurations.some(
        (configuration) => configuration.host === "smtp.backup.owner.test",
      ),
      "queued campaign should send through its explicitly selected SMTP account",
    );
    const personalizedDelivery = tenantDeliveries.find(
      (message) => message.to === "one@owner.test",
    );
    assert.ok(personalizedDelivery);
    assert.equal(personalizedDelivery.subject, "A workspace update for Owner");
    assert.equal(personalizedDelivery.text, "Hello Owner from the campaign.");
    assert.equal(
      personalizedDelivery.html,
      "<p><strong>Hi Owner</strong>, welcome to Acme &amp; Sons.</p>",
    );
    assert.ok(personalizedDelivery.tracking?.attemptId);
    assert.equal(
      personalizedDelivery.tracking.messageId,
      `<${personalizedDelivery.tracking.attemptId}@mailflow.local>`,
    );
    assert.equal(personalizedDelivery.tracking.dsnRequested, true);

    const recipientOutcomes = await db
      .select({
        id: dbModule.emailCampaignRecipientsTable.id,
        contactId: dbModule.emailCampaignRecipientsTable.contactId,
        email: dbModule.emailCampaignRecipientsTable.email,
        status: dbModule.emailCampaignRecipientsTable.status,
      })
      .from(dbModule.emailCampaignRecipientsTable)
      .where(eq(dbModule.emailCampaignRecipientsTable.campaignId, campaign.body.id));
    const deliveredRecipient = recipientOutcomes.find((item) => item.status === "delivered");
    const bouncedRecipient = recipientOutcomes.find((item) => item.status === "bounced");
    const recordedAttempts = await db
      .select()
      .from(dbModule.emailSendAttemptsTable)
      .where(eq(dbModule.emailSendAttemptsTable.userId, owner.user.id));
    assert.equal(recordedAttempts.length, 2);
    assert.ok(recordedAttempts.every((attempt) => attempt.dsnRequested));
    assert.ok(
      recordedAttempts.every((attempt) =>
        new RegExp(`^<${attempt.id}@mailflow\\.local>$`).test(attempt.messageId),
      ),
    );
    assert.deepEqual(
      new Set(recordedAttempts.map((attempt) => attempt.outcome)),
      new Set(["smtp_accepted", "smtp_rejected"]),
    );
    assert.ok(
      recordedAttempts.every(
        (attempt) =>
          attempt.smtpCode === 250 || attempt.smtpCode === 550,
      ),
    );
    assert.ok(
      recordedAttempts.every(
        (attempt) =>
          attempt.enhancedStatus === "2.0.0" ||
          attempt.enhancedStatus === "5.1.1",
      ),
    );
    const deliveredAttempt = recordedAttempts.find(
      (attempt) => attempt.recipientId === deliveredRecipient.id,
    );
    assert.ok(deliveredAttempt);
    assert.equal(personalizedDelivery.tracking.messageId, deliveredAttempt.messageId);
    const contactsWithHistory = await api("/contacts", { cookie: owner.cookie });
    assert.equal(contactsWithHistory.response.status, 200);
    const contactById = new Map(
      contactsWithHistory.body.contacts.map((contact) => [contact.id, contact]),
    );
    assert.equal(contactById.get(deliveredRecipient.contactId).lastEmail.status, "delivered");
    assert.equal(contactById.get(bouncedRecipient.contactId).lastEmail.status, "bounced");
    assert.ok(contactById.get(deliveredRecipient.contactId).lastEmail.lastAttemptAt);
    assert.equal(
      contactById.get(deliveredRecipient.contactId).lastEmail.messageId,
      deliveredAttempt.messageId,
    );
    assert.equal(
      contactById.get(deliveredRecipient.contactId).lastEmail.smtpResponse,
      "250 2.0.0 SMTP accepted",
    );
    assert.equal(contactById.get(ownerContacts[2].body.id).lastEmail, null);

    const deliveredHistory = await api(
      `/contacts/${deliveredRecipient.contactId}/email-history`,
      { cookie: owner.cookie },
    );
    assert.equal(deliveredHistory.response.status, 200);
    assert.equal(deliveredHistory.body.length, 1);
    assert.equal(deliveredHistory.body[0].status, "delivered");
    assert.equal(deliveredHistory.body[0].campaignName, "Owner campaign");
    assert.ok(deliveredHistory.body[0].lastAttemptAt);
    assert.equal(deliveredHistory.body[0].messageId, deliveredAttempt.messageId);
    assert.equal(
      deliveredHistory.body[0].smtpResponse,
      "250 2.0.0 SMTP accepted",
    );
    const bouncedHistory = await api(
      `/contacts/${bouncedRecipient.contactId}/email-history`,
      { cookie: owner.cookie },
    );
    assert.equal(bouncedHistory.response.status, 200);
    assert.equal(bouncedHistory.body[0].status, "bounced");
    assert.equal(bouncedHistory.body[0].subject, "A workspace update for {{firstName}}");
    assert.equal(bouncedHistory.body[0].reportOutcome, "unconfirmed");
    assert.ok(bouncedHistory.body[0].messageId);
    const noEmailHistory = await api(
      `/contacts/${ownerContacts[2].body.id}/email-history`,
      { cookie: owner.cookie },
    );
    assert.deepEqual(noEmailHistory.body, []);
    const crossTenantHistory = await api(
      `/contacts/${otherContact.body.id}/email-history`,
      { cookie: owner.cookie },
    );
    assert.equal(crossTenantHistory.response.status, 404);

    const initialDeliveryPage = await api(
      `/campaigns/${campaign.body.id}/delivery-report?limit=1&offset=0`,
      { cookie: owner.cookie },
    );
    assert.equal(initialDeliveryPage.response.status, 200);
    assert.equal(initialDeliveryPage.body.total, 3);
    assert.equal(initialDeliveryPage.body.recipients.length, 1);
    assert.equal(initialDeliveryPage.body.recipients[0].email, "one@owner.test");
    assert.equal(initialDeliveryPage.body.summary.smtpAccepted, 1);
    assert.equal(initialDeliveryPage.body.summary.sendFailed, 1);
    assert.equal(initialDeliveryPage.body.summary.unconfirmed, 3);
    assert.ok(initialDeliveryPage.body.recipients[0].latestMessageId);
    assert.equal(initialDeliveryPage.body.recipients[0].dsnRequested, true);

    const reportTimestamp = new Date(Date.now() + 1000).toISOString();
    const dsnReport = [
      `Original-Message-ID: ${deliveredAttempt.messageId}`,
      `Final-Recipient: rfc822; ${deliveredRecipient.email}`,
      "Action: delivered",
      "Status: 2.0.0",
      "Diagnostic-Code: smtp; 250 2.0.0 recipient accepted",
      `Last-Attempt-Date: ${reportTimestamp}`,
    ].join("\r\n");
    const importedReport = await api("/sending/reports/import", {
      method: "POST",
      cookie: owner.cookie,
      body: { format: "dsn", content: dsnReport },
    });
    assert.equal(importedReport.response.status, 200, JSON.stringify(importedReport.body));
    assert.equal(importedReport.body.imported, 1);
    assert.equal(importedReport.body.unmatched, 0);
    assert.match(importedReport.body.message, /user-imported evidence/i);

    const duplicateReport = await api("/sending/reports/import", {
      method: "POST",
      cookie: owner.cookie,
      body: { format: "dsn", content: dsnReport },
    });
    assert.equal(duplicateReport.body.imported, 0);
    assert.equal(duplicateReport.body.duplicates, 1);

    const unmatchedReport = await api("/sending/reports/import", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        format: "generic_csv",
        content:
          "message_id,recipient_email,status\n<unknown@provider.test>,one@owner.test,delivered",
      },
    });
    assert.equal(unmatchedReport.body.unmatched, 1);

    const otherTenantImport = await api("/sending/reports/import", {
      method: "POST",
      cookie: other.cookie,
      body: { format: "dsn", content: dsnReport },
    });
    assert.equal(otherTenantImport.response.status, 200);
    assert.equal(otherTenantImport.body.imported, 0);
    assert.equal(otherTenantImport.body.unmatched, 1);

    await db
      .update(dbModule.emailCampaignRecipientsTable)
      .set({ reportEvidenceVerification: null })
      .where(eq(dbModule.emailCampaignRecipientsTable.id, deliveredRecipient.id));
    const reportedDeliveryPage = await api(
      `/campaigns/${campaign.body.id}/delivery-report?limit=1&offset=0`,
      { cookie: owner.cookie },
    );
    assert.equal(reportedDeliveryPage.body.total, 3);
    assert.equal(reportedDeliveryPage.body.summary.reportedDelivered, 1);
    assert.equal(reportedDeliveryPage.body.summary.unconfirmed, 2);
    assert.equal(reportedDeliveryPage.body.recipients[0].reportOutcome, "delivered");
    assert.equal(
      reportedDeliveryPage.body.recipients[0].evidenceVerification,
      "user_imported",
    );
    const legacyContactHistory = await api(
      `/contacts/${ownerContacts[0].body.id}/email-history`,
      { cookie: owner.cookie },
    );
    assert.equal(
      legacyContactHistory.body[0].reportEvidenceVerification,
      "user_imported",
    );
    const [gmailConnection] = await db
      .insert(dbModule.gmailMailboxConnectionsTable)
      .values({
        userId: owner.user.id,
        emailAddress: "bounces@owner.test",
        refreshTokenEncrypted: "test-only-encrypted-token",
        historyId: "gmail-history-100",
      })
      .returning();
    const parsedGmailReport = deliveryParserModule.parseDeliveryReports(
      "dsn",
      dsnReport,
    ).reports;
    const authorizedIngestion =
      await deliveryReportIngestionModule.ingestDeliveryReports({
        userId: owner.user.id,
        reports: parsedGmailReport,
        campaignId: campaign.body.id,
        verification: "gmail_authorized",
        gmailMailboxConnectionId: gmailConnection.id,
      });
    assert.equal(authorizedIngestion.imported, 1);
    const replayedGmailIngestion =
      await deliveryReportIngestionModule.ingestDeliveryReports({
        userId: owner.user.id,
        reports: parsedGmailReport,
        campaignId: campaign.body.id,
        verification: "gmail_authorized",
        gmailMailboxConnectionId: gmailConnection.id,
      });
    assert.equal(replayedGmailIngestion.duplicates, 1);
    const crossTenantGmailIngestion =
      await deliveryReportIngestionModule.ingestDeliveryReports({
        userId: other.user.id,
        reports: parsedGmailReport,
        campaignId: campaign.body.id,
        verification: "gmail_authorized",
        gmailMailboxConnectionId: gmailConnection.id,
      });
    assert.equal(crossTenantGmailIngestion.imported, 0);
    assert.equal(crossTenantGmailIngestion.unmatched, 1);
    const authorizedDeliveryPage = await api(
      `/campaigns/${campaign.body.id}/delivery-report?limit=1&offset=0`,
      { cookie: owner.cookie },
    );
    assert.equal(
      authorizedDeliveryPage.body.recipients[0].evidenceVerification,
      "gmail_authorized",
    );
    assert.equal(authorizedDeliveryPage.body.recipients[0].reportSource, "dsn");
    const secondDeliveryPage = await api(
      `/campaigns/${campaign.body.id}/delivery-report?limit=1&offset=1`,
      { cookie: owner.cookie },
    );
    assert.equal(secondDeliveryPage.body.recipients.length, 1);
    assert.notEqual(
      secondDeliveryPage.body.recipients[0].id,
      reportedDeliveryPage.body.recipients[0].id,
    );

    const bouncedAttempt = recordedAttempts.find(
      (attempt) => attempt.recipientId === bouncedRecipient.id,
    );
    assert.ok(bouncedAttempt);
    const makeDsn = ({
      attempt = deliveredAttempt,
      envelopeId,
      outcome,
      occurredAt,
    }) =>
      [
        `Original-Message-ID: ${attempt.messageId}`,
        ...(envelopeId ? [`Original-Envelope-ID: ${envelopeId}`] : []),
        `Final-Recipient: rfc822; ${deliveredRecipient.email}`,
        `Action: ${outcome === "bounced" ? "failed" : outcome}`,
        `Status: ${outcome === "bounced" ? "5.1.1" : outcome === "delayed" ? "4.2.0" : "2.0.0"}`,
        ...(occurredAt ? [`Last-Attempt-Date: ${occurredAt}`] : []),
      ].join("\r\n");
    const importDsn = (content) =>
      api("/sending/reports/import", {
        method: "POST",
        cookie: owner.cookie,
        body: { format: "dsn", content },
      });
    const importGeneric = (status, occurredAt) =>
      api("/sending/reports/import", {
        method: "POST",
        cookie: owner.cookie,
        body: {
          format: "generic_csv",
          content: [
            "message_id,recipient_email,status,timestamp",
            `${deliveredAttempt.messageId},${deliveredRecipient.email},${status},${occurredAt ?? ""}`,
          ].join("\n"),
        },
      });

    const conflictingIdentifiers = await importDsn(
      [
        `Original-Message-ID: ${deliveredAttempt.messageId}`,
        "Original-Envelope-ID: 123e4567-e89b-42d3-a456-426614174000",
        `Final-Recipient: rfc822; ${deliveredRecipient.email}`,
        "Action: delivered",
        "Status: 2.0.0",
      ].join("\r\n"),
    );
    assert.equal(conflictingIdentifiers.body.unmatched, 1);
    const invalidEnvelopeId = await importDsn(
      [
        `Original-Message-ID: ${deliveredAttempt.messageId}`,
        "Original-Envelope-ID: not-a-uuid",
        `Final-Recipient: rfc822; ${deliveredRecipient.email}`,
        "Action: delivered",
        "Status: 2.0.0",
      ].join("\r\n"),
    );
    assert.equal(invalidEnvelopeId.response.status, 200);
    assert.equal(invalidEnvelopeId.body.unmatched, 1);
    assert.match(invalidEnvelopeId.body.warnings[0], /invalid envelope ID/i);

    const originalAttemptTime = deliveredAttempt.attemptedAt;
    const attemptWholeSecond = new Date(
      Math.floor(new Date(originalAttemptTime).getTime() / 1000) * 1000,
    );
    await db
      .update(dbModule.emailSendAttemptsTable)
      .set({ attemptedAt: new Date(attemptWholeSecond.getTime() + 450) })
      .where(eq(dbModule.emailSendAttemptsTable.id, deliveredAttempt.id));
    const sameSecondRfcBounce = await importDsn(
      makeDsn({
        outcome: "bounced",
        occurredAt: attemptWholeSecond.toUTCString(),
      }),
    );
    assert.equal(sameSecondRfcBounce.response.status, 200);
    assert.equal(sameSecondRfcBounce.body.imported, 1);
    assert.equal(sameSecondRfcBounce.body.ignored, 0);
    const sameSecondCsvBounce = await api("/sending/reports/import", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        format: "generic_csv",
        content: [
          "message_id,recipient_email,status,occurred_at",
          `${deliveredAttempt.messageId},${deliveredRecipient.email},bounced,${attemptWholeSecond.toISOString()}`,
        ].join("\n"),
      },
    });
    assert.equal(sameSecondCsvBounce.response.status, 200);
    assert.equal(sameSecondCsvBounce.body.imported, 0);
    assert.equal(sameSecondCsvBounce.body.ignored, 1);
    const precedingSecondRfcBounce = await importDsn(
      makeDsn({
        outcome: "bounced",
        occurredAt: new Date(attemptWholeSecond.getTime() - 1000).toUTCString(),
      }),
    );
    assert.equal(precedingSecondRfcBounce.body.imported, 0);
    assert.equal(precedingSecondRfcBounce.body.ignored, 1);
    await db
      .update(dbModule.emailSendAttemptsTable)
      .set({ attemptedAt: new Date(originalAttemptTime) })
      .where(eq(dbModule.emailSendAttemptsTable.id, deliveredAttempt.id));

    const tieTimestamp = new Date(Date.now() + 10_000).toISOString();
    const [concurrentDelivered, concurrentBounced] = await Promise.all([
      importDsn(
        makeDsn({
          outcome: "delivered",
          occurredAt: tieTimestamp,
        }),
      ),
      importDsn(
        makeDsn({
          outcome: "bounced",
          occurredAt: tieTimestamp,
        }),
      ),
    ]);
    assert.equal(concurrentDelivered.body.imported, 1);
    assert.equal(concurrentBounced.body.imported, 1);
    const tiedProjection = await api(
      `/campaigns/${campaign.body.id}/delivery-report?limit=100`,
      { cookie: owner.cookie },
    );
    const tiedRecipient = tiedProjection.body.recipients.find(
      (item) => item.id === deliveredRecipient.id,
    );
    assert.equal(tiedRecipient.reportOutcome, "bounced");
    assert.equal(new Date(tiedRecipient.reportAt).toISOString(), tieTimestamp);
    const tiedEvents = await db
      .select()
      .from(dbModule.emailDeliveryReportsTable)
      .where(
        and(
          eq(dbModule.emailDeliveryReportsTable.recipientId, deliveredRecipient.id),
          eq(dbModule.emailDeliveryReportsTable.attemptId, deliveredAttempt.id),
        ),
      );
    assert.equal(
      tiedEvents.filter(
        (event) =>
          event.occurredAt?.toISOString() === tieTimestamp &&
          ["delivered", "bounced"].includes(event.outcome),
      ).length,
      2,
    );

    const olderTimestamp = new Date(
      new Date(tieTimestamp).getTime() - 1000,
    ).toISOString();
    const olderTerminal = await importDsn(
      makeDsn({
        outcome: "delivered",
        occurredAt: olderTimestamp,
      }),
    );
    assert.equal(olderTerminal.body.imported, 1);
    assert.ok(olderTerminal.body.warnings.length > 0);
    const undatedTerminal = await importGeneric("failed");
    assert.equal(undatedTerminal.body.imported, 1);
    assert.ok(undatedTerminal.body.warnings.length > 0);
    const newerTimestamp = new Date(
      new Date(tieTimestamp).getTime() + 1000,
    ).toISOString();
    const newerTerminal = await importGeneric("failed", newerTimestamp);
    assert.equal(newerTerminal.body.imported, 1);
    const delayedAfterTerminal = await importDsn(
      makeDsn({
        outcome: "delayed",
        occurredAt: new Date(
          new Date(tieTimestamp).getTime() + 2000,
        ).toISOString(),
      }),
    );
    assert.equal(delayedAfterTerminal.body.imported, 1);
    assert.ok(delayedAfterTerminal.body.warnings.length > 0);
    const dateOrderedProjection = await api(
      `/campaigns/${campaign.body.id}/delivery-report?limit=100`,
      { cookie: owner.cookie },
    );
    const dateOrderedRecipient = dateOrderedProjection.body.recipients.find(
      (item) => item.id === deliveredRecipient.id,
    );
    assert.equal(dateOrderedRecipient.reportOutcome, "failed");
    assert.equal(
      new Date(dateOrderedRecipient.reportAt).toISOString(),
      newerTimestamp,
    );

    const [dashboardPaymentPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Dashboard payment package",
        description: "",
        amountMinor: 12500,
        currency: "INR",
        periodDays: 30,
      })
      .returning();
    await db.insert(dbModule.companiesTable).values({
      userId: owner.user.id,
      companyName: "Dashboard Company",
      companyDomain: "dashboard-company.owner.test",
      companyDomainKey: "dashboard-company.owner.test",
    });
    await db.insert(dbModule.paymentsTable).values([
      {
        userId: owner.user.id,
        packageId: dashboardPaymentPackage.id,
        receipt: `db-inr-${randomUUID().slice(0, 8)}`,
        amountMinor: 12500,
        currency: "INR",
        status: "captured",
      },
      {
        userId: owner.user.id,
        packageId: dashboardPaymentPackage.id,
        receipt: `db-usd-${randomUUID().slice(0, 8)}`,
        amountMinor: 2345,
        currency: "USD",
        status: "captured",
      },
      {
        userId: owner.user.id,
        packageId: dashboardPaymentPackage.id,
        receipt: `db-rfd-${randomUUID().slice(0, 8)}`,
        amountMinor: 99000,
        currency: "INR",
        status: "refunded",
      },
    ]);

    const ownerDashboard = await api("/dashboard", { cookie: owner.cookie });
    const otherDashboard = await api("/dashboard", { cookie: other.cookie });
    assert.equal(ownerDashboard.response.status, 200);
    assert.equal(ownerDashboard.body.contacts, 3);
    assert.equal(ownerDashboard.body.companies, 1);
    assert.equal(ownerDashboard.body.activeLists, 2);
    assert.deepEqual(ownerDashboard.body.amountSpentByCurrency, [
      { currency: "INR", amountMinor: 12500 },
      { currency: "USD", amountMinor: 2345 },
    ]);
    assert.deepEqual(ownerDashboard.body.lifecycleStages, [{ value: "Not set", count: 3 }]);
    assert.deepEqual(ownerDashboard.body.leadStatuses, [{ value: "Not set", count: 3 }]);
    const ownerCampaignSummary = ownerDashboard.body.campaigns.find(
      (item) => item.id === campaign.body.id,
    );
    assert.equal(ownerCampaignSummary.status, "completed");
    assert.equal(ownerCampaignSummary.recipients, 3);
    assert.equal(ownerCampaignSummary.delivered, 1);
    assert.equal(ownerCampaignSummary.bounced, 1);
    assert.equal(ownerCampaignSummary.suppressed, 1);
    assert.equal(typeof ownerCampaignSummary.attemptsThisHour, "number");
    assert.equal(ownerCampaignSummary.remainingThisHour, 0);
    for (const globalSendMetric of [
      "emailsSent",
      "delivered",
      "bounced",
      "remainingThisHour",
    ]) {
      assert.equal(Object.hasOwn(ownerDashboard.body, globalSendMetric), false);
    }
    assert.equal(otherDashboard.body.contacts, 1);
    assert.equal(otherDashboard.body.companies, 0);
    assert.deepEqual(otherDashboard.body.amountSpentByCurrency, []);
    assert.deepEqual(otherDashboard.body.campaigns, []);

    await db
      .update(dbModule.emailCampaignRecipientsTable)
      .set({
        status: "queued",
        nextAttemptAt: new Date(Date.now() - 1000),
        reportOutcome: "bounced",
        reportSource: "dsn",
        reportDiagnostic: "old attempt diagnostic",
        reportStatusCode: "5.1.1",
        reportAt: new Date(Date.now() - 1000),
        reportDeliveryScope: "recipient",
      })
      .where(eq(dbModule.emailCampaignRecipientsTable.id, deliveredRecipient.id));
    await db
      .update(dbModule.emailCampaignsTable)
      .set({ status: "queued", completedAt: null })
      .where(eq(dbModule.emailCampaignsTable.id, campaign.body.id));
    await db
      .update(dbModule.emailSendAttemptsTable)
      .set({ attemptedAt: new Date(Date.now() - 60_000) })
      .where(eq(dbModule.emailSendAttemptsTable.userId, owner.user.id));
    const retryEvidenceReset = await campaignWorkerModule.processPendingCampaignDeliveries(1);
    assert.equal(retryEvidenceReset, 1);
    const [resetRecipient] = await db
      .select()
      .from(dbModule.emailCampaignRecipientsTable)
      .where(eq(dbModule.emailCampaignRecipientsTable.id, deliveredRecipient.id));
    assert.equal(resetRecipient.reportOutcome, "unconfirmed");
    assert.equal(resetRecipient.reportSource, null);
    assert.equal(resetRecipient.reportDiagnostic, null);
    assert.equal(resetRecipient.reportStatusCode, null);
    assert.equal(resetRecipient.reportAt, null);
    assert.equal(resetRecipient.reportDeliveryScope, null);

    await db
      .update(dbModule.systemConfigurationTable)
      .set({
        value: {
          defaultEmailsPerHour: 100,
          maxEmailsPerDay: 10,
          retryAttempts: 0,
        },
      })
      .where(eq(dbModule.systemConfigurationTable.key, "platform"));
    await db
      .update(dbModule.emailCampaignRecipientsTable)
      .set({
        status: "queued",
        nextAttemptAt: new Date(Date.now() - 1000),
        reportOutcome: "delivered",
        reportSource: "dsn",
        reportAt: new Date(Date.now() - 1000),
      })
      .where(eq(dbModule.emailCampaignRecipientsTable.id, deliveredRecipient.id));
    await db
      .update(dbModule.emailCampaignsTable)
      .set({ status: "queued", completedAt: null })
      .where(eq(dbModule.emailCampaignsTable.id, campaign.body.id));
    await db
      .update(dbModule.emailSendAttemptsTable)
      .set({ attemptedAt: new Date(Date.now() - 60_000) })
      .where(eq(dbModule.emailSendAttemptsTable.userId, owner.user.id));
    emailModule.setTenantEmailTransportForTests(async () => {
      throw Object.assign(new Error("connection timeout"), {
        code: "ETIMEDOUT",
        command: "DATA",
      });
    });
    const unknownTerminalDelivery =
      await campaignWorkerModule.processPendingCampaignDeliveries(1);
    assert.equal(unknownTerminalDelivery, 1);
    const [unknownRecipient] = await db
      .select()
      .from(dbModule.emailCampaignRecipientsTable)
      .where(eq(dbModule.emailCampaignRecipientsTable.id, deliveredRecipient.id));
    assert.equal(unknownRecipient.status, "unknown");
    assert.equal(unknownRecipient.reportOutcome, "unconfirmed");
    const latestOwnerAttempts = await db
      .select()
      .from(dbModule.emailSendAttemptsTable)
      .where(
        and(
          eq(dbModule.emailSendAttemptsTable.userId, owner.user.id),
          eq(dbModule.emailSendAttemptsTable.recipientId, deliveredRecipient.id),
        ),
      )
      .orderBy(desc(dbModule.emailSendAttemptsTable.attemptedAt));
    assert.equal(latestOwnerAttempts[0].outcome, "unknown");
    assert.equal(latestOwnerAttempts[0].dsnRequested, false);
    const terminalUnknownReport = await api(
      `/campaigns/${campaign.body.id}/delivery-report?limit=100`,
      { cookie: owner.cookie },
    );
    assert.equal(terminalUnknownReport.body.summary.sendFailed, 1);
    assert.equal(terminalUnknownReport.body.summary.smtpAccepted, 0);
  });

  it("retains the selected SMTP sender and removes the other account when a lower-limit package starts", async () => {
    const owner = await loggedInUser({ username: "sender-retention-owner" });
    const [paidPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "Two sender package",
        description: "",
        amountMinor: 1000,
        currency: "INR",
        periodDays: 30,
        contactLimit: 100,
        emailAccountLimit: 2,
      })
      .returning();
    const [currentSubscription] = await db
      .insert(dbModule.userSubscriptionsTable)
      .values({
        userId: owner.user.id,
        packageId: paidPackage.id,
        status: "active",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60_000),
      })
      .returning();
    const createSender = async (host, fromEmail) =>
      api("/sending/accounts", {
        method: "POST",
        cookie: owner.cookie,
        body: {
          provider: "other",
          host,
          port: 587,
          encryption: "tls",
          username: `${fromEmail}-user`,
          password: `${fromEmail}-secret`,
          fromName: "Retention Test",
          fromEmail,
        },
      });
    const retained = await createSender("smtp.keep.test", "keep@retention.test");
    const removed = await createSender("smtp.remove.test", "remove@retention.test");
    assert.equal(retained.response.status, 201, JSON.stringify(retained.body));
    assert.equal(removed.response.status, 201, JSON.stringify(removed.body));
    assert.equal(retained.body.account.isPrimary, true);
    assert.equal(removed.body.account.isPrimary, false);
    const [freePackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values({
        name: "One sender package",
        description: "",
        amountMinor: 0,
        currency: "INR",
        periodDays: 30,
        contactLimit: 100,
        emailAccountLimit: 1,
      })
      .returning();

    const downgrade = await api("/subscriptions/free", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        packageId: freePackage.id,
        senderAccountIdsToKeep: [retained.body.account.id],
      },
    });
    assert.equal(downgrade.response.status, 200, JSON.stringify(downgrade.body));
    const beforeStart = await api("/sending/accounts", { cookie: owner.cookie });
    assert.equal(beforeStart.body.configuredCount, 2);
    assert.equal(beforeStart.body.scheduledDowngrade.emailAccountLimit, 1);
    assert.deepEqual(beforeStart.body.scheduledDowngrade.accountIdsToKeep, [
      retained.body.account.id,
    ]);

    const [scheduledSubscription] = await db
      .select()
      .from(dbModule.userSubscriptionsTable)
      .where(
        and(
          eq(dbModule.userSubscriptionsTable.userId, owner.user.id),
          eq(dbModule.userSubscriptionsTable.packageId, freePackage.id),
        ),
      );
    await db
      .update(dbModule.userSubscriptionsTable)
      .set({ endsAt: new Date(Date.now() - 1000) })
      .where(eq(dbModule.userSubscriptionsTable.id, currentSubscription.id));
    await db
      .update(dbModule.userSubscriptionsTable)
      .set({
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 24 * 60 * 60_000),
      })
      .where(eq(dbModule.userSubscriptionsTable.id, scheduledSubscription.id));

    const afterStart = await api("/sending/accounts", { cookie: owner.cookie });
    assert.equal(afterStart.response.status, 200, JSON.stringify(afterStart.body));
    assert.equal(afterStart.body.emailAccountLimit, 1);
    assert.equal(afterStart.body.configuredCount, 1);
    assert.equal(afterStart.body.overLimit, false);
    assert.equal(afterStart.body.accounts[0].id, retained.body.account.id);
    assert.equal(afterStart.body.scheduledDowngrade, null);
    const deletedSender = await api(
      `/sending/accounts/${removed.body.account.id}`,
      { method: "DELETE", cookie: owner.cookie },
    );
    assert.equal(deletedSender.response.status, 404);
  });
});

describe("Microsoft 365 trace polling worker", { concurrency: false }, () => {
  it("preserves a failed backfill page checkpoint and deduplicates replayed traces", async () => {
    const owner = await loggedInUser({ username: "m365-checkpoint-owner" });
    const candidate = await createMicrosoft365Candidate(owner.user.id, {
      email: "checkpoint@example.test",
      messageId: "<checkpoint-message@example.test>",
    });
    const backfillStartAt = new Date(Date.now() - 24 * 60 * 60_000);
    const backfillEndAt = new Date();
    const secondPage =
      "https://graph.microsoft.com/v1.0/admin/exchange/tracing/messageTraces?$skiptoken=page-two";
    const firstTrace = {
      id: "checkpoint-trace-1",
      messageId: candidate.attempt.messageId,
      recipientAddress: candidate.recipient.email,
      receivedDateTime: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: "Delivered",
    };
    const connection = await createMicrosoft365Connection(owner.user.id, {
      backfillStartAt,
      backfillEndAt,
    });
    let listRequests = 0;

    await withMicrosoft365Fetch(async (url) => {
      if (url.hostname === "login.microsoftonline.com") {
        return microsoftJson({ access_token: "m365-worker-test-token" });
      }
      if (url.pathname.includes("/getDetailsByRecipient(")) {
        return microsoftJson({ value: [] });
      }
      listRequests += 1;
      if (listRequests === 1) {
        return microsoftJson({
          value: [firstTrace],
          "@odata.nextLink": secondPage,
        });
      }
      assert.equal(url.toString(), secondPage);
      if (listRequests === 2) {
        return microsoftJson({ error: { code: "ServiceUnavailable" } }, 503);
      }
      return microsoftJson({
        value: [
          firstTrace,
          {
            ...firstTrace,
            id: "checkpoint-trace-2",
          },
        ],
      });
    }, async () => {
      await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();
      let [afterFirstPage] = await db
        .select()
        .from(dbModule.microsoft365TraceConnectionsTable)
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      assert.equal(afterFirstPage.pageNextLink, secondPage);
      assert.equal(
        afterFirstPage.backfillStartAt.toISOString(),
        backfillStartAt.toISOString(),
      );
      assert.equal(afterFirstPage.syncStatus, "connected");

      await db
        .update(dbModule.microsoft365TraceConnectionsTable)
        .set({ nextSyncAt: new Date(Date.now() - 60_000) })
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();
      let [afterPageFailure] = await db
        .select()
        .from(dbModule.microsoft365TraceConnectionsTable)
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      assert.equal(afterPageFailure.pageNextLink, secondPage);
      assert.equal(
        afterPageFailure.backfillStartAt.toISOString(),
        backfillStartAt.toISOString(),
      );
      assert.equal(afterPageFailure.syncStatus, "error");
      assert.match(afterPageFailure.lastError, /status 503/i);
      assert.ok(afterPageFailure.nextSyncAt.getTime() > Date.now());
      assert.equal(afterPageFailure.leaseExpiresAt, null);

      await db
        .update(dbModule.microsoft365TraceConnectionsTable)
        .set({ nextSyncAt: new Date(Date.now() - 60_000) })
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();

      [afterFirstPage] = await db
        .select()
        .from(dbModule.microsoft365TraceConnectionsTable)
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      const traces = await db
        .select()
        .from(dbModule.microsoft365MessageTracesTable)
        .where(eq(dbModule.microsoft365MessageTracesTable.connectionId, connection.id));
      assert.equal(listRequests, 3);
      assert.equal(traces.length, 2, "the replayed first-page trace must be unique");
      assert.equal(afterFirstPage.pageNextLink, null);
      assert.equal(afterFirstPage.backfillStartAt, null);
      assert.ok(afterFirstPage.backfillCompletedAt instanceof Date);
    });
  });

  it("bounds throttled and transient retries without hiding the last successful health state", async () => {
    const owner = await loggedInUser({ username: "m365-retry-owner" });
    const previousSuccess = new Date(Date.now() - 60 * 60_000);
    const connection = await createMicrosoft365Connection(owner.user.id, {
      lastSuccessAt: previousSuccess,
    });
    let graphRequests = 0;

    await withMicrosoft365Fetch(async (url) => {
      if (url.hostname === "login.microsoftonline.com") {
        return microsoftJson({ access_token: "m365-worker-test-token" });
      }
      graphRequests += 1;
      if (graphRequests === 1) {
        return microsoftJson(
          { error: { code: "TooManyRequests" } },
          429,
          { "retry-after": "7200" },
        );
      }
      if (graphRequests === 2) {
        return microsoftJson(
          { error: { code: "TooManyRequests" } },
          429,
          { "retry-after": "0" },
        );
      }
      throw new Error("Temporary network failure");
    }, async () => {
      await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();
      let [afterLongThrottle] = await db
        .select()
        .from(dbModule.microsoft365TraceConnectionsTable)
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      let retryIn = afterLongThrottle.nextSyncAt.getTime() - Date.now();
      assert.ok(retryIn > 59 * 60_000 && retryIn <= 60 * 60_000);
      assert.equal(afterLongThrottle.syncStatus, "error");
      assert.equal(afterLongThrottle.lastSuccessAt.toISOString(), previousSuccess.toISOString());
      assert.match(afterLongThrottle.lastError, /throttling/i);

      await db
        .update(dbModule.microsoft365TraceConnectionsTable)
        .set({ nextSyncAt: new Date(Date.now() - 60_000) })
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();
      let [afterShortThrottle] = await db
        .select()
        .from(dbModule.microsoft365TraceConnectionsTable)
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      retryIn = afterShortThrottle.nextSyncAt.getTime() - Date.now();
      assert.ok(retryIn > 28_000 && retryIn <= 30_000);
      assert.equal(afterShortThrottle.syncStatus, "error");
      assert.equal(afterShortThrottle.lastSuccessAt.toISOString(), previousSuccess.toISOString());

      await db
        .update(dbModule.microsoft365TraceConnectionsTable)
        .set({ nextSyncAt: new Date(Date.now() - 60_000) })
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();
      const [afterTransientFailure] = await db
        .select()
        .from(dbModule.microsoft365TraceConnectionsTable)
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      retryIn = afterTransientFailure.nextSyncAt.getTime() - Date.now();
      assert.ok(retryIn > 295_000 && retryIn <= 5 * 60_000);
      assert.equal(afterTransientFailure.syncStatus, "error");
      assert.equal(afterTransientFailure.lastSuccessAt.toISOString(), previousSuccess.toISOString());
      assert.match(afterTransientFailure.lastError, /could not reach/i);

      const visibleHealth = await api("/sending/microsoft-365/connection", {
        cookie: owner.cookie,
      });
      assert.equal(visibleHealth.response.status, 200);
      assert.equal(visibleHealth.body.syncStatus, "error");
      assert.match(visibleHealth.body.lastError, /could not reach/i);
      assert.equal(
        new Date(visibleHealth.body.lastSuccessAt).toISOString(),
        previousSuccess.toISOString(),
      );
      assert.equal(graphRequests, 3);
    });
  });

  it("uses the persisted lease to prevent overlapping syncs", async () => {
    const owner = await loggedInUser({ username: "m365-lease-owner" });
    const connection = await createMicrosoft365Connection(owner.user.id, {
      backfillStartAt: new Date(Date.now() - 24 * 60 * 60_000),
      backfillEndAt: new Date(),
    });
    let signalTokenRequest;
    let releaseTokenRequest;
    const tokenRequestEntered = new Promise((resolve) => {
      signalTokenRequest = resolve;
    });
    const tokenRequestGate = new Promise((resolve) => {
      releaseTokenRequest = resolve;
    });
    let tokenRequests = 0;
    let listRequests = 0;

    await withMicrosoft365Fetch(async (url) => {
      if (url.hostname === "login.microsoftonline.com") {
        tokenRequests += 1;
        signalTokenRequest();
        await tokenRequestGate;
        return microsoftJson({ access_token: "m365-worker-test-token" });
      }
      listRequests += 1;
      return microsoftJson({ value: [] });
    }, async () => {
      const firstSync = microsoft365TraceModule.syncDueMicrosoft365TraceConnections();
      await tokenRequestEntered;
      try {
        await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();
        assert.equal(tokenRequests, 1);
        assert.equal(listRequests, 0);
      } finally {
        releaseTokenRequest();
      }
      await firstSync;
      assert.equal(tokenRequests, 1);
      assert.equal(listRequests, 1);
      const [afterSync] = await db
        .select()
        .from(dbModule.microsoft365TraceConnectionsTable)
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      assert.equal(afterSync.leaseExpiresAt, null);
      assert.equal(afterSync.syncStatus, "connected");
    });
  });

  it("isolates trace candidates by tenant and preserves event projection semantics", async () => {
    const owner = await loggedInUser({ username: "m365-projection-owner" });
    const other = await loggedInUser({ username: "m365-projection-other" });
    const connection = await createMicrosoft365Connection(owner.user.id);
    const eventCases = [
      {
        event: "SEND",
        outcome: "delivered",
        deliveryScope: "receiving_server",
        email: "send@example.test",
        messageId: "<send@example.test>",
      },
      {
        event: "DELIVER",
        outcome: "delivered",
        deliveryScope: "mailbox",
        email: "deliver@example.test",
        messageId: "<deliver@example.test>",
      },
      {
        event: "FAIL",
        outcome: "failed",
        deliveryScope: "unspecified",
        email: "fail@example.test",
        messageId: "<fail@example.test>",
      },
      {
        event: "DEFER",
        outcome: "delayed",
        deliveryScope: "unspecified",
        email: "defer@example.test",
        messageId: "<defer@example.test>",
      },
    ];
    const candidates = new Map();
    for (const testCase of eventCases) {
      candidates.set(
        testCase.event,
        await createMicrosoft365Candidate(owner.user.id, testCase),
      );
    }
    const foreignCandidate = await createMicrosoft365Candidate(other.user.id, {
      email: "foreign@example.test",
      messageId: "<foreign-message@example.test>",
    });
    const traces = [
      ...eventCases.map((testCase) => ({
        id: `trace-${testCase.event.toLowerCase()}`,
        messageId: testCase.messageId,
        recipientAddress: testCase.email,
        receivedDateTime: new Date(Date.now() - 60_000).toISOString(),
        status: "Delivered",
      })),
      {
        id: "trace-foreign-candidate",
        messageId: foreignCandidate.attempt.messageId,
        recipientAddress: foreignCandidate.recipient.email,
        receivedDateTime: new Date(Date.now() - 60_000).toISOString(),
        status: "Delivered",
      },
    ];
    const detailsByTraceId = new Map(
      eventCases.map((testCase) => [
        `trace-${testCase.event.toLowerCase()}`,
        testCase.event,
      ]),
    );
    let detailRequests = 0;
    let listRequests = 0;

    await withMicrosoft365Fetch(async (url) => {
      if (url.hostname === "login.microsoftonline.com") {
        return microsoftJson({ access_token: "m365-worker-test-token" });
      }
      if (url.pathname.includes("/getDetailsByRecipient(")) {
        detailRequests += 1;
        const traceId = [...detailsByTraceId.keys()].find((id) =>
          url.pathname.includes(`/${id}/getDetailsByRecipient(`),
        );
        assert.ok(traceId, `unexpected details request: ${url.pathname}`);
        const trace = traces.find((item) => item.id === traceId);
        return microsoftJson({
          value: [
            {
              messageId: trace.messageId,
              event: detailsByTraceId.get(traceId),
              dateTime: new Date(Date.now() - 30_000).toISOString(),
            },
          ],
        });
      }
      listRequests += 1;
      return microsoftJson({ value: traces });
    }, async () => {
      await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();

      const savedTraces = await db
        .select()
        .from(dbModule.microsoft365MessageTracesTable)
        .where(eq(dbModule.microsoft365MessageTracesTable.connectionId, connection.id));
      assert.equal(savedTraces.length, 4);
      assert.equal(
        savedTraces.some((trace) => trace.traceId === "trace-foreign-candidate"),
        false,
      );

      for (const testCase of eventCases) {
        const candidate = candidates.get(testCase.event);
        const [projected] = await db
          .select()
          .from(dbModule.emailCampaignRecipientsTable)
          .where(eq(dbModule.emailCampaignRecipientsTable.id, candidate.recipient.id));
        assert.equal(projected.reportOutcome, testCase.outcome, testCase.event);
        assert.equal(projected.reportDeliveryScope, testCase.deliveryScope, testCase.event);
        assert.equal(projected.reportSource, "microsoft_365_graph");
        assert.equal(projected.reportEvidenceVerification, "microsoft365_authorized");

        const [storedTrace] = savedTraces.filter(
          (trace) => trace.traceId === `trace-${testCase.event.toLowerCase()}`,
        );
        if (testCase.event === "DEFER") {
          assert.ok(storedTrace.nextAttemptAt.getTime() > Date.now() + 14 * 60_000);
        } else {
          assert.ok(storedTrace.nextAttemptAt.getUTCFullYear() >= 9999);
        }
      }

      const [untouchedForeignRecipient] = await db
        .select()
        .from(dbModule.emailCampaignRecipientsTable)
        .where(eq(dbModule.emailCampaignRecipientsTable.id, foreignCandidate.recipient.id));
      assert.equal(untouchedForeignRecipient.reportOutcome, "unconfirmed");
      const reports = await db
        .select()
        .from(dbModule.emailDeliveryReportsTable)
        .where(eq(dbModule.emailDeliveryReportsTable.userId, owner.user.id));
      assert.equal(reports.length, 4);
      assert.equal(detailRequests, 4);

      await db
        .update(dbModule.microsoft365TraceConnectionsTable)
        .set({ nextSyncAt: new Date(Date.now() - 60_000) })
        .where(eq(dbModule.microsoft365TraceConnectionsTable.id, connection.id));
      await microsoft365TraceModule.syncDueMicrosoft365TraceConnections();
      assert.equal(listRequests, 2);
      assert.equal(
        detailRequests,
        4,
        "terminal traces and the deferred trace must not be polled again before their recheck time",
      );
    });
  });
});

describe("superadmin finance payment ledger", { concurrency: false }, () => {
  it("limits finance records to customer captures and applies server-side filters", async () => {
    const admin = await loggedInUser({
      username: "finance-ledger-admin",
      role: "SUPERADMIN",
    });
    const customer = await loggedInUser({
      username: "finance-ledger-customer",
      email: "customer.finance@example.test",
    });
    const disabledCustomer = await createUser({
      username: "finance-ledger-disabled",
      email: "disabled.finance@example.test",
      active: false,
    });
    const [launchPackage, growthPackage] = await db
      .insert(dbModule.subscriptionPackagesTable)
      .values([
        {
          name: "Finance Launch",
          description: "",
          amountMinor: 9900,
          currency: "INR",
          periodDays: 30,
        },
        {
          name: "Finance Growth",
          description: "",
          amountMinor: 4999,
          currency: "USD",
          periodDays: 90,
        },
      ])
      .returning();
    const baseDay = new Date(
      (Math.floor(Date.now() / 86_400_000) + 1) * 86_400_000,
    );
    const capture = async ({
      user,
      pkg,
      status = "captured",
      at,
      environment = "production",
      amountMinor,
    }) => {
      const tag = `${user.id.slice(0, 8)}-${status}-${amountMinor}`;
      const [payment] = await dbModule.db
        .insert(dbModule.paymentsTable)
        .values({
          userId: user.id,
          packageId: pkg.id,
          receipt: `finance-${tag}`,
          amountMinor,
          currency: pkg.currency,
          status,
          razorpayEnvironment: environment,
          razorpayOrderId: `order-${tag}`,
          razorpayPaymentId: `payment-${tag}`,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      if (status === "captured" || status === "refunded") {
        await dbModule.db.insert(dbModule.userSubscriptionsTable).values({
          userId: user.id,
          packageId: pkg.id,
          paymentId: payment.id,
          status: status === "refunded" ? "cancelled" : "active",
          startsAt: at,
          endsAt: new Date(at.getTime() + pkg.periodDays * 86_400_000),
          createdAt: at,
        });
      }
    };

    await capture({
      user: customer.user,
      pkg: launchPackage,
      at: new Date(baseDay.getTime() + 60 * 60_000),
      amountMinor: 9900,
    });
    await capture({
      user: customer.user,
      pkg: growthPackage,
      status: "refunded",
      at: new Date(baseDay.getTime() + 12 * 60 * 60_000),
      environment: "sandbox",
      amountMinor: 4999,
    });
    await capture({
      user: disabledCustomer,
      pkg: growthPackage,
      at: new Date(baseDay.getTime() + 26 * 60 * 60_000),
      environment: null,
      amountMinor: 4999,
    });
    await capture({
      user: customer.user,
      pkg: launchPackage,
      status: "failed",
      at: new Date(baseDay.getTime() + 18 * 60 * 60_000),
      amountMinor: 9900,
    });
    await capture({
      user: admin.user,
      pkg: launchPackage,
      at: new Date(baseDay.getTime() + 6 * 60 * 60_000),
      amountMinor: 999999,
    });

    const unauthorized = await api("/admin/finance/payments");
    assert.equal(unauthorized.response.status, 401);
    const customerDenied = await api("/admin/finance/payments", {
      cookie: customer.cookie,
    });
    assert.equal(customerDenied.response.status, 403);

    const defaultPage = await api("/admin/finance/payments", {
      cookie: admin.cookie,
    });
    assert.equal(defaultPage.response.status, 200, JSON.stringify(defaultPage.body));
    assert.equal(defaultPage.body.total, 2);
    assert.deepEqual(
      defaultPage.body.rows.map((row) => row.status),
      ["captured", "captured"],
    );
    assert.equal(defaultPage.body.rows[0].account.status, "disabled");
    assert.equal(defaultPage.body.rows[0].subscriptionPackage.name, "Finance Growth");
    assert.deepEqual(defaultPage.body.currencies, ["INR", "USD"]);
    assert.deepEqual(
      defaultPage.body.summaryByCurrency.map((summary) => [
        summary.currency,
        summary.capturedCount,
        summary.refundedCount,
        summary.capturedAmountMinor,
      ]),
      [
        ["INR", 1, 0, "9900"],
        ["USD", 1, 0, "4999"],
      ],
    );

    const allSuccessful = await api(
      "/admin/finance/payments?status=all&pageSize=100",
      { cookie: admin.cookie },
    );
    assert.equal(allSuccessful.body.total, 3);
    assert.equal(
      allSuccessful.body.summaryByCurrency.find(
        (summary) => summary.currency === "USD",
      ).refundedAmountMinor,
      "4999",
    );

    const subscriptionId = allSuccessful.body.rows.find(
      (row) => row.subscription?.id,
    ).subscription.id;
    const subscriptionSearch = await api(
      `/admin/finance/payments?search=${subscriptionId}&status=all`,
      { cookie: admin.cookie },
    );
    assert.equal(subscriptionSearch.body.total, 1);

    const planAndAccountSearch = await api(
      `/admin/finance/payments?search=Growth&status=all&packageId=${growthPackage.id}`,
      { cookie: admin.cookie },
    );
    assert.equal(planAndAccountSearch.body.total, 2);

    const amountRange = await api(
      "/admin/finance/payments?currency=USD&status=all&minAmountMinor=4999&maxAmountMinor=4999",
      { cookie: admin.cookie },
    );
    assert.equal(amountRange.body.total, 2);
    const amountWithoutCurrency = await api(
      "/admin/finance/payments?minAmountMinor=4999",
      { cookie: admin.cookie },
    );
    assert.equal(amountWithoutCurrency.response.status, 400);
    const reversedAmountRange = await api(
      "/admin/finance/payments?currency=USD&minAmountMinor=5000&maxAmountMinor=4999",
      { cookie: admin.cookie },
    );
    assert.equal(reversedAmountRange.response.status, 400);
    const amountSortWithoutCurrency = await api(
      "/admin/finance/payments?sortBy=amount",
      { cookie: admin.cookie },
    );
    assert.equal(amountSortWithoutCurrency.response.status, 400);

    const customerSearch = await api(
      "/admin/finance/payments?search=finance-ledger-customer&status=all",
      { cookie: admin.cookie },
    );
    assert.equal(customerSearch.body.total, 2);

    const oneUtcDay = await api(
      `/admin/finance/payments?fromDate=${baseDay.toISOString().slice(0, 10)}&toDate=${baseDay.toISOString().slice(0, 10)}&status=all&pageSize=100`,
      { cookie: admin.cookie },
    );
    assert.equal(oneUtcDay.body.total, 2);

    const disabledOnly = await api(
      "/admin/finance/payments?accountStatus=disabled",
      { cookie: admin.cookie },
    );
    assert.equal(disabledOnly.body.total, 1);
    const unrecordedEnvironment = await api(
      "/admin/finance/payments?environment=unrecorded",
      { cookie: admin.cookie },
    );
    assert.equal(unrecordedEnvironment.body.total, 1);
    const refundedOnly = await api(
      "/admin/finance/payments?status=refunded&currency=USD",
      { cookie: admin.cookie },
    );
    assert.equal(refundedOnly.body.total, 1);

    const secondPage = await api(
      "/admin/finance/payments?page=2&pageSize=1&sortBy=amount&sortDirection=asc&currency=USD&status=all",
      { cookie: admin.cookie },
    );
    assert.equal(secondPage.body.total, 2);
    assert.equal(secondPage.body.rows.length, 1);
    assert.equal(secondPage.body.rows[0].amountMinor, 4999);

    const invalidDate = await api(
      "/admin/finance/payments?fromDate=2026-02-30",
      { cookie: admin.cookie },
    );
    assert.equal(invalidDate.response.status, 400);
    const invalidRange = await api(
      "/admin/finance/payments?fromDate=2026-02-03&toDate=2026-02-02",
      { cookie: admin.cookie },
    );
    assert.equal(invalidRange.response.status, 400);
  });
});