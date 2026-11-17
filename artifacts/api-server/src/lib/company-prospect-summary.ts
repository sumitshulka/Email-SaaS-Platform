export type CompanyProspectValueRow = {
  currencyCode: string;
  expectedDealValue: number | string;
  stageType: string;
  terminalOutcome: string | null;
};

export type CompanyProspectValueTotal = {
  currencyCode: string;
  totalProspectValue: number;
  totalRevenueValue: number;
};

export function summarizeCompanyProspectValues(
  rows: CompanyProspectValueRow[],
): CompanyProspectValueTotal[] {
  const totals = new Map<string, CompanyProspectValueTotal>();
  for (const row of rows) {
    const outcome = row.terminalOutcome?.toLowerCase();
    const total = totals.get(row.currencyCode) ?? {
      currencyCode: row.currencyCode,
      totalProspectValue: 0,
      totalRevenueValue: 0,
    };
    const amount = Number(row.expectedDealValue);
    total.totalProspectValue += amount;
    if (outcome === "won") total.totalRevenueValue += amount;
    totals.set(row.currencyCode, total);
  }
  return [...totals.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}
