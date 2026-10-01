export const CONTACT_PLACEHOLDERS = [
  { token: "{{firstName}}", label: "First name" },
  { token: "{{lastName}}", label: "Last name" },
  { token: "{{fullName}}", label: "Full name" },
  { token: "{{email}}", label: "Email" },
  { token: "{{companyName}}", label: "Company" },
  { token: "{{phoneNumber}}", label: "Phone" },
  { token: "{{linkedinUrl}}", label: "LinkedIn URL" },
];

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
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

export function plainTextToHtml(text: string): string {
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split("\n").map(escapeHtml).join("<br>")}</p>`)
    .join("");
}