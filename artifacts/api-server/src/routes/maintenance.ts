import { Router, type IRouter } from "express";
import { GetMaintenanceStatusResponse } from "@workspace/api-zod";
import { getPlatformSettings } from "../lib/platform-settings";

const router: IRouter = Router();

router.get("/maintenance/status", async (_req, res): Promise<void> => {
  const settings = await getPlatformSettings();
  res.json(
    GetMaintenanceStatusResponse.parse({
      maintenanceMode: settings.maintenanceMode,
    }),
  );
});

export default router;
