import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  companyDomainKey,
  companyProfileFrom,
  companyProfileReviewReason,
  conflictingCompanyProfileFields,
  mergeCompatibleCompanyProfiles,
  normalizeCompanyDomain,
} from "../src/lib/company-profile.ts";

describe("company domain matching", () => {
  it("normalizes case, URL schemes, and the www prefix", () => {
    assert.equal(normalizeCompanyDomain(" HTTPS://WWW.Example.COM/path "), "example.com");
    assert.equal(companyDomainKey({ companyDomain: null, companyWebsiteUrl: "https://www.example.com/about" }), "example.com");
  });

  it("does not infer a domain from an invalid value", () => {
    assert.equal(normalizeCompanyDomain("not a domain"), null);
  });
});

describe("legacy company profile merge", () => {
  it("merges matching values and fills missing profile fields", () => {
    const merged = mergeCompatibleCompanyProfiles([
      companyProfileFrom({ companyName: "Acme", companyDomain: "acme.test" }),
      companyProfileFrom({ companyName: "ACME", companyIndustry: "Software", companyDomain: "https://www.acme.test" }),
    ]);

    assert.equal(merged?.companyName, "Acme");
    assert.equal(merged?.companyIndustry, "Software");
    assert.equal(merged?.companyDomain, "acme.test");
  });

  it("leaves conflicting profiles unmatched instead of merging by name", () => {
    const profiles = [
      companyProfileFrom({ companyName: "Acme", companyDomain: "acme.test" }),
      companyProfileFrom({ companyName: "Different company", companyDomain: "https://www.acme.test" }),
    ];
    const merged = mergeCompatibleCompanyProfiles(profiles);

    assert.equal(merged, null);
    assert.deepEqual(conflictingCompanyProfileFields(profiles), ["companyName"]);
    assert.match(
      companyProfileReviewReason(profiles[0], profiles),
      /conflicting company name values/,
    );
  });

  it("explains when a profile is missing the domain required for safe matching", () => {
    const profile = companyProfileFrom({ companyName: "Acme" });

    assert.match(
      companyProfileReviewReason(profile, [profile]),
      /domain or website URL is missing/,
    );
  });

  it("identifies conflicting fields on an existing shared company", () => {
    const profile = companyProfileFrom({
      companyName: "Acme",
      companyDomain: "acme.test",
      companyIndustry: "Software",
    });
    const sharedCompany = companyProfileFrom({
      companyName: "Acme",
      companyDomain: "acme.test",
      companyIndustry: "Manufacturing",
    });

    assert.match(
      companyProfileReviewReason(profile, [profile], sharedCompany),
      /shared company for acme\.test has conflicting industry values/,
    );
  });
});