import { and, count, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateContactFieldOptionBody,
  CreateContactFieldOptionResponse,
  DeleteContactFieldOptionParams,
  GetContactFieldOptionsResponse,
} from "@workspace/api-zod";
import {
  contactFieldKeys,
  contactFieldOptionsTable,
  contactsTable,
  db,
  usersTable,
} from "@workspace/db";
import { requireUserRole } from "../lib/session";

const router: IRouter = Router();
const MAX_OPTIONS_PER_FIELD = 500;
const normalize = (value: string) => value.trim().toLowerCase();

router.get("/contact-field-options", requireUserRole, async (req, res): Promise<void> => {
  const options = await db
    .select({
      id: contactFieldOptionsTable.id,
      field: contactFieldOptionsTable.fieldKey,
      value: contactFieldOptionsTable.value,
      createdAt: contactFieldOptionsTable.createdAt,
    })
    .from(contactFieldOptionsTable)
    .where(eq(contactFieldOptionsTable.userId, req.authUser!.id))
    .orderBy(contactFieldOptionsTable.fieldKey, contactFieldOptionsTable.normalizedValue);
  res.json(GetContactFieldOptionsResponse.parse({ options }));
});

router.post("/contact-field-options", requireUserRole, async (req, res): Promise<void> => {
  const parsed = CreateContactFieldOptionBody.safeParse(req.body);
  const value = typeof parsed.data?.value === "string" ? parsed.data.value.trim() : "";
  if (!parsed.success || !value) {
    res.status(400).json({
      error: "Choose a contact field and enter a non-empty value.",
      code: "INVALID_INPUT",
    });
    return;
  }
  const userId = req.authUser!.id;
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)
      .for("update");
    if (!user) return { kind: "user_missing" as const };

    const [duplicate] = await tx
      .select()
      .from(contactFieldOptionsTable)
      .where(and(
        eq(contactFieldOptionsTable.userId, userId),
        eq(contactFieldOptionsTable.fieldKey, parsed.data.field),
        eq(contactFieldOptionsTable.normalizedValue, normalize(value)),
      ))
      .limit(1);
    if (duplicate) return { kind: "duplicate" as const };
    const [{ value: existingCount }] = await tx
      .select({ value: count() })
      .from(contactFieldOptionsTable)
      .where(and(
        eq(contactFieldOptionsTable.userId, userId),
        eq(contactFieldOptionsTable.fieldKey, parsed.data.field),
      ));
    if (Number(existingCount) >= MAX_OPTIONS_PER_FIELD) return { kind: "limit" as const };

    const [option] = await tx
      .insert(contactFieldOptionsTable)
      .values({
        userId,
        fieldKey: parsed.data.field,
        value,
        normalizedValue: normalize(value),
      })
      .returning({
        id: contactFieldOptionsTable.id,
        field: contactFieldOptionsTable.fieldKey,
        value: contactFieldOptionsTable.value,
        createdAt: contactFieldOptionsTable.createdAt,
      });
    return option ? { kind: "created" as const, option } : { kind: "duplicate" as const };
  });
  if (result.kind === "user_missing") {
    res.status(401).json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" });
    return;
  }
  if (result.kind === "duplicate") {
    res.status(409).json({ error: "That value already exists in this contact field.", code: "CONTACT_FIELD_OPTION_EXISTS" });
    return;
  }
  if (result.kind === "limit") {
    res.status(409).json({ error: `This contact field already has ${MAX_OPTIONS_PER_FIELD} values.`, code: "CONTACT_FIELD_OPTION_LIMIT" });
    return;
  }
  res.status(201).json(CreateContactFieldOptionResponse.parse({ option: result.option }));
});

router.delete(
  "/contact-field-options/:optionId",
  requireUserRole,
  async (req, res): Promise<void> => {
    const params = DeleteContactFieldOptionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid contact field value.", code: "INVALID_INPUT" });
      return;
    }
    const userId = req.authUser!.id;
    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)
        .for("update");
      if (!user) return "not_found" as const;
      const [option] = await tx
        .select()
        .from(contactFieldOptionsTable)
        .where(and(
          eq(contactFieldOptionsTable.id, params.data.optionId),
          eq(contactFieldOptionsTable.userId, userId),
        ))
        .limit(1)
        .for("update");
      if (!option) return "not_found" as const;
      const filters = [eq(contactsTable.userId, userId)];
      switch (option.fieldKey) {
        case "jobTitle": filters.push(sql`lower(${contactsTable.jobTitle}) = ${option.normalizedValue}`); break;
        case "preferredLanguage": filters.push(sql`lower(${contactsTable.preferredLanguage}) = ${option.normalizedValue}`); break;
        case "lifecycleStage": filters.push(sql`lower(${contactsTable.lifecycleStage}) = ${option.normalizedValue}`); break;
        case "leadStatus": filters.push(sql`lower(${contactsTable.leadStatus}) = ${option.normalizedValue}`); break;
        case "leadSource": filters.push(sql`lower(${contactsTable.leadSource}) = ${option.normalizedValue}`); break;
      }
      const [contact] = await tx
        .select({ id: contactsTable.id })
        .from(contactsTable)
        .where(and(...filters))
        .limit(1);
      if (contact) return "in_use" as const;
      await tx
        .delete(contactFieldOptionsTable)
        .where(and(
          eq(contactFieldOptionsTable.id, option.id),
          eq(contactFieldOptionsTable.userId, userId),
        ));
      return "deleted" as const;
    });
    if (result === "not_found") {
      res.status(404).json({ error: "Contact field value not found.", code: "CONTACT_FIELD_OPTION_NOT_FOUND" });
      return;
    }
    if (result === "in_use") {
      res.status(409).json({ error: "This value is assigned to a contact. Change that contact's value before removing it.", code: "CONTACT_FIELD_OPTION_IN_USE" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
