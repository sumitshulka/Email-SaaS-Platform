import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const MAX_BYTES = 5 * 1024 * 1024;

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function storageLocation() {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("Private object storage is not configured.");
  const [bucketName, ...prefix] = dir.replace(/^\/+/, "").split("/");
  if (!bucketName || !prefix.length) throw new Error("Invalid private storage path.");
  return { bucketName, prefix: prefix.join("/") };
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
      !item ||
      typeof item !== "object" ||
      typeof item.objectPath !== "string" ||
      typeof item.name !== "string" ||
      !/^[^/\\\u0000-\u001f]{1,180}\.pdf$/i.test(item.name) ||
      !Number.isInteger(item.size) ||
      item.size < 1 ||
      item.size > MAX_BYTES ||
      !/^\/objects\/mailflow-attachments\/[a-zA-Z0-9-]+\/[a-f0-9-]+$/.test(item.objectPath)
    ) return false;
    total += item.size;
  }
  return total <= MAX_BYTES;
}

export async function createCampaignAttachmentUpload(userId: string, name: string, size: number) {
  if (!/^[^/\\\u0000-\u001f]{1,180}\.pdf$/i.test(name)) {
    throw new Error("Only PDF files are allowed.");
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) {
    throw new Error("Each PDF must be 5 MB or smaller.");
  }
  const { bucketName, prefix } = storageLocation();
  const objectName = `${prefix}/mailflow-attachments/${userId}/${randomUUID()}`;
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Could not create a secure PDF upload.");
  const data = (await response.json()) as { signed_url?: string };
  if (!data.signed_url) throw new Error("Could not create a secure PDF upload.");
  return {
    uploadUrl: data.signed_url,
    objectPath: `/objects/mailflow-attachments/${userId}/${objectName.split("/").at(-1)}`,
  };
}

export async function readCampaignAttachments(
  userId: string,
  attachments: CampaignAttachment[],
) {
  if (attachments.length === 0) return [];

  const { bucketName, prefix } = storageLocation();
  let total = 0;
  const result = [];
  for (const attachment of attachments) {
    if (!validateAttachmentList([attachment]) ||
      !attachment.objectPath.startsWith(`/objects/mailflow-attachments/${userId}/`)) {
      throw new Error("Campaign attachment is invalid.");
    }
    const key = attachment.objectPath.slice("/objects/".length);
    const file = storage.bucket(bucketName).file(`${prefix}/${key}`);
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size);
    if (!Number.isInteger(actualSize) || actualSize !== attachment.size) {
      throw new Error("Campaign attachment size could not be verified.");
    }
    total += actualSize;
    if (total > MAX_BYTES) throw new Error("Campaign attachments exceed the 5 MB total limit.");
    const [bytes] = await file.download();
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Only valid PDF files can be attached.");
    }
    result.push({ filename: attachment.name, content: bytes, contentType: "application/pdf" });
  }
  return result;
}
