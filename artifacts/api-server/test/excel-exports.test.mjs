import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { DataType, newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import ExcelJS from "exceljs";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://excel-export-test:excel-export-test@127.0.0.1/excel_export_test";

const memory = newDb({ autoCreateForeignKeyIndices: true });
memory.public.registerFunction({
  name: "gen_random_uuid",
  returns: DataType.uuid,
  implementation: () => randomUUID(),
  impure: true,
});
memory.public.none(`
  CREATE TABLE contacts (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
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
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE companies (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
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
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE contact_lists (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    name varchar(120) NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE contact_list_members (
    user_id uuid NOT NULL,
    list_id uuid NOT NULL,
    contact_id uuid NOT NULL,
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
  return connection?.then ? connection.then(adaptMemoryQuery) : adaptMemoryQuery(connection);
};

const testDb = drizzle(memoryPool, { schema });
const dbModule = await import("@workspace/db");
dbModule.setTestDatabase(testDb);
const {
  contactsTable,
  companiesTable,
  contactListsTable,
  contactListMembersTable,
} = dbModule;
const [{ default: companiesRouter }, { default: sendingRouter }] =
  await Promise.all([
    import("../src/routes/companies.ts"),
    import("../src/routes/sending.ts"),
  ]);

const ownerId = "10000000-0000-4000-8000-000000000001";
const otherTenantId = "10000000-0000-4000-8000-000000000002";
const sameSortDate = new Date("2026-01-01T00:00:00.000Z");
const rowCount = 257;
let server;
let baseUrl;

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

function workbookRows(workbook) {
  const rows = [];
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      rows.push(row.values.slice(1));
    });
  }
  return rows;
}

async function exportWorkbook(path, userId, body) {
  const response = await fetch(`${baseUrl}/api/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
    },
    body: JSON.stringify(body),
  });
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    assert.fail(`Export failed with ${response.status}: ${responseBytes.toString()}`);
  }
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\b/,
    `Unexpected export response headers (${response.status}): ${JSON.stringify(
      [...response.headers],
    )}`,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(responseBytes);
  return workbookRows(workbook);
}

describe("large contact and company Excel exports", { concurrency: false }, () => {
  before(async () => {
    const contactRows = Array.from({ length: rowCount }, (_, index) => {
      const number = index + 1;
      return {
        id: uuid("20000000", number),
        userId: ownerId,
        companyId:
          number === 8
            ? uuid("40000000", 1)
            : number === 7
              ? uuid("50000000", 1)
              : null,
        name: `Owner contact ${String(number).padStart(3, "0")}`,
        email: `owner-${String(number).padStart(3, "0")}@example.test`,
        ...(number === 7
          ? {
              companyName: "Legacy fallback company",
              companyIndustry: "Legacy fallback industry",
            }
          : {}),
        subscribed: number % 2 === 0,
        createdAt: sameSortDate,
      };
    });
    contactRows.push(
      ...Array.from({ length: 5 }, (_, index) => ({
        id: uuid("30000000", index + 1),
        userId: otherTenantId,
        name: `Other tenant contact ${index + 1}`,
        email: `other-${index + 1}@example.test`,
        subscribed: true,
        createdAt: sameSortDate,
      })),
    );
    await testDb.insert(contactsTable).values(contactRows);

    const companyRows = Array.from({ length: rowCount }, (_, index) => {
      const number = index + 1;
      return {
        id: uuid("40000000", number),
        userId: ownerId,
        companyName: number === 1 ? "Owner boundary company" : "Boundary Company",
        companyIndustry:
          number === 1
            ? "Clean energy"
            : number % 2 === 0
              ? "Software"
              : "Healthcare",
        createdAt: sameSortDate,
      };
    });
    companyRows.push(
      ...Array.from({ length: 7 }, (_, index) => ({
        id: uuid("50000000", index + 1),
        userId: otherTenantId,
        companyName:
          index === 0 ? "Private tenant company" : "Boundary Company",
        companyIndustry: index === 0 ? "Private industry" : "Software",
        createdAt: sameSortDate,
      })),
    );
    await testDb.insert(companiesTable).values(companyRows);

    const ownerListId = uuid("60000000", 1);
    const otherTenantListId = uuid("70000000", 1);
    await testDb.insert(contactListsTable).values([
      { id: ownerListId, userId: ownerId, name: "Owner boundary list" },
      {
        id: otherTenantListId,
        userId: otherTenantId,
        name: "Private tenant list",
      },
    ]);
    await testDb.insert(contactListMembersTable).values([
      {
        userId: ownerId,
        listId: ownerListId,
        contactId: uuid("20000000", 8),
      },
      {
        userId: ownerId,
        listId: ownerListId,
        contactId: uuid("20000000", 7),
      },
      {
        userId: otherTenantId,
        listId: ownerListId,
        contactId: uuid("20000000", 7),
      },
      {
        userId: ownerId,
        listId: otherTenantListId,
        contactId: uuid("20000000", 7),
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.authUser = {
        id: req.get("x-test-user-id"),
        role: "USER",
        mustChangeCredentials: false,
      };
      req.log = { error() {} };
      next();
    });
    app.use("/api", companiesRouter, sendingRouter);
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

  it("exports every contact across the 250-row boundary with requested columns and tenant filters", async () => {
    const columns = ["id", "email", "name"];
    const allRows = await exportWorkbook("contacts/export", ownerId, {
      scope: "all",
      filters: { status: "unsubscribed" },
      columns,
    });
    const expectedContacts = Array.from({ length: rowCount }, (_, index) => {
      const number = index + 1;
      return [
        uuid("20000000", number),
        `owner-${String(number).padStart(3, "0")}@example.test`,
        `Owner contact ${String(number).padStart(3, "0")}`,
      ];
    });

    assert.deepEqual(allRows[0], ["Contact ID", "Email", "Name"]);
    assert.equal(allRows.length - 1, rowCount);
    assert.deepEqual(
      new Set(allRows.slice(1).map((row) => row[0])),
      new Set(expectedContacts.map((row) => row[0])),
    );
    assert.ok(allRows.slice(1).every((row) => row.length === columns.length));

    const filteredRows = await exportWorkbook("contacts/export", ownerId, {
      scope: "filtered",
      filters: { status: "subscribed" },
      columns,
    });
    const expectedSubscribed = expectedContacts.filter((_, index) => (index + 1) % 2 === 0);
    assert.deepEqual(filteredRows[0], ["Contact ID", "Email", "Name"]);
    assert.equal(filteredRows.length - 1, expectedSubscribed.length);
    assert.deepEqual(
      new Set(filteredRows.slice(1).map((row) => row[0])),
      new Set(expectedSubscribed.map((row) => row[0])),
    );
  });

  it("keeps linked company and list values accurate across the 250-row boundary", async () => {
    const columns = ["id", "email", "listNames", "companyName", "companyIndustry"];
    const rows = await exportWorkbook("contacts/export", ownerId, {
      scope: "all",
      columns,
    });

    assert.deepEqual(rows[0], [
      "Contact ID",
      "Email",
      "Lists",
      "Company",
      "Company industry",
    ]);
    assert.equal(rows.length - 1, rowCount);
    assert.deepEqual(rows[250], [
      uuid("20000000", 8),
      "owner-008@example.test",
      "Owner boundary list",
      "Owner boundary company",
      "Clean energy",
    ]);
    assert.deepEqual(rows[251], [
      uuid("20000000", 7),
      "owner-007@example.test",
      "Owner boundary list",
      "Legacy fallback company",
      "Legacy fallback industry",
    ]);
    assert.equal(rows[250].length, columns.length);
    assert.equal(rows[251].length, columns.length);
    assert.doesNotMatch(
      JSON.stringify([rows[250], rows[251]]),
      /Private tenant company|Private industry|Private tenant list/,
    );
  });

  it("exports every company across the 250-row boundary with requested columns and tenant filters", async () => {
    const columns = ["id", "companyName", "companyIndustry"];
    const allRows = await exportWorkbook("companies/export", ownerId, {
      scope: "all",
      filters: { industry: "Software" },
      columns,
    });
    const expectedIds = Array.from({ length: rowCount }, (_, index) =>
      uuid("40000000", index + 1),
    );

    assert.deepEqual(allRows[0], ["Company ID", "Company name", "Industry"]);
    assert.equal(allRows.length - 1, rowCount);
    assert.deepEqual(
      new Set(allRows.slice(1).map((row) => row[0])),
      new Set(expectedIds),
    );
    assert.ok(allRows.slice(1).every((row) => row.length === columns.length));

    const filteredRows = await exportWorkbook("companies/export", ownerId, {
      scope: "filtered",
      filters: { industry: "Software" },
      columns,
    });
    const expectedSoftwareIds = expectedIds.filter((_, index) => (index + 1) % 2 === 0);
    assert.deepEqual(filteredRows[0], ["Company ID", "Company name", "Industry"]);
    assert.equal(filteredRows.length - 1, expectedSoftwareIds.length);
    assert.deepEqual(
      new Set(filteredRows.slice(1).map((row) => row[0])),
      new Set(expectedSoftwareIds),
    );
  });
});
