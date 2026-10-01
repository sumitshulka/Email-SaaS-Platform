import { auditLogsTable, db } from "@workspace/db";

export async function writeAuditLog(input: {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogsTable).values({
    actorId: input.actorId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    ipAddress: input.ipAddress?.slice(0, 80) ?? null,
    metadata: input.metadata ?? {},
  });
}