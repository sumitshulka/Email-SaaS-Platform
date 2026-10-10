import { logger } from "./lib/logger";
import { requireSessionSecret } from "./lib/security";
import { syncDueGmailMailboxes } from "./lib/gmail-mailbox";

try {
  requireSessionSecret();
  const result = await syncDueGmailMailboxes();
  logger.info(result, "Scheduled Gmail mailbox sync completed");
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  logger.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "Scheduled Gmail mailbox sync failed",
  );
  process.exitCode = 1;
}
