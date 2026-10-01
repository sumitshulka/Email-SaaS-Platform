import { and, count, desc, eq, gt, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateContactBody,
  CreateContactResponse,
  DeleteContactParams,
  ListContactsResponse,
} from "@workspace/api-zod";
import {
  contactsTable,
  db,
  subscriptionPackagesTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { getPlatformSettings } from "../lib/platform-settings";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();

async function getContactQuota(userId: string) {
  const now = new Date();
  const [activeSubscription] = await db
    .select({ contactLimit: subscriptionPackagesTable.contactLimit })
    .from(userSubscriptionsTable)
    .innerJoin(
      subscriptionPackagesTable,
      eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
    )
    .where(
      and(
        eq(userSubscriptionsTable.userId, userId),
        eq(userSubscriptionsTable.status, "active"),
        lte(userSubscriptionsTable.startsAt, now),
        gt(userSubscriptionsTable.endsAt, now),
      ),
    )
    .orderBy(desc(userSubscriptionsTable.endsAt))
    .limit(1);
  const settings = await getPlatformSettings();
  const requiresSubscription =
    !activeSubscription && !settings.allowUserWithoutSubscription;
  const limit = requiresSubscription
    ? 0
    : Math.min(
        activeSubscription?.contactLimit ?? settings.maxContactsPerUser,
        settings.maxContactsPerUser,
      );
  const [{ used }] = await db
    .select({ used: count() })
    .from(contactsTable)
    .where(eq(contactsTable.userId, userId));
  const usedCount = Number(used);
  return {
    used: usedCount,
    limit,
    remaining: Math.max(0, limit - usedCount),
    canAdd: !requiresSubscription && usedCount < limit,
    requiresSubscription,
  };
}

router.get("/contacts", requireUserRole, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;
  const [contacts, quota] = await Promise.all([
    db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId))
      .orderBy(desc(contactsTable.createdAt)),
    getContactQuota(userId),
  ]);
  res.json(ListContactsResponse.parse({ contacts, quota }));
});

router.post("/contacts", requireUserRole, async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Enter a contact name and a valid email address.",
      code: "INVALID_INPUT",
    });
    return;
  }

  const userId = req.authUser!.id;
  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim().toLowerCase();
  if (!name || name.length > 120 || email.length > 254) {
    res.status(400).json({
      error: "Enter a contact name and a valid email address.",
      code: "INVALID_INPUT",
    });
    return;
  }

  const settings = await getPlatformSettings();
  const result = await db.transaction(async (tx) => {
    const [lockedUser] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)
      .for("update");
    if (!lockedUser) return { kind: "user_missing" as const };

    const now = new Date();
    const [activeSubscription] = await tx
      .select({ contactLimit: subscriptionPackagesTable.contactLimit })
      .from(userSubscriptionsTable)
      .innerJoin(
        subscriptionPackagesTable,
        eq(userSubscriptionsTable.packageId, subscriptionPackagesTable.id),
      )
      .where(
        and(
          eq(userSubscriptionsTable.userId, userId),
          eq(userSubscriptionsTable.status, "active"),
          lte(userSubscriptionsTable.startsAt, now),
          gt(userSubscriptionsTable.endsAt, now),
        ),
      )
      .orderBy(desc(userSubscriptionsTable.endsAt))
      .limit(1);

    if (!activeSubscription && !settings.allowUserWithoutSubscription) {
      return { kind: "subscription_required" as const };
    }
    const limit = Math.min(
      activeSubscription?.contactLimit ?? settings.maxContactsPerUser,
      settings.maxContactsPerUser,
    );
    const [duplicate] = await tx
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(eq(contactsTable.userId, userId), eq(contactsTable.email, email)))
      .limit(1);
    if (duplicate) return { kind: "duplicate" as const };

    const [{ used }] = await tx
      .select({ used: count() })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId));
    if (Number(used) >= limit) {
      return { kind: "limit_reached" as const, used: Number(used), limit };
    }

    const [contact] = await tx
      .insert(contactsTable)
      .values({ userId, name, email })
      .returning();
    return { kind: "created" as const, contact: contact! };
  });

  if (result.kind === "user_missing") {
    res.status(401).json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" });
    return;
  }
  if (result.kind === "subscription_required") {
    res.status(403).json({
      error: "An active subscription is required to add contacts.",
      code: "SUBSCRIPTION_REQUIRED",
    });
    return;
  }
  if (result.kind === "duplicate") {
    res.status(409).json({
      error: "That email address is already in your contacts.",
      code: "CONTACT_ALREADY_EXISTS",
    });
    return;
  }
  if (result.kind === "limit_reached") {
    res.status(409).json({
      error: `Your contact limit is ${result.limit}. Remove a contact or choose a package with more capacity.`,
      code: "CONTACT_LIMIT_REACHED",
    });
    return;
  }
  res.status(201).json(CreateContactResponse.parse(result.contact));
});

router.delete(
  "/contacts/:contactId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = DeleteContactParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid contact.", code: "INVALID_INPUT" });
      return;
    }
    const [deleted] = await db
      .delete(contactsTable)
      .where(
        and(
          eq(contactsTable.id, params.data.contactId),
          eq(contactsTable.userId, req.authUser!.id),
        ),
      )
      .returning({ id: contactsTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Contact not found.", code: "NOT_FOUND" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;