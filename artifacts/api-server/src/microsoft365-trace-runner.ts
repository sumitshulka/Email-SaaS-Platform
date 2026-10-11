import { logger } from "./lib/logger";
import { syncDueMicrosoft365TraceConnections } from "./lib/microsoft365-trace";
import { requireSessionSecret } from "./lib/security";

try {
  requireSessionSecret();
  const result = await syncDueMicrosoft365TraceConnections();
  logger.info(result, "Scheduled Microsoft 365 trace sync completed");
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  logger.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "Scheduled Microsoft 365 trace sync failed",
  );
  process.exitCode = 1;
}
