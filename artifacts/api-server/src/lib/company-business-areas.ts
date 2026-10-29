import { eq } from "drizzle-orm";
import { db, systemConfigurationTable } from "@workspace/db";

export const COMPANY_BUSINESS_AREAS_SETTING_KEY = "company_business_areas";
export const DEFAULT_COMPANY_BUSINESS_AREAS = [
  "Manufacturing",
  "Education",
  "Textiles",
  "Service Industry",
];

export async function getCompanyBusinessAreaValues(): Promise<string[]> {
  const [row] = await db
    .select({ value: systemConfigurationTable.value })
    .from(systemConfigurationTable)
    .where(eq(systemConfigurationTable.key, COMPANY_BUSINESS_AREAS_SETTING_KEY))
    .limit(1);
  const value = row?.value;
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : DEFAULT_COMPANY_BUSINESS_AREAS;
}
