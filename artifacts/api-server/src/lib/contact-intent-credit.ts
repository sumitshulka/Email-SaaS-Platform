import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { addOnEntitlementsTable, companyResearchJobsTable, db, paymentsTable, subscriptionPackagesTable, userSubscriptionsTable, usersTable } from "@workspace/db";
import { contactIntentAnalysesTable } from "@workspace/db/schema";
import { prorateAddOnAllowance } from "./add-on-entitlements";

export async function saveIntentWithResearchCredit(input: {
  userId: string; contactId: string; sourceHash: string; answers: Record<string, string>;
  intents: Array<{ intent: string; confidence: number; evidence: string[]; suggestedNextStep: string }>;
  provider: string; model: string;
}) {
  return db.transaction(async tx => {
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, input.userId)).for("update");
    const [existing] = await tx.select().from(contactIntentAnalysesTable).where(and(
      eq(contactIntentAnalysesTable.userId, input.userId), eq(contactIntentAnalysesTable.contactId, input.contactId),
      eq(contactIntentAnalysesTable.sourceHash, input.sourceHash),
    )).limit(1);
    if (existing) return { kind: "existing" as const, analysis: existing };
    const now = new Date();
    const [active] = await tx.select({
      planType: subscriptionPackagesTable.packageType, amount: subscriptionPackagesTable.amountMinor,
      limit: subscriptionPackagesTable.researchAllowance, starts: userSubscriptionsTable.startsAt, ends: userSubscriptionsTable.endsAt,
    }).from(userSubscriptionsTable).innerJoin(subscriptionPackagesTable, eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id))
      .where(and(eq(userSubscriptionsTable.userId, input.userId), eq(userSubscriptionsTable.status, "active"), lte(userSubscriptionsTable.startsAt, now), gt(userSubscriptionsTable.endsAt, now)))
      .orderBy(desc(userSubscriptionsTable.endsAt)).limit(1);
    if (!active) return { kind: "exhausted" as const };
    const [jobCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(companyResearchJobsTable).where(and(
      eq(companyResearchJobsTable.requestedBy, input.userId), gte(companyResearchJobsTable.createdAt, active.starts), lt(companyResearchJobsTable.createdAt, active.ends),
    ));
    const [intentCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(contactIntentAnalysesTable).where(and(
      eq(contactIntentAnalysesTable.userId, input.userId), eq(contactIntentAnalysesTable.creditSource, "primary"),
      gte(contactIntentAnalysesTable.analyzedAt, active.starts), lt(contactIntentAnalysesTable.analyzedAt, active.ends),
    ));
    let creditSource = "primary";
    let entitlementId: string | null = null;
    if (Number(jobCount?.count ?? 0) + Number(intentCount?.count ?? 0) >= active.limit) {
      if (active.planType !== "primary" || active.amount <= 0) return { kind: "exhausted" as const };
      const grants = await tx.select().from(addOnEntitlementsTable).where(and(
        eq(addOnEntitlementsTable.userId, input.userId), gt(addOnEntitlementsTable.researchAllowance, addOnEntitlementsTable.researchUsed),
        or(isNull(addOnEntitlementsTable.paymentId), inArray(addOnEntitlementsTable.paymentId, tx.select({ id: paymentsTable.id }).from(paymentsTable).where(eq(paymentsTable.status, "captured")))),
      )).orderBy(asc(addOnEntitlementsTable.createdAt)).for("update");
      const ids = grants.map(g => g.paymentId).filter((id): id is string => id !== null);
      const paid = ids.length ? await tx.select().from(paymentsTable).where(inArray(paymentsTable.id, ids)) : [];
      const payments = new Map(paid.map(p => [p.id, p]));
      const grant = grants.find(g => {
        const payment = g.paymentId ? payments.get(g.paymentId) : null;
        return (g.paymentId === null || payment?.status === "captured") &&
          prorateAddOnAllowance(g.researchAllowance, payment?.amountMinor ?? null, payment?.refundedAmountMinor ?? null) > g.researchUsed;
      });
      if (!grant) return { kind: "exhausted" as const };
      await tx.update(addOnEntitlementsTable).set({ researchUsed: sql`${addOnEntitlementsTable.researchUsed} + 1` }).where(eq(addOnEntitlementsTable.id, grant.id));
      creditSource = "addon"; entitlementId = grant.id;
    }
    const [analysis] = await tx.insert(contactIntentAnalysesTable).values({
      ...input, creditSource, entitlementId,
    }).onConflictDoNothing().returning();
    return analysis ? { kind: "created" as const, analysis } : { kind: "existing" as const, analysis: null };
  });
}
