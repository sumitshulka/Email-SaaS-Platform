import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  companiesTable,
  contactsTable,
  db,
} from "@workspace/db";
import {
  companyDomainKey,
  companyProfileFrom,
  hasCompanyProfile,
  mergeCompatibleCompanyProfiles,
} from "./company-profile";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function backfillCompanyProfilesInTransaction(
  tx: DatabaseTransaction,
  userId: string,
) {
  const legacyContacts = await tx
    .select()
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.userId, userId),
        isNull(contactsTable.companyId),
        eq(contactsTable.companyLinkSuppressed, false),
      ),
    )
    .for("update");
  const legacyProfiles = legacyContacts
    .map((contact) => ({
      contact,
      profile: companyProfileFrom(contact),
    }))
    .filter(({ profile }) => hasCompanyProfile(profile));
  const groups = new Map<string, Array<(typeof legacyProfiles)[number]>>();
  for (const row of legacyProfiles) {
    const domainKey = companyDomainKey(row.profile);
    if (!domainKey) continue;
    const group = groups.get(domainKey) ?? [];
    group.push(row);
    groups.set(domainKey, group);
  }

  let linkedContacts = 0;
  let createdCompanies = 0;
  const linkedContactIds = new Set<string>();
  for (const [domainKey, rows] of groups) {
    const mergedLegacy = mergeCompatibleCompanyProfiles(rows.map((row) => row.profile));
    if (!mergedLegacy?.companyName) continue;

    const [existingCompany] = await tx
      .select()
      .from(companiesTable)
      .where(
        and(
          eq(companiesTable.userId, userId),
          eq(companiesTable.companyDomainKey, domainKey),
        ),
      )
      .limit(1)
      .for("update");
    let companyId: string;
    if (existingCompany) {
      const merged = mergeCompatibleCompanyProfiles([
        companyProfileFrom(existingCompany),
        mergedLegacy,
      ]);
      const companyName = merged?.companyName;
      if (!merged || !companyName) continue;
      const [updated] = await tx
        .update(companiesTable)
        .set({
          ...merged,
          companyName,
          companyDomainKey: domainKey,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companiesTable.id, existingCompany.id),
            eq(companiesTable.userId, userId),
          ),
        )
        .returning({ id: companiesTable.id });
      if (!updated) continue;
      companyId = updated.id;
    } else {
      const companyName = mergedLegacy.companyName;
      if (!companyName) continue;
      const [created] = await tx
        .insert(companiesTable)
        .values({
          userId,
          ...mergedLegacy,
          companyName,
          companyDomainKey: domainKey,
        })
        .returning({ id: companiesTable.id });
      if (!created) continue;
      companyId = created.id;
      createdCompanies += 1;
    }

    const ids = rows.map(({ contact }) => contact.id);
    const linked = await tx
      .update(contactsTable)
      .set({
        companyId,
        companyLinkSuppressed: false,
        companyName: null,
        companyWebsiteUrl: null,
        companyDomain: null,
        companyIndustry: null,
        companySize: null,
        companyRevenueRange: null,
        companyDescription: null,
        companyPhoneNumber: null,
        companyLinkedinUrl: null,
        companyLocation: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contactsTable.userId, userId),
          isNull(contactsTable.companyId),
          inArray(contactsTable.id, ids),
        ),
      )
      .returning({ id: contactsTable.id });
    linked.forEach((contact) => linkedContactIds.add(contact.id));
    linkedContacts += linked.length;
  }

  return {
    linkedContacts,
    createdCompanies,
    skippedContacts: legacyProfiles.length - linkedContactIds.size,
  };
}