import { and, desc, eq, gt, lte } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db, subscriptionPackagesTable, userSubscriptionsTable } from "@workspace/db";
import { renewExpiredFreePrimaryPlanForUser } from "./billing";

export type PackageFeature =
  | "prospectManagementEnabled"
  | "reportsEnabled"
  | "byokAiEnabled";

export type PackageFeatureAccess = {
  packageId: string;
  packageName: string;
  amountMinor: number;
  prospectManagementEnabled: boolean;
  reportsEnabled: boolean;
  personalReportLimit: number;
  byokAiEnabled: boolean;
};

declare global {
  namespace Express {
    interface Request {
      packageFeatureAccess?: PackageFeatureAccess | null;
    }
  }
}

export async function getPackageFeatureAccess(
  userId: string,
): Promise<PackageFeatureAccess | null> {
  const now = new Date();
  const readActivePackage = async () => {
    const [active] = await db
      .select({
        id: subscriptionPackagesTable.id,
        name: subscriptionPackagesTable.name,
        amountMinor: subscriptionPackagesTable.amountMinor,
        packageType: subscriptionPackagesTable.packageType,
        prospectManagementEnabled: subscriptionPackagesTable.prospectManagementEnabled,
        reportsEnabled: subscriptionPackagesTable.reportsEnabled,
        personalReportLimit: subscriptionPackagesTable.personalReportLimit,
        byokAiEnabled: subscriptionPackagesTable.byokAiEnabled,
      })
      .from(userSubscriptionsTable)
      .innerJoin(
        subscriptionPackagesTable,
        eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
      )
      .where(and(
        eq(userSubscriptionsTable.userId, userId),
        eq(userSubscriptionsTable.status, "active"),
        lte(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
      ))
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1);
    return active;
  };

  let active = await readActivePackage();
  if (!active) {
    await renewExpiredFreePrimaryPlanForUser(userId, now);
    active = await readActivePackage();
  }
  if (!active || active.packageType !== "primary") return null;
  return {
    packageId: active.id,
    packageName: active.name,
    amountMinor: active.amountMinor,
    prospectManagementEnabled:
      active.amountMinor > 0 && active.prospectManagementEnabled,
    reportsEnabled: active.reportsEnabled,
    personalReportLimit: active.personalReportLimit,
    byokAiEnabled: active.byokAiEnabled,
  };
}

export function requirePackageFeature(feature: PackageFeature): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.authUser) {
        res.status(401).json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" });
        return;
      }
      const access = await getPackageFeatureAccess(req.authUser.id);
      req.packageFeatureAccess = access;
      if (!access) {
        res.status(403).json({
          error: "An active primary package with this feature is required.",
          code: "PACKAGE_FEATURE_REQUIRED",
        });
        return;
      }
      if (!access[feature]) {
        res.status(403).json({
          error: feature === "prospectManagementEnabled"
            ? "Prospect Management is not included in the active package."
            : feature === "reportsEnabled"
              ? "Reports are not included in the active package."
              : "Bring Your Own AI is not included in the active package.",
          code: "PACKAGE_FEATURE_NOT_INCLUDED",
          feature: feature === "prospectManagementEnabled"
            ? "prospect_management"
            : feature === "reportsEnabled"
              ? "reports"
              : "byok_ai",
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
