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
const emailModule = await import("../src/lib/application-email.ts");
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
const emails = [];
let emailDeliveryFails = false;
emailModule.setApplicationEmailTransportForTests(async (message) => {
  emails.push(message);
  if (emailDeliveryFails) {
    throw new Error("Test email transport failure");
  }
});

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
  emails.length = 0;
  emailDeliveryFails = false;
  await db.delete(supportTicketMessagesTable);
  await db.delete(supportTicketsTable);
  await db.delete(userSessionsTable);
  await db.delete(usersTable);
});

async function api(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
  };
}

async function createUser({
  username,
  role = "USER",
  firstName = username === "support-admin" ? "Support" : "Test",
  lastName = username === "support-admin" ? "Admin" : "Customer",
  email = `${username}@example.test`,
}) {
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      firstName,
      lastName,
      email,
      passwordHash: "unused-test-password-hash",
      role,
    })
    .returning();
  return user;
}

function signedSessionCookie(token) {
  const signature = createHmac("sha256", process.env.SESSION_SECRET)
    .update(`session:${token}`)
    .digest("base64url");
  return `mailflow_session=${token}.${signature}`;
}

async function sessionCookie(user) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(userSessionsTable).values({
    userId: user.id,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return signedSessionCookie(token);
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
  it("rejects anonymous and unrecognized sessions on every customer and admin endpoint", async () => {
    const owner = await createUser({ username: "anonymous-boundary-owner" });
    const ownerCookie = await sessionCookie(owner);
    const created = await createTicket(ownerCookie);
    const ticketId = created.ticket.id;
    const unrecognizedCookie = signedSessionCookie(
      randomBytes(32).toString("base64url"),
    );
    const anonymousSessions = [
      { name: "no session cookie", cookie: undefined },
      { name: "unrecognized session", cookie: unrecognizedCookie },
    ];
    const requests = [
      {
        name: "list customer tickets",
        run: (cookie) => api("/support/tickets", { cookie }),
      },
      {
        name: "create a customer ticket",
        run: (cookie) => api("/support/tickets", {
          method: "POST",
          cookie,
          body: {
            subject: "Anonymous ticket",
            message: "This ticket must not be created.",
          },
        }),
      },
      {
        name: "view a customer ticket",
        run: (cookie) => api(`/support/tickets/${ticketId}`, { cookie }),
      },
      {
        name: "reply to a customer ticket",
        run: (cookie) => api(`/support/tickets/${ticketId}/messages`, {
          method: "POST",
          cookie,
          body: { message: "This reply must not be added." },
        }),
      },
      {
        name: "read the admin ticket queue",
        run: (cookie) => api("/admin/support/tickets", { cookie }),
      },
      {
        name: "view an admin ticket",
        run: (cookie) => api(`/admin/support/tickets/${ticketId}`, { cookie }),
      },
      {
        name: "reply as staff",
        run: (cookie) => api(`/admin/support/tickets/${ticketId}/messages`, {
          method: "POST",
          cookie,
          body: { message: "This staff reply must not be added." },
        }),
      },
      {
        name: "change ticket status",
        run: (cookie) => api(`/admin/support/tickets/${ticketId}/status`, {
          method: "PATCH",
          cookie,
          body: { status: "resolved" },
        }),
      },
    ];

    for (const session of anonymousSessions) {
      for (const request of requests) {
        const result = await request.run(session.cookie);
        assert.equal(
          result.status,
          401,
          `${session.name} must not ${request.name}: ${JSON.stringify(result.body)}`,
        );
        assert.equal(result.body.code, "UNAUTHENTICATED");
      }
    }

    const unchanged = await api(`/support/tickets/${ticketId}`, {
      cookie: ownerCookie,
    });
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.ticket.status, "open");
    assert.deepEqual(
      unchanged.body.messages.map((message) => message.message),
      ["Please review the invoice on my account."],
    );
    const customerTickets = await api("/support/tickets", {
      cookie: ownerCookie,
    });
    assert.deepEqual(
      customerTickets.body.items.map((ticket) => ticket.id),
      [ticketId],
    );
  });

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
    assert.equal(emails.length, 0);

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

  it("emails the requester a link to the ticket after a staff reply", async () => {
    const owner = await createUser({ username: "reply-notification-owner" });
    const admin = await createUser({
      username: "reply-notification-admin",
      role: "SUPERADMIN",
    });
    const ownerCookie = await sessionCookie(owner);
    const adminCookie = await sessionCookie(admin);
    const created = await createTicket(ownerCookie, {
      subject: "Help with my account",
    });
    const ticketId = created.ticket.id;

    const reply = await api(`/admin/support/tickets/${ticketId}/messages`, {
      method: "POST",
      cookie: adminCookie,
      headers: {
        "x-forwarded-host": "mailflow.example.test",
        "x-forwarded-proto": "https",
      },
      body: { message: "We have updated your account settings." },
    });

    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.messages.at(-1).message, "We have updated your account settings.");
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, owner.email);
    assert.match(emails[0].subject, /reply/i);
    assert.match(emails[0].text, /Mailflow Support replied/);
    assert.match(emails[0].text, /Help with my account/);
    const link = emails[0].text.match(/https:\/\/\S+/)?.[0];
    assert.ok(link, "notification email should contain a conversation link");
    const conversationUrl = new URL(link);
    assert.equal(conversationUrl.origin, "https://mailflow.example.test");
    assert.equal(conversationUrl.pathname, "/support");
    assert.equal(conversationUrl.searchParams.get("ticketId"), ticketId);
  });

  it("keeps a saved staff reply when notification email delivery fails", async () => {
    const owner = await createUser({ username: "reply-email-failure-owner" });
    const admin = await createUser({
      username: "reply-email-failure-admin",
      role: "SUPERADMIN",
    });
    const ownerCookie = await sessionCookie(owner);
    const adminCookie = await sessionCookie(admin);
    const created = await createTicket(ownerCookie);
    const ticketId = created.ticket.id;
    emailDeliveryFails = true;

    const reply = await api(`/admin/support/tickets/${ticketId}/messages`, {
      method: "POST",
      cookie: adminCookie,
      body: { message: "The saved reply must survive an email failure." },
    });

    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, owner.email);
    const detail = await api(`/support/tickets/${ticketId}`, {
      cookie: ownerCookie,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.ticket.status, "waiting_on_customer");
    assert.equal(detail.body.messages.at(-1).message, "The saved reply must survive an email failure.");
  });

  it("filters the admin queue by every status and searchable ticket/requester fields", async () => {
    const admin = await createUser({
      username: "support-admin",
      role: "SUPERADMIN",
    });
    const adminCookie = await sessionCookie(admin);
    const statuses = [
      "open",
      "in_progress",
      "waiting_on_customer",
      "resolved",
      "closed",
    ];
    const tickets = [];

    for (const status of statuses) {
      const owner = await createUser({
        username: `queue-${status}`,
        firstName: "Avery",
        lastName: "Nguyen",
        email: `avery.${status}@filter.test`,
      });
      const created = await createTicket(await sessionCookie(owner), {
        subject: "Refund for annual plan",
      });
      const updated = await api(
        `/admin/support/tickets/${created.ticket.id}/status`,
        {
          method: "PATCH",
          cookie: adminCookie,
          body: { status },
        },
      );
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      tickets.push({ id: created.ticket.id, status });
    }

    const idsFor = (items) => items.map((ticket) => ticket.id).sort();
    for (const status of statuses) {
      const result = await api(
        `/admin/support/tickets?${new URLSearchParams({ status })}`,
        { cookie: adminCookie },
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(
        idsFor(result.body.items),
        tickets
          .filter((ticket) => ticket.status === status)
          .map((ticket) => ticket.id)
          .sort(),
        `status=${status} must exclude tickets in every other status`,
      );
    }

    const all = await api(
      `/admin/support/tickets?${new URLSearchParams({ status: "all" })}`,
      { cookie: adminCookie },
    );
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.deepEqual(idsFor(all.body.items), idsFor(tickets));

    const searches = [
      { term: "annual plan", expected: tickets },
      { term: "Avery", expected: tickets },
      { term: "Nguyen", expected: tickets },
      { term: "Avery Nguyen", expected: tickets },
      {
        term: "AVERY.OPEN@FILTER.TEST",
        expected: tickets.filter((ticket) => ticket.status === "open"),
      },
    ];
    for (const { term, expected } of searches) {
      const result = await api(
        `/admin/support/tickets?${new URLSearchParams({
          status: "all",
          search: term,
        })}`,
        { cookie: adminCookie },
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(
        idsFor(result.body.items),
        idsFor(expected),
        `search=${term} must return only matching tickets`,
      );
    }

    const combined = await api(
      `/admin/support/tickets?${new URLSearchParams({
        status: "open",
        search: "Avery Nguyen",
      })}`,
      { cookie: adminCookie },
    );
    assert.equal(combined.status, 200, JSON.stringify(combined.body));
    assert.deepEqual(
      idsFor(combined.body.items),
      tickets
        .filter((ticket) => ticket.status === "open")
        .map((ticket) => ticket.id),
      "combined status and search filters must exclude nonmatching tickets",
    );

    const noMatches = await api(
      `/admin/support/tickets?${new URLSearchParams({
        status: "open",
        search: "not a real requester or subject",
      })}`,
      { cookie: adminCookie },
    );
    assert.equal(noMatches.status, 200, JSON.stringify(noMatches.body));
    assert.deepEqual(noMatches.body.items, []);
  });
});
