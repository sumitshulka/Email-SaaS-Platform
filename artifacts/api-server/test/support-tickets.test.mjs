import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { DataType, newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://support-test:support-test@127.0.0.1/support_test";
process.env.SESSION_SECRET = "isolated-support-test-session-secret";
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
  CREATE TYPE support_ticket_status AS ENUM (
    'open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'
  );

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

  CREATE TABLE system_configuration (
    key varchar(100) PRIMARY KEY,
    value jsonb NOT NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE support_tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject varchar(160) NOT NULL,
    status support_ticket_status NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE support_ticket_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    author_role user_role NOT NULL,
    message text NOT NULL,
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
    const queryText = typeof config === "string" ? config : config?.text ?? "";
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
  return connection?.then
    ? connection.then(adaptMemoryQuery)
    : adaptMemoryQuery(connection);
};

const testDb = drizzle(memoryPool, { schema });
const dbModule = await import("@workspace/db");
dbModule.setTestDatabase(testDb);
const { default: app } = await import("../src/app.ts");
const {
  db,
  supportTicketMessagesTable,
  supportTicketsTable,
  userSessionsTable,
  usersTable,
} = dbModule;

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  dbModule.pool.on("error", () => {});
  await dbModule.pool.end();
  await memoryPool.end();
});

beforeEach(async () => {
  await db.delete(supportTicketMessagesTable);
  await db.delete(supportTicketsTable);
  await db.delete(userSessionsTable);
  await db.delete(usersTable);
});

async function api(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
  };
}

async function createUser({ username, role = "USER" }) {
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      firstName: username === "support-admin" ? "Support" : "Test",
      lastName: username === "support-admin" ? "Admin" : "Customer",
      email: `${username}@example.test`,
      passwordHash: "unused-test-password-hash",
      role,
    })
    .returning();
  return user;
}

async function sessionCookie(user) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(userSessionsTable).values({
    userId: user.id,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  const signature = createHmac("sha256", process.env.SESSION_SECRET)
    .update(`session:${token}`)
    .digest("base64url");
  return `mailflow_session=${token}.${signature}`;
}

async function createTicket(cookie, overrides = {}) {
  const result = await api("/support/tickets", {
    method: "POST",
    cookie,
    body: {
      subject: "Billing question",
      message: "Please review the invoice on my account.",
      ...overrides,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

describe("support ticket access boundaries", { concurrency: false }, () => {
  it("keeps another customer's ticket out of their list, detail, and replies", async () => {
    const owner = await createUser({ username: "ticket-owner" });
    const otherCustomer = await createUser({ username: "different-customer" });
    const ownerCookie = await sessionCookie(owner);
    const otherCookie = await sessionCookie(otherCustomer);
    const created = await createTicket(ownerCookie);
    const ticketId = created.ticket.id;

    const ownerList = await api("/support/tickets", { cookie: ownerCookie });
    const otherList = await api("/support/tickets", { cookie: otherCookie });
    const otherDetail = await api(`/support/tickets/${ticketId}`, {
      cookie: otherCookie,
    });
    const otherReply = await api(`/support/tickets/${ticketId}/messages`, {
      method: "POST",
      cookie: otherCookie,
      body: { message: "This reply must not be added." },
    });

    assert.equal(ownerList.status, 200);
    assert.deepEqual(ownerList.body.items.map((ticket) => ticket.id), [ticketId]);
    assert.equal(otherList.status, 200);
    assert.deepEqual(otherList.body.items, []);
    assert.equal(otherDetail.status, 404);
    assert.equal(otherDetail.body.code, "SUPPORT_TICKET_NOT_FOUND");
    assert.equal(otherReply.status, 404);
    assert.equal(otherReply.body.code, "SUPPORT_TICKET_NOT_FOUND");

    const ownerDetail = await api(`/support/tickets/${ticketId}`, {
      cookie: ownerCookie,
    });
    assert.equal(ownerDetail.status, 200);
    assert.equal(ownerDetail.body.ticket.status, "open");
    assert.deepEqual(
      ownerDetail.body.messages.map((message) => message.message),
      ["Please review the invoice on my account."],
    );
  });

  it("blocks customers from admin queue, ticket replies, and status updates", async () => {
    const owner = await createUser({ username: "admin-boundary-owner" });
    const customer = await createUser({ username: "admin-boundary-customer" });
    const ownerCookie = await sessionCookie(owner);
    const customerCookie = await sessionCookie(customer);
    const created = await createTicket(ownerCookie);
    const ticketId = created.ticket.id;

    const queue = await api("/admin/support/tickets", {
      cookie: customerCookie,
    });
    const detail = await api(`/admin/support/tickets/${ticketId}`, {
      cookie: customerCookie,
    });
    const reply = await api(`/admin/support/tickets/${ticketId}/messages`, {
      method: "POST",
      cookie: customerCookie,
      body: { message: "An unauthorized staff response." },
    });
    const status = await api(`/admin/support/tickets/${ticketId}/status`, {
      method: "PATCH",
      cookie: customerCookie,
      body: { status: "resolved" },
    });

    for (const result of [queue, detail, reply, status]) {
      assert.equal(result.status, 403, JSON.stringify(result.body));
      assert.equal(result.body.code, "FORBIDDEN");
    }

    const unchanged = await api(`/support/tickets/${ticketId}`, {
      cookie: ownerCookie,
    });
    assert.equal(unchanged.body.ticket.status, "open");
    assert.equal(unchanged.body.messages.length, 1);
  });

  it("allows superadmins to manage tickets and applies reply-driven statuses", async () => {
    const owner = await createUser({ username: "status-flow-owner" });
    const admin = await createUser({
      username: "support-admin",
      role: "SUPERADMIN",
    });
    const ownerCookie = await sessionCookie(owner);
    const adminCookie = await sessionCookie(admin);
    const created = await createTicket(ownerCookie);
    const ticketId = created.ticket.id;

    const queue = await api("/admin/support/tickets", {
      cookie: adminCookie,
    });
    assert.equal(queue.status, 200);
    assert.equal(
      queue.body.items.some((ticket) => ticket.id === ticketId),
      true,
    );

    const adminDetail = await api(`/admin/support/tickets/${ticketId}`, {
      cookie: adminCookie,
    });
    assert.equal(adminDetail.status, 200);
    assert.equal(adminDetail.body.ticket.requesterEmail, owner.email);

    const resolved = await api(`/admin/support/tickets/${ticketId}/status`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { status: "resolved" },
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.ticket.status, "resolved");

    const customerReply = await api(`/support/tickets/${ticketId}/messages`, {
      method: "POST",
      cookie: ownerCookie,
      body: { message: "I have added the requested details." },
    });
    assert.equal(customerReply.status, 200);
    assert.equal(customerReply.body.ticket.status, "open");
    assert.equal(customerReply.body.messages.at(-1).authorRole, "USER");

    const adminReply = await api(`/admin/support/tickets/${ticketId}/messages`, {
      method: "POST",
      cookie: adminCookie,
      body: { message: "Thanks, we are reviewing the invoice." },
    });
    assert.equal(adminReply.status, 200);
    assert.equal(adminReply.body.ticket.status, "waiting_on_customer");
    assert.equal(adminReply.body.messages.at(-1).authorRole, "SUPERADMIN");

    const customerView = await api(`/support/tickets/${ticketId}`, {
      cookie: ownerCookie,
    });
    assert.equal(customerView.status, 200);
    assert.equal(customerView.body.ticket.status, "waiting_on_customer");
    assert.equal(customerView.body.messages.at(-1).authorName, "Mailflow Support");

    const closed = await api(`/admin/support/tickets/${ticketId}/status`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { status: "closed" },
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.ticket.status, "closed");
  });
});
