import {
  and,
  desc,
  eq,
  gt,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetUserNotificationsResponse,
  MarkUserNotificationReadParams,
  MarkUserNotificationReadResponse,
} from "@workspace/api-zod";
import {
  db,
  platformNotificationReadsTable,
  platformNotificationRecipientsTable,
  platformNotificationsTable,
} from "@workspace/db";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();

router.get("/notifications", requireUserRole, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;
  const now = new Date();
  const unreadRows = await db
    .select({
      id: platformNotificationsTable.id,
      title: platformNotificationsTable.title,
      message: platformNotificationsTable.message,
      startsAt: platformNotificationsTable.startsAt,
      expiresAt: platformNotificationsTable.expiresAt,
      createdAt: platformNotificationsTable.createdAt,
    })
    .from(platformNotificationsTable)
    .leftJoin(
      platformNotificationRecipientsTable,
      and(
        eq(
          platformNotificationRecipientsTable.notificationId,
          platformNotificationsTable.id,
        ),
        eq(platformNotificationRecipientsTable.userId, userId),
      ),
    )
    .leftJoin(
      platformNotificationReadsTable,
      and(
        eq(
          platformNotificationReadsTable.notificationId,
          platformNotificationsTable.id,
        ),
        eq(platformNotificationReadsTable.userId, userId),
      ),
    )
    .where(
      and(
        eq(platformNotificationsTable.enabled, true),
        lte(platformNotificationsTable.startsAt, now),
        gt(platformNotificationsTable.expiresAt, now),
        or(
          eq(platformNotificationsTable.audience, "broadcast"),
          eq(platformNotificationRecipientsTable.userId, userId),
        ),
        isNull(platformNotificationReadsTable.readAt),
      ),
    )
    .orderBy(desc(platformNotificationsTable.startsAt))
    .limit(100);

  const historyRows = await db
    .select({
      id: platformNotificationsTable.id,
      title: platformNotificationsTable.title,
      message: platformNotificationsTable.message,
      startsAt: platformNotificationsTable.startsAt,
      expiresAt: platformNotificationsTable.expiresAt,
      createdAt: platformNotificationsTable.createdAt,
      readAt: platformNotificationReadsTable.readAt,
    })
    .from(platformNotificationReadsTable)
    .innerJoin(
      platformNotificationsTable,
      eq(
        platformNotificationsTable.id,
        platformNotificationReadsTable.notificationId,
      ),
    )
    .where(eq(platformNotificationReadsTable.userId, userId))
    .orderBy(desc(platformNotificationReadsTable.readAt))
    .limit(100);

  res.json(
    GetUserNotificationsResponse.parse({
      unread: unreadRows.map((row) => ({
        ...row,
        startsAt: row.startsAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        readAt: null,
      })),
      history: historyRows.map((row) => ({
        ...row,
        startsAt: row.startsAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt.toISOString(),
      })),
    }),
  );
});

router.post(
  "/notifications/:notificationId/read",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = MarkUserNotificationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Invalid notification identifier.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const userId = req.authUser!.id;
    const now = new Date();
    const [available] = await db
      .select({ id: platformNotificationsTable.id })
      .from(platformNotificationsTable)
      .leftJoin(
        platformNotificationRecipientsTable,
        and(
          eq(
            platformNotificationRecipientsTable.notificationId,
            platformNotificationsTable.id,
          ),
          eq(platformNotificationRecipientsTable.userId, userId),
        ),
      )
      .where(
        and(
          eq(platformNotificationsTable.id, params.data.notificationId),
          eq(platformNotificationsTable.enabled, true),
          lte(platformNotificationsTable.startsAt, now),
          gt(platformNotificationsTable.expiresAt, now),
          or(
            eq(platformNotificationsTable.audience, "broadcast"),
            eq(platformNotificationRecipientsTable.userId, userId),
          ),
        ),
      )
      .limit(1);

    if (!available) {
      res.status(404).json({
        error: "Notification is not available to this account.",
        code: "NOTIFICATION_NOT_AVAILABLE",
      });
      return;
    }

    await db
      .insert(platformNotificationReadsTable)
      .values({ notificationId: params.data.notificationId, userId })
      .onConflictDoNothing();

    const [read] = await db
      .select({ readAt: platformNotificationReadsTable.readAt })
      .from(platformNotificationReadsTable)
      .where(
        and(
          eq(
            platformNotificationReadsTable.notificationId,
            params.data.notificationId,
          ),
          eq(platformNotificationReadsTable.userId, userId),
        ),
      )
      .limit(1);

    res.json(
      MarkUserNotificationReadResponse.parse({
        notificationId: params.data.notificationId,
        readAt: read?.readAt.toISOString() ?? now.toISOString(),
      }),
    );
  },
);

export default router;
