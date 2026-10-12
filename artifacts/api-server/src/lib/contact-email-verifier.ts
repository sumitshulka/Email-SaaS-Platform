import { domainToASCII } from "node:url";
import { lookup, resolveMx } from "node:dns/promises";
import net from "node:net";
import { randomUUID } from "node:crypto";
import disposableDomainList from "disposable-email-domains" with { type: "json" };

export type ContactEmailVerification = {
  status: "accepted" | "rejected" | "catch_all" | "no_mail_server" | "inconclusive";
  checkedAt: string;
  providerName: string | null;
  verificationMethod: string;
  mailServer: string | null;
  catchAll: boolean | null;
  noReplyStyle: boolean;
  riskFlags: Array<"disposable_domain" | "role_based_address" | "likely_domain_typo">;
  suggestedEmail: string | null;
  message: string;
};

const SMTP_TIMEOUT_MS = 4_000;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DISPOSABLE_DOMAINS = new Set((disposableDomainList as string[]).map(domain => domain.toLowerCase()));
const COMMON_EMAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com",
  "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me",
  "protonmail.com", "fastmail.com", "gmx.com", "mail.com",
];
const ROLE_ADDRESS_TOKENS = new Set([
  "abuse", "admin", "billing", "careers", "contact", "customerservice",
  "feedback", "help", "hello", "info", "jobs", "marketing", "office",
  "postmaster", "press", "privacy", "sales", "security", "service",
  "support", "team", "webmaster",
]);

type ProviderProfile = {
  name: string;
  method: string;
  matches: (host: string) => boolean;
};

const PROVIDER_PROFILES: ProviderProfile[] = [
  {
    name: "Google Workspace",
    method: "Google MX SMTP recipient and catch-all probe",
    matches: (host) =>
      host === "googlemail.com" ||
      host === "aspmx.l.google.com" ||
      /^alt\d+\.aspmx\.l\.google\.com$/.test(host) ||
      host.endsWith(".google.com"),
  },
  {
    name: "Microsoft 365",
    method: "Microsoft 365 MX SMTP recipient and catch-all probe",
    matches: (host) =>
      host.endsWith(".mail.protection.outlook.com") ||
      host === "mail.protection.outlook.com",
  },
  {
    name: "Yahoo Mail",
    method: "Yahoo MX SMTP recipient and catch-all probe",
    matches: (host) => host.endsWith(".yahoodns.net"),
  },
  {
    name: "Zoho Mail",
    method: "Zoho MX SMTP recipient and catch-all probe",
    matches: (host) => /^mx\d?\.zoho\.(com|eu|in)$/.test(host),
  },
  {
    name: "Proton Mail",
    method: "Proton Mail MX SMTP recipient and catch-all probe",
    matches: (host) =>
      host === "mail.protonmail.ch" || host === "mailsec.protonmail.ch",
  },
  {
    name: "Fastmail",
    method: "Fastmail MX SMTP recipient and catch-all probe",
    matches: (host) => host.endsWith(".messagingengine.com"),
  },
  {
    name: "iCloud Mail",
    method: "iCloud MX SMTP recipient and catch-all probe",
    matches: (host) => /^mx\d+\.mail\.icloud\.com$/.test(host),
  },
];

export function identifyMailProvider(hosts: string[], domain: string): ProviderProfile & { name: string } {
  const normalizedHosts = hosts.map((host) => host.toLowerCase().replace(/\.$/, ""));
  const profile = PROVIDER_PROFILES.find(({ matches }) =>
    normalizedHosts.some(matches),
  );
  if (profile) {
    if (profile.name === "Google Workspace" &&
        (domain === "gmail.com" || domain === "googlemail.com")) {
      return { ...profile, name: "Gmail" };
    }
    return profile;
  }
  return {
    name: hosts.length ? "Other mail provider" : "Unknown mail provider",
    method: hosts.length
      ? "MX-directed SMTP recipient and catch-all probe"
      : "DNS mail-routing lookup",
    matches: () => true,
  };
}

function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0) || (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0));
  }
  return false;
}

function noReplyAddress(localPart: string): boolean {
  return /(?:^|[._+-])(?:no[\W_]*reply|do[\W_]*not[\W_]*reply)(?:$|[._+-])/i.test(localPart);
}

function isDisposableDomain(domain: string): boolean {
  const labels = domain.toLowerCase().split(".");
  for (let index = 0; index < labels.length - 1; index += 1) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(index).join("."))) return true;
  }
  return false;
}

function domainDistance(left: string, right: string): number {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}

function suggestCommonDomain(domain: string): string | null {
  let bestDistance = 3;
  let suggestion: string | null = null;
  let tied = false;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const distance = domainDistance(domain, candidate);
    if (distance === 0 || distance > 2) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      suggestion = candidate;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  return tied ? null : suggestion;
}

export function assessEmailRisks(email: string): {
  riskFlags: ContactEmailVerification["riskFlags"];
  suggestedEmail: string | null;
} {
  const [localPart = "", rawDomain = ""] = email.trim().split("@");
  const domain = domainToASCII(rawDomain).toLowerCase();
  const normalizedLocalPart = localPart.split("+", 1)[0].toLowerCase();
  const roleTokens = normalizedLocalPart.split(/[._+-]+/).filter(Boolean);
  const hasRoleAddress = roleTokens.some(token => ROLE_ADDRESS_TOKENS.has(token));
  const roleBased = hasRoleAddress || noReplyAddress(localPart);
  const suggestion = suggestCommonDomain(domain);
  const riskFlags: ContactEmailVerification["riskFlags"] = [];
  if (domain && isDisposableDomain(domain)) riskFlags.push("disposable_domain");
  if (roleBased) riskFlags.push("role_based_address");
  if (suggestion) riskFlags.push("likely_domain_typo");
  return {
    riskFlags,
    suggestedEmail: suggestion ? `${localPart}@${suggestion}` : null,
  };
}

type SmtpReply = { code: number; text: string };
type SmtpProbeEvidence = {
  recipientCode: number;
  catchAllCode: number;
  mailServer: string;
};

export function classifySmtpProbeEvidence(
  results: SmtpProbeEvidence[],
  incompleteHostCount: number,
): "accepted" | "rejected" | "catch_all" | "inconclusive" {
  if (results.some(({ catchAllCode }) => catchAllCode >= 200 && catchAllCode < 300)) {
    return "catch_all";
  }
  if (results.some(({ recipientCode, catchAllCode }) =>
    recipientCode >= 200 &&
    recipientCode < 300 &&
    catchAllCode >= 500 &&
    catchAllCode < 600
  )) {
    return "accepted";
  }
  if (
    results.length > 0 &&
    incompleteHostCount === 0 &&
    results.every(({ recipientCode, catchAllCode }) =>
      recipientCode >= 500 &&
      recipientCode < 600 &&
      catchAllCode >= 500 &&
      catchAllCode < 600
    )
  ) {
    return "rejected";
  }
  return "inconclusive";
}

async function probeServer(host: string, address: string, domain: string, recipient: string): Promise<{ recipient: SmtpReply; catchAll: SmtpReply }> {
  const socket = net.createConnection({ host: address, port: 25 });
  socket.setTimeout(SMTP_TIMEOUT_MS);
  let buffer = "";
  let pending = "";
  const replies: SmtpReply[] = [];
  const waiters: Array<{ resolve: (reply: SmtpReply) => void; reject: (error: Error) => void }> = [];
  const rejectAll = (error: Error) => {
    while (waiters.length) waiters.shift()!.reject(error);
  };
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      pending += `${line}\n`;
      if (/^\d{3} /.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), text: pending.trim() };
        pending = "";
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(reply);
        else replies.push(reply);
      }
    }
  });
  socket.on("error", error => rejectAll(error));
  socket.on("timeout", () => rejectAll(new Error("SMTP probe timed out")));
  const readReply = () => replies.length
    ? Promise.resolve(replies.shift()!)
    : new Promise<SmtpReply>((resolve, reject) => waiters.push({ resolve, reject }));
  const command = async (value: string) => {
    socket.write(`${value}\r\n`);
    return readReply();
  };
  try {
    const greeting = await readReply();
    if (greeting.code !== 220) throw new Error("Mail server did not accept the connection");
    const hello = await command("EHLO mailflow.invalid");
    if (hello.code < 200 || hello.code >= 400) throw new Error("Mail server did not accept the probe");
    const mailFrom = await command("MAIL FROM:<>");
    if (mailFrom.code < 200 || mailFrom.code >= 300) throw new Error("Mail server did not accept recipient checks");
    const recipientReply = await command(`RCPT TO:<${recipient}>`);
    const randomAddress = `mailflow-check-${randomUUID()}@${domain}`;
    const catchAllReply = await command(`RCPT TO:<${randomAddress}>`);
    socket.end("QUIT\r\n");
    return { recipient: recipientReply, catchAll: catchAllReply };
  } finally {
    socket.destroy();
  }
}

export async function verifyContactEmail(email: string): Promise<ContactEmailVerification> {
  const checkedAt = new Date().toISOString();
  const [localPart, rawDomain, extra] = email.trim().split("@");
  const domain = domainToASCII(rawDomain ?? "").toLowerCase();
  const noReplyStyle = noReplyAddress(localPart ?? "");
  const emailRisks = assessEmailRisks(email);
  if (extra !== undefined || !EMAIL_SHAPE.test(email.trim()) || !domain || domain.length > 253 || domain.endsWith(".local")) {
    return { status: "inconclusive", checkedAt, providerName: null, verificationMethod: "Email format check", mailServer: null, catchAll: null, noReplyStyle, ...emailRisks, message: "The stored address is not in a verifiable email format." };
  }

  let hosts: string[];
  try {
    hosts = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority).map(item => item.exchange.replace(/\.$/, ""));
  } catch {
    try {
      await lookup(domain);
      hosts = [domain]; // RFC implicit MX fallback.
    } catch {
      return { status: "no_mail_server", checkedAt, providerName: null, verificationMethod: "DNS mail-routing lookup", mailServer: null, catchAll: false, noReplyStyle, ...emailRisks, message: "This domain does not currently resolve to a mail server." };
    }
  }
  if (!hosts.length) {
    try {
      await lookup(domain);
      hosts = [domain];
    } catch {
      return { status: "no_mail_server", checkedAt, providerName: null, verificationMethod: "DNS mail-routing lookup", mailServer: null, catchAll: false, noReplyStyle, ...emailRisks, message: "This domain does not currently resolve to a mail server." };
    }
  }

  const provider = identifyMailProvider(hosts, domain);
  const providerHosts = hosts.filter((host) => provider.matches(host));
  const probeHosts = providerHosts.length ? providerHosts : hosts;
  let lastHost: string | null = null;
  let incompleteHostCount = 0;
  const evidence: SmtpProbeEvidence[] = [];
  for (const host of probeHosts.slice(0, 2)) {
    try {
      const addresses = await lookup(host, { all: true, verbatim: true });
      const publicAddress = addresses.find(address => isPublicAddress(address.address));
      if (!publicAddress) {
        incompleteHostCount += 1;
        continue;
      }
      lastHost = host;
      const result = await probeServer(host, publicAddress.address, domain, email.trim());
      evidence.push({
        recipientCode: result.recipient.code,
        catchAllCode: result.catchAll.code,
        mailServer: host,
      });
    } catch {
      incompleteHostCount += 1;
    }
  }
  const classification = classifySmtpProbeEvidence(evidence, incompleteHostCount);
  if (classification === "catch_all") {
    const outcomeHost = evidence.find(({ catchAllCode }) => catchAllCode >= 200 && catchAllCode < 300)?.mailServer ?? lastHost;
    return { status: classification, checkedAt, providerName: provider.name, verificationMethod: provider.method, mailServer: outcomeHost, catchAll: true, noReplyStyle, ...emailRisks, message: `${provider.name} accepts a randomly generated address too, so mailbox existence cannot be confirmed.` };
  }
  if (classification === "accepted") {
    const outcomeHost = evidence.find(({ recipientCode, catchAllCode }) =>
      recipientCode >= 200 && recipientCode < 300 && catchAllCode >= 500 && catchAllCode < 600
    )?.mailServer ?? lastHost;
    return { status: classification, checkedAt, providerName: provider.name, verificationMethod: provider.method, mailServer: outcomeHost, catchAll: false, noReplyStyle, ...emailRisks, message: `${provider.name} accepted this recipient and rejected the random control address during an SMTP check. This is not proof of inbox delivery or future acceptance.` };
  }
  if (classification === "rejected") {
    return { status: classification, checkedAt, providerName: provider.name, verificationMethod: provider.method, mailServer: lastHost, catchAll: false, noReplyStyle, ...emailRisks, message: `${provider.name} rejected both the recipient and random control address on each reachable mail server checked.` };
  }
  return {
    status: classification,
    checkedAt,
    providerName: provider.name,
    verificationMethod: provider.method,
    mailServer: lastHost,
    catchAll: null,
    noReplyStyle,
    ...emailRisks,
    message: `${provider.name} did not provide consistent, conclusive recipient answers across the mail servers checked. No message was sent.`,
  };
}
