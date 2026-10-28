import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { before, after, test } from "node:test";
import express from "express";
import { DataType, newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1/microsoft_sender_test";
process.env.SESSION_SECRET = "microsoft-sender-unit-test-secret-not-for-production";
const { setTestDatabase, pool: productionPool, db, tenantSendingConfigurationTable: senders,
  microsoftSenderConnectionsTable: connections, systemConfigurationTable: configurations } = await import("@workspace/db");
const { encryptSecret, decryptSecret } = await import("../src/lib/security.ts");
const { smtpConnectionDiagnostic } = await import("../src/lib/smtp-diagnostics.ts");
const { validMicrosoftRedirect, microsoftAccessToken } = await import("../src/lib/microsoft-sender.ts");
const { sendTenantEmail } = await import("../src/lib/application-email.ts");
const { default: router } = await import("../src/routes/microsoft-sender.ts");
const memory = newDb();
memory.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, impure: true, implementation: randomUUID });
memory.public.none(`
 CREATE TABLE users(id uuid PRIMARY KEY);
 CREATE TABLE system_configuration(key varchar(100) PRIMARY KEY, value jsonb NOT NULL, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, action text NOT NULL, entity text NOT NULL, entity_id text, ip_address text, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE tenant_sending_configurations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), is_primary boolean NOT NULL DEFAULT true,
  provider varchar(32) NOT NULL DEFAULT 'other', host varchar(255) NOT NULL, port integer NOT NULL, encryption varchar(10) NOT NULL,
  username_encrypted text NOT NULL, password_encrypted text NOT NULL, from_name varchar(120) NOT NULL, from_email varchar(254) NOT NULL,
  reply_to varchar(254), inbox_host varchar(255), inbox_connected_at timestamptz, verified_at timestamptz,
  connection_check_status varchar(16), connection_check_at timestamptz, last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
 );
`);
memory.public.none(await readFile(new URL("../../../lib/db/migrations/0016_microsoft_sender_oauth.sql", import.meta.url), "utf8"));
const adapter = memory.adapters.createPg();
const testPool = new adapter.Pool();
const poolQuery = testPool.query.bind(testPool);
testPool.query = (config, ...args) => {
  const array = config && typeof config === "object" && config.rowMode === "array";
  if (config && typeof config === "object") { config = { ...config }; delete config.types; delete config.rowMode; }
  return Promise.resolve(poolQuery(config, ...args)).then(r => {
    if (array) r.rows = r.rows.map(row => Object.values(row));
    return r;
  });
};
const originalConnect = testPool.connect.bind(testPool);
testPool.connect = async () => {
  const client = await originalConnect();
  if (client.__mailflowPatched) return client;
  client.__mailflowPatched = true;
  const query = client.query.bind(client);
  client.query = (config, ...args) => {
    const array = config && typeof config === "object" && config.rowMode === "array";
    if (config && typeof config === "object") {
      config = { ...config }; delete config.types; delete config.rowMode;
    }
    const result = query(config, ...args);
    return Promise.resolve(result).then(r => {
      if (array) r.rows = r.rows.map(row => Object.values(row));
      return r;
    });
  };
  return client;
};
setTestDatabase(drizzle(testPool));
const userId = randomUUID(), otherId = randomUUID(), accountId = randomUUID();
memory.public.none(`INSERT INTO users(id) VALUES ('${userId}'), ('${otherId}')`);
let base, server, microsoftCalls = [], profileMailbox = "sender@example.com", sendResponse = 202;
const originalFetch = globalThis.fetch;
const session = "a".repeat(64);
const clientId = "11111111-1111-4111-8111-111111111111";
const request = async (path, { method = "GET", data, user = userId, role = "USER", sessionHash = session } = {}) => {
  const response = await originalFetch(`${base}${path}`, { method, redirect: "manual",
    headers: { "content-type": "application/json", "x-test-user": user, "x-test-role": role, "x-test-session": sessionHash },
    ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: response.status, location: response.headers.get("location"),
    body: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
};
before(async () => {
  await db.insert(senders).values({ id: accountId, userId, provider: "microsoft_365", host: "smtp.office365.com", port: 587,
    encryption: "tls", usernameEncrypted: encryptSecret("sender@example.com"), passwordEncrypted: encryptSecret(" password with spaces "),
    fromName: "Sender", fromEmail: "sender@example.com" });
  const app = express(); app.use(express.json()); app.use((req, _res, next) => {
    req.authUser = { id: req.get("x-test-user") || userId, role: req.get("x-test-role") || "USER", mustChangeCredentials: false };
    req.sessionTokenHash = req.get("x-test-session") || session;
    req.log = { warn() {} }; next();
  }); app.use("/api", router);
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = async (url, init = {}) => {
    microsoftCalls.push({ url: String(url), init });
    if (String(url).includes("/oauth2/v2.0/token")) return Response.json({ access_token: "test-access", refresh_token: "test-refresh-rotated", expires_in: 3600, scope: "User.Read Mail.Send" });
    if (String(url).includes("/me?")) return Response.json({ mail: profileMailbox, userPrincipalName: profileMailbox });
    if (String(url).endsWith("/me/sendMail")) return new Response(null, { status: sendResponse });
    throw new Error("Unexpected external request in test");
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise(resolve => server.close(resolve)); await testPool.end(); await productionPool.end();
});

test("diagnostics distinguish policy, credentials, network, DNS and TLS without echoing provider secrets", () => {
  const policy = smtpConnectionDiagnostic({ code: "EAUTH", response: "535 5.7.139 SmtpClientAuthentication is disabled for tenant secret@invalid.example" }, true);
  assert.equal(policy.code, "SMTP_AUTH_BLOCKED"); assert.doesNotMatch(policy.error, /secret@/);
  assert.match(smtpConnectionDiagnostic({ code: "EAUTH" }, true).error, /does not necessarily mean the password is wrong/);
  assert.match(smtpConnectionDiagnostic({ code: "EAUTH" }, true).error, /app password only if/);
  assert.equal(smtpConnectionDiagnostic({ code: "ETIMEDOUT" }, true).code, "SMTP_NETWORK_FAILURE");
  assert.equal(smtpConnectionDiagnostic({ code: "ENOTFOUND" }, true).code, "SMTP_DNS_FAILURE");
  assert.equal(smtpConnectionDiagnostic({ code: "ESOCKET", message: "certificate expired" }, true).code, "SMTP_TLS_FAILURE");
});
test("callback URI validation rejects unsafe URLs", () => {
  assert.equal(validMicrosoftRedirect("https://mail.example/api/sending/microsoft/oauth/callback"), true);
  for (const url of ["http://mail.example/api/sending/microsoft/oauth/callback", "https://user:pass@mail.example/api/sending/microsoft/oauth/callback", "https://mail.example/wrong", "https://mail.example/api/sending/microsoft/oauth/callback?token=bad"]) assert.equal(validMicrosoftRedirect(url), false);
});
test("global app setup is superadmin-only, encrypted, reusable, and never returns the secret", async () => {
  const data = { enabled: true, clientId, clientSecret: "synthetic-client-secret", redirectUri: `${base}/api/sending/microsoft/oauth/callback` };
  assert.equal((await request("/api/admin/settings/microsoft-oauth", { method: "PUT", data })).status, 403);
  const result = await request("/api/admin/settings/microsoft-oauth", { method: "PUT", data, role: "SUPERADMIN" });
  assert.equal(result.status, 200); assert.equal(result.body.configured, true);
  assert.doesNotMatch(JSON.stringify(result.body), /synthetic-client-secret|clientSecretEncrypted/);
  const [config] = await db.select().from(configurations);
  assert.notEqual(config.value.clientSecretEncrypted, data.clientSecret);
  assert.equal(decryptSecret(config.value.clientSecretEncrypted), data.clientSecret);
  const preserved = await request("/api/admin/settings/microsoft-oauth", { method: "PUT", role: "SUPERADMIN", data: { ...data, clientSecret: "" } });
  assert.equal(preserved.status, 200); assert.equal(preserved.body.clientSecretConfigured, true);
});
test("sender connection and authorize enforce tenant ownership", async () => {
  for (const suffix of ["connection", "authorize"]) {
    assert.equal((await request(`/api/sending/accounts/${accountId}/microsoft/${suffix}`, { method: suffix === "authorize" ? "POST" : "GET", user: otherId })).status, 404);
  }
});
let authorizationState;
test("authorization uses PKCE, fixed scopes, state and the saved mailbox; wrong session cannot consume it", async () => {
  const result = await request(`/api/sending/accounts/${accountId}/microsoft/authorize`, { method: "POST" });
  assert.equal(result.status, 200);
  const url = new URL(result.body.authorizationUrl); authorizationState = url.searchParams.get("state");
  assert.equal(url.origin, "https://login.microsoftonline.com"); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("scope"), /Mail.Send/); assert.doesNotMatch(url.searchParams.get("scope"), /Mail.Read/);
  const wrong = await request(`/api/sending/microsoft/oauth/callback?state=${authorizationState}&code=synthetic-code`, { sessionHash: "b".repeat(64) });
  assert.match(wrong.location, /microsoft=expired/);
  assert.equal(microsoftCalls.length, 0);
});
test("callback connects only the intended sender, preserves password, requires a test send, and blocks replay", async () => {
  const result = await request(`/api/sending/microsoft/oauth/callback?state=${authorizationState}&code=synthetic-code`);
  assert.equal(result.status, 303); assert.match(result.location, /microsoft=connected/); assert.match(result.location, new RegExp(accountId));
  const [sender] = await db.select().from(senders).where(eq(senders.id, accountId));
  assert.equal(sender.authenticationMethod, "microsoft_oauth"); assert.equal(sender.verifiedAt, null);
  assert.equal(sender.connectionCheckStatus, "success");
  assert.equal(decryptSecret(sender.passwordEncrypted), " password with spaces ");
  const callCount = microsoftCalls.length;
  assert.match((await request(`/api/sending/microsoft/oauth/callback?state=${authorizationState}&code=synthetic-code`)).location, /expired/);
  assert.equal(microsoftCalls.length, callCount);
  assert.equal((await request(`/api/sending/accounts/${accountId}/microsoft/connection`)).body.connected, true);
});
test("a different Microsoft mailbox cannot overwrite the existing connection", async () => {
  const auth = await request(`/api/sending/accounts/${accountId}/microsoft/authorize`, { method: "POST" });
  const state = new URL(auth.body.authorizationUrl).searchParams.get("state");
  profileMailbox = "different@example.com";
  const result = await request(`/api/sending/microsoft/oauth/callback?state=${state}&code=synthetic-code`);
  assert.match(result.location, /mailbox-mismatch/);
  const [connection] = await db.select().from(connections);
  assert.equal(connection.mailbox, "sender@example.com"); profileMailbox = connection.mailbox;
});
test("expired tokens refresh once and persist rotated credentials encrypted", async () => {
  await db.update(connections).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(connections.accountId, accountId));
  const before = microsoftCalls.length;
  assert.equal(await microsoftAccessToken(accountId, userId), "test-access");
  assert.equal(microsoftCalls.length, before + 1);
  const [connection] = await db.select().from(connections);
  assert.equal(decryptSecret(connection.refreshTokenEncrypted), "test-refresh-rotated");
  assert.ok(connection.expiresAt.getTime() > Date.now());
});
test("worker transport preserves MIME PDF attachments, sender, unsubscribe header and message ID", async () => {
  const [sender] = await db.select().from(senders).where(eq(senders.id, accountId));
  const result = await sendTenantEmail(sender, "recipient@example.com", "Microsoft test", "Test body", undefined, {
    attemptId: randomUUID(), messageId: "<microsoft-test@mailflow.local>", dsnRequested: false,
    headers: { "List-Unsubscribe": "<https://example.com/unsubscribe>" },
    attachments: [{ filename: "test.pdf", content: Buffer.from("%PDF-1.4 test attachment"), contentType: "application/pdf" }],
  });
  assert.equal(result.accepted, true); assert.equal(result.smtpResponse, undefined);
  const send = microsoftCalls.findLast(c => c.url.endsWith("/me/sendMail"));
  const mime = Buffer.from(send.init.body, "base64").toString();
  assert.match(mime, /application\/pdf/); assert.match(mime, /test\.pdf/); assert.match(mime, /List-Unsubscribe/);
  assert.match(mime, /microsoft-test@mailflow\.local/); assert.match(mime, /sender@example\.com/);
});
test("Microsoft throttling and interrupted submissions carry distinct retry evidence", async () => {
  const [sender] = await db.select().from(senders).where(eq(senders.id, accountId));
  sendResponse = 429;
  await assert.rejects(sendTenantEmail(sender, "recipient@example.com", "Test", "Test"), e => {
    assert.equal(e.deliveryUncertain, false); assert.ok(e.retryAfterMs >= 60_000); return true;
  });
  sendResponse = 503;
  await assert.rejects(sendTenantEmail(sender, "recipient@example.com", "Test", "Test"), e => {
    assert.equal(e.deliveryUncertain, true); assert.equal(e.retryAfterMs, undefined); return true;
  });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network timeout containing synthetic secret"); };
  await assert.rejects(sendTenantEmail(sender, "recipient@example.com", "Test", "Test"), e => {
    assert.equal(e.deliveryUncertain, true); assert.doesNotMatch(e.message, /synthetic secret/); return true;
  });
  globalThis.fetch = savedFetch; sendResponse = 202;
});
test("oversized Microsoft MIME messages fail before any submission", async () => {
  const [sender] = await db.select().from(senders).where(eq(senders.id, accountId));
  const before = microsoftCalls.length;
  await assert.rejects(sendTenantEmail(sender, "recipient@example.com", "Test", "Test", undefined, {
    attachments: [{ filename: "large.pdf", content: Buffer.alloc(3 * 1024 * 1024), contentType: "application/pdf" }],
  }), e => { assert.equal(e.code, "MICROSOFT_MESSAGE_TOO_LARGE"); assert.equal(e.deliveryUncertain, false); return true; });
  assert.equal(microsoftCalls.length, before);
});
test("rejected Microsoft sends are not retried and disconnect clears campaign verification", async () => {
  const [sender] = await db.select().from(senders).where(eq(senders.id, accountId));
  sendResponse = 403; const before = microsoftCalls.length;
  await assert.rejects(sendTenantEmail(sender, "recipient@example.com", "Test", "Test"), /Microsoft blocked sending/);
  assert.equal(microsoftCalls.length, before + 1); sendResponse = 202;
  assert.equal((await request(`/api/sending/accounts/${accountId}/microsoft/connection`, { method: "DELETE" })).body.connected, false);
  const [disconnected] = await db.select().from(senders).where(eq(senders.id, accountId));
  assert.equal(disconnected.authenticationMethod, "password"); assert.equal(disconnected.verifiedAt, null);
  assert.equal((await db.select().from(connections)).length, 0);
});
