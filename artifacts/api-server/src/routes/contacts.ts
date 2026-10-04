import { and, count, desc, eq, gt, inArray, lte } from "drizzle-orm";
import express, {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  CreateContactBody,
  CreateContactResponse,
  DeleteContactParams,
  ImportContactsQueryParams,
  ImportContactsResponse,
  ListContactsResponse,
} from "@workspace/api-zod";
import {
  contactListMembersTable,
  contactListsTable,
  contactsTable,
  db,
  subscriptionPackagesTable,
  userSubscriptionsTable,
  usersTable,
} from "@workspace/db";
import { getPlatformSettings } from "../lib/platform-settings";
import { requireUserRole } from "../lib/session";
import {
  buildRejectedContactsCsv,
  CsvSyntaxError,
  normalizeCsvHeader,
  parseCsvRecords,
  type CsvRecord,
} from "../lib/contact-csv";

const router: IRouter = Router();
export const contactImportRouter: IRouter = Router();

const contactCsvEnrichmentFields = [
  { key: "companyName", label: "Company name", aliases: ["companyname", "company", "organization", "organisation", "employer"], maxLength: 200 },
  { key: "linkedinUrl", label: "LinkedIn URL", aliases: ["linkedin", "linkedinurl", "linkedinprofile", "linkedinprofileurl"], maxLength: 2048 },
  { key: "phoneNumber", label: "Phone number", aliases: ["phonenumber", "phone", "telephone", "tel"], maxLength: 40 },
  { key: "jobTitle", label: "Job title", aliases: ["jobtitle", "title", "position"], maxLength: 200 },
  { key: "department", label: "Department", aliases: ["department", "team"], maxLength: 120 },
  { key: "seniority", label: "Seniority", aliases: ["seniority", "senioritylevel"], maxLength: 80 },
  { key: "mobilePhone", label: "Mobile phone", aliases: ["mobilephone", "mobile", "mobilenumber", "cellphone"], maxLength: 40 },
  { key: "websiteUrl", label: "Personal website URL", aliases: ["websiteurl", "personalwebsite", "personalwebsiteurl", "website"], maxLength: 2048 },
  { key: "twitterUrl", label: "Twitter URL", aliases: ["twitter", "twitterurl", "twitterprofile", "twitterprofileurl"], maxLength: 2048 },
  { key: "facebookUrl", label: "Facebook URL", aliases: ["facebook", "facebookurl", "facebookprofile", "facebookprofileurl"], maxLength: 2048 },
  { key: "instagramUrl", label: "Instagram URL", aliases: ["instagram", "instagramurl", "instagramprofile", "instagramprofileurl"], maxLength: 2048 },
  { key: "location", label: "Location", aliases: ["location", "contactlocation"], maxLength: 200 },
  { key: "preferredLanguage", label: "Preferred language", aliases: ["preferredlanguage", "language"], maxLength: 80 },
  { key: "timeZone", label: "Time zone", aliases: ["timezone", "tz"], maxLength: 100 },
  { key: "lifecycleStage", label: "Lifecycle stage", aliases: ["lifecyclestage", "stage"], maxLength: 80 },
  { key: "leadStatus", label: "Lead status", aliases: ["leadstatus"], maxLength: 80 },
  { key: "leadSource", label: "Lead source", aliases: ["leadsource"], maxLength: 120 },
  { key: "interests", label: "Interests", aliases: ["interests"], maxLength: 10000 },
  { key: "goals", label: "Goals", aliases: ["goals"], maxLength: 10000 },
  { key: "painPoints", label: "Pain points", aliases: ["painpoints"], maxLength: 10000 },
  { key: "personalizationContext", label: "Personalization context", aliases: ["personalizationcontext"], maxLength: 10000 },
  { key: "notes", label: "Notes", aliases: ["notes"], maxLength: 10000 },
  { key: "companyWebsiteUrl", label: "Company website URL", aliases: ["companywebsite", "companywebsiteurl", "organizationwebsite", "organizationwebsiteurl"], maxLength: 2048 },
  { key: "companyDomain", label: "Company domain", aliases: ["companydomain", "domain"], maxLength: 255 },
  { key: "companyIndustry", label: "Company industry", aliases: ["companyindustry", "industry"], maxLength: 120 },
  { key: "companySize", label: "Company size", aliases: ["companysize", "employees"], maxLength: 80 },
  { key: "companyRevenueRange", label: "Company revenue range", aliases: ["companyrevenuerange", "revenuerange", "revenue"], maxLength: 80 },
  { key: "companyDescription", label: "Company description", aliases: ["companydescription"], maxLength: 10000 },
  { key: "companyPhoneNumber", label: "Company phone number", aliases: ["companyphone", "companyphonenumber"], maxLength: 40 },
  { key: "companyLinkedinUrl", label: "Company LinkedIn URL", aliases: ["companylinkedin", "companylinkedinurl", "linkedincompanyurl", "companylinkedinprofile"], maxLength: 2048 },
  { key: "companyLocation", label: "Company location", aliases: ["companylocation", "headquarters"], maxLength: 200 },
] as const satisfies readonly {
  key: keyof typeof contactsTable.$inferInsert;
  label: string;
  aliases: readonly string[];
  maxLength: number;
}[];
const csvEnrichmentFieldByHeader = new Map<
  string,
  (typeof contactCsvEnrichmentFields)[number]
>(
  contactCsvEnrichmentFields.flatMap((field) =>
    field.aliases.map((alias) => [alias, field] as const),
  ),
);

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
  const [contacts, quota, settings, memberships] = await Promise.all([
    db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId))
      .orderBy(desc(contactsTable.createdAt)),
    getContactQuota(userId),
    getPlatformSettings(),
    db
      .select({
        contactId: contactListMembersTable.contactId,
        listId: contactListMembersTable.listId,
      })
      .from(contactListMembersTable)
      .where(eq(contactListMembersTable.userId, userId)),
  ]);
  const listIdsByContact = new Map<string, string[]>();
  for (const membership of memberships) {
    const listIds = listIdsByContact.get(membership.contactId) ?? [];
    listIds.push(membership.listId);
    listIdsByContact.set(membership.contactId, listIds);
  }
  res.json(
    ListContactsResponse.parse({
      contacts: contacts.map((contact) => ({
        ...contact,
        listIds: listIdsByContact.get(contact.id) ?? [],
      })),
      quota,
      uploadSettings: {
        maxFileSizeMb: settings.maxUploadFileSizeMb,
        allowedFileTypes: settings.allowedContactFileTypes,
      },
    }),
  );
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
  const name =
    parsed.data.name?.trim() ||
    [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(" ").trim();
  const email = parsed.data.email.trim().toLowerCase();
  if (!name || name.length > 120 || email.length > 254) {
    res.status(400).json({
      error: "Enter a contact name and a valid email address.",
      code: "INVALID_INPUT",
    });
    return;
  }

  const firstName = parsed.data.firstName?.trim() ?? name.split(/\s+/)[0] ?? "";
  const lastName =
    parsed.data.lastName?.trim() ??
    name.split(/\s+/).slice(1).join(" ");
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
      .values({
        userId,
        name,
        email,
        firstName,
        lastName,
        subscribed: parsed.data.subscribed ?? true,
      })
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
  res.status(201).json(
    CreateContactResponse.parse({ ...result.contact, listIds: [] }),
  );
});

contactImportRouter.post(
  "/contacts/import",
  requireUserRole,
  async (req, res, next): Promise<void> => {
    if (!req.is("text/csv")) {
      next();
      return;
    }

    const settings = await getPlatformSettings();
    const allowedTypes = settings.allowedContactFileTypes.map((type) =>
      type.trim().toLowerCase().replace(/^\./, ""),
    );
    if (!allowedTypes.includes("csv")) {
      res.status(415).json({
        error: "CSV imports are disabled by the platform file type settings.",
        code: "FILE_TYPE_NOT_ALLOWED",
      });
      return;
    }

    const parseBody = express.raw({
      type: "text/csv",
      limit: settings.maxUploadFileSizeMb * 1024 * 1024,
    });
    parseBody(req, res, (error) => {
      if (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "type" in error &&
          error.type === "entity.too.large"
        ) {
          res.status(413).json({
            error: `The CSV exceeds the ${settings.maxUploadFileSizeMb} MB upload limit.`,
            code: "FILE_TOO_LARGE",
          });
          return;
        }
        next(error);
        return;
      }

      void importContactCsv(req, res, settings).catch(next);
    });
  },
);

async function importContactCsv(
  req: Request,
  res: Response,
  settings: Awaited<ReturnType<typeof getPlatformSettings>>,
): Promise<void> {
  const rawListIds = req.query.listIds;
  const params = ImportContactsQueryParams.safeParse({
    ...req.query,
    listIds: typeof rawListIds === "string" ? [rawListIds] : rawListIds,
  });
  if (!params.success || (params.data.listId && params.data.listIds)) {
    res.status(400).json({
      error: "Choose valid contact lists.",
      code: "INVALID_INPUT",
    });
    return;
  }
  const listIds = [
    ...new Set(params.data.listIds ?? (params.data.listId ? [params.data.listId] : [])),
  ];

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({
      error: "Choose a non-empty CSV file.",
      code: "INVALID_CSV",
    });
    return;
  }

  let csvText: string;
  let records: CsvRecord[];
  try {
    csvText = new TextDecoder("utf-8", { fatal: true }).decode(req.body);
    records = parseCsvRecords(csvText);
  } catch (error) {
    if (error instanceof CsvSyntaxError) {
      res.status(400).json({
        error: `Invalid CSV near row ${error.rowNumber}: ${error.message}`,
        code: "INVALID_CSV",
      });
      return;
    }
    res.status(400).json({
      error: "The CSV must use UTF-8 text encoding.",
      code: "INVALID_CSV_ENCODING",
    });
    return;
  }

  const [headerRecord, ...dataRecords] = records;
  if (!headerRecord) {
    res.status(400).json({ error: "The CSV file is empty.", code: "INVALID_CSV" });
    return;
  }
  const headers = headerRecord.cells.map((header) =>
    normalizeCsvHeader(header).replace(/[^a-z0-9]/g, ""),
  );
  const emailIndex = headers.indexOf("email");
  const nameIndex = headers.indexOf("name");
  const firstNameIndex = headers.findIndex((header) =>
    ["firstname", "first", "givenname", "forename"].includes(header),
  );
  const lastNameIndex = headers.findIndex((header) =>
    ["lastname", "last", "surname", "familyname"].includes(header),
  );
  const enrichmentColumnIndices = new Map<
    (typeof contactCsvEnrichmentFields)[number]["key"],
    number
  >();
  for (const [index, header] of headers.entries()) {
    const field = csvEnrichmentFieldByHeader.get(header);
    if (field) {
      if (enrichmentColumnIndices.has(field.key)) {
        res.status(400).json({
          error: `Include at most one column for ${field.label}.`,
          code: "INVALID_CSV_HEADERS",
        });
        return;
      }
      enrichmentColumnIndices.set(field.key, index);
    }
  }
  if (
    new Set(headers).size !== headers.length ||
    emailIndex < 0 ||
    (nameIndex < 0 && firstNameIndex < 0 && lastNameIndex < 0)
  ) {
    res.status(400).json({
      error: "Include one email column and either name or first_name/last_name columns.",
      code: "INVALID_CSV_HEADERS",
    });
    return;
  }
  if (dataRecords.length === 0) {
    res.status(400).json({
      error: "The CSV has a header row but no contact rows.",
      code: "EMPTY_CSV",
    });
    return;
  }

  const rejected: Array<{
    rowNumber: number;
    email: string | null;
    reason: string;
  }> = [];
  const sourceRowsByNumber = new Map(
    dataRecords.map((record) => [record.rowNumber, record.cells]),
  );
  const getSourceValues = (rowNumber: number): string[] => {
    const sourceValues = sourceRowsByNumber.get(rowNumber);
    if (!sourceValues) {
      throw new Error(`Rejected contact row ${rowNumber} is missing its source values.`);
    }
    return sourceValues;
  };
  const validatedRows: Array<{
    rowNumber: number;
    email: string;
    name: string;
    firstName: string;
    lastName: string;
    enrichment: Partial<typeof contactsTable.$inferInsert>;
  }> = [];

  for (const record of dataRecords) {
    const rawEmail = record.cells[emailIndex]?.trim() ?? "";
    const rowEmail = rawEmail ? rawEmail.toLowerCase() : null;
    if (record.cells.length !== headers.length) {
      rejected.push({
        rowNumber: record.rowNumber,
        email: rowEmail,
        reason: `Expected ${headers.length} columns but found ${record.cells.length}.`,
      });
      continue;
    }

    const email = rawEmail.toLowerCase();
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      rejected.push({
        rowNumber: record.rowNumber,
        email: rowEmail,
        reason: "Enter a valid email address of 254 characters or fewer.",
      });
      continue;
    }

    let name = nameIndex >= 0 ? record.cells[nameIndex]!.trim() : "";
    let firstName =
      firstNameIndex >= 0 ? record.cells[firstNameIndex]!.trim() : "";
    let lastName =
      lastNameIndex >= 0 ? record.cells[lastNameIndex]!.trim() : "";
    if (!name) name = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!name) {
      rejected.push({
        rowNumber: record.rowNumber,
        email,
        reason: "Enter a contact name.",
      });
      continue;
    }
    if (name.length > 120) {
      rejected.push({
        rowNumber: record.rowNumber,
        email,
        reason: "Names can be up to 120 characters.",
      });
      continue;
    }
    if (!firstName && !lastName) {
      const [derivedFirstName = "", ...remainingName] = name.split(/\s+/);
      firstName = derivedFirstName;
      lastName = remainingName.join(" ");
    }
    if (firstName.length > 100 || lastName.length > 100) {
      rejected.push({
        rowNumber: record.rowNumber,
        email,
        reason: "First and last names can be up to 100 characters each.",
      });
      continue;
    }

    const enrichment: Partial<typeof contactsTable.$inferInsert> = {};
    const fieldProblems: string[] = [];
    for (const field of contactCsvEnrichmentFields) {
      const columnIndex = enrichmentColumnIndices.get(field.key);
      if (columnIndex === undefined) continue;
      const value = record.cells[columnIndex]?.trim() ?? "";
      if (value.length > field.maxLength) {
        fieldProblems.push(`${field.label} can be up to ${field.maxLength} characters.`);
      } else if (value) {
        Object.assign(enrichment, { [field.key]: value });
      }
    }
    if (fieldProblems.length > 0) {
      rejected.push({
        rowNumber: record.rowNumber,
        email,
        reason: fieldProblems.join(" "),
      });
      continue;
    }

    validatedRows.push({ rowNumber: record.rowNumber, email, name, firstName, lastName, enrichment });
  }

  const userId = req.authUser!.id;
  const result = await db.transaction(async (tx) => {
    const [lockedUser] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)
      .for("update");
    if (!lockedUser) return { kind: "user_missing" as const };

    if (listIds.length > 0) {
      const tenantLists = await tx
        .select({ id: contactListsTable.id })
        .from(contactListsTable)
        .where(
          and(
            inArray(contactListsTable.id, listIds),
            eq(contactListsTable.userId, userId),
          ),
        );
      if (tenantLists.length !== listIds.length) {
        return { kind: "invalid_list" as const };
      }
    }

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
    const [{ used: currentCount }] = await tx
      .select({ used: count() })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId));
    const currentUsed = Number(currentCount);
    const existingContacts = await tx
      .select({ email: contactsTable.email })
      .from(contactsTable)
      .where(eq(contactsTable.userId, userId));
    const existingEmails = new Set(existingContacts.map((contact) => contact.email));
    const seenImportEmails = new Set<string>();
    const toInsert: typeof contactsTable.$inferInsert[] = [];

    for (const contact of validatedRows) {
      if (existingEmails.has(contact.email)) {
        rejected.push({
          rowNumber: contact.rowNumber,
          email: contact.email,
          reason: "This email address is already in your contacts.",
        });
        continue;
      }
      if (seenImportEmails.has(contact.email)) {
        rejected.push({
          rowNumber: contact.rowNumber,
          email: contact.email,
          reason: "This email address appears more than once in the CSV file.",
        });
        continue;
      }
      seenImportEmails.add(contact.email);
      if (currentUsed + toInsert.length >= limit) {
        rejected.push({
          rowNumber: contact.rowNumber,
          email: contact.email,
          reason: `The contact limit of ${limit} has been reached.`,
        });
        continue;
      }
      toInsert.push({
        userId,
        name: contact.name,
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        ...contact.enrichment,
        subscribed: true,
      });
    }

    if (toInsert.length > 0) {
      const inserted = await tx
        .insert(contactsTable)
        .values(toInsert)
        .returning({ id: contactsTable.id });
      if (listIds.length > 0) {
        const memberships = inserted.flatMap((contact) =>
          listIds.map((listId) => ({
            userId,
            listId,
            contactId: contact.id,
          })),
        );
        const batchSize = 1000;
        for (let offset = 0; offset < memberships.length; offset += batchSize) {
          await tx
            .insert(contactListMembersTable)
            .values(memberships.slice(offset, offset + batchSize));
        }
      }
    }
    const used = currentUsed + toInsert.length;
    return {
      kind: "imported" as const,
      imported: toInsert.length,
      quota: {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        canAdd: used < limit,
        requiresSubscription: false,
      },
    };
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
  if (result.kind === "invalid_list") {
    res.status(400).json({
      error: "Choose contact lists from your workspace.",
      code: "INVALID_LIST",
    });
    return;
  }

  const orderedRejected = rejected.sort((left, right) => left.rowNumber - right.rowNumber);
  res.json(
    ImportContactsResponse.parse({
      imported: result.imported,
      rejected: orderedRejected,
      rejectedCsv: buildRejectedContactsCsv(
        headerRecord.cells,
        orderedRejected.map((row) => ({
          sourceValues: getSourceValues(row.rowNumber),
          reason: row.reason,
        })),
      ),
      quota: result.quota,
    }),
  );
}

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