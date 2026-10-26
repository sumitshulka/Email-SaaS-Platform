import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GetObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
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

async function getStorageSettings(): Promise<StoredS3Settings> {
  const [row] = await db.select().from(systemConfigurationTable).where(eq(systemConfigurationTable.key, SETTINGS_KEY));
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Campaign object storage is not configured by a superadmin.");
  }
  const settings = value as Partial<StoredS3Settings>;
  if (!settings.bucket || !settings.region || !settings.accessKeyIdEncrypted || !settings.secretAccessKeyEncrypted) {
    throw new Error("Campaign object storage is not configured by a superadmin.");
  }
  return settings as StoredS3Settings;
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

export async function readCampaignAttachments(userId: string, attachments: CampaignAttachment[]) {
  if (attachments.length === 0) return [];
  const settings = await getStorageSettings();
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
