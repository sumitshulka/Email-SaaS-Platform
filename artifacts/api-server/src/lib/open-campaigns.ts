import { and, count, desc, eq, gt, lte } from "drizzle-orm";
import {
  db, emailCampaignsTable, openCampaignAudienceTable,
  subscriptionPackagesTable, userSubscriptionsTable,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OpenRecipient = { email: string; firstName?: string; lastName?: string };

export function normalizeOpenRecipients(rows: OpenRecipient[]): OpenRecipient[] {
  const unique = new Map<string, OpenRecipient>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Every uploaded recipient must have a valid email address.");
    }
    const firstName = (row.firstName ?? "").trim();
    const lastName = (row.lastName ?? "").trim();
    if (firstName.length > 100 || lastName.length > 100) throw new Error("Recipient names must be 100 characters or fewer.");
    if (!unique.has(email)) unique.set(email, { email, firstName, lastName });
  }
  if (!unique.size) throw new Error("Upload at least one recipient.");
  return [...unique.values()];
}

export function openCampaignPlaceholderError(rows: OpenRecipient[], content: string): string | null {
  for (const match of content.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)) {
    if (!["email", "firstName", "lastName", "fullName"].includes(match[1]!)) {
      return `The {{${match[1]}}} placeholder is not available for uploaded recipients.`;
    }
  }
  const available = {
    firstName: rows.length > 0 && rows.every(row => !!row.firstName?.trim()),
    lastName: rows.length > 0 && rows.every(row => !!row.lastName?.trim()),
  };
  for (const [field, present] of Object.entries(available)) {
    const alias = field === "firstName" ? "first_name" : "last_name";
    if (!present && new RegExp(`\\{\\{\\s*(?:${field}|${alias})\\s*\\}\\}`, "i").test(content)) {
      return `Remove the ${field} placeholder or provide that name for every uploaded recipient.`;
    }
  }
  if ((!available.firstName || !available.lastName) && /\{\{\s*fullName\s*\}\}/i.test(content)) {
    return "Remove the fullName placeholder or provide first and last names for every uploaded recipient.";
  }
  if (/\{\{\s*(?:companyName|company_name|phoneNumber|phone_number|linkedinUrl|linkedin_url)\s*\}\}/i.test(content)) {
    return "Company, phone and profile placeholders are not available for uploaded recipients.";
  }
  return null;
}

export async function openCampaignAllowance(userId: string, tx: Tx | typeof db = db) {
  const now = new Date();
  const [term] = await tx.select({
    id: userSubscriptionsTable.id,
    endsAt: userSubscriptionsTable.endsAt,
    allowance: subscriptionPackagesTable.openCampaignAllowance,
    recipientLimit: subscriptionPackagesTable.openCampaignRecipientLimit,
  }).from(userSubscriptionsTable)
    .innerJoin(subscriptionPackagesTable, eq(subscriptionPackagesTable.id, userSubscriptionsTable.packageId))
    .where(and(
      eq(userSubscriptionsTable.userId, userId),
      eq(userSubscriptionsTable.status, "active"),
      lte(userSubscriptionsTable.startsAt, now),
      gt(userSubscriptionsTable.endsAt, now),
      eq(subscriptionPackagesTable.packageType, "primary"),
    )).orderBy(desc(userSubscriptionsTable.endsAt)).limit(1);
  const [usage] = term ? await tx.select({ value: count() }).from(emailCampaignsTable)
    .where(and(eq(emailCampaignsTable.userId, userId), eq(emailCampaignsTable.openCampaignSubscriptionId, term.id))) : [];
  const used = Number(usage?.value ?? 0);
  return {
    subscriptionId: term?.id ?? null,
    allowance: term?.allowance ?? 0,
    used,
    remaining: Math.max(0, (term?.allowance ?? 0) - used),
    recipientLimit: term?.recipientLimit ?? 0,
    termEndsAt: term?.endsAt.toISOString() ?? null,
  };
}

export async function replaceOpenAudience(tx: Tx, userId: string, campaignId: string, rows: OpenRecipient[]) {
  await tx.delete(openCampaignAudienceTable).where(and(
    eq(openCampaignAudienceTable.userId, userId), eq(openCampaignAudienceTable.campaignId, campaignId),
  ));
  for (let index = 0; index < rows.length; index += 500) {
    await tx.insert(openCampaignAudienceTable).values(rows.slice(index, index + 500).map(row => ({
      userId, campaignId, email: row.email, firstName: row.firstName ?? "", lastName: row.lastName ?? "",
    })));
  }
}
