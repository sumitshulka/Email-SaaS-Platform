import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { test } from "node:test";

const enabled = process.env.RUN_REPORT_WORKAREA_DB_TESTS === "1";

test("saved reports stay tenant-owned and run through shared export/query paths", {
  skip: !enabled ? "Set RUN_REPORT_WORKAREA_DB_TESTS=1 to run against a disposable test database." : false,
}, async () => {
  const [
    { db, usersTable, savedReportDefinitionsTable },
    { default: reportWorkareaRouter },
  ] = await Promise.all([
    import("@workspace/db"),
    import("../src/routes/report-workarea.ts"),
  ]);
  const userIds = [randomUUID(), randomUUID()];
  const users = userIds.map((id, index) => ({
    id,
    username: `report_route_${id.slice(0, 8)}`,
    firstName: "Report",
    lastName: `Route${index}`,
    email: `report-route-${id}@example.invalid`,
    passwordHash: "unused-test-hash",
    role: "USER",
    timezone: "UTC",
    emailVerified: true,
  }));
  const servers = [];
  const apps = users.map(user => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.authUser = {
        ...user,
        role: "USER",
        mustChangeCredentials: false,
      };
      next();
    });
    app.use(reportWorkareaRouter);
    const server = app.listen(0);
    servers.push(server);
    return new Promise(resolve => server.once("listening", () => resolve(server)));
  });

  async function call(server, path, method = "GET", body) {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = response.status === 204 ? "" : await response.text();
    let data = null;
    if (response.headers.get("content-type")?.startsWith("text/csv")) {
      data = raw;
    } else {
      try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    }
    return { response, data };
  }

  try {
    await db.insert(usersTable).values(users);
    const [ownerServer, otherServer] = await Promise.all(apps);
    const definition = {
      version: 1,
      baseEntityId: "contacts",
      columns: [{ fieldId: "contacts.email" }],
    };
    const created = await call(ownerServer, "/report-workarea/saved", "POST", {
      name: "Route ownership check",
      category: "Tests",
      definition,
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    const reportId = created.data.id;

    assert.equal((await call(ownerServer, "/report-workarea/saved")).data.reports.length, 1);
    assert.equal((await call(otherServer, "/report-workarea/saved")).data.reports.length, 0);
    assert.equal((await call(otherServer, `/report-workarea/saved/${reportId}`)).response.status, 404);
    assert.equal((await call(otherServer, `/report-workarea/saved/${reportId}`, "PATCH", { name: "Stolen" })).response.status, 404);
    assert.equal((await call(otherServer, `/report-workarea/saved/${reportId}`, "DELETE")).response.status, 404);

    const duplicateName = await call(ownerServer, "/report-workarea/saved", "POST", {
      name: "route ownership check",
      definition,
    });
    assert.equal(duplicateName.response.status, 409);

    const run = await call(ownerServer, "/report-workarea/run", "POST", {
      savedReportId: reportId,
      definition: { version: 1, baseEntityId: "contacts", columns: [{ fieldId: "contacts.email" }] },
      page: 1,
      pageSize: 10,
    });
    assert.equal(run.response.status, 200, JSON.stringify(run.data));
    assert.equal(run.data.totalRows, 0);

    const csv = await call(ownerServer, "/report-workarea/export/csv", "POST", { definition });
    assert.equal(csv.response.status, 200);
    assert.match(String(csv.data), /^"Email"/);
    const xlsx = await call(ownerServer, "/report-workarea/export/xlsx", "POST", { definition });
    assert.equal(xlsx.response.status, 200);
    assert.match(xlsx.response.headers.get("content-type"), /spreadsheetml/);

    const deleted = await call(ownerServer, `/report-workarea/saved/${reportId}`, "DELETE");
    assert.equal(deleted.response.status, 204);
    assert.equal((await call(ownerServer, `/report-workarea/saved/${reportId}`)).response.status, 404);
  } finally {
    for (const server of servers) {
      await new Promise(resolve => server.close(resolve));
    }
    await db.delete(savedReportDefinitionsTable).where(eq(savedReportDefinitionsTable.userId, userIds[0]));
    await db.delete(savedReportDefinitionsTable).where(eq(savedReportDefinitionsTable.userId, userIds[1]));
    await db.delete(usersTable).where(eq(usersTable.id, userIds[0]));
    await db.delete(usersTable).where(eq(usersTable.id, userIds[1]));
  }
});
