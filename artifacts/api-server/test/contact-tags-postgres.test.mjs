import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { SetContactTagsBody, CreateContactTagBody } from "@workspace/api-zod";
import { contactTagCondition, readContactTags, replaceContactTags } from "../src/lib/contact-tags.ts";

test("tag selections reject more than two IDs", () => {
  assert.equal(SetContactTagsBody.safeParse({ tagIds: [randomUUID(), randomUUID(), randomUUID()] }).success, false);
  assert.equal(SetContactTagsBody.safeParse({ tagIds: [] }).success, true);
  assert.equal(CreateContactTagBody.safeParse({ name: "x".repeat(41) }).success, false);
});

test("private tags enforce two assignments, filter correctly and cascade safely",
  { skip: !process.env.RUN_CONTACT_TAGS_DB_TESTS }, async () => {
    process.env.NODE_ENV = "test";
    const database = drizzle(schema.pool, { schema });
    const rollback = new Error("ROLLBACK_TAG_FIXTURES");
    try {
      await assert.rejects(database.transaction(async tx => {
        schema.setTestDatabase(tx);
        const users = await tx.insert(schema.usersTable).values([1, 2].map(() => {
          const suffix = randomUUID();
          return { username: `tags-${suffix}`, email: `tags-${suffix}@example.test`,
            firstName: "Tag", lastName: "Fixture", passwordHash: "unused" };
        })).returning();
        const userId = users[0].id;
        const [contact, untagged, foreignContact] = await tx.insert(schema.contactsTable).values([
          { userId, name: "Tagged", email: `tagged-${randomUUID()}@example.test` },
          { userId, name: "Untagged", email: `untagged-${randomUUID()}@example.test` },
          { userId: users[1].id, name: "Foreign", email: `foreign-${randomUUID()}@example.test` },
        ]).returning();
        const [vip, partner, lead, foreignTag] = await tx.insert(schema.contactTagsTable).values([
          { userId, name: "VIP" }, { userId, name: "Partner" }, { userId, name: "Lead" },
          { userId: users[1].id, name: "VIP" },
        ]).returning();
        const apply = ids => replaceContactTags(tx, userId, contact.id, ids);
        assert.equal((await apply([vip.id, partner.id])).kind, "updated");
        assert.equal((await apply([vip.id, partner.id, lead.id])).kind, "invalid");
        assert.equal((await apply([vip.id, vip.id])).kind, "invalid");
        assert.equal((await apply([foreignTag.id])).kind, "not_found");
        assert.equal((await replaceContactTags(tx, userId, foreignContact.id, [vip.id])).kind, "not_found");
        assert.deepEqual((await readContactTags(userId, [contact.id])).get(contact.id).map(tag => tag.name), ["VIP", "Partner"]);
        const matching = async tagId => (await tx.select({ id: schema.contactsTable.id }).from(schema.contactsTable)
          .where(and(eq(schema.contactsTable.userId, userId), contactTagCondition(userId, tagId)))).map(row => row.id);
        assert.deepEqual(await matching(vip.id), [contact.id]);
        assert.deepEqual(await matching("__none__"), [untagged.id]);
        assert.deepEqual(await matching(foreignTag.id), []);
        await assert.rejects(tx.transaction(async inner => {
          await inner.insert(schema.contactTagsTable).values({ userId, name: "vip" });
        }), "case-insensitive duplicate library names must fail");
        await assert.rejects(tx.transaction(async inner => {
          await inner.insert(schema.contactTagAssignmentsTable).values({ userId, contactId: contact.id, tagId: lead.id, slot: 3 });
        }), "the database itself must reject a third tag slot");
        await assert.rejects(tx.transaction(async inner => {
          await inner.insert(schema.contactTagAssignmentsTable).values({ userId, contactId: untagged.id, tagId: foreignTag.id, slot: 1 });
        }), "the database must reject cross-account tag assignments");
        await tx.update(schema.contactTagsTable).set({ name: "Priority" }).where(eq(schema.contactTagsTable.id, vip.id));
        assert.equal((await readContactTags(userId, [contact.id])).get(contact.id)[0].name, "Priority");
        await tx.delete(schema.contactTagsTable).where(eq(schema.contactTagsTable.id, vip.id));
        assert.deepEqual((await readContactTags(userId, [contact.id])).get(contact.id).map(tag => tag.id), [partner.id]);
        assert.equal((await tx.select().from(schema.contactsTable).where(eq(schema.contactsTable.id, contact.id))).length, 1);
        assert.equal((await apply([])).kind, "updated");
        assert.equal((await readContactTags(userId, [contact.id])).get(contact.id), undefined);
        const [sameRevision] = await tx.select().from(schema.contactsTable).where(eq(schema.contactsTable.id, contact.id));
        assert.equal(sameRevision.updatedAt.getTime(), contact.updatedAt.getTime(), "tag-only edits must not reset a dirty profile form");
        throw rollback;
      }), error => error === rollback);
    } finally {
      schema.setTestDatabase(database);
      await schema.pool.end();
    }
  });
