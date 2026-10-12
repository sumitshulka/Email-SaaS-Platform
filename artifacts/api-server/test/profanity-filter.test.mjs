import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findProhibitedCampaignKeywordMatchDetails,
  findProhibitedCampaignKeywordMatches,
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
    assert.deepEqual(
      findProhibitedCampaignContent({ body: "BADWORD" }, ["badword"]),
      ["body"],
    );
    assert.deepEqual(
      findProhibitedCampaignContent({ body: "badword" }, ["BADWORD"]),
      ["body"],
    );
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

  it("matches common Greek and Cyrillic look-alikes in configured terms", () => {
    for (const value of [
      "bаdwоrd", // Cyrillic а and о
      "οbjectionable phrase", // Greek ο
      "bαdword", // Greek α
      "bаdword", // Cyrillic а
    ]) {
      assert.deepEqual(
        findProhibitedCampaignContent({ body: value }, terms),
        ["body"],
        value,
      );
    }
    assert.equal(normalizeProfanityText("οаε"), "oae");
  });

  it("previews draft keywords with the same normalization used for campaign enforcement", () => {
    const sampleText = "A safe bаd.word and OBJECTIONABLE—PHRASE.";
    const matches = findProhibitedCampaignKeywordMatches(sampleText, terms);
    assert.deepEqual(matches, terms);
    assert.deepEqual(
      findProhibitedCampaignContent({ body: sampleText }, terms),
      ["body"],
    );
    assert.deepEqual(
      findProhibitedCampaignKeywordMatches("safe campaign copy", terms),
      [],
    );
    assert.deepEqual(
      findProhibitedCampaignKeywordMatches("ordinary text", ["...", ""]),
      [],
    );
  });

  it("returns every original-text range for punctuation and confusable-character matches", () => {
    assert.deepEqual(
      findProhibitedCampaignKeywordMatchDetails(
        "A badword, bаd.word; badword",
        ["badword"],
      ),
      {
        matchedKeywords: ["badword"],
        matchRanges: [
          { start: 2, end: 9, keywords: ["badword"] },
          { start: 11, end: 19, keywords: ["badword"] },
          { start: 21, end: 28, keywords: ["badword"] },
        ],
      },
    );
  });

  it("maps decoded entities to their full source spelling and combines overlapping terms", () => {
    assert.deepEqual(
      findProhibitedCampaignKeywordMatchDetails("b&#97;d.word", ["bad", "badword"]),
      {
        matchedKeywords: ["bad", "badword"],
        matchRanges: [{ start: 0, end: 12, keywords: ["bad", "badword"] }],
      },
    );
  });

  it("keeps source offsets correct around markup, accents, and supplementary Unicode", () => {
    assert.deepEqual(
      findProhibitedCampaignKeywordMatchDetails("😀 <i>b</i>ádword!", ["badword"]),
      {
        matchedKeywords: ["badword"],
        matchRanges: [{ start: 6, end: 17, keywords: ["badword"] }],
      },
    );
  });

  it("does not broadly transliterate ordinary Greek or Cyrillic text", () => {
    assert.deepEqual(
      findProhibitedCampaignContent(
        { body: "Καλημέρα, κόσμε! Привет, мир." },
        terms,
      ),
      [],
    );
    assert.deepEqual(
      findProhibitedCampaignContent({ body: "objectionable phrase" }, ["badword"]),
      [],
    );
  });

  it("ignores empty or punctuation-only configured keywords", () => {
    assert.deepEqual(findProhibitedCampaignContent({ body: "Anything" }, ["...", ""]), []);
    assert.equal(normalizeProfanityText("b [a] .d"), "bad");
  });
});
