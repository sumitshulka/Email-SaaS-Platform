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

export type ProhibitedCampaignKeywordMatchRange = {
  start: number;
  end: number;
  keywords: string[];
};

type SourceCharacter = {
  value: string;
  start: number;
  end: number;
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

function charactersFromSource(value: string, sourceStart = 0): SourceCharacter[] {
  const characters: SourceCharacter[] = [];
  let offset = sourceStart;
  for (const character of value) {
    characters.push({ value: character, start: offset, end: offset + character.length });
    offset += character.length;
  }
  return characters;
}

function decodeHtmlEntitiesWithSource(value: string): SourceCharacter[] {
  const entities = /&(?:#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?|(?:nbsp|thinsp|ensp|emsp|hairsp);)/giu;
  const characters: SourceCharacter[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(entities)) {
    const start = match.index!;
    characters.push(...charactersFromSource(value.slice(lastIndex, start), lastIndex));
    let decoded: string | null = null;
    if (match[1] !== undefined || match[2] !== undefined) {
      const codePoint = Number.parseInt(match[1] ?? match[2], match[1] ? 16 : 10);
      if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try {
          decoded = String.fromCodePoint(codePoint);
        } catch {
          decoded = null;
        }
      }
    } else {
      decoded = " ";
    }
    if (decoded === null) {
      characters.push(...charactersFromSource(match[0], start));
    } else {
      characters.push(
        ...Array.from(decoded, (character) => ({
          value: character,
          start,
          end: start + match[0].length,
        })),
      );
    }
    lastIndex = start + match[0].length;
  }
  characters.push(...charactersFromSource(value.slice(lastIndex), lastIndex));
  return characters;
}

function removeMarkupWithSource(characters: SourceCharacter[]): SourceCharacter[] {
  const value = characters.map(({ value }) => value).join("");
  const removedRanges = [...value.matchAll(/<[^>]*>/gsu)].map((match) => ({
    start: match.index!,
    end: match.index! + match[0].length,
  }));
  if (removedRanges.length === 0) return characters;

  let offset = 0;
  let rangeIndex = 0;
  return characters.filter(({ value: character }) => {
    const start = offset;
    const end = start + character.length;
    offset = end;
    while (rangeIndex < removedRanges.length && removedRanges[rangeIndex].end <= start) {
      rangeIndex += 1;
    }
    const range = removedRanges[rangeIndex];
    return !range || end <= range.start || start >= range.end;
  });
}

function normalizeCharactersWithSource(value: string): SourceCharacter[] {
  const withoutMarkup = removeMarkupWithSource(decodeHtmlEntitiesWithSource(value));
  const decomposed = withoutMarkup.flatMap(({ value: character, start, end }) =>
    Array.from(character.normalize("NFKD"), (decomposedCharacter) => ({
      value: decomposedCharacter,
      start,
      end,
    })),
  );
  const lowercasedText = decomposed.map(({ value: character }) => character).join("")
    .toLocaleLowerCase("en-US");
  const loweredValues = Array.from(lowercasedText);
  const sourceForLoweredCharacters: SourceCharacter[] = [];
  let loweredOffset = 0;
  for (const sourceCharacter of decomposed) {
    const lowercaseLength = Array.from(
      sourceCharacter.value.toLocaleLowerCase("en-US"),
    ).length;
    for (let index = 0; index < lowercaseLength; index += 1) {
      const loweredCharacter = loweredValues[loweredOffset++];
      if (loweredCharacter === undefined) break;
      sourceForLoweredCharacters.push({
        value: loweredCharacter,
        start: sourceCharacter.start,
        end: sourceCharacter.end,
      });
    }
  }
  // Context-sensitive casing can change a character without changing its source
  // position; if a future Unicode rule changes output length, keep source indexes safe.
  while (loweredOffset < loweredValues.length) {
    const lastSource = decomposed.at(-1);
    if (!lastSource) break;
    sourceForLoweredCharacters.push({
      value: loweredValues[loweredOffset++],
      start: lastSource.start,
      end: lastSource.end,
    });
  }

  return sourceForLoweredCharacters
    .filter(({ value: character }) => !/\p{M}/u.test(character))
    .map(({ value: character, start, end }) => ({
      value: CONFUSABLE_LETTERS[character] ?? character,
      start,
      end,
    }))
    // Ignore punctuation, spaces, brackets, format controls, and markup.
    // This makes "w.o.r.d", "w (o) r d", and zero-width separators equivalent.
    .filter(({ value: character }) => /[\p{L}\p{N}]/u.test(character));
}

export function normalizeProfanityText(value: string): string {
  return normalizeCharactersWithSource(value)
    .map(({ value: character }) => character)
    .join("");
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
  return findProhibitedCampaignKeywordMatchDetails(sampleText, prohibitedKeywords)
    .matchedKeywords;
}

export function findProhibitedCampaignKeywordMatchDetails(
  sampleText: string,
  prohibitedKeywords: readonly string[],
): {
  matchedKeywords: string[];
  matchRanges: ProhibitedCampaignKeywordMatchRange[];
} {
  const normalizedSample = normalizeCharactersWithSource(sampleText);
  if (normalizedSample.length === 0) return { matchedKeywords: [], matchRanges: [] };

  const matchedKeywords: string[] = [];
  const occurrences: ProhibitedCampaignKeywordMatchRange[] = [];
  for (const { keyword, normalized } of getNormalizedProhibitedKeywords(prohibitedKeywords)) {
    const normalizedKeyword = Array.from(normalized);
    if (normalizedKeyword.length === 0 || normalizedKeyword.length > normalizedSample.length) continue;
    let keywordMatched = false;
    for (let startIndex = 0; startIndex <= normalizedSample.length - normalizedKeyword.length; startIndex += 1) {
      const matchesAtIndex = normalizedKeyword.every(
        (character, keywordIndex) =>
          normalizedSample[startIndex + keywordIndex].value === character,
      );
      if (!matchesAtIndex) continue;
      keywordMatched = true;
      occurrences.push({
        start: normalizedSample[startIndex].start,
        end: normalizedSample[startIndex + normalizedKeyword.length - 1].end,
        keywords: [keyword],
      });
    }
    if (keywordMatched) matchedKeywords.push(keyword);
  }

  occurrences.sort((left, right) => left.start - right.start || left.end - right.end);
  const matchRanges: ProhibitedCampaignKeywordMatchRange[] = [];
  for (const occurrence of occurrences) {
    const overlapping = matchRanges.at(-1);
    if (!overlapping || occurrence.start >= overlapping.end) {
      matchRanges.push(occurrence);
      continue;
    }
    overlapping.end = Math.max(overlapping.end, occurrence.end);
    for (const keyword of occurrence.keywords) {
      if (!overlapping.keywords.includes(keyword)) overlapping.keywords.push(keyword);
    }
  }
  return { matchedKeywords, matchRanges };
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
