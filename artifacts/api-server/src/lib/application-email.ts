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
};

export type TenantEmailResult = {
  accepted: boolean;
  error?: string;
};

type TenantEmailTransport = (
  message: TenantEmailMessage,
) => Promise<TenantEmailResult>;

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

  await transport.sendMail({
    from: { name: config.fromName, address: config.fromEmail },
    to,
    replyTo: config.replyTo ?? undefined,
    subject,
    text,
  });
  transport.close();
}

export async function sendTenantEmail(
  configuration: TenantSendingConfiguration,
  to: string,
  subject: string,
  text: string,
): Promise<TenantEmailResult> {
  const message = {
    userId: configuration.userId,
    to,
    subject,
    text,
  };
  if (tenantTestTransport) {
    return tenantTestTransport(message);
  }

  const transport = nodemailer.createTransport({
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

  try {
    const info = await transport.sendMail({
      from: { name: configuration.fromName, address: configuration.fromEmail },
      to,
      replyTo: configuration.replyTo ?? undefined,
      subject,
      text,
    });
    const addressIs = (value: unknown): boolean =>
      value === to ||
      (typeof value === "object" &&
        value !== null &&
        "address" in value &&
        value.address === to);
    if (Array.isArray(info.rejected) && info.rejected.some(addressIs)) {
      return { accepted: false, error: "SMTP server rejected the recipient." };
    }
    if (Array.isArray(info.accepted) && info.accepted.some(addressIs)) {
      return { accepted: true };
    }
    return { accepted: false, error: "SMTP server did not accept the recipient." };
  } finally {
    transport.close();
  }
}

export function setTenantEmailTransportForTests(
  transport: TenantEmailTransport | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A tenant email transport can only be configured in test mode.");
  }
  tenantTestTransport = transport ?? undefined;
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
