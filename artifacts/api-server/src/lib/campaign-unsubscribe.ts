import { and, eq } from "drizzle-orm";
import {
  contactsTable,
  db,
  emailCampaignRecipientsTable,
} from "@workspace/db";
import { constantTimeEqual, hmac } from "./security";

type UnsubscribePayload = {
  version: 1;
  tenantId: string;
  contactId: string;
  campaignId: string;
};

export class InvalidUnsubscribeTokenError extends Error {
  constructor() {
    super("This unsubscribe link is invalid or no longer available.");
    this.name = "InvalidUnsubscribeTokenError";
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function encodePayload(payload: UnsubscribePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function createCampaignUnsubscribeToken(payload: {
  tenantId: string;
  contactId: string;
  campaignId: string;
}): string {
  const encoded = encodePayload({
    version: 1,
    tenantId: payload.tenantId,
    contactId: payload.contactId,
    campaignId: payload.campaignId,
  });
  return `${encoded}.${hmac(encoded, "campaign-unsubscribe-v1")}`;
}

function verifyCampaignUnsubscribeToken(token: string): UnsubscribePayload {
  if (token.length > 1024) throw new InvalidUnsubscribeTokenError();
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    throw new InvalidUnsubscribeTokenError();
  }
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (
    !constantTimeEqual(
      signature,
      hmac(encoded, "campaign-unsubscribe-v1"),
    )
  ) {
    throw new InvalidUnsubscribeTokenError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new InvalidUnsubscribeTokenError();
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("version" in payload) ||
    payload.version !== 1 ||
    !("tenantId" in payload) ||
    !isUuid(payload.tenantId) ||
    !("contactId" in payload) ||
    !isUuid(payload.contactId) ||
    !("campaignId" in payload) ||
    !isUuid(payload.campaignId)
  ) {
    throw new InvalidUnsubscribeTokenError();
  }
  return payload as UnsubscribePayload;
}

export function normalizePublicAppOrigin(
  candidate: string | null | undefined,
): string | null {
  if (!candidate?.trim()) return null;
  try {
    const url = new URL(candidate.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicAppOrigin(requestOrigin?: string | null): string | null {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return normalizePublicAppOrigin(configured);

  const request = normalizePublicAppOrigin(requestOrigin);
  if (request) return request;

  if (process.env.NODE_ENV !== "production") {
    const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    if (replitDomain) {
      return normalizePublicAppOrigin(
        replitDomain.includes("://") ? replitDomain : `https://${replitDomain}`,
      );
    }
    return "https://mailflow.test";
  }
  return null;
}

export function createCampaignUnsubscribeUrls(
  origin: string,
  payload: { tenantId: string; contactId: string; campaignId: string },
): { browserUrl: string; oneClickUrl: string } {
  const normalizedOrigin = normalizePublicAppOrigin(origin);
  if (!normalizedOrigin) throw new Error("A valid public app origin is required.");
  const token = encodeURIComponent(createCampaignUnsubscribeToken(payload));
  return {
    browserUrl: `${normalizedOrigin}/unsubscribe?token=${token}`,
    oneClickUrl: `${normalizedOrigin}/api/public/unsubscribe?token=${token}`,
  };
}

export async function applyCampaignUnsubscribeToken(token: string): Promise<void> {
  const payload = verifyCampaignUnsubscribeToken(token);
  await db.transaction(async (tx) => {
    const [contact] = await tx
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, payload.contactId),
          eq(contactsTable.userId, payload.tenantId),
        ),
      )
      .for("update");
    if (!contact) throw new InvalidUnsubscribeTokenError();

    await tx
      .update(contactsTable)
      .set({ subscribed: false, updatedAt: new Date() })
      .where(
        and(
          eq(contactsTable.id, payload.contactId),
          eq(contactsTable.userId, payload.tenantId),
        ),
      );
    await tx
      .update(emailCampaignRecipientsTable)
      .set({ status: "suppressed", lastError: "Recipient unsubscribed." })
      .where(
        and(
          eq(emailCampaignRecipientsTable.userId, payload.tenantId),
          eq(emailCampaignRecipientsTable.contactId, payload.contactId),
          eq(emailCampaignRecipientsTable.status, "queued"),
        ),
      );
  });
}
