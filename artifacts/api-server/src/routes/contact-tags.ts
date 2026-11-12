import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, contactTagsTable, usersTable } from "@workspace/db";
import {
  CreateContactTagBody, CreateContactTagResponse, UpdateContactTagBody, UpdateContactTagParams,
  UpdateContactTagResponse, DeleteContactTagParams, ListContactTagsResponse,
  SetContactTagsBody, SetContactTagsParams, SetContactTagsResponse,
} from "@workspace/api-zod";
import { requireUserRole } from "../lib/session";
import { replaceContactTags } from "../lib/contact-tags";

const router: IRouter = Router();
function duplicateName(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return ("code" in error && error.code === "23505") || ("cause" in error && duplicateName(error.cause));
}
router.get("/contact-tags", requireUserRole, async (req, res): Promise<void> => {
  const tags = await db.select({ id: contactTagsTable.id, name: contactTagsTable.name })
    .from(contactTagsTable).where(eq(contactTagsTable.userId, req.authUser!.id)).orderBy(asc(contactTagsTable.name));
  res.json(ListContactTagsResponse.parse(tags));
});
router.post("/contact-tags", requireUserRole, async (req, res): Promise<void> => {
  const input = CreateContactTagBody.safeParse(req.body);
  const name = input.success ? input.data.name.trim() : "";
  if (!input.success || !name) { res.status(400).json({ error: "Enter a tag name of 1–40 characters." }); return; }
  try {
    const [tag] = await db.insert(contactTagsTable).values({ userId: req.authUser!.id, name }).returning();
    res.status(201).json(CreateContactTagResponse.parse(tag));
  } catch (error) {
    if (!duplicateName(error)) throw error;
    res.status(409).json({ error: "A tag with this name already exists in your library." });
  }
});
router.patch("/contact-tags/:tagId", requireUserRole, async (req, res): Promise<void> => {
  const params = UpdateContactTagParams.safeParse(req.params);
  const input = UpdateContactTagBody.safeParse(req.body);
  const name = input.success ? input.data.name.trim() : "";
  if (!params.success || !input.success || !name) { res.status(400).json({ error: "Enter a valid tag and name of 1–40 characters." }); return; }
  try {
    const [tag] = await db.update(contactTagsTable).set({ name }).where(and(
      eq(contactTagsTable.id, params.data.tagId), eq(contactTagsTable.userId, req.authUser!.id),
    )).returning();
    if (!tag) { res.status(404).json({ error: "Tag not found." }); return; }
    res.json(UpdateContactTagResponse.parse(tag));
  } catch (error) {
    if (!duplicateName(error)) throw error;
    res.status(409).json({ error: "A tag with this name already exists in your library." });
  }
});
router.delete("/contact-tags/:tagId", requireUserRole, async (req, res): Promise<void> => {
  const params = DeleteContactTagParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid tag." }); return; }
  const userId = req.authUser!.id;
  const removed = await db.transaction(async tx => {
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
    return tx.delete(contactTagsTable).where(and(eq(contactTagsTable.id, params.data.tagId), eq(contactTagsTable.userId, userId))).returning();
  });
  if (!removed.length) { res.status(404).json({ error: "Tag not found." }); return; }
  res.sendStatus(204);
});
router.put("/contacts/:contactId/tags", requireUserRole, async (req, res): Promise<void> => {
  const params = SetContactTagsParams.safeParse(req.params);
  const input = SetContactTagsBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Select up to two different tags." }); return; }
  const result = await replaceContactTags(db, req.authUser!.id, params.data.contactId, input.data.tagIds);
  if (result.kind === "invalid") { res.status(400).json({ error: "Select up to two different tags." }); return; }
  if (result.kind === "not_found") { res.status(404).json({ error: "Contact or tag not found in your account." }); return; }
  res.json(SetContactTagsResponse.parse(result.tags));
});
export default router;
