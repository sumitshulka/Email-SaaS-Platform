import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import bcrypt from "bcryptjs";

function applicationSecret(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "APP_ENCRYPTION_KEY or SESSION_SECRET must be configured for secure credentials.",
    );
  }
  return Buffer.from(secret, "utf8");
}

export function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function credentialKey(): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      applicationSecret(),
      Buffer.from("mailflow-saas"),
      Buffer.from("credential-encryption-v1"),
      32,
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sixDigitCode(): string {
  return String(randomInt(100000, 1000000));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string, purpose: string): string {
  return createHmac("sha256", requireSessionSecret())
    .update(`${purpose}:${value}`)
    .digest("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(value: string): string {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (
    version !== "v1" ||
    !ivText ||
    !tagText ||
    ciphertextText === undefined
  ) {
    throw new Error("Stored credential has an unsupported encryption format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}