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
  textBody: string;
  htmlBody?: string | null;
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

export function renderCampaignForContact(
  template: CampaignTemplate,
  personalization: CampaignPersonalization,
): RenderedCampaignTemplate {
  return {
    subject: personalizeCampaignText(template.subject, personalization),
    textBody: personalizeCampaignText(template.textBody, personalization),
    htmlBody: template.htmlBody
      ? personalizeCampaignHtml(template.htmlBody, personalization)
      : null,
  };
}
