export type CampaignContentField =
  | "subject"
  | "greeting"
  | "body"
  | "signature";

export type CampaignContentValues = Partial<
  Record<CampaignContentField, string | string[] | null | undefined>
> & {
  htmlBody?: string | null;
};

function decodeHtmlNumericEntities(value: string): string {
  return value.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/giu, (entity, hex, decimal) => {
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return entity;
    }
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  });
}

export function normalizeProfanityText(value: string): string {
  return decodeHtmlNumericEntities(value)
    .replace(/&(?:nbsp|thinsp|ensp|emsp|hairsp);/giu, " ")
    .replace(/<[^>]*>/gsu, "")
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/\p{M}/gu, "")
    // Ignore punctuation, spaces, brackets, format controls, and markup.
    // This makes "w.o.r.d", "w (o) r d", and zero-width separators equivalent.
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function findProhibitedCampaignContent(
  content: CampaignContentValues,
  prohibitedKeywords: readonly string[],
): CampaignContentField[] {
  const normalizedKeywords = [...new Set(
    prohibitedKeywords
      .filter((keyword): keyword is string => typeof keyword === "string")
      .map(normalizeProfanityText)
      .filter((keyword) => keyword.length > 0),
  )];
  if (normalizedKeywords.length === 0) return [];

  const fields: CampaignContentField[] = ["subject", "greeting", "body", "signature"];
  const blocked = new Set<CampaignContentField>();
  for (const field of fields) {
    const rawValue = content[field];
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const normalizedValues = values
      .filter((value): value is string => typeof value === "string")
      .map(normalizeProfanityText);
    if (field === "body" && content.htmlBody) {
      normalizedValues.push(normalizeProfanityText(content.htmlBody));
    }
    if (normalizedValues.some((value) =>
      normalizedKeywords.some((keyword) => value.includes(keyword)),
    )) {
      blocked.add(field);
    }
  }
  return [...blocked];
}

export function describeBlockedCampaignFields(
  fields: readonly CampaignContentField[],
): string {
  const labels: Record<CampaignContentField, string> = {
    subject: "subject",
    greeting: "greeting",
    body: "body",
    signature: "signature",
  };
  return fields.map((field) => labels[field]).join(", ");
}
