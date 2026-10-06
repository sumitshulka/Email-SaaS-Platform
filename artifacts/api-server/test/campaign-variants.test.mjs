import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignCampaignVariants,
  normalizeCampaignVariantValues,
  summarizeCampaignVariantResults,
} from "../src/lib/campaign-variants.ts";

const limits = { subject: 3, greeting: 3, signature: 3 };
const variants = {
  subject: ["Subject A", "Subject B", "Subject C"],
  greeting: ["Hello {{firstName}}", "Hi {{firstName}}", "Good day {{firstName}}"],
  signature: ["Regards", "Thanks", "Best"],
};

describe("campaign content tests", () => {
  it("keeps recipient assignments stable for the same campaign and contact", () => {
    const first = assignCampaignVariants("campaign-1", "contact-1", variants, limits);
    const repeated = assignCampaignVariants("campaign-1", "contact-1", variants, limits);

    assert.deepEqual(repeated, first);
    assert.equal(first.subject.tested, true);
    assert.ok(first.subject.index >= 0 && first.subject.index < variants.subject.length);
    assert.ok(
      Object.values(first).every((assignment) => assignment.tested),
      "all three configured sections should be tested at the configured minimum",
    );
  });

  it("uses the first non-empty option without testing below the configured minimum", () => {
    const assignment = assignCampaignVariants(
      "campaign-1",
      "contact-1",
      {
        subject: ["Only one subject"],
        greeting: [],
        signature: ["One signature", "Two signatures"],
      },
      limits,
    );

    assert.deepEqual(assignment.subject, { index: 0, tested: false });
    assert.deepEqual(assignment.greeting, { index: 0, tested: false });
    assert.deepEqual(assignment.signature, { index: 0, tested: false });
  });

  it("uses the legacy subject as the sole subject option when variants are absent", () => {
    assert.deepEqual(
      normalizeCampaignVariantValues({ subject: "Legacy subject" }),
      {
        subject: ["Legacy subject"],
        greeting: [],
        signature: [],
      },
    );
  });

  it("summarizes assignment and SMTP outcomes without implying engagement or inbox delivery", () => {
    const recipients = [
      {
        status: "delivered",
        variantAssignment: {
          subject: { index: 1, tested: true },
          greeting: { index: 0, tested: true },
          signature: { index: 2, tested: true },
        },
      },
      {
        status: "bounced",
        variantAssignment: {
          subject: { index: 1, tested: true },
          greeting: { index: 1, tested: true },
          signature: { index: 0, tested: true },
        },
      },
      {
        status: "suppressed",
        variantAssignment: {
          subject: { index: 2, tested: true },
          greeting: { index: 2, tested: true },
          signature: { index: 1, tested: true },
        },
      },
      {
        status: "unknown",
        variantAssignment: {
          subject: { index: 0, tested: true },
          greeting: { index: 0, tested: true },
          signature: { index: 0, tested: true },
        },
      },
    ];

    const summary = summarizeCampaignVariantResults(variants, recipients);
    assert.equal(summary.subject.testEnabled, true);
    assert.deepEqual(summary.subject.variants[1], {
      index: 1,
      value: "Subject B",
      assigned: 2,
      smtpAccepted: 1,
      failed: 1,
      suppressed: 0,
      unknown: 0,
    });
    assert.equal(summary.greeting.variants[0].assigned, 2);
    assert.equal(summary.signature.variants[2].smtpAccepted, 1);
  });
});
