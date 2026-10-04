import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { eq } from "drizzle-orm";
import {
  db, pool, usersTable, contactsTable, contactListsTable,
  emailCampaignsTable, emailCampaignRecipientsTable, emailSendAttemptsTable,
} from "@workspace/db";
import { hashPassword } from "../src/lib/security";

const metadataPath = "/tmp/mailflow-delivery-qa.json";
if (process.env.NODE_ENV === "production") throw new Error("Development fixture only");
try {
  if (process.argv.includes("--cleanup")) {
    const fixture = JSON.parse(readFileSync(metadataPath, "utf8"));
    await db.delete(usersTable).where(eq(usersTable.id, fixture.userId));
    for (const path of [metadataPath, "/tmp/mailflow-delivery-qa.csv", "/tmp/mailflow-delivery-qa.eml"]) {
      unlinkSync(path);
    }
    process.stdout.write("Temporary delivery fixture removed.\n");
  } else {
    const suffix = randomUUID().slice(0, 8);
    const username = `deliveryqa${suffix}`;
    const passwordHash = await hashPassword("Mailflow-report-qa!47");
    const fixture = await db.transaction(async (tx) => {
      const [user] = await tx.insert(usersTable).values({
        username, firstName: "Delivery", lastName: "QA",
        email: `${username}@example.test`, passwordHash,
        active: true, emailVerified: true, mustChangeCredentials: false,
      }).returning();
      const [list] = await tx.insert(contactListsTable).values({
        userId: user.id, name: `Report QA ${suffix}`,
      }).returning();
      const [campaign] = await tx.insert(emailCampaignsTable).values({
        userId: user.id, listId: list.id, name: `Delivery evidence QA ${suffix}`,
        subject: "Synthetic delivery evidence test",
        textBody: "Temporary test fixture. No email was sent.",
        status: "completed", queuedAt: new Date(Date.now() - 120_000),
        completedAt: new Date(Date.now() - 60_000),
      }).returning();
      const recipients = [];
      for (let i = 1; i <= 2; i++) {
        const email = `delivery-${i}-${suffix}@example.test`;
        const [contact] = await tx.insert(contactsTable).values({
          userId: user.id, email, firstName: `Report${i}`, lastName: "Fixture",
        }).returning();
        const [recipient] = await tx.insert(emailCampaignRecipientsTable).values({
          userId: user.id, campaignId: campaign.id, contactId: contact.id,
          email, firstName: contact.firstName, lastName: contact.lastName,
          status: "delivered", attempts: 1, deliveredAt: new Date(Date.now() - 60_000),
        }).returning();
        const [attempt] = await tx.insert(emailSendAttemptsTable).values({
          userId: user.id, recipientId: recipient.id,
          messageId: `<qa-report-${randomUUID()}@example.test>`,
          attemptedAt: new Date(Date.now() - 60_000), completedAt: new Date(Date.now() - 60_000),
          outcome: "smtp_accepted", smtpCode: 250, smtpResponse: "250 2.0.0 Accepted for relay",
          enhancedStatus: "2.0.0", dsnRequested: true,
        }).returning();
        recipients.push({ email, recipientId: recipient.id, attemptId: attempt.id, messageId: attempt.messageId });
      }
      return { userId: user.id, username, email: user.email, campaignId: campaign.id, suffix, recipients };
    });
    const first = fixture.recipients[0];
    const second = fixture.recipients[1];
    writeFileSync("/tmp/mailflow-delivery-qa.csv",
      `Message ID,RecipientAddress,Status\n${first.messageId},${first.email},Delivered\n<unmatched@qa.example.test>,${first.email},Delivered\n`);
    writeFileSync("/tmp/mailflow-delivery-qa.eml",
      `Original-Envelope-Id: ${second.attemptId}\r\nReporting-MTA: dns; mail.example.test\r\n\r\nFinal-Recipient: rfc822; ${second.email}\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 5.1.1 Synthetic recipient not found\r\n`);
    writeFileSync(metadataPath, JSON.stringify(fixture));
    process.stdout.write(JSON.stringify({ campaignId: fixture.campaignId, username: fixture.username, metadataPath }) + "\n");
  }
} finally {
  await pool.end();
}