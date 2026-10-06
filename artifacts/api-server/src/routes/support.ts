import {
  and,
  asc,
  desc,
  eq,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateSupportTicketBody,
  CreateSupportTicketResponse,
  GetAdminSupportTicketParams,
  GetAdminSupportTicketResponse,
  GetSupportTicketParams,
  GetSupportTicketResponse,
  ListAdminSupportTicketsQueryParams,
  ListAdminSupportTicketsResponse,
  ListSupportTicketsResponse,
  ReplyToAdminSupportTicketBody,
  ReplyToAdminSupportTicketParams,
  ReplyToAdminSupportTicketResponse,
  ReplyToSupportTicketBody,
  ReplyToSupportTicketParams,
  ReplyToSupportTicketResponse,
  UpdateAdminSupportTicketStatusBody,
  UpdateAdminSupportTicketStatusParams,
  UpdateAdminSupportTicketStatusResponse,
} from "@workspace/api-zod";
import {
  db,
  supportTicketMessagesTable,
  supportTicketsTable,
  usersTable,
} from "@workspace/db";
import { requireSuperadmin, requireUserRole } from "../lib/session";

const router: IRouter = Router();

type TicketRow = typeof supportTicketsTable.$inferSelect;

function ticketSummary(ticket: TicketRow) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    lastMessageAt: ticket.lastMessageAt.toISOString(),
  };
}

async function ticketMessages(ticketId: string, revealStaffNames = false) {
  const rows = await db
    .select({
      id: supportTicketMessagesTable.id,
      ticketId: supportTicketMessagesTable.ticketId,
      authorRole: supportTicketMessagesTable.authorRole,
      message: supportTicketMessagesTable.message,
      createdAt: supportTicketMessagesTable.createdAt,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(supportTicketMessagesTable)
    .leftJoin(
      usersTable,
      eq(supportTicketMessagesTable.authorUserId, usersTable.id),
    )
    .where(eq(supportTicketMessagesTable.ticketId, ticketId))
    .orderBy(asc(supportTicketMessagesTable.createdAt));

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    authorRole: row.authorRole,
      authorName: row.authorRole === "SUPERADMIN" && !revealStaffNames
        ? "Mailflow Support"
        : [row.firstName, row.lastName].filter(Boolean).join(" ") ||
          (row.authorRole === "SUPERADMIN" ? "Support team member" : "Customer"),
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function customerTicketDetail(ticket: TicketRow) {
  return {
    ticket: ticketSummary(ticket),
    messages: await ticketMessages(ticket.id),
  };
}

async function adminTicketDetail(ticketId: string) {
  const [row] = await db
    .select({
      ticket: supportTicketsTable,
      requesterFirstName: usersTable.firstName,
      requesterLastName: usersTable.lastName,
      requesterEmail: usersTable.email,
    })
    .from(supportTicketsTable)
    .innerJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(eq(supportTicketsTable.id, ticketId))
    .limit(1);
  if (!row) return null;
  return {
    ticket: {
      ...ticketSummary(row.ticket),
      requesterFirstName: row.requesterFirstName,
      requesterLastName: row.requesterLastName,
      requesterEmail: row.requesterEmail,
    },
    messages: await ticketMessages(ticketId, true),
  };
}

router.get(
  "/support/tickets",
  requireUserRole,
  async (req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.userId, req.authUser!.id))
      .orderBy(desc(supportTicketsTable.lastMessageAt))
      .limit(200);
    res.json(ListSupportTicketsResponse.parse({
      items: rows.map(ticketSummary),
    }));
  },
);

router.post(
  "/support/tickets",
  requireUserRole,
  async (req, res): Promise<void> => {
    const parsed = CreateSupportTicketBody.safeParse(req.body);
    const subject = typeof req.body?.subject === "string"
      ? req.body.subject.trim()
      : "";
    const message = typeof req.body?.message === "string"
      ? req.body.message.trim()
      : "";
    if (!parsed.success || !subject || !message) {
      res.status(400).json({
        error: "Enter a subject and message to open a support ticket.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const userId = req.authUser!.id;
    const ticket = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(supportTicketsTable)
        .values({ userId, subject, status: "open" })
        .returning();
      if (!created) return null;
      await tx.insert(supportTicketMessagesTable).values({
        ticketId: created.id,
        authorUserId: userId,
        authorRole: "USER",
        message,
      });
      return created;
    });
    if (!ticket) {
      res.status(500).json({
        error: "The support ticket could not be created.",
        code: "SUPPORT_TICKET_CREATE_FAILED",
      });
      return;
    }
    res.status(201).json(
      CreateSupportTicketResponse.parse(await customerTicketDetail(ticket)),
    );
  },
);

router.get(
  "/support/tickets/:ticketId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = GetSupportTicketParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Invalid support ticket identifier.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const [ticket] = await db
      .select()
      .from(supportTicketsTable)
      .where(and(
        eq(supportTicketsTable.id, params.data.ticketId),
        eq(supportTicketsTable.userId, req.authUser!.id),
      ))
      .limit(1);
    if (!ticket) {
      res.status(404).json({
        error: "Support ticket not found.",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
      return;
    }
    res.json(
      GetSupportTicketResponse.parse(await customerTicketDetail(ticket)),
    );
  },
);

router.post(
  "/support/tickets/:ticketId/messages",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = ReplyToSupportTicketParams.safeParse(req.params);
    const parsed = ReplyToSupportTicketBody.safeParse(req.body);
    const message = typeof req.body?.message === "string"
      ? req.body.message.trim()
      : "";
    if (!params.success || !parsed.success || !message) {
      res.status(400).json({
        error: "Enter a reply message.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const ticket = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(supportTicketsTable)
        .where(and(
          eq(supportTicketsTable.id, params.data.ticketId),
          eq(supportTicketsTable.userId, req.authUser!.id),
        ))
        .limit(1)
        .for("update");
      if (!existing) return null;
      await tx.insert(supportTicketMessagesTable).values({
        ticketId: existing.id,
        authorUserId: req.authUser!.id,
        authorRole: "USER",
        message,
      });
      const [updated] = await tx
        .update(supportTicketsTable)
        .set({ status: "open", lastMessageAt: new Date() })
        .where(eq(supportTicketsTable.id, existing.id))
        .returning();
      return updated ?? null;
    });
    if (!ticket) {
      res.status(404).json({
        error: "Support ticket not found.",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
      return;
    }
    res.json(
      ReplyToSupportTicketResponse.parse(await customerTicketDetail(ticket)),
    );
  },
);

router.get(
  "/admin/support/tickets",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const parsed = ListAdminSupportTicketsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Use a supported support-ticket status and search term.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const conditions = [];
    if (parsed.data.status !== "all") {
      conditions.push(eq(supportTicketsTable.status, parsed.data.status));
    }
    const search = parsed.data.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(supportTicketsTable.subject, pattern),
          ilike(usersTable.firstName, pattern),
          ilike(usersTable.lastName, pattern),
          ilike(
            sql`${usersTable.firstName} || ' ' || ${usersTable.lastName}`,
            pattern,
          ),
          ilike(usersTable.email, pattern),
        ),
      );
    }
    const rows = await db
      .select({
        ticket: supportTicketsTable,
        requesterFirstName: usersTable.firstName,
        requesterLastName: usersTable.lastName,
        requesterEmail: usersTable.email,
      })
      .from(supportTicketsTable)
      .innerJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(supportTicketsTable.lastMessageAt))
      .limit(200);
    res.json(ListAdminSupportTicketsResponse.parse({
      items: rows.map((row) => ({
        ...ticketSummary(row.ticket),
        requesterFirstName: row.requesterFirstName,
        requesterLastName: row.requesterLastName,
        requesterEmail: row.requesterEmail,
      })),
    }));
  },
);

router.get(
  "/admin/support/tickets/:ticketId",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = GetAdminSupportTicketParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: "Invalid support ticket identifier.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const detail = await adminTicketDetail(params.data.ticketId);
    if (!detail) {
      res.status(404).json({
        error: "Support ticket not found.",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
      return;
    }
    res.json(GetAdminSupportTicketResponse.parse(detail));
  },
);

router.post(
  "/admin/support/tickets/:ticketId/messages",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = ReplyToAdminSupportTicketParams.safeParse(req.params);
    const parsed = ReplyToAdminSupportTicketBody.safeParse(req.body);
    const message = typeof req.body?.message === "string"
      ? req.body.message.trim()
      : "";
    if (!params.success || !parsed.success || !message) {
      res.status(400).json({
        error: "Enter a reply message.",
        code: "INVALID_INPUT",
      });
      return;
    }

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(supportTicketsTable)
        .where(eq(supportTicketsTable.id, params.data.ticketId))
        .limit(1)
        .for("update");
      if (!existing) return null;
      await tx.insert(supportTicketMessagesTable).values({
        ticketId: existing.id,
        authorUserId: req.authUser!.id,
        authorRole: "SUPERADMIN",
        message,
      });
      const [ticket] = await tx
        .update(supportTicketsTable)
        .set({
          status: "waiting_on_customer",
          lastMessageAt: new Date(),
        })
        .where(eq(supportTicketsTable.id, existing.id))
        .returning();
      return ticket ?? null;
    });
    if (!updated) {
      res.status(404).json({
        error: "Support ticket not found.",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
      return;
    }
    const detail = await adminTicketDetail(updated.id);
    if (!detail) {
      res.status(404).json({
        error: "Support ticket not found.",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
      return;
    }
    res.json(ReplyToAdminSupportTicketResponse.parse(detail));
  },
);

router.patch(
  "/admin/support/tickets/:ticketId/status",
  requireSuperadmin,
  async (req, res): Promise<void> => {
    const params = UpdateAdminSupportTicketStatusParams.safeParse(req.params);
    const parsed = UpdateAdminSupportTicketStatusBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({
        error: "Choose a valid support-ticket status.",
        code: "INVALID_INPUT",
      });
      return;
    }
    const [ticket] = await db
      .update(supportTicketsTable)
      .set({ status: parsed.data.status })
      .where(eq(supportTicketsTable.id, params.data.ticketId))
      .returning();
    if (!ticket) {
      res.status(404).json({
        error: "Support ticket not found.",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
      return;
    }
    const detail = await adminTicketDetail(ticket.id);
    if (!detail) {
      res.status(404).json({
        error: "Support ticket not found.",
        code: "SUPPORT_TICKET_NOT_FOUND",
      });
      return;
    }
    res.json(UpdateAdminSupportTicketStatusResponse.parse(detail));
  },
);

export default router;
