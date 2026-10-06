import { createHash } from "node:crypto";
import type {
  CampaignVariantAssignment,
  EmailCampaignRecipient,
} from "@workspace/db";

export type CampaignVariantValues = {
  subject: string[];
  greeting: string[];
  signature: string[];
};

export type CampaignVariantMinimums = {
  subject: number;
  greeting: number;
  signature: number;
};

export type CampaignVariantResult = {
  index: number;
  value: string;
  assigned: number;
  smtpAccepted: number;
  failed: number;
  suppressed: number;
  unknown: number;
};

export type CampaignVariantResultGroup = {
  testEnabled: boolean;
  variants: CampaignVariantResult[];
};

export type CampaignVariantResults = {
  subject: CampaignVariantResultGroup;
  greeting: CampaignVariantResultGroup;
  signature: CampaignVariantResultGroup;
};

type RecipientOutcome = Pick<
  EmailCampaignRecipient,
  "status" | "variantAssignment"
>;

function firstNonEmpty(values: string[] | null | undefined): string[] {
  return (values ?? []).filter((value) => typeof value === "string" && value.trim());
}

export function normalizeCampaignVariantValues(campaign: {
  subject: string;
  subjectVariants?: string[] | null;
  greetingVariants?: string[] | null;
  signatureVariants?: string[] | null;
}): CampaignVariantValues {
  const subjectVariants = firstNonEmpty(campaign.subjectVariants);
  return {
    subject: subjectVariants.length ? subjectVariants : [campaign.subject],
    greeting: firstNonEmpty(campaign.greetingVariants),
    signature: firstNonEmpty(campaign.signatureVariants),
  };
}

function stableIndex(
  campaignId: string,
  contactId: string,
  section: keyof CampaignVariantValues,
  variantCount: number,
): number {
  const digest = createHash("sha256")
    .update(`${campaignId}:${contactId}:${section}`)
    .digest();
  return digest.readUInt32BE(0) % variantCount;
}

export function assignCampaignVariants(
  campaignId: string,
  contactId: string,
  variants: CampaignVariantValues,
  minimums: CampaignVariantMinimums,
): CampaignVariantAssignment {
  const sections = ["subject", "greeting", "signature"] as const;
  const assignment = {} as CampaignVariantAssignment;
  for (const section of sections) {
    const values = variants[section];
    const tested = values.length >= minimums[section] && values.length > 1;
    assignment[section] = {
      index:
        tested && values.length
          ? stableIndex(campaignId, contactId, section, values.length)
          : 0,
      tested,
    };
  }
  return assignment;
}

function recipientSlot(
  assignment: CampaignVariantAssignment | null | undefined,
  section: keyof CampaignVariantValues,
  valueCount: number,
): { index: number; tested: boolean } {
  const candidate = assignment?.[section];
  if (
    candidate &&
    Number.isInteger(candidate.index) &&
    candidate.index >= 0 &&
    candidate.index < Math.max(1, valueCount)
  ) {
    return { index: candidate.index, tested: candidate.tested === true };
  }
  return { index: 0, tested: false };
}

export function summarizeCampaignVariantResults(
  variants: CampaignVariantValues,
  recipients: RecipientOutcome[],
): CampaignVariantResults {
  const sections = ["subject", "greeting", "signature"] as const;
  const result = {} as CampaignVariantResults;

  for (const section of sections) {
    const values = variants[section];
    const rows = values.map((value, index): CampaignVariantResult => ({
      index,
      value,
      assigned: 0,
      smtpAccepted: 0,
      failed: 0,
      suppressed: 0,
      unknown: 0,
    }));
    let testEnabled = false;

    for (const recipient of recipients) {
      const slot = recipientSlot(
        recipient.variantAssignment,
        section,
        values.length,
      );
      testEnabled ||= slot.tested;
      const row = rows[slot.index];
      if (!row) continue;
      row.assigned += 1;
      if (recipient.status === "delivered") row.smtpAccepted += 1;
      else if (recipient.status === "bounced") row.failed += 1;
      else if (recipient.status === "suppressed") row.suppressed += 1;
      else if (recipient.status === "unknown") row.unknown += 1;
    }

    result[section] = { testEnabled, variants: rows };
  }
  return result;
}
