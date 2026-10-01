import app from "./app";
import { logger } from "./lib/logger";
import { ensureSeedSuperadmin } from "./lib/seed";
import { requireSessionSecret } from "./lib/security";
import { startCampaignWorker } from "./lib/campaign-worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try {
  requireSessionSecret();
  await ensureSeedSuperadmin();
  startCampaignWorker();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
} catch (error) {
  logger.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "API startup initialization failed",
  );
  process.exit(1);
}
