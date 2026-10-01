import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const productionDb = drizzle(pool, { schema });
let activeDb = productionDb;

export const db = new Proxy(productionDb, {
  get(_target, property) {
    const value = Reflect.get(activeDb, property, activeDb);
    return typeof value === "function" ? value.bind(activeDb) : value;
  },
}) as typeof productionDb;

export function setTestDatabase(testDatabase: typeof productionDb): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A test database can only be configured in test mode.");
  }
  activeDb = testDatabase;
}

export * from "./schema";
