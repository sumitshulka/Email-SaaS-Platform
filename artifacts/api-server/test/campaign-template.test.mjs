import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderCampaignForContact } from "../src/lib/campaign-template.ts";

describe("renderCampaignForContact", () => {
  it("uses the campaign substitution and HTML sanitization rules for a recipient preview", () => {
    const rendered = renderCampaignForContact(
      {
        subject: "Hello {{fullName}} ({{unknown}})",
        textBody: "Hi {{firstName}} at {{companyName}}.",
        htmlBody:
          "<p><strong>Hi {{firstName}}</strong>, welcome to {{companyName}}.</p><script>alert(1)</script>",
      },
      {
        firstName: "Rae <Admin>",
        lastName: "O'Neil",
        fullName: "Rae <Admin> O'Neil",
        email: "rae@example.test",
        companyName: "Acme & Sons",
        phoneNumber: "",
        linkedinUrl: "",
      },
    );

    assert.equal(rendered.subject, "Hello Rae <Admin> O'Neil ({{unknown}})");
    assert.equal(rendered.textBody, "Hi Rae <Admin> at Acme & Sons.");
    assert.equal(
      rendered.htmlBody,
      "<p><strong>Hi Rae &lt;Admin&gt;</strong>, welcome to Acme &amp; Sons.</p>",
    );
  });

  it("uses the assigned content options and includes unsubscribe in text and HTML", () => {
    const rendered = renderCampaignForContact(
      {
        subject: "Fallback subject",
        subjectVariants: ["Hello {{firstName}}", "A note for {{companyName}}"],
        greetingVariants: ["Hi {{firstName}},", "Good morning {{firstName}},"],
        signatureVariants: ["Regards,\nTaskone", "Thanks,\n{{firstName}}"],
        textBody: "Your update is ready.",
        htmlBody: "<p>Your update is ready.</p>",
      },
      {
        firstName: "Rae",
        lastName: "O'Neil",
        fullName: "Rae O'Neil",
        email: "rae@example.test",
        companyName: "Acme & Sons",
        phoneNumber: "",
        linkedinUrl: "",
      },
      {
        variantAssignment: {
          subject: { index: 1 },
          greeting: { index: 1 },
          signature: { index: 1 },
        },
        unsubscribeUrl: "https://mailflow.test/unsubscribe?token=signed",
      },
    );

    assert.equal(rendered.subject, "A note for Acme & Sons");
    assert.equal(
      rendered.textBody,
      "Good morning Rae,\n\nYour update is ready.\n\nThanks,\nRae\n\nUnsubscribe: https://mailflow.test/unsubscribe?token=signed",
    );
    assert.equal(
      rendered.htmlBody,
      '<p>Good morning Rae,</p>\n<p>Your update is ready.</p>\n<p>Thanks,<br>Rae</p>\n<p><a href="https://mailflow.test/unsubscribe?token=signed">Unsubscribe</a></p>',
    );
  });
});