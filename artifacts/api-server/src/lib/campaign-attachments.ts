import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DeleteObjectCommand, GetObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db, systemConfigurationTable } from "@workspace/db";
import { decryptSecret } from "./security";

const MAX_BYTES = 5 * 1024 * 1024;
const SETTINGS_KEY = "campaign_object_storage";

type StoredS3Settings = {
  endpoint: string | null;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyIdEncrypted: string;
  secretAccessKeyEncrypted: string;
};

async function getStorageSettings(): Promise<StoredS3Settings | null> {
  const [row] = await db.select().from(systemConfigurationTable).where(eq(systemConfigurationTable.key, SETTINGS_KEY));
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const settings = value as Partial<StoredS3Settings>;
  if (
    typeof settings.bucket !== "string" || !settings.bucket.trim() ||
    typeof settings.region !== "string" || !settings.region.trim() ||
    typeof settings.accessKeyIdEncrypted !== "string" || !settings.accessKeyIdEncrypted ||
    typeof settings.secretAccessKeyEncrypted !== "string" || !settings.secretAccessKeyEncrypted
  ) {
    return null;
  }
  return {
    endpoint: typeof settings.endpoint === "string" && settings.endpoint.trim() ? settings.endpoint.trim() : null,
    region: settings.region.trim(),
    bucket: settings.bucket.trim(),
    prefix: typeof settings.prefix === "string" ? settings.prefix : "mailflow",
    forcePathStyle: settings.forcePathStyle === true,
    accessKeyIdEncrypted: settings.accessKeyIdEncrypted,
    secretAccessKeyEncrypted: settings.secretAccessKeyEncrypted,
  };
}

export async function isCampaignAttachmentStorageConfigured(): Promise<boolean> {
  return Boolean(await getStorageSettings());
}

function clientConfig(settings: StoredS3Settings): S3ClientConfig {
  return {
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: decryptSecret(settings.accessKeyIdEncrypted),
      secretAccessKey: decryptSecret(settings.secretAccessKeyEncrypted),
    },
  };
}

export type CampaignAttachment = {
  objectPath: string;
  name: string;
  size: number;
};

export function validateAttachmentList(value: unknown): value is CampaignAttachment[] {
  if (!Array.isArray(value) || value.length > 2) return false;
  let total = 0;
  for (const item of value) {
    if (
      !item || typeof item !== "object" ||
      typeof item.objectPath !== "string" ||
      typeof item.name !== "string" ||
      !/^[^/\\\u0000-\u001f]{1,180}\.pdf$/i.test(item.name) ||
      !Number.isInteger(item.size) || item.size < 1 || item.size > MAX_BYTES ||
      !/^\/objects\/mailflow-attachments\/[a-zA-Z0-9-]+\/[a-f0-9-]+$/.test(item.objectPath)
    ) return false;
    total += item.size;
  }
  return total <= MAX_BYTES;
}

export async function createCampaignAttachmentUpload(userId: string, name: string, size: number) {
  if (!/^[^/\\\u0000-\u001f]{1,180}\.pdf$/i.test(name)) throw new Error("Only PDF files are allowed.");
  if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) throw new Error("Each PDF must be 5 MB or smaller.");
  const settings = await getStorageSettings();
  if (!settings) {
    throw new Error("Campaign PDF uploads are unavailable because private storage is not configured.");
  }
  const key = `${settings.prefix.replace(/^\/+|\/+$/g, "")}/mailflow-attachments/${userId}/${randomUUID()}`.replace(/^\//, "");
  const client = new S3Client(clientConfig(settings));
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: settings.bucket, Key: key, ContentType: "application/pdf" }),
    { expiresIn: 900 },
  );
  return {
    uploadUrl,
    objectPath: `/objects/mailflow-attachments/${userId}/${key.split("/").at(-1)}`,
  };
}

export async function uploadCampaignAttachment(userId: string, name: string, bytes: Buffer) {
  if (!/^[^/\\\u0000-\u001f]{1,180}\.pdf$/i.test(name)) {
    throw new Error("Only PDF files are allowed.");
  }
  if (bytes.length < 1 || bytes.length > MAX_BYTES) {
    throw new Error("Each PDF must be 5 MB or smaller.");
  }
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("The selected file is not a valid PDF.");
  }
  const settings = await getStorageSettings();
  if (!settings) {
    throw new Error("Campaign PDF uploads are unavailable because private storage is not configured.");
  }
  const id = randomUUID();
  const key = `${settings.prefix.replace(/^\/+|\/+$/g, "")}/mailflow-attachments/${userId}/${id}`.replace(/^\//, "");
  const client = new S3Client(clientConfig(settings));
  await client.send(new PutObjectCommand({
    Bucket: settings.bucket,
    Key: key,
    Body: bytes,
    ContentLength: bytes.length,
    ContentType: "application/pdf",
  }));
  return {
    objectPath: `/objects/mailflow-attachments/${userId}/${id}`,
    name,
    size: bytes.length,
  };
}

function explainStorageTestFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  const details = error && typeof error === "object" ? error as {
    name?: unknown;
    Code?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: number };
  } : {};
  const code = String(details.Code ?? details.code ?? details.name ?? "");
  const status = details.$metadata?.httpStatusCode;

  if (/APP_ENCRYPTION_KEY or SESSION_SECRET must be configured/i.test(message)) {
    return new Error("The API deployment needs APP_ENCRYPTION_KEY or SESSION_SECRET to decrypt the saved storage credentials.");
  }
  if (/unable to authenticate|unsupported state/i.test(message)) {
    return new Error("The saved storage credentials cannot be decrypted. Keep APP_ENCRYPTION_KEY or SESSION_SECRET stable and re-enter both storage credentials in Superadmin settings using the production API.");
  }
  if (["InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidToken"].includes(code)) {
    return new Error("The storage service rejected the credentials. Re-enter the access key and secret in Superadmin settings and save them from the production environment.");
  }
  if (code === "NoSuchBucket") {
    return new Error("The configured bucket was not found. Check the bucket name, endpoint, and region in Superadmin settings.");
  }
  if (["PermanentRedirect", "AuthorizationHeaderMalformed", "IncorrectEndpoint"].includes(code) || status === 301) {
    return new Error("The storage service redirected the request. Check that the configured region and endpoint match the bucket's region.");
  }
  if (code === "AccessDenied" || code === "AllAccessDisabled" || status === 403) {
    return new Error("The storage service denied an operation. Check the bucket policy and grant this key PutObject and GetObject access for the configured prefix.");
  }
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code) ||
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timed out|certificate|TLS/i.test(message)) {
    return new Error("The production API could not reach the storage endpoint. Check DNS, outbound network access, TLS, and the endpoint URL from the API host.");
  }
  const safeCode = code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  return new Error(`Storage test failed${safeCode ? ` (${safeCode})` : status ? ` (HTTP ${status})` : ""}. Check the API server log for the provider error.`);
}

export async function testCampaignAttachmentStorage() {
  const settings = await getStorageSettings();
  if (!settings) {
    throw new Error("Campaign file storage is not configured. Save the S3-compatible settings first.");
  }

  let client: S3Client;
  try {
    client = new S3Client(clientConfig(settings));
  } catch (error) {
    throw explainStorageTestFailure(error);
  }

  const prefix = settings.prefix.replace(/^\/+|\/+$/g, "");
  const key = `${prefix ? `${prefix}/` : ""}mailflow-storage-check/probe.pdf`;
  const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "ascii");
  let failure: Error | null = null;
  let cleanupWarning: string | null = null;
  try {
    await client.send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: "application/pdf",
    }));
    const head = await client.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
    if (Number(head.ContentLength) !== bytes.length) {
      throw new Error("Storage probe size did not match after upload.");
    }
    const object = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
    if (!object.Body || !Buffer.from(await object.Body.transformToByteArray()).equals(bytes)) {
      throw new Error("Storage probe content did not match after download.");
    }
  } catch (error) {
    failure = explainStorageTestFailure(error);
  }

  try {
    await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
  } catch {
    cleanupWarning = "The test object could not be removed; grant DeleteObject for the check or remove mailflow-storage-check/probe.pdf manually.";
  }

  if (failure) {
    throw new Error(cleanupWarning ? `${failure.message} ${cleanupWarning}` : failure.message);
  }
  return {
    success: true,
    message: "Storage upload and download checks passed.",
    cleanupWarning,
  };
}

export async function readCampaignAttachments(userId: string, attachments: CampaignAttachment[]) {
  if (attachments.length === 0) return [];
  const settings = await getStorageSettings();
  if (!settings) {
    throw new Error("Campaign attachment storage is not configured.");
  }
  const client = new S3Client(clientConfig(settings));
  let total = 0;
  const result = [];
  for (const attachment of attachments) {
    if (!validateAttachmentList([attachment]) ||
      !attachment.objectPath.startsWith(`/objects/mailflow-attachments/${userId}/`)) {
      throw new Error("Campaign attachment is invalid.");
    }
    const id = attachment.objectPath.slice(`/objects/mailflow-attachments/${userId}/`.length);
    const key = `${settings.prefix.replace(/^\/+|\/+$/g, "")}/mailflow-attachments/${userId}/${id}`.replace(/^\//, "");
    const head = await client.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
    if (Number(head.ContentLength) !== attachment.size) throw new Error("Campaign attachment size could not be verified.");
    total += Number(head.ContentLength);
    if (total > MAX_BYTES) throw new Error("Campaign attachments exceed the 5 MB total limit.");
    const object = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
    if (!object.Body) throw new Error("Campaign attachment could not be read.");
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Only valid PDF files can be attached.");
    result.push({ filename: attachment.name, content: bytes, contentType: "application/pdf" });
  }
  return result;
}
