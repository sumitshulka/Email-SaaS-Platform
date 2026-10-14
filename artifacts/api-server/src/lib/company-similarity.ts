import { and, desc, eq, sql } from "drizzle-orm";
import { companiesTable, db, globalCompaniesTable } from "@workspace/db";

export type SimilarCompanyCandidate = {
  id: string;
  companyName: string;
  websiteUrl: string | null;
  domain: string | null;
  similarity: number;
};

const threshold = 0.36;

export async function findSimilarCompanies(
  companyName: string,
  options: { userId?: string; globalOnly?: boolean } = {},
): Promise<SimilarCompanyCandidate[]> {
  const name = companyName.trim().replace(/\s+/g, " ");
  if (name.length < 4) return [];
  const found: SimilarCompanyCandidate[] = [];
  if (options.userId && !options.globalOnly) {
    const score = sql<number>`similarity(${companiesTable.companyName}, ${name})`;
    const rows = await db.select({
      id: companiesTable.id,
      companyName: companiesTable.companyName,
      websiteUrl: companiesTable.companyWebsiteUrl,
      domain: companiesTable.companyDomainKey,
      similarity: score,
    }).from(companiesTable)
      .where(and(eq(companiesTable.userId, options.userId), sql`${companiesTable.companyName} % ${name}`))
      .orderBy(desc(score)).limit(8);
    found.push(...rows.filter(row => row.similarity >= threshold));
  }
  const globalScore = sql<number>`similarity(${globalCompaniesTable.companyName}, ${name})`;
  const globals = await db.select({
    id: globalCompaniesTable.id,
    companyName: globalCompaniesTable.companyName,
    websiteUrl: globalCompaniesTable.companyWebsiteUrl,
      domain: globalCompaniesTable.companyDomainKey,
    similarity: globalScore,
  }).from(globalCompaniesTable)
    .where(sql`${globalCompaniesTable.companyName} % ${name}`)
    .orderBy(desc(globalScore)).limit(8);
  found.push(...globals.filter(row => row.similarity >= threshold));
  return found.sort((left, right) => right.similarity - left.similarity).slice(0, 5);
}

