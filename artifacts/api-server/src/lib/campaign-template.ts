import sanitizeHtml from "sanitize-html";

export type CampaignPersonalization = {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  companyName: string;
  phoneNumber: string;
  linkedinUrl: string;
};

export type CampaignTemplate = {
  subject: string;
  subjectVariants?: string[];
  greetingVariants?: string[];
  signatureVariants?: string[];
  textBody: string;
  htmlBody?: string | null;
};

export type CampaignTemplateRenderOptions = {
  variantAssignment?: Partial<
    Record<"subject" | "greeting" | "signature", { index: number }>
  >;
  unsubscribeUrl?: string;
};

export type RenderedCampaignTemplate = {
  subject: string;
  textBody: string;
  htmlBody: string | null;
};

const allowedCampaignTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "em",
  "h1",
  "h2",
  "h3",
  "i",
  "li",
  "ol",
  "p",
  "strong",
  "u",
  "ul",
];

export function sanitizeCampaignHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: allowedCampaignTags,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
      }),
    },
  });
}

function replaceContactTokens(
  template: string,
  personalization: CampaignPersonalization,
  escapeValues: boolean,
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g,
    (token, rawKey: string) => {
      if (!Object.prototype.hasOwnProperty.call(personalization, rawKey)) {
        return token;
      }
      const value = personalization[rawKey as keyof CampaignPersonalization];
      return escapeValues
        ? value.replace(/[&<>"']/g, (character) => {
            const entities: Record<string, string> = {
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            };
            return entities[character]!;
          })
        : value;
    },
  );
}

export function personalizeCampaignText(
  template: string,
  personalization: CampaignPersonalization,
): string {
  return replaceContactTokens(template, personalization, false);
}

export function personalizeCampaignHtml(
  template: string,
  personalization: CampaignPersonalization,
): string {
  return replaceContactTokens(
    sanitizeCampaignHtml(template),
    personalization,
    true,
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function selectedValue(
  variants: string[] | undefined,
  index: number | undefined,
  fallback = "",
): string {
  if (!variants?.length) return fallback;
  const candidate = Number.isInteger(index) ? variants[index!] : undefined;
  return candidate ?? variants[0] ?? fallback;
}

export function renderCampaignForContact(
  template: CampaignTemplate,
  personalization: CampaignPersonalization,
  options: CampaignTemplateRenderOptions = {},
): RenderedCampaignTemplate {
  const subject = selectedValue(
    template.subjectVariants,
    options.variantAssignment?.subject?.index,
    template.subject,
  );
  const greeting = selectedValue(
    template.greetingVariants,
    options.variantAssignment?.greeting?.index,
  );
  const signature = selectedValue(
    template.signatureVariants,
    options.variantAssignment?.signature?.index,
  );
  const personalizedGreeting = personalizeCampaignText(greeting, personalization);
  const personalizedSignature = personalizeCampaignText(signature, personalization);
  const personalizedBody = personalizeCampaignText(
    template.textBody,
    personalization,
  );
  const unsubscribeFooter = options.unsubscribeUrl
    ? `Unsubscribe: ${options.unsubscribeUrl}`
    : "";
  const textBody = [
    personalizedGreeting,
    personalizedBody,
    personalizedSignature,
    unsubscribeFooter,
  ]
    .filter(Boolean)
    .join("\n\n");

  const htmlGreeting = personalizedGreeting
    ? `<p>${escapeHtml(personalizedGreeting).replace(/\r?\n/g, "<br>")}</p>`
    : "";
  const htmlSignature = personalizedSignature
    ? `<p>${escapeHtml(personalizedSignature).replace(/\r?\n/g, "<br>")}</p>`
    : "";
  const htmlUnsubscribe = options.unsubscribeUrl
    ? `<p><a href="${escapeHtml(options.unsubscribeUrl)}">Unsubscribe</a></p>`
    : "";
  return {
    subject: personalizeCampaignText(subject, personalization),
    textBody,
    htmlBody: template.htmlBody
      ? [
          htmlGreeting,
          personalizeCampaignHtml(template.htmlBody, personalization),
          htmlSignature,
          htmlUnsubscribe,
        ]
          .filter(Boolean)
          .join("\n")
      : null,
  };
}
