import { Router, type IRouter, type RequestHandler } from "express";
import { db, systemConfigurationTable } from "@workspace/db";
import {
  ListCompanyBusinessAreasResponse,
  UpdateCompanyBusinessAreasBody,
  UpdateCompanyBusinessAreasResponse,
} from "@workspace/api-zod";
import { requireSuperadmin, requireUserRole } from "../lib/session";
import {
  COMPANY_BUSINESS_AREAS_SETTING_KEY,
  getCompanyBusinessAreaValues,
} from "../lib/company-business-areas";

const router: IRouter = Router();
const requireBusinessAreaViewer: RequestHandler = (req, res, next) =>
  req.authUser?.role === "SUPERADMIN"
    ? requireSuperadmin(req, res, next)
    : requireUserRole(req, res, next);

router.get("/company-business-areas", requireBusinessAreaViewer, async (_req, res): Promise<void> => {
  res.json(ListCompanyBusinessAreasResponse.parse({ values: await getCompanyBusinessAreaValues() }));
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
    .values({ key: COMPANY_BUSINESS_AREAS_SETTING_KEY, value: values, updatedBy: req.authUser!.id })
    .onConflictDoUpdate({
      target: systemConfigurationTable.key,
      set: { value: values, updatedBy: req.authUser!.id, updatedAt: new Date() },
    });
  res.json(UpdateCompanyBusinessAreasResponse.parse({ values }));
});

export default router;
