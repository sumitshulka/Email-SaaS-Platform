import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findProhibitedCampaignContent,
  normalizeProfanityText,
} from "../src/lib/profanity-filter.ts";

describe("campaign profanity filter", () => {
  const terms = ["badword", "objectionable phrase"];

  it("matches plain, punctuated, spaced, and bracket-separated spellings", () => {
    for (const value of [
      "badword",
      "BADWORD!",
      "b.a.d.w.o.r.d",
      "b a d w o r d",
      "b (a) [d] {w} . o - r _ d",
    ]) {
      assert.deepEqual(
        findProhibitedCampaignContent({ body: value }, terms),
        ["body"],
        value,
      );
    }
  });

  it("checks all campaign fields and numeric HTML entities", () => {
    assert.deepEqual(
      findProhibitedCampaignContent({
        subject: ["A safe subject", "b&#97;dword"],
        greeting: "Hello",
        body: "Safe text",
        htmlBody: "<p>b</p><span>a</span><i>d</i><em>w</em><i>o</i><span>r</span><p>d</p>",
        signature: "Objectionable-phrase",
      }, terms),
      ["subject", "body", "signature"],
    );
  });

  it("ignores empty or punctuation-only configured keywords", () => {
    assert.deepEqual(findProhibitedCampaignContent({ body: "Anything" }, ["...", ""]), []);
    assert.equal(normalizeProfanityText("b [a] .d"), "bad");
  });
});
