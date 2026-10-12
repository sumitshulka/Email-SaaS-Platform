process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.SESSION_SECRET ??=
  "postgres-campaign-send-limit-race-test-session-secret";

let dbModule;
let workerModule;
let emailModule;

try {
  [dbModule, workerModule, emailModule] = await Promise.all([
    import("@workspace/db"),
    import("../src/lib/campaign-worker.ts"),
    import("../src/lib/application-email.ts"),
  ]);

  const runRequest = await new Promise((resolve) => {
    process.once("message", resolve);
  });
  if (runRequest?.type !== "run" || !runRequest.recipientId) {
    throw new Error("The parent test did not assign a recipient to this worker.");
  }

  workerModule.setCandidateRecipientIdsForTests([runRequest.recipientId]);
  workerModule.setCampaignEmailSpacingWindowForTests({
    minimumSeconds: 0,
    maximumSeconds: 0,
  });
  workerModule.setBeforeDeliveryClaimForTests(
    () =>
      new Promise((resolve) => {
        process.send({ type: "ready" });
        process.once("message", (message) => {
          if (message?.type === "start") resolve();
        });
      }),
  );
  emailModule.setTenantEmailTransportForTests(async () => ({
    accepted: true,
    smtpResponse: "250 2.0.0 SMTP accepted",
    smtpCode: 250,
  }));

  const processed = await workerModule.processPendingCampaignDeliveries(1);
  workerModule.setBeforeDeliveryClaimForTests(null);
  workerModule.setCandidateRecipientIdsForTests(null);
  workerModule.setCampaignEmailSpacingWindowForTests(null);
  emailModule.setTenantEmailTransportForTests(null);
  await dbModule.pool.end();
  process.send({ type: "result", processed });
  process.disconnect();
} catch (error) {
  workerModule?.setBeforeDeliveryClaimForTests(null);
  workerModule?.setCandidateRecipientIdsForTests(null);
  workerModule?.setCampaignEmailSpacingWindowForTests(null);
  emailModule?.setTenantEmailTransportForTests(null);
  await dbModule?.pool.end().catch(() => {});
  process.send?.({
    type: "error",
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.disconnect?.();
  process.exitCode = 1;
}
