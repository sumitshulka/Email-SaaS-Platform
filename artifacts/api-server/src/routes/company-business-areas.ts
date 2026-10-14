import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, systemConfigurationTable } from "@workspace/db";
import {
  ListCompanyBusinessAreasResponse,
  UpdateCompanyBusinessAreasBody,
  UpdateCompanyBusinessAreasResponse,
} from "@workspace/api-zod";
import { requireSuperadmin, requireUserRole } from "../lib/session";

const router: IRouter = Router();
const SETTINGS_KEY = "company_business_areas";
const DEFAULT_VALUES = ["Manufacturing", "Education", "Textiles", "Service Industry"];

async function getValues(): Promise<string[]> {
  const [row] = await db.select({ value: systemConfigurationTable.value })
    .from(systemConfigurationTable).where(eq(systemConfigurationTable.key, SETTINGS_KEY)).limit(1);
  const value = row?.value;
  return Array.isArray(value) && value.every(item => typeof item === "string")
    ? value
    : DEFAULT_VALUES;
}

router.get("/company-business-areas", requireUserRole, async (_req, res): Promise<void> => {
  res.json(ListCompanyBusinessAreasResponse.parse({ values: await getValues() }));
});

router.put("/admin/company-business-areas", requireSuperadmin, async (req, res): Promise<void> => {
  const parsed = UpdateCompanyBusinessAreasBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter between 1 and 100 business-area values.", code: "INVALID_INPUT" });
    return;
  }
  const values = parsed.data.values.map(value => value.trim()).filter(Boolean);
  if (!values.length || values.length !== parsed.data.values.length ||
      new Set(values.map(value => value.toLowerCase())).size !== values.length) {
    res.status(400).json({ error: "Business-area values must be non-empty and unique.", code: "INVALID_INPUT" });
    return;
  }
  await db.insert(systemConfigurationTable)
    .values({ key: SETTINGS_KEY, value: values, updatedBy: req.authUser!.id })
    .onConflictDoUpdate({
      target: systemConfigurationTable.key,
      set: { value: values, updatedBy: req.authUser!.id, updatedAt: new Date() },
    });
  res.json(UpdateCompanyBusinessAreasResponse.parse({ values }));
});

export default router;
