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

const CONFUSABLE_LETTERS: Record<string, string> = {
  // Greek letters with common Latin look-alikes.
  α: "a",
  ε: "e",
  ι: "i",
  κ: "k",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "y",
  χ: "x",
  // Cyrillic letters commonly substituted into Latin words.
  а: "a",
  е: "e",
  і: "i",
  ј: "j",
  к: "k",
  м: "m",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
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
    .replace(/[αεικορτυχаеіјкморсху]/gu, (character) =>
      CONFUSABLE_LETTERS[character] ?? character,
    )
    // Ignore punctuation, spaces, brackets, format controls, and markup.
    // This makes "w.o.r.d", "w (o) r d", and zero-width separators equivalent.
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function getNormalizedProhibitedKeywords(
  prohibitedKeywords: readonly string[],
): Array<{ keyword: string; normalized: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ keyword: string; normalized: string }> = [];
  for (const keyword of prohibitedKeywords) {
    if (typeof keyword !== "string") continue;
    const normalizedKeyword = normalizeProfanityText(keyword);
    if (!normalizedKeyword || seen.has(normalizedKeyword)) continue;
    seen.add(normalizedKeyword);
    normalized.push({ keyword, normalized: normalizedKeyword });
  }
  return normalized;
}

function containsProhibitedKeyword(normalizedText: string, normalizedKeyword: string): boolean {
  return normalizedKeyword.length > 0 && normalizedText.includes(normalizedKeyword);
}

export function findProhibitedCampaignKeywordMatches(
  sampleText: string,
  prohibitedKeywords: readonly string[],
): string[] {
  const normalizedSample = normalizeProfanityText(sampleText);
  if (!normalizedSample) return [];

  return getNormalizedProhibitedKeywords(prohibitedKeywords)
    .filter(({ normalized }) => containsProhibitedKeyword(normalizedSample, normalized))
    .map(({ keyword }) => keyword);
}

export function findProhibitedCampaignContent(
  content: CampaignContentValues,
  prohibitedKeywords: readonly string[],
): CampaignContentField[] {
  const normalizedKeywords = getNormalizedProhibitedKeywords(prohibitedKeywords);
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
      normalizedKeywords.some(({ normalized }) => containsProhibitedKeyword(value, normalized)),
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
