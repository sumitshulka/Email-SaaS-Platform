import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import {
  applicationEmailConfigurationTable,
  db,
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
