import assert from "node:assert/strict";
import test from "node:test";
import { getCampaignMinimumSpacingSeconds } from "../src/lib/platform-settings.ts";

test("minimum campaign spacing includes randomized gap and current platform caps", () => {
  assert.equal(
    getCampaignMinimumSpacingSeconds({
      defaultEmailsPerHour: 100,
      maxEmailsPerDay: 1000,
      queuePollingSeconds: 15,
    }),
    300,
  );
  assert.equal(
    getCampaignMinimumSpacingSeconds({
      defaultEmailsPerHour: 1,
      maxEmailsPerDay: 2,
      queuePollingSeconds: 15,
    }),
    43200,
  );
});
