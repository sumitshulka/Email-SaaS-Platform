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
});