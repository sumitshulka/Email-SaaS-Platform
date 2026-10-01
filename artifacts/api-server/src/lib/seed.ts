import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hashPassword } from "./security";

export async function ensureSeedSuperadmin(): Promise<void> {
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "SUPERADMIN"),
        isNull(usersTable.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return;

  const [usernameConflict] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.username, "superadmin"), isNull(usersTable.deletedAt)))
    .limit(1);
  if (usernameConflict) {
    throw new Error(
      "Cannot seed the superadmin: the username 'superadmin' is already assigned to a customer account.",
    );
  }

  await db.insert(usersTable).values({
    username: "superadmin",
    firstName: "Platform",
    lastName: "Administrator",
    email: "superadmin@mailflow.local",
    passwordHash: await hashPassword("superadmin123"),
    role: "SUPERADMIN",
    timezone: "Asia/Kolkata",
    active: true,
    emailVerified: true,
    mustChangeCredentials: true,
  });
}