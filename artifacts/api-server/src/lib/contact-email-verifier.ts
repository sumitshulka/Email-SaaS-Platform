import { domainToASCII } from "node:url";
import { lookup, resolveMx } from "node:dns/promises";
import net from "node:net";
import { randomUUID } from "node:crypto";

export type ContactEmailVerification = {
  status: "accepted" | "rejected" | "catch_all" | "no_mail_server" | "inconclusive";
  checkedAt: string;
  mailServer: string | null;
  catchAll: boolean | null;
  noReplyStyle: boolean;
  message: string;
};

const SMTP_TIMEOUT_MS = 4_000;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

type SmtpReply = { code: number; text: string };
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
  if (extra !== undefined || !EMAIL_SHAPE.test(email.trim()) || !domain || domain.length > 253 || domain.endsWith(".local")) {
    return { status: "inconclusive", checkedAt, mailServer: null, catchAll: null, noReplyStyle, message: "The stored address is not in a verifiable email format." };
  }

  let hosts: string[];
  try {
    hosts = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority).map(item => item.exchange.replace(/\.$/, ""));
  } catch {
    try {
      await lookup(domain);
      hosts = [domain]; // RFC implicit MX fallback.
    } catch {
      return { status: "no_mail_server", checkedAt, mailServer: null, catchAll: false, noReplyStyle, message: "This domain does not currently resolve to a mail server." };
    }
  }
  if (!hosts.length) {
    try {
      await lookup(domain);
      hosts = [domain];
    } catch {
      return { status: "no_mail_server", checkedAt, mailServer: null, catchAll: false, noReplyStyle, message: "This domain does not currently resolve to a mail server." };
    }
  }

  let lastHost: string | null = null;
  for (const host of hosts.slice(0, 2)) {
    try {
      const addresses = await lookup(host, { all: true, verbatim: true });
      const publicAddress = addresses.find(address => isPublicAddress(address.address));
      if (!publicAddress) continue;
      lastHost = host;
      const result = await probeServer(host, publicAddress.address, domain, email.trim());
      const accepted = result.recipient.code >= 200 && result.recipient.code < 300;
      const rejected = result.recipient.code >= 500 && result.recipient.code < 600;
      const catchAll = result.catchAll.code >= 200 && result.catchAll.code < 300;
      if (catchAll) {
        return { status: "catch_all", checkedAt, mailServer: host, catchAll: true, noReplyStyle, message: "The server accepts a randomly generated address too, so mailbox existence cannot be confirmed." };
      }
      if (accepted) {
        return { status: "accepted", checkedAt, mailServer: host, catchAll: false, noReplyStyle, message: "The mail server accepted this recipient during an SMTP check. This is not proof of inbox delivery or future acceptance." };
      }
      if (rejected) {
        return { status: "rejected", checkedAt, mailServer: host, catchAll: false, noReplyStyle, message: "The mail server explicitly rejected this recipient during the SMTP check." };
      }
    } catch {
      // Continue to the next advertised MX. Do not log or return remote server text.
    }
  }
  return {
    status: "inconclusive",
    checkedAt,
    mailServer: lastHost,
    catchAll: null,
    noReplyStyle,
    message: "The mail server did not provide a conclusive recipient answer. No message was sent.",
  };
}
