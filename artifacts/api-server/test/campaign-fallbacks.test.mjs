import assert from "node:assert/strict";
import test from "node:test";
import { renderCampaignForContact } from "../src/lib/campaign-template.ts";
import { campaignFallbackError, missingCampaignRecipientValue } from "../src/lib/campaign-personalization.ts";
import { openCampaignPlaceholderError } from "../src/lib/open-campaigns.ts";

const recipient = { email: "recipient@example.test", firstName: "", lastName: " ", fullName: "",
  companyName: "", phoneNumber: "", linkedinUrl: "" };
const template = {
  subject: "Hi {{firstName}}",
  greetingVariants: ["Dear {{fullName}},"], signatureVariants: ["From {{companyName}}"],
  textBody: "{{firstName}} {{lastName}} {{phoneNumber}} {{linkedinUrl}} {{email}}",
  htmlBody: "<p>{{firstName}} {{lastName}}</p>",
  placeholderFallbacks: { firstName: "there", lastName: "<friend & colleague>", fullName: "reader",
    companyName: "our team", phoneNumber: "not provided", linkedinUrl: "not available" },
};

test("fallbacks cover missing and whitespace values in every message part, escaping HTML", () => {
  const rendered = renderCampaignForContact(template, recipient);
  assert.equal(rendered.subject, "Hi there");
  assert.match(rendered.textBody, /Dear reader,/);
  assert.match(rendered.textBody, /there <friend & colleague> not provided not available recipient@example.test/);
  assert.match(rendered.textBody, /From our team/);
  assert.match(rendered.htmlBody, /there &lt;friend &amp; colleague&gt;/);
  assert.equal(campaignFallbackError(template), null);
  assert.equal(missingCampaignRecipientValue(template, recipient), null);
});

test("recipient values override defaults and substituted values are not recursively expanded", () => {
  const rendered = renderCampaignForContact(template, {
    ...recipient, firstName: "Ada", fullName: "Ada Lovelace", lastName: "{{firstName}}",
  });
  assert.equal(rendered.subject, "Hi Ada");
  assert.match(rendered.textBody, /Dear Ada Lovelace,/);
  assert.match(rendered.textBody, /Ada \{\{firstName\}\}/);
});

test("fallback values cannot introduce executable links through HTML attributes", () => {
  const rendered = renderCampaignForContact({
    subject: "Safe", textBody: "Safe", htmlBody: '<a href="{{linkedinUrl}}">Profile</a>',
    placeholderFallbacks: { linkedinUrl: "javascript:alert(1)" },
  }, recipient);
  assert.doesNotMatch(rendered.htmlBody, /javascript:/);
  assert.match(rendered.htmlBody, /Profile/);
});

test("optional used placeholders need explicit defaults while email-only campaigns do not", () => {
  assert.match(campaignFallbackError({ ...template, placeholderFallbacks: {} }), /firstName.*fullName/);
  assert.equal(campaignFallbackError({ subject: "Hi", textBody: "For {{email}}" }), null);
  assert.equal(campaignFallbackError({ ...template, placeholderFallbacks: {} }, false), null, "drafts may remain incomplete");
  assert.match(campaignFallbackError({ textBody: "Hi", placeholderFallbacks: { firstName: "{{email}}" } }), /plain text/);
  assert.match(missingCampaignRecipientValue({ ...template, placeholderFallbacks: {} }, recipient), /no fallback/);
  assert.match(campaignFallbackError({ htmlBody: "<p>&#123;&#123;firstName&#125;&#125;</p>" }), /firstName/);
});

test("missing uploaded names accept explicit defaults but contact-only tokens never become available", () => {
  assert.equal(openCampaignPlaceholderError([{ email: recipient.email }], "{{firstName}} {{fullName}}",
    template.placeholderFallbacks), null);
  assert.match(openCampaignPlaceholderError([{ email: recipient.email }], "{{companyName}}",
    template.placeholderFallbacks), /not available/);
  assert.match(openCampaignPlaceholderError([{ email: recipient.email }], "<p>&#123;&#123;firstName&#125;&#125;</p>"), /firstName/);
});
