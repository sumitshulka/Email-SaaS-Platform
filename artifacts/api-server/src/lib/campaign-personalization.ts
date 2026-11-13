import sanitizeHtml from "sanitize-html";

export const optionalCampaignFields = ["firstName", "lastName", "fullName", "companyName", "phoneNumber", "linkedinUrl"] as const;
export type CampaignFallbackValues = Partial<Record<typeof optionalCampaignFields[number], string>>;
export type CampaignPlaceholderSource = {
  subject?: string; subjectVariants?: string[]; greetingVariants?: string[]; signatureVariants?: string[];
  textBody?: string; htmlBody?: string | null; placeholderFallbacks?: CampaignFallbackValues;
};

export function campaignPlaceholderKeys(source: CampaignPlaceholderSource): string[] {
  const texts = [source.subject ?? "", ...(source.subjectVariants ?? []), ...(source.greetingVariants ?? []),
    ...(source.signatureVariants ?? []), source.textBody ?? "", sanitizeHtml(source.htmlBody ?? "")];
  return [...new Set(texts.flatMap(text => [...text.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)].map(match => match[1]!)))];
}

export function campaignFallbackError(source: CampaignPlaceholderSource, requireDefaults = true): string | null {
  const fallbacks = source.placeholderFallbacks ?? {};
  if (Object.values(fallbacks).some(value => value && /[{}]/.test(value))) {
    return "Fallback values must be plain text, not other placeholders.";
  }
  const keys = campaignPlaceholderKeys(source);
  const unsupported = keys.find(key => key !== "email" && !optionalCampaignFields.includes(key as typeof optionalCampaignFields[number]));
  if (unsupported) return `The {{${unsupported}}} placeholder is not supported.`;
  if (!requireDefaults) return null;
  const missing = keys.filter(key => key !== "email" && !fallbacks[key as keyof CampaignFallbackValues]?.trim());
  return missing.length ? `Set a fallback value for ${missing.map(key => `{{${key}}}`).join(", ")} before sending. Recipient details can be missing or change before delivery.` : null;
}

export function missingCampaignRecipientValue(
  source: CampaignPlaceholderSource, recipient: Record<string, string>,
): string | null {
  const missing = campaignPlaceholderKeys(source).filter(key => optionalCampaignFields.includes(key as typeof optionalCampaignFields[number])
    && !recipient[key]?.trim() && !source.placeholderFallbacks?.[key as keyof CampaignFallbackValues]?.trim());
  return missing.length ? `Recipient data is missing for ${missing.map(key => `{{${key}}}`).join(", ")} and no fallback is configured. Update the campaign before sending again.` : null;
}

export function fallbackPolicyText(body: string, fallbacks?: CampaignFallbackValues): string {
  return [body, ...Object.values(fallbacks ?? {})].join("\n");
}
