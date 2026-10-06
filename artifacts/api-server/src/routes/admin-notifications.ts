import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAdminNotificationBody,
  CreateAdminNotificationResponse,
  DeleteAdminNotificationParams,
  ListAdminNotificationsQueryParams,
  ListAdminNotificationsResponse,
  UpdateAdminNotificationStatusBody,
  UpdateAdminNotificationStatusParams,
  UpdateAdminNotificationStatusResponse,
} from "@workspace/api-zod";
import {
  db,
  platformNotificationReadsTable,
  platformNotificationRecipientsTable,
  platformNotificationsTable,
  usersTable,
} from "@workspace/db";
import { requireSuperadmin } from "../lib/session";

const router: IRouter = Router();
const NOTICE_DELETION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

type NotificationRow = typeof platformNotificationsTable.$inferSelect;

function notificationStatus(notification: NotificationRow, now: Date): string {
  if (!notification.enabled) return "disabled";
  if (notification.startsAt > now) return "scheduled";
  if (notification.expiresAt <= now) return "expired";
  return "active";
}

async function withCounts(notifications: NotificationRow[]) {
  if (notifications.length === 0) return [];
  const ids = notifications.map(({ id }) => id);
  const [recipientRows, readRows, [broadcastRecipients]] = await Promise.all([
    db
      .select({
        notificationId: platformNotificationRecipientsTable.notificationId,
        value: count(),
      })
      .from(platformNotificationRecipientsTable)
      .where(inArray(platformNotificationRecipientsTable.notificationId, ids))
      .groupBy(platformNotificationRecipientsTable.notificationId),
    db
      .select({
        notificationId: platformNotificationReadsTable.notificationId,
        value: count(),
      })
      .from(platformNotificationReadsTable)
      .where(inArray(platformNotificationReadsTable.notificationId, ids))
      .groupBy(platformNotificationReadsTable.notificationId),
    db
      .select({ value: count() })
      .from(usersTable)
      .where(
        and(eq(usersTable.role, "USER"), isNull(usersTable.deletedAt)),
      ),
  ]);
  const recipientCounts = new Map(
    recipientRows.map((row) => [row.notificationId, row.value]),
  );
  const readCounts = new Map(
    readRows.map((row) => [row.notificationId, row.value]),
  );
  const broadcastCount = broadcastRecipients?.value ?? 0;
  const now = new Date();

  return notifications.map((notification) => ({
    id: notification.id,
    title: notification.title,
    message: notification.message,
    audience: notification.audience,
    enabled: notification.enabled,
    status: notificationStatus(notification, now),
    startsAt: notification.startsAt.toISOString(),
    expiresAt: notification.expiresAt.toISOString(),
    recipientCount:
      notification.audience === "broadcast"
        ? broadcastCount
        : (recipientCounts.get(notification.id) ?? 0),
    readCount: readCounts.get(notification.id) ?? 0,
    createdAt: notification.createdAt.toISOString(),
  }));
}

router.get(
  "/admin/notifications",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = ListAdminNotificationsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Search terms must be 160 characters or fewer.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const search = parsed.data.search?.trim();
    const pattern = search
      ? `%${search.replace(/[\\%_]/g, "\\$&")}%`
      : undefined;
    const notifications = await db
      .select()
      .from(platformNotificationsTable)
      .where(
        pattern
          ? or(
              ilike(platformNotificationsTable.title, pattern),
              ilike(platformNotificationsTable.message, pattern),
            )
          : undefined,
      )
      .orderBy(desc(platformNotificationsTable.createdAt))
      .limit(200);

    res.json(
      ListAdminNotificationsResponse.parse({
        items: await withCounts(notifications),
      }),
    );
  },
);

router.post(
  "/admin/notifications",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = CreateAdminNotificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter a title, message, audience, and valid schedule.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const { title, message, audience, startsAt, expiresAt } = parsed.data;
    const recipientUserIds = [...new Set(parsed.data.recipientUserIds)];
    if (startsAt >= expiresAt) {
      res.status(400).json({
        error: "The expiry date must be after the activation date.",
        code: "INVALID_SCHEDULE",
      });
      return;
    }
    if (
      (audience === "broadcast" && recipientUserIds.length > 0) ||
      (audience === "focused" && recipientUserIds.length === 0)
    ) {
      res.status(400).json({
        error:
          audience === "broadcast"
            ? "Broadcast notifications cannot include selected accounts."
            : "Choose at least one account for a focused notification.",
        code: "INVALID_RECIPIENTS",
      });
      return;
    }

    if (audience === "focused") {
      const eligibleRecipients = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            inArray(usersTable.id, recipientUserIds),
            eq(usersTable.role, "USER"),
            isNull(usersTable.deletedAt),
          ),
        );
      if (eligibleRecipients.length !== recipientUserIds.length) {
        res.status(400).json({
          error: "One or more selected accounts are not available.",
          code: "INVALID_RECIPIENTS",
        });
        return;
      }
    }

    const created = await db.transaction(async (tx) => {
      const [notification] = await tx
        .insert(platformNotificationsTable)
        .values({
          title,
          message,
          audience,
          startsAt,
          expiresAt,
          createdBy: req.authUser!.id,
        })
        .returning();
      if (!notification) return undefined;
      if (audience === "focused") {
        await tx.insert(platformNotificationRecipientsTable).values(
          recipientUserIds.map((userId) => ({
            notificationId: notification.id,
            userId,
          })),
        );
      }
      return notification;
    });

    if (!created) {
      res.status(500).json({
        error: "The notification could not be created.",
        code: "NOTIFICATION_CREATE_FAILED",
      });
      return;
    }

    const [summary] = await withCounts([created]);
    res
      .status(201)
      .json(CreateAdminNotificationResponse.parse(summary));
  },
);

router.delete(
  "/admin/notifications/:notificationId",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = DeleteAdminNotificationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Enter a valid notification ID.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const deletionCutoff = new Date(Date.now() - NOTICE_DELETION_RETENTION_MS);
    const [deleted] = await db
      .delete(platformNotificationsTable)
      .where(
        and(
          eq(platformNotificationsTable.id, params.data.notificationId),
          lte(platformNotificationsTable.expiresAt, deletionCutoff),
        ),
      )
      .returning({ id: platformNotificationsTable.id });

    if (deleted) {
      res.sendStatus(204);
      return;
    }

    const [existing] = await db
      .select({ id: platformNotificationsTable.id })
      .from(platformNotificationsTable)
      .where(eq(platformNotificationsTable.id, params.data.notificationId))
      .limit(1);
    if (!existing) {
      res.status(404).json({
        error: "Notification not found.",
        code: "NOTIFICATION_NOT_FOUND",
      });
      return;
    }

    res.status(409).json({
      error: "A notification can be deleted after it has been expired for 90 days.",
      code: "NOTIFICATION_RETENTION_PERIOD",
    });
  },
);

router.patch(
  "/admin/notifications/:notificationId/status",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = UpdateAdminNotificationStatusParams.safeParse(req.params);
    const body = UpdateAdminNotificationStatusBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: "Enter a valid notification status.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const [updated] = await db
      .update(platformNotificationsTable)
      .set({ enabled: body.data.enabled, updatedAt: new Date() })
      .where(eq(platformNotificationsTable.id, params.data.notificationId))
      .returning();
    if (!updated) {
      res.status(404).json({
        error: "Notification not found.",
        code: "NOTIFICATION_NOT_FOUND",
      });
      return;
    }

    const [summary] = await withCounts([updated]);
    res.json(UpdateAdminNotificationStatusResponse.parse(summary));
  },
);

export default router;
