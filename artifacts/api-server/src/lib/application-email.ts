import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import {
  applicationEmailConfigurationTable,
  db,
  type TenantSendingConfiguration,
} from "@workspace/db";
import { decryptSecret } from "./security";

export type ApplicationEmailConfigInput = {
  host: string;
  port: number;
  encryption: "none" | "ssl" | "tls";
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
};

export type ApplicationEmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type TenantEmailMessage = {
  userId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  tracking?: {
    attemptId: string;
    messageId: string;
    dsnRequested: boolean;
  };
};

export type TenantEmailResult = {
  accepted: boolean;
  error?: string;
  smtpResponse?: string;
  smtpCode?: number;
  enhancedStatus?: string;
};

type TenantEmailTransport = (
  message: TenantEmailMessage,
  configuration: TenantSendingEmailConfiguration,
) => Promise<TenantEmailResult>;

export type TenantSendingEmailConfiguration = Pick<
  TenantSendingConfiguration,
  | "userId"
  | "provider"
  | "host"
  | "port"
  | "encryption"
  | "usernameEncrypted"
  | "passwordEncrypted"
  | "fromName"
  | "fromEmail"
  | "replyTo"
>;

type TenantEmailVerifier = (
  configuration: TenantSendingEmailConfiguration,
) => Promise<void>;

export async function getApplicationEmailConfig() {
  const [config] = await db
    .select()
    .from(applicationEmailConfigurationTable)
    .where(eq(applicationEmailConfigurationTable.id, "platform"));
  return config ?? null;
}

export async function sendApplicationEmail(
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  if (testTransport) {
    await testTransport({ to, subject, text });
    return;
  }

  const config = await getApplicationEmailConfig();
  if (!config) {
    throw new Error("Application email is not configured.");
  }

  const password = decryptSecret(config.passwordEncrypted);
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.encryption === "ssl",
    requireTLS: config.encryption === "tls",
    auth: { user: decryptSecret(config.username), pass: password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    logger: false,
    debug: false,
  });

  try {
    await transport.sendMail({
      from: { name: config.fromName, address: config.fromEmail },
      to,
      replyTo: config.replyTo ?? undefined,
      subject,
      text,
    });
  } finally {
    transport.close();
  }
}

export async function sendSupportReplyNotification(
  to: string,
  ticketSubject: string,
  ticketId: string,
  origin: string,
): Promise<void> {
  const conversationUrl = new URL("/support", origin);
  conversationUrl.searchParams.set("ticketId", ticketId);

  await sendApplicationEmail(
    to,
    "A reply to your Mailflow support ticket",
    `Mailflow Support replied to your support ticket "${ticketSubject}".\n\nView the conversation: ${conversationUrl.toString()}`,
  );
}

export async function sendTenantEmail(
  configuration: TenantSendingEmailConfiguration,
  to: string,
  subject: string,
  text: string,
  html?: string,
  tracking?: TenantEmailMessage["tracking"],
): Promise<TenantEmailResult> {
  const message = {
    userId: configuration.userId,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    ...(tracking ? { tracking } : {}),
  };
  if (tenantTestTransport) {
    return tenantTestTransport(message, configuration);
  }

  const transport = createTenantTransport(configuration);

  try {
    const info = await transport.sendMail({
      from: { name: configuration.fromName, address: configuration.fromEmail },
      to,
      replyTo: configuration.replyTo ?? undefined,
      subject,
      text,
      ...(html ? { html } : {}),
      ...(tracking
        ? {
            messageId: tracking.messageId,
            headers: { "X-Mailflow-Attempt-ID": tracking.attemptId },
            ...(tracking.dsnRequested
              ? {
                  dsn: {
                    id: tracking.attemptId,
                    return: "headers",
                    notify: ["success", "failure", "delay"],
                    recipient: to,
                  },
                }
              : {}),
          }
        : {}),
    });
    const smtpResponse = safeSmtpResponse(info.response, configuration);
    const smtpCode =
      typeof info.responseCode === "number"
        ? info.responseCode
        : Number(smtpResponse?.match(/^(\d{3})/)?.[1]) || undefined;
    const enhancedStatus =
      smtpResponse?.match(/\b([245]\.\d{1,3}\.\d{1,3})\b/)?.[1];
    const evidence = {
      ...(smtpResponse ? { smtpResponse } : {}),
      ...(smtpCode ? { smtpCode } : {}),
      ...(enhancedStatus ? { enhancedStatus } : {}),
    };
    const addressIs = (value: unknown): boolean =>
      value === to ||
      (typeof value === "object" &&
        value !== null &&
        "address" in value &&
        value.address === to);
    if (Array.isArray(info.rejected) && info.rejected.some(addressIs)) {
      return {
        accepted: false,
        error: "SMTP server rejected the recipient.",
        ...evidence,
      };
    }
    if (Array.isArray(info.accepted) && info.accepted.some(addressIs)) {
      return { accepted: true, ...evidence };
    }
    return {
      accepted: false,
      error: "SMTP server did not accept the recipient.",
      ...evidence,
    };
  } finally {
    transport.close();
  }
}

export async function verifyTenantEmailConnection(
  configuration: TenantSendingEmailConfiguration,
): Promise<void> {
  if (tenantTestTransport) {
    if (!tenantTestVerifier) {
      throw new Error(
        "A tenant SMTP verification transport is not configured in test mode.",
      );
    }
    await tenantTestVerifier(configuration);
    return;
  }

  const transport = createTenantTransport(configuration);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

function createTenantTransport(configuration: TenantSendingEmailConfiguration) {
  return nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.encryption === "ssl",
    requireTLS: configuration.encryption === "tls",
    auth: {
      user: decryptSecret(configuration.usernameEncrypted),
      pass: decryptSecret(configuration.passwordEncrypted),
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    logger: false,
    debug: false,
  });
}

function safeSmtpResponse(
  value: unknown,
  configuration: TenantSendingEmailConfiguration,
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  let safe = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
  for (const credential of [
    decryptSecret(configuration.usernameEncrypted),
    decryptSecret(configuration.passwordEncrypted),
  ]) {
    if (credential) safe = safe.split(credential).join("[redacted]");
  }
  return safe.slice(0, 1000);
}

export function setTenantEmailTransportForTests(
  transport: TenantEmailTransport | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A tenant email transport can only be configured in test mode.");
  }
  tenantTestTransport = transport ?? undefined;
}

export function setTenantEmailVerifierForTests(
  verifier: TenantEmailVerifier | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "A tenant email verifier can only be configured in test mode.",
    );
  }
  tenantTestVerifier = verifier ?? undefined;
}

export function setApplicationEmailTransportForTests(
  transport: ((message: ApplicationEmailMessage) => Promise<void>) | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A test email transport can only be configured in test mode.");
  }
  testTransport = transport ?? undefined;
}

let testTransport:
  | ((message: ApplicationEmailMessage) => Promise<void>)
  | undefined;
let tenantTestTransport: TenantEmailTransport | undefined;
let tenantTestVerifier: TenantEmailVerifier | undefined;
