import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeCampaignAudience,
  uniqueCampaignRecipients,
} from "../src/lib/campaign-audience.ts";

const memberships = [
  {
    id: "contact-a",
    listId: "list-first",
    email: "Shared@example.com",
    firstName: "First",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    id: "contact-b",
    listId: "list-first",
    email: "first-only@example.com",
    firstName: "Only",
    createdAt: new Date("2026-01-02T00:00:00Z"),
  },
  {
    id: "contact-c",
    listId: "list-second",
    email: " shared@EXAMPLE.com ",
    firstName: "Second",
    createdAt: new Date("2026-01-03T00:00:00Z"),
  },
  {
    id: "contact-d",
    listId: "list-second",
    email: "second-only@example.com",
    firstName: "Another",
    createdAt: new Date("2026-01-04T00:00:00Z"),
  },
];

test("summarizes unique email addresses and cross-list overlaps", () => {
  assert.deepEqual(
    summarizeCampaignAudience(memberships, ["list-first", "list-second"]),
    { uniqueRecipients: 3, overlappingRecipients: 1 },
  );
});

test("queues a shared address once and keeps the first selected list's entry", () => {
  const recipients = uniqueCampaignRecipients(memberships, [
    "list-second",
    "list-first",
  ]);
  assert.deepEqual(
    recipients.map(({ email, firstName }) => [email.trim().toLowerCase(), firstName]),
    [
      ["shared@example.com", "Second"],
      ["second-only@example.com", "Another"],
      ["first-only@example.com", "Only"],
    ],
  );
});

test("ignores memberships outside the selected lists", () => {
  assert.deepEqual(
    summarizeCampaignAudience(memberships, ["list-first"]),
    { uniqueRecipients: 2, overlappingRecipients: 0 },
  );
});
