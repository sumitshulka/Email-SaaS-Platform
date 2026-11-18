import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  companiesTable,
  contactListMembersTable,
  contactListsTable,
  contactTagAssignmentsTable,
  contactTagsTable,
  contactsTable,
  emailCampaignRepliesTable,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  prospectActionTypesTable,
  prospectActionsTable,
  prospectFollowUpsTable,
  prospectProductsTable,
  prospectStageHistoryTable,
  prospectStagesTable,
  prospectsTable,
  usersTable,
} from "@workspace/db";
import type { SQLWrapper } from "drizzle-orm";

export type ReportDataType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "boolean";

export type ReportOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal"
  | "between"
  | "in"
  | "is_empty"
  | "is_not_empty"
  | "is_true"
  | "is_false";

export type ReportAggregationOperation =
  | "count"
  | "count_distinct"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "win_rate";

export type ReportDateInterval = "day" | "week" | "month" | "quarter" | "year";

export type ReportField = {
  id: string;
  label: string;
  description: string;
  dataType: ReportDataType;
  operators: ReportOperator[];
  groupable: boolean;
  aggregations: ReportAggregationOperation[];
  dateIntervals: ReportDateInterval[];
  relationId?: string;
  currencyGroupFieldId?: string;
  calculated?: boolean;
  expression: SQLWrapper;
};

export type ReportJoin = {
  id: string;
  label: string;
  entityId: string;
  cardinality: "many_to_one" | "one_to_one" | "one_to_many";
  description: string;
  table: unknown;
  on: ReturnType<typeof and>;
  requires?: string[];
};

export type ReportEntity = {
  id: string;
  label: string;
  description: string;
  grain: string;
  table: unknown;
  tenantColumn: unknown;
  primaryKey: unknown;
  fields: ReportField[];
  joins: ReportJoin[];
};

const textOperators: ReportOperator[] = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "ends_with",
  "in",
  "is_empty",
  "is_not_empty",
];
const numberOperators: ReportOperator[] = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "between",
  "is_empty",
  "is_not_empty",
];
const dateOperators: ReportOperator[] = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "between",
  "is_empty",
  "is_not_empty",
];
const booleanOperators: ReportOperator[] = ["is_true", "is_false"];
const textAggregations: ReportAggregationOperation[] = ["count", "count_distinct"];
const numericAggregations: ReportAggregationOperation[] = [
  "count",
  "count_distinct",
  "sum",
  "avg",
  "min",
  "max",
];
const dateAggregations: ReportAggregationOperation[] = [
  "count",
  "count_distinct",
  "min",
  "max",
];
const supportedDateIntervals: ReportDateInterval[] = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
];

function textField(
  id: string,
  label: string,
  expression: SQLWrapper,
  description = "",
  relationId?: string,
  groupable = true,
): ReportField {
  return {
    id,
    label,
    description,
    dataType: "text",
    operators: textOperators,
    groupable,
    aggregations: textAggregations,
    dateIntervals: [],
    expression,
    ...(relationId ? { relationId } : {}),
  };
}

function numberField(
  id: string,
  label: string,
  expression: SQLWrapper,
  description = "",
  relationId?: string,
  groupable = true,
): ReportField {
  return {
    id,
    label,
    description,
    dataType: "number",
    operators: numberOperators,
    groupable,
    aggregations: numericAggregations,
    dateIntervals: [],
    expression,
    ...(relationId ? { relationId } : {}),
  };
}

function currencyField(
  id: string,
  label: string,
  expression: SQLWrapper,
  description = "",
  relationId?: string,
  currencyGroupFieldId?: string,
): ReportField {
  return {
    id,
    label,
    description,
    dataType: "currency",
    operators: numberOperators,
    groupable: true,
    aggregations: numericAggregations,
    dateIntervals: [],
    expression,
    ...(currencyGroupFieldId ? { currencyGroupFieldId } : {}),
    ...(relationId ? { relationId } : {}),
  };
}

function dateField(
  id: string,
  label: string,
  expression: SQLWrapper,
  description = "",
  relationId?: string,
): ReportField {
  return {
    id,
    label,
    description,
    dataType: "date",
    operators: dateOperators,
    groupable: true,
    aggregations: dateAggregations,
    dateIntervals: supportedDateIntervals,
    expression,
    ...(relationId ? { relationId } : {}),
  };
}

function datetimeField(
  id: string,
  label: string,
  expression: SQLWrapper,
  description = "",
  relationId?: string,
): ReportField {
  return {
    id,
    label,
    description,
    dataType: "datetime",
    operators: dateOperators,
    groupable: true,
    aggregations: dateAggregations,
    dateIntervals: supportedDateIntervals,
    expression,
    ...(relationId ? { relationId } : {}),
  };
}

function booleanField(
  id: string,
  label: string,
  expression: SQLWrapper,
  description = "",
  relationId?: string,
): ReportField {
  return {
    id,
    label,
    description,
    dataType: "boolean",
    operators: booleanOperators,
    groupable: true,
    aggregations: textAggregations,
    dateIntervals: [],
    expression,
    ...(relationId ? { relationId } : {}),
  };
}

function calculatedField(field: ReportField): ReportField {
  return { ...field, calculated: true };
}

const contactCompany = alias(companiesTable, "rw_contact_company");
const recipientCampaign = alias(emailCampaignsTable, "rw_recipient_campaign");
const recipientContact = alias(contactsTable, "rw_recipient_contact");
const recipientCompany = alias(companiesTable, "rw_recipient_company");
const prospectContact = alias(contactsTable, "rw_prospect_contact");
const prospectCompany = alias(companiesTable, "rw_prospect_company");
const prospectProduct = alias(prospectProductsTable, "rw_prospect_product");
const prospectStage = alias(prospectStagesTable, "rw_prospect_stage");
const actionProspect = alias(prospectsTable, "rw_action_prospect");
const actionContact = alias(contactsTable, "rw_action_contact");
const actionCompany = alias(companiesTable, "rw_action_company");
const actionType = alias(prospectActionTypesTable, "rw_action_type");
const actionStageHistory = alias(prospectStageHistoryTable, "rw_action_stage_history");
const actionStage = alias(prospectStagesTable, "rw_action_stage");
const followUpProspect = alias(prospectsTable, "rw_followup_prospect");
const followUpContact = alias(contactsTable, "rw_followup_contact");
const followUpCompany = alias(companiesTable, "rw_followup_company");
const followUpStage = alias(prospectStagesTable, "rw_followup_stage");
const followUpActionType = alias(prospectActionTypesTable, "rw_followup_action_type");
const historyProspect = alias(prospectsTable, "rw_history_prospect");
const historyContact = alias(contactsTable, "rw_history_contact");
const historyCompany = alias(companiesTable, "rw_history_company");
const historyPreviousStage = alias(prospectStagesTable, "rw_history_previous_stage");
const historyNewStage = alias(prospectStagesTable, "rw_history_new_stage");
const historyActor = alias(usersTable, "rw_history_actor");

const contactTagSummary = sql<string>`coalesce((
  select string_agg(${contactTagsTable.name}, ', ' order by ${contactTagsTable.name})
  from ${contactTagAssignmentsTable}
  inner join ${contactTagsTable}
    on ${contactTagsTable.id} = ${contactTagAssignmentsTable.tagId}
    and ${contactTagsTable.userId} = ${contactTagAssignmentsTable.userId}
  where ${contactTagAssignmentsTable.userId} = ${contactsTable.userId}
    and ${contactTagAssignmentsTable.contactId} = ${contactsTable.id}
), '')`;

const contactListSummary = sql<string>`coalesce((
  select string_agg(${contactListsTable.name}, ', ' order by ${contactListsTable.name})
  from ${contactListMembersTable}
  inner join ${contactListsTable}
    on ${contactListsTable.id} = ${contactListMembersTable.listId}
    and ${contactListsTable.userId} = ${contactListMembersTable.userId}
  where ${contactListMembersTable.userId} = ${contactsTable.userId}
    and ${contactListMembersTable.contactId} = ${contactsTable.id}
), '')`;

const contactCampaignCount = sql<number>`(
  select count(distinct ${emailCampaignRecipientsTable.campaignId})::int
  from ${emailCampaignRecipientsTable}
  where ${emailCampaignRecipientsTable.userId} = ${contactsTable.userId}
    and ${emailCampaignRecipientsTable.contactId} = ${contactsTable.id}
)`;
const contactProspectCount = sql<number>`(
  select count(*)::int
  from ${prospectsTable}
  where ${prospectsTable.userId} = ${contactsTable.userId}
    and ${prospectsTable.contactId} = ${contactsTable.id}
)`;
const companyProspectCount = sql<number>`(
  select count(*)::int
  from ${prospectsTable}
  inner join ${contactsTable}
    on ${contactsTable.id} = ${prospectsTable.contactId}
    and ${contactsTable.userId} = ${prospectsTable.userId}
  where ${prospectsTable.userId} = ${companiesTable.userId}
    and ${contactsTable.companyId} = ${companiesTable.id}
)`;
const companyCampaignCount = sql<number>`(
  select count(distinct ${emailCampaignRecipientsTable.campaignId})::int
  from ${emailCampaignRecipientsTable}
  inner join ${contactsTable}
    on ${contactsTable.id} = ${emailCampaignRecipientsTable.contactId}
    and ${contactsTable.userId} = ${emailCampaignRecipientsTable.userId}
  where ${emailCampaignRecipientsTable.userId} = ${companiesTable.userId}
    and ${contactsTable.companyId} = ${companiesTable.id}
)`;
const prospectActivityCount = sql<number>`(
  select count(*)::int
  from ${prospectActionsTable}
  where ${prospectActionsTable.userId} = ${prospectsTable.userId}
    and ${prospectActionsTable.prospectId} = ${prospectsTable.id}
)`;
const prospectPendingFollowUpCount = sql<number>`(
  select count(*)::int
  from ${prospectFollowUpsTable}
  where ${prospectFollowUpsTable.userId} = ${prospectsTable.userId}
    and ${prospectFollowUpsTable.prospectId} = ${prospectsTable.id}
    and ${prospectFollowUpsTable.status} = 'pending'
)`;
const prospectDaysSinceActivity = sql<number>`(
  select current_date - max(${prospectActionsTable.actionDate})::date
  from ${prospectActionsTable}
  where ${prospectActionsTable.userId} = ${prospectsTable.userId}
    and ${prospectActionsTable.prospectId} = ${prospectsTable.id}
)`;
const prospectCurrentStageDays = sql<number>`floor(extract(epoch from (
  current_timestamp - coalesce((
    select max(current_stage_event.created_at)
    from ${prospectStageHistoryTable} as current_stage_event
    where current_stage_event.user_id = ${prospectsTable.userId}
      and current_stage_event.prospect_id = ${prospectsTable.id}
      and current_stage_event.new_stage_id = ${prospectsTable.currentStageId}
  ), ${prospectsTable.createdAt})
)) / 86400)::int`;
const stageHistoryDaysInStage = sql<number>`floor(extract(epoch from (
  coalesce((
    select min(next_stage_event.created_at)
    from ${prospectStageHistoryTable} as next_stage_event
    where next_stage_event.user_id = ${prospectStageHistoryTable.userId}
      and next_stage_event.prospect_id = ${prospectStageHistoryTable.prospectId}
      and (
        next_stage_event.created_at > ${prospectStageHistoryTable.createdAt}
        or (
          next_stage_event.created_at = ${prospectStageHistoryTable.createdAt}
          and next_stage_event.id > ${prospectStageHistoryTable.id}
        )
      )
  ), current_timestamp) - ${prospectStageHistoryTable.createdAt}
)) / 86400)::int`;

const companies: ReportEntity = {
  id: "companies",
  label: "Companies",
  description: "Workspace-owned company profiles.",
  grain: "One row per company in this workspace",
  table: companiesTable,
  tenantColumn: companiesTable.userId,
  primaryKey: companiesTable.id,
  joins: [],
  fields: [
    textField("companies.name", "Company name", companiesTable.companyName),
    textField("companies.domain", "Domain", companiesTable.companyDomain),
    textField("companies.businessArea", "Business area", companiesTable.companyBusinessArea),
    textField("companies.industry", "Industry", companiesTable.companyIndustry),
    textField("companies.size", "Company size", companiesTable.companySize),
    textField("companies.revenueRange", "Revenue range", companiesTable.companyRevenueRange),
    textField("companies.location", "Location", companiesTable.companyLocation),
    textField("companies.description", "Description", companiesTable.companyDescription),
    datetimeField("companies.createdAt", "Created", companiesTable.createdAt),
    datetimeField("companies.updatedAt", "Last updated", companiesTable.updatedAt),
    numberField(
      "companies.contactCount",
      "Linked contact count",
      sql<number>`(select count(*)::int from ${contactsTable}
        where ${contactsTable.userId} = ${companiesTable.userId}
        and ${contactsTable.companyId} = ${companiesTable.id})`,
      "Counted with a tenant-scoped scalar query; company rows are not multiplied.",
    ),
    calculatedField(numberField(
      "companies.prospectCount",
      "Linked prospect count",
      companyProspectCount,
      "Counts the company's prospects through workspace-owned contacts.",
    )),
    calculatedField(numberField(
      "companies.campaignCount",
      "Distinct campaigns involving contacts",
      companyCampaignCount,
      "Counts distinct campaigns that include contacts linked to this company.",
    )),
  ],
};

const contacts: ReportEntity = {
  id: "contacts",
  label: "Contacts",
  description: "Contact records and their workspace-owned company association.",
  grain: "One row per contact",
  table: contactsTable,
  tenantColumn: contactsTable.userId,
  primaryKey: contactsTable.id,
  joins: [
    {
      id: "company",
      label: "Linked company",
      entityId: "companies",
      cardinality: "many_to_one",
      description: "Optional company associated with this contact.",
      table: contactCompany,
      on: and(
        eq(contactCompany.id, contactsTable.companyId),
        eq(contactCompany.userId, contactsTable.userId),
      ),
    },
  ],
  fields: [
    textField("contacts.name", "Full name", contactsTable.name),
    textField("contacts.firstName", "First name", contactsTable.firstName),
    textField("contacts.lastName", "Last name", contactsTable.lastName),
    textField("contacts.email", "Email", contactsTable.email),
    textField("contacts.companyName", "Company name (contact record)", contactsTable.companyName),
    textField("contacts.jobTitle", "Job title", contactsTable.jobTitle),
    textField("contacts.department", "Department", contactsTable.department),
    textField("contacts.seniority", "Seniority", contactsTable.seniority),
    textField("contacts.phone", "Phone", contactsTable.phoneNumber),
    textField("contacts.mobilePhone", "Mobile phone", contactsTable.mobilePhone),
    textField("contacts.location", "Location", contactsTable.location),
    textField("contacts.lifecycleStage", "Lifecycle stage", contactsTable.lifecycleStage),
    textField("contacts.leadStatus", "Lead status", contactsTable.leadStatus),
    textField("contacts.leadSource", "Lead source", contactsTable.leadSource),
    textField("contacts.importedContact", "Contact source", contactsTable.importedContact),
    textField("contacts.emailStatus", "Email status", contactsTable.emailStatus),
    textField("contacts.emailVerificationStatus", "Email verification", contactsTable.emailVerificationStatus),
    booleanField("contacts.subscribed", "Subscribed", contactsTable.subscribed),
    textField("contacts.tags", "Tags", contactTagSummary, "Tenant-scoped tag summary; does not add rows.", undefined, false),
    textField("contacts.lists", "Lists", contactListSummary, "Tenant-scoped list summary; does not add rows.", undefined, false),
    textField("contacts.company.name", "Linked company name", contactCompany.companyName, "Workspace company linked to this contact.", "company"),
    textField("contacts.company.businessArea", "Linked company business area", contactCompany.companyBusinessArea, "", "company"),
    textField("contacts.company.industry", "Linked company industry", contactCompany.companyIndustry, "", "company"),
    textField("contacts.company.domain", "Linked company domain", contactCompany.companyDomain, "", "company"),
    datetimeField("contacts.createdAt", "Created", contactsTable.createdAt),
    datetimeField("contacts.updatedAt", "Last updated", contactsTable.updatedAt),
    calculatedField(numberField(
      "contacts.prospectCount",
      "Linked prospect count",
      contactProspectCount,
      "Counts prospects associated with this contact.",
    )),
    calculatedField(numberField(
      "contacts.campaignCount",
      "Distinct campaigns",
      contactCampaignCount,
      "Counts distinct campaigns with a stored recipient record for this contact.",
    )),
  ],
};

const campaignRecipientCount = sql<number>`(
  select count(*)::int from ${emailCampaignRecipientsTable}
  where ${emailCampaignRecipientsTable.userId} = ${emailCampaignsTable.userId}
    and ${emailCampaignRecipientsTable.campaignId} = ${emailCampaignsTable.id}
)`;
const campaignAcceptedCount = sql<number>`(
  select count(*)::int from ${emailCampaignRecipientsTable}
  where ${emailCampaignRecipientsTable.userId} = ${emailCampaignsTable.userId}
    and ${emailCampaignRecipientsTable.campaignId} = ${emailCampaignsTable.id}
    and ${emailCampaignRecipientsTable.status} = 'delivered'
)`;
const campaignBounceCount = sql<number>`(
  select count(*)::int from ${emailCampaignRecipientsTable}
  where ${emailCampaignRecipientsTable.userId} = ${emailCampaignsTable.userId}
    and ${emailCampaignRecipientsTable.campaignId} = ${emailCampaignsTable.id}
    and ${emailCampaignRecipientsTable.status} = 'bounced'
)`;

const campaigns: ReportEntity = {
  id: "campaigns",
  label: "Campaigns",
  description: "Campaign configuration and aggregate recipient counts.",
  grain: "One row per campaign",
  table: emailCampaignsTable,
  tenantColumn: emailCampaignsTable.userId,
  primaryKey: emailCampaignsTable.id,
  joins: [],
  fields: [
    textField("campaigns.name", "Campaign name", emailCampaignsTable.name),
    textField("campaigns.audienceType", "Audience type", emailCampaignsTable.audienceType),
    textField("campaigns.status", "Campaign status", emailCampaignsTable.status),
    textField("campaigns.subject", "Subject line", emailCampaignsTable.subject),
    textField("campaigns.objective", "Campaign objective", emailCampaignsTable.objective),
    datetimeField("campaigns.createdAt", "Created", emailCampaignsTable.createdAt),
    datetimeField("campaigns.queuedAt", "Queued", emailCampaignsTable.queuedAt),
    datetimeField("campaigns.scheduledAt", "Scheduled", emailCampaignsTable.scheduledAt),
    datetimeField("campaigns.completedAt", "Completed", emailCampaignsTable.completedAt),
    numberField("campaigns.recipientRecords", "Recipient records", campaignRecipientCount),
    numberField(
      "campaigns.smtpAccepted",
      "Accepted by SMTP",
      campaignAcceptedCount,
      "SMTP acceptance is not proof of inbox delivery.",
    ),
    numberField("campaigns.bounced", "Bounced recipient records", campaignBounceCount),
  ],
};

const recipientReplyCount = sql<number>`(
  select count(*)::int from ${emailCampaignRepliesTable}
  where ${emailCampaignRepliesTable.userId} = ${emailCampaignRecipientsTable.userId}
    and ${emailCampaignRepliesTable.recipientId} = ${emailCampaignRecipientsTable.id}
)`;

const campaignRecipients: ReportEntity = {
  id: "campaignRecipients",
  label: "Campaign recipients",
  description: "Stored recipient outcomes, including open-campaign uploads that are not contacts.",
  grain: "One row per campaign recipient record",
  table: emailCampaignRecipientsTable,
  tenantColumn: emailCampaignRecipientsTable.userId,
  primaryKey: emailCampaignRecipientsTable.id,
  joins: [
    {
      id: "campaign",
      label: "Campaign",
      entityId: "campaigns",
      cardinality: "many_to_one",
      description: "Campaign associated with this recipient record.",
      table: recipientCampaign,
      on: and(
        eq(recipientCampaign.id, emailCampaignRecipientsTable.campaignId),
        eq(recipientCampaign.userId, emailCampaignRecipientsTable.userId),
      ),
    },
    {
      id: "contact",
      label: "Saved contact",
      entityId: "contacts",
      cardinality: "many_to_one",
      description: "Optional saved contact; open-campaign recipients may not have one.",
      table: recipientContact,
      on: and(
        eq(recipientContact.id, emailCampaignRecipientsTable.contactId),
        eq(recipientContact.userId, emailCampaignRecipientsTable.userId),
      ),
    },
    {
      id: "company",
      label: "Contact's company",
      entityId: "companies",
      cardinality: "many_to_one",
      description: "Workspace company linked through the optional saved contact.",
      table: recipientCompany,
      requires: ["contact"],
      on: and(
        eq(recipientCompany.id, recipientContact.companyId),
        eq(recipientCompany.userId, emailCampaignRecipientsTable.userId),
      ),
    },
  ],
  fields: [
    textField("campaignRecipients.email", "Recipient email", emailCampaignRecipientsTable.email),
    textField("campaignRecipients.firstName", "Recipient first name", emailCampaignRecipientsTable.firstName),
    textField("campaignRecipients.lastName", "Recipient last name", emailCampaignRecipientsTable.lastName),
    textField("campaignRecipients.status", "Send status", emailCampaignRecipientsTable.status),
    numberField("campaignRecipients.attempts", "Send attempts", emailCampaignRecipientsTable.attempts),
    datetimeField("campaignRecipients.smtpAcceptedAt", "Accepted by SMTP at", emailCampaignRecipientsTable.deliveredAt, "The SMTP handoff time; not proof of inbox delivery."),
    textField("campaignRecipients.providerOutcome", "Provider-reported outcome", emailCampaignRecipientsTable.reportOutcome),
    textField("campaignRecipients.reportSource", "Outcome source", emailCampaignRecipientsTable.reportSource),
    datetimeField("campaignRecipients.reportedAt", "Outcome recorded at", emailCampaignRecipientsTable.reportAt),
    textField("campaignRecipients.reportScope", "Outcome scope", emailCampaignRecipientsTable.reportDeliveryScope),
    textField("campaignRecipients.evidenceVerification", "Evidence verification", emailCampaignRecipientsTable.reportEvidenceVerification),
    numberField("campaignRecipients.replyCount", "Recorded replies", recipientReplyCount, "Counts reply records without exposing message bodies."),
    textField("campaignRecipients.campaign.name", "Campaign name", recipientCampaign.name, "", "campaign"),
    textField("campaignRecipients.campaign.audienceType", "Campaign audience type", recipientCampaign.audienceType, "", "campaign"),
    textField("campaignRecipients.campaign.status", "Campaign status", recipientCampaign.status, "", "campaign"),
    textField("campaignRecipients.contact.name", "Saved contact name", recipientContact.name, "", "contact"),
    textField("campaignRecipients.contact.email", "Saved contact email", recipientContact.email, "", "contact"),
    textField("campaignRecipients.company.name", "Contact's company", recipientCompany.companyName, "", "company"),
    datetimeField("campaignRecipients.createdAt", "Recipient record created", emailCampaignRecipientsTable.createdAt),
  ],
};

const prospects: ReportEntity = {
  id: "prospects",
  label: "Prospects",
  description: "Prospect pipeline records, their current stage, and associated contact/company.",
  grain: "One row per prospect",
  table: prospectsTable,
  tenantColumn: prospectsTable.userId,
  primaryKey: prospectsTable.id,
  joins: [
    {
      id: "contact",
      label: "Contact",
      entityId: "contacts",
      cardinality: "many_to_one",
      description: "Contact linked to this prospect.",
      table: prospectContact,
      on: and(eq(prospectContact.id, prospectsTable.contactId), eq(prospectContact.userId, prospectsTable.userId)),
    },
    {
      id: "company",
      label: "Contact's company",
      entityId: "companies",
      cardinality: "many_to_one",
      description: "Company linked through the prospect's contact.",
      table: prospectCompany,
      requires: ["contact"],
      on: and(eq(prospectCompany.id, prospectContact.companyId), eq(prospectCompany.userId, prospectsTable.userId)),
    },
    {
      id: "product",
      label: "Product or service",
      entityId: "prospectProducts",
      cardinality: "many_to_one",
      description: "Product or service associated with this prospect.",
      table: prospectProduct,
      on: and(eq(prospectProduct.id, prospectsTable.productId), eq(prospectProduct.userId, prospectsTable.userId)),
    },
    {
      id: "stage",
      label: "Current stage",
      entityId: "prospectStages",
      cardinality: "many_to_one",
      description: "Current tenant-owned pipeline stage.",
      table: prospectStage,
      on: and(eq(prospectStage.id, prospectsTable.currentStageId), eq(prospectStage.userId, prospectsTable.userId)),
    },
  ],
  fields: [
    textField("prospects.name", "Prospect name", prospectsTable.name),
    currencyField("prospects.expectedDealValue", "Expected deal value", prospectsTable.expectedDealValue, "Keep totals separated by currency.", undefined, "prospects.currencyCode"),
    calculatedField(currencyField(
      "prospects.weightedPipelineValue",
      "Weighted pipeline value",
      sql`${prospectsTable.expectedDealValue} * ${prospectsTable.currentProbability} / 100`,
      "Expected deal value multiplied by current probability; totals stay separated by currency.",
      undefined,
      "prospects.currencyCode",
    )),
    textField("prospects.currencyCode", "Currency code", prospectsTable.currencyCode),
    dateField("prospects.expectedClosureDate", "Expected closure date", prospectsTable.expectedClosureDate),
    numberField("prospects.currentProbability", "Current probability (%)", prospectsTable.currentProbability),
    calculatedField(numberField(
      "prospects.prospectAgeDays",
      "Prospect age (days)",
      sql<number>`floor(extract(epoch from (current_timestamp - ${prospectsTable.createdAt})) / 86400)::int`,
      "Whole days since this prospect was created.",
    )),
    calculatedField(numberField(
      "prospects.daysSinceLastActivity",
      "Days since last activity",
      prospectDaysSinceActivity,
      "Null when no activity has been recorded.",
    )),
    calculatedField(numberField(
      "prospects.daysUntilExpectedClosure",
      "Days until expected closure",
      sql<number>`${prospectsTable.expectedClosureDate} - current_date`,
      "Negative values indicate an overdue expected closure date.",
    )),
    calculatedField(numberField(
      "prospects.currentStageDurationDays",
      "Days in current stage",
      prospectCurrentStageDays,
      "Uses the most recent history event for the current stage.",
    )),
    calculatedField(numberField(
      "prospects.activityCount",
      "Recorded activity count",
      prospectActivityCount,
      "Counts actions through a tenant-scoped scalar query without multiplying prospect rows.",
    )),
    calculatedField(numberField(
      "prospects.pendingFollowUpCount",
      "Pending follow-up count",
      prospectPendingFollowUpCount,
      "Counts pending follow-ups linked to this prospect.",
    )),
    booleanField("prospects.archived", "Archived", sql<boolean>`${prospectsTable.archivedAt} is not null`),
    datetimeField("prospects.createdAt", "Created", prospectsTable.createdAt),
    datetimeField("prospects.updatedAt", "Last updated", prospectsTable.updatedAt),
    textField("prospects.contact.name", "Contact name", prospectContact.name, "", "contact"),
    textField("prospects.contact.email", "Contact email", prospectContact.email, "", "contact"),
    textField("prospects.contact.jobTitle", "Contact job title", prospectContact.jobTitle, "", "contact"),
    textField("prospects.company.name", "Company name", prospectCompany.companyName, "", "company"),
    textField("prospects.company.businessArea", "Company business area", prospectCompany.companyBusinessArea, "", "company"),
    textField("prospects.product.name", "Product or service", prospectProduct.name, "", "product"),
    textField("prospects.product.type", "Product or service type", prospectProduct.itemType, "", "product"),
    textField("prospects.stage.name", "Current stage", prospectStage.name, "", "stage"),
    numberField("prospects.stage.probability", "Stage default probability (%)", prospectStage.probability, "", "stage"),
    {
      ...textField("prospects.stage.outcome", "Terminal outcome", prospectStage.terminalOutcome, "", "stage"),
      aggregations: [...textAggregations, "win_rate"],
      description: "The Win rate measure calculates won ÷ (won + lost); undecided prospects are excluded.",
    },
  ],
};

const prospectActions: ReportEntity = {
  id: "prospectActions",
  label: "Prospect actions",
  description: "Recorded activities during a prospect's stage period.",
  grain: "One row per recorded prospect action",
  table: prospectActionsTable,
  tenantColumn: prospectActionsTable.userId,
  primaryKey: prospectActionsTable.id,
  joins: [
    {
      id: "prospect",
      label: "Prospect",
      entityId: "prospects",
      cardinality: "many_to_one",
      description: "Prospect associated with this action.",
      table: actionProspect,
      on: and(eq(actionProspect.id, prospectActionsTable.prospectId), eq(actionProspect.userId, prospectActionsTable.userId)),
    },
    {
      id: "contact",
      label: "Prospect contact",
      entityId: "contacts",
      cardinality: "many_to_one",
      description: "Contact linked through the prospect.",
      table: actionContact,
      requires: ["prospect"],
      on: and(eq(actionContact.id, actionProspect.contactId), eq(actionContact.userId, prospectActionsTable.userId)),
    },
    {
      id: "company",
      label: "Contact's company",
      entityId: "companies",
      cardinality: "many_to_one",
      description: "Company linked through the prospect contact.",
      table: actionCompany,
      requires: ["contact"],
      on: and(eq(actionCompany.id, actionContact.companyId), eq(actionCompany.userId, prospectActionsTable.userId)),
    },
    {
      id: "actionType",
      label: "Action type",
      entityId: "prospectActionTypes",
      cardinality: "many_to_one",
      description: "Configured action type.",
      table: actionType,
      on: and(eq(actionType.id, prospectActionsTable.actionTypeId), eq(actionType.userId, prospectActionsTable.userId)),
    },
    {
      id: "stagePeriod",
      label: "Stage period",
      entityId: "prospectStageHistory",
      cardinality: "many_to_one",
      description: "Immutable stage period in which the action was recorded.",
      table: actionStageHistory,
      on: and(eq(actionStageHistory.id, prospectActionsTable.stageHistoryId), eq(actionStageHistory.userId, prospectActionsTable.userId)),
    },
    {
      id: "actionStage",
      label: "Stage at action",
      entityId: "prospectStages",
      cardinality: "many_to_one",
      description: "Stage captured by the action's stage period.",
      table: actionStage,
      requires: ["stagePeriod"],
      on: and(eq(actionStage.id, actionStageHistory.newStageId), eq(actionStage.userId, prospectActionsTable.userId)),
    },
  ],
  fields: [
    textField("prospectActions.notes", "Action note", prospectActionsTable.notes, "", undefined, false),
    dateField("prospectActions.actionDate", "Action date", prospectActionsTable.actionDate),
    datetimeField("prospectActions.createdAt", "Recorded at", prospectActionsTable.createdAt),
    textField("prospectActions.prospect.name", "Prospect name", actionProspect.name, "", "prospect"),
    textField("prospectActions.contact.name", "Contact name", actionContact.name, "", "contact"),
    textField("prospectActions.contact.email", "Contact email", actionContact.email, "", "contact"),
    textField("prospectActions.company.name", "Company name", actionCompany.companyName, "", "company"),
    textField("prospectActions.type", "Action type", actionType.name, "", "actionType"),
    textField("prospectActions.stage", "Stage at action", actionStage.name, "", "actionStage"),
  ],
};

const prospectStageHistory: ReportEntity = {
  id: "prospectStageHistory",
  label: "Prospect stage history",
  description: "Immutable stage-change and creation events.",
  grain: "One row per prospect stage-history event",
  table: prospectStageHistoryTable,
  tenantColumn: prospectStageHistoryTable.userId,
  primaryKey: prospectStageHistoryTable.id,
  joins: [
    {
      id: "prospect",
      label: "Prospect",
      entityId: "prospects",
      cardinality: "many_to_one",
      description: "Prospect associated with this stage event.",
      table: historyProspect,
      on: and(eq(historyProspect.id, prospectStageHistoryTable.prospectId), eq(historyProspect.userId, prospectStageHistoryTable.userId)),
    },
    {
      id: "contact",
      label: "Prospect contact",
      entityId: "contacts",
      cardinality: "many_to_one",
      description: "Contact linked through the prospect.",
      table: historyContact,
      requires: ["prospect"],
      on: and(eq(historyContact.id, historyProspect.contactId), eq(historyContact.userId, prospectStageHistoryTable.userId)),
    },
    {
      id: "company",
      label: "Contact's company",
      entityId: "companies",
      cardinality: "many_to_one",
      description: "Company linked through the prospect contact.",
      table: historyCompany,
      requires: ["contact"],
      on: and(eq(historyCompany.id, historyContact.companyId), eq(historyCompany.userId, prospectStageHistoryTable.userId)),
    },
    {
      id: "previousStage",
      label: "Previous stage",
      entityId: "prospectStages",
      cardinality: "many_to_one",
      description: "Stage before this event, if one existed.",
      table: historyPreviousStage,
      on: and(eq(historyPreviousStage.id, prospectStageHistoryTable.previousStageId), eq(historyPreviousStage.userId, prospectStageHistoryTable.userId)),
    },
    {
      id: "newStage",
      label: "New stage",
      entityId: "prospectStages",
      cardinality: "many_to_one",
      description: "Stage entered by this event.",
      table: historyNewStage,
      on: and(eq(historyNewStage.id, prospectStageHistoryTable.newStageId), eq(historyNewStage.userId, prospectStageHistoryTable.userId)),
    },
    {
      id: "actor",
      label: "Recorded by",
      entityId: "users",
      cardinality: "many_to_one",
      description: "Account that recorded the event; only the display name is exposed.",
      table: historyActor,
      on: and(
        eq(historyActor.id, prospectStageHistoryTable.changedBy),
        eq(historyActor.id, prospectStageHistoryTable.userId),
        eq(historyActor.role, "USER"),
      ),
    },
  ],
  fields: [
    textField("prospectStageHistory.eventType", "Event type", prospectStageHistoryTable.eventType),
    numberField("prospectStageHistory.previousProbability", "Previous probability (%)", prospectStageHistoryTable.previousProbability),
    numberField("prospectStageHistory.newProbability", "New probability (%)", prospectStageHistoryTable.newProbability),
    calculatedField(numberField(
      "prospectStageHistory.daysInStage",
      "Days in this stage period",
      stageHistoryDaysInStage,
      "Days from this history event until the next event for the prospect; the current period runs through today.",
    )),
    textField("prospectStageHistory.reason", "Change reason", prospectStageHistoryTable.reason, "", undefined, false),
    textField("prospectStageHistory.notesSnapshot", "Notes snapshot", prospectStageHistoryTable.notesSnapshot, "", undefined, false),
    datetimeField("prospectStageHistory.createdAt", "Event recorded", prospectStageHistoryTable.createdAt),
    textField("prospectStageHistory.prospect.name", "Prospect name", historyProspect.name, "", "prospect"),
    textField("prospectStageHistory.contact.name", "Contact name", historyContact.name, "", "contact"),
    textField("prospectStageHistory.contact.email", "Contact email", historyContact.email, "", "contact"),
    textField("prospectStageHistory.company.name", "Company name", historyCompany.companyName, "", "company"),
    textField("prospectStageHistory.previousStage.name", "Previous stage", historyPreviousStage.name, "", "previousStage"),
    textField("prospectStageHistory.newStage.name", "New stage", historyNewStage.name, "", "newStage"),
    textField(
      "prospectStageHistory.actor.name",
      "Recorded by",
      sql<string>`trim(concat(${historyActor.firstName}, ' ', ${historyActor.lastName}))`,
      "",
      "actor",
    ),
  ],
};

const prospectFollowUps: ReportEntity = {
  id: "prospectFollowUps",
  label: "Prospect follow-ups",
  description: "Scheduled and completed follow-up tasks.",
  grain: "One row per follow-up",
  table: prospectFollowUpsTable,
  tenantColumn: prospectFollowUpsTable.userId,
  primaryKey: prospectFollowUpsTable.id,
  joins: [
    {
      id: "prospect",
      label: "Prospect",
      entityId: "prospects",
      cardinality: "many_to_one",
      description: "Prospect associated with the follow-up.",
      table: followUpProspect,
      on: and(eq(followUpProspect.id, prospectFollowUpsTable.prospectId), eq(followUpProspect.userId, prospectFollowUpsTable.userId)),
    },
    {
      id: "contact",
      label: "Prospect contact",
      entityId: "contacts",
      cardinality: "many_to_one",
      description: "Contact linked through the prospect.",
      table: followUpContact,
      requires: ["prospect"],
      on: and(eq(followUpContact.id, followUpProspect.contactId), eq(followUpContact.userId, prospectFollowUpsTable.userId)),
    },
    {
      id: "company",
      label: "Contact's company",
      entityId: "companies",
      cardinality: "many_to_one",
      description: "Company linked through the prospect contact.",
      table: followUpCompany,
      requires: ["contact"],
      on: and(eq(followUpCompany.id, followUpContact.companyId), eq(followUpCompany.userId, prospectFollowUpsTable.userId)),
    },
    {
      id: "stage",
      label: "Current stage",
      entityId: "prospectStages",
      cardinality: "many_to_one",
      description: "Current prospect pipeline stage.",
      table: followUpStage,
      requires: ["prospect"],
      on: and(eq(followUpStage.id, followUpProspect.currentStageId), eq(followUpStage.userId, prospectFollowUpsTable.userId)),
    },
    {
      id: "actionType",
      label: "Action type",
      entityId: "prospectActionTypes",
      cardinality: "many_to_one",
      description: "Configured follow-up action type.",
      table: followUpActionType,
      on: and(eq(followUpActionType.id, prospectFollowUpsTable.actionTypeId), eq(followUpActionType.userId, prospectFollowUpsTable.userId)),
    },
  ],
  fields: [
    dateField("prospectFollowUps.date", "Follow-up date", prospectFollowUpsTable.followUpDate),
    textField("prospectFollowUps.status", "Follow-up status", prospectFollowUpsTable.status),
    textField("prospectFollowUps.notes", "Follow-up note", prospectFollowUpsTable.notes, "", undefined, false),
    datetimeField("prospectFollowUps.completedAt", "Completed at", prospectFollowUpsTable.completedAt),
    datetimeField("prospectFollowUps.createdAt", "Created", prospectFollowUpsTable.createdAt),
    textField("prospectFollowUps.prospect.name", "Prospect name", followUpProspect.name, "", "prospect"),
    textField("prospectFollowUps.contact.name", "Contact name", followUpContact.name, "", "contact"),
    textField("prospectFollowUps.contact.email", "Contact email", followUpContact.email, "", "contact"),
    textField("prospectFollowUps.company.name", "Company name", followUpCompany.companyName, "", "company"),
    textField("prospectFollowUps.stage.name", "Current stage", followUpStage.name, "", "stage"),
    textField("prospectFollowUps.actionType.name", "Action type", followUpActionType.name, "", "actionType"),
  ],
};

const reportEntities: ReportEntity[] = [
  contacts,
  companies,
  campaigns,
  campaignRecipients,
  prospects,
  prospectActions,
  prospectStageHistory,
  prospectFollowUps,
];

export const reportEntityById = new Map(reportEntities.map((entity) => [entity.id, entity]));

type ReportColumnDefinition = { fieldId: string; label?: string };
type ReportDefinition = {
  version: number;
  baseEntityId: string;
  columns: ReportColumnDefinition[];
  filters?: unknown;
  sorting?: Array<{ fieldId: string; direction: "asc" | "desc" }>;
  groupBy?: Array<{ fieldId: string; interval?: ReportDateInterval }>;
  aggregates?: Array<{
    id: string;
    label: string;
    operation: ReportAggregationOperation;
    fieldId?: string;
  }>;
  subtotals?: boolean;
  grandTotal?: boolean;
  visualization?: {
    type: "table" | "kpi" | "bar" | "horizontal_bar" | "line" | "area" | "pie" | "donut";
    categoryFieldId?: string;
    valueFieldId?: string;
  };
};

function definition(
  baseEntityId: string,
  fields: string[],
  sorting: Array<{ fieldId: string; direction: "asc" | "desc" }> = [],
): ReportDefinition {
  return {
    version: 1,
    baseEntityId,
    columns: fields.map((fieldId) => ({ fieldId })),
    sorting,
  };
}

function summaryDefinition(
  baseEntityId: string,
  groupBy: Array<{ fieldId: string; interval?: ReportDateInterval }>,
  aggregates: Array<{
    id: string;
    label: string;
    operation: ReportAggregationOperation;
    fieldId?: string;
  }>,
  options: {
    subtotals?: boolean;
    grandTotal?: boolean;
    visualization?: ReportDefinition["visualization"];
  } = {},
): ReportDefinition {
  return {
    version: 1,
    baseEntityId,
    columns: [],
    groupBy,
    aggregates,
    ...(options.subtotals !== undefined ? { subtotals: options.subtotals } : {}),
    ...(options.grandTotal !== undefined ? { grandTotal: options.grandTotal } : {}),
    ...(options.visualization ? { visualization: options.visualization } : {}),
  };
}

export const reportTemplates = [
  {
    id: "contacts-directory",
    name: "Contact directory",
    category: "Contacts",
    description: "Review contact details, company association, subscription, verification, and list membership.",
    baseEntityId: "contacts",
    definition: definition("contacts", [
      "contacts.name",
      "contacts.email",
      "contacts.company.name",
      "contacts.company.businessArea",
      "contacts.jobTitle",
      "contacts.subscribed",
      "contacts.emailVerificationStatus",
      "contacts.tags",
      "contacts.lists",
    ], [{ fieldId: "contacts.name", direction: "asc" }]),
  },
  {
    id: "company-directory",
    name: "Company directory",
    category: "Companies",
    description: "Review workspace company profiles and linked-contact counts.",
    baseEntityId: "companies",
    definition: definition("companies", [
      "companies.name",
      "companies.domain",
      "companies.businessArea",
      "companies.industry",
      "companies.size",
      "companies.location",
      "companies.contactCount",
    ], [{ fieldId: "companies.name", direction: "asc" }]),
  },
  {
    id: "campaign-register",
    name: "Campaign register",
    category: "Campaigns",
    description: "Inspect campaigns and distinguish SMTP acceptance from recipient outcomes.",
    baseEntityId: "campaigns",
    definition: definition("campaigns", [
      "campaigns.name",
      "campaigns.audienceType",
      "campaigns.status",
      "campaigns.createdAt",
      "campaigns.scheduledAt",
      "campaigns.completedAt",
      "campaigns.recipientRecords",
      "campaigns.smtpAccepted",
      "campaigns.bounced",
    ], [{ fieldId: "campaigns.createdAt", direction: "desc" }]),
  },
  {
    id: "campaign-recipient-outcomes",
    name: "Campaign recipient outcomes",
    category: "Campaigns",
    description: "Review recipient send status, SMTP acceptance time, provider outcome evidence, and replies.",
    baseEntityId: "campaignRecipients",
    definition: definition("campaignRecipients", [
      "campaignRecipients.campaign.name",
      "campaignRecipients.email",
      "campaignRecipients.status",
      "campaignRecipients.smtpAcceptedAt",
      "campaignRecipients.providerOutcome",
      "campaignRecipients.reportSource",
      "campaignRecipients.reportedAt",
      "campaignRecipients.replyCount",
    ], [{ fieldId: "campaignRecipients.createdAt", direction: "desc" }]),
  },
  {
    id: "prospect-pipeline",
    name: "Prospect pipeline",
    category: "Prospects",
    description: "Review pipeline value, stage, expected closure, contact, and company without combining currencies.",
    baseEntityId: "prospects",
    definition: definition("prospects", [
      "prospects.name",
      "prospects.expectedDealValue",
      "prospects.currencyCode",
      "prospects.currentProbability",
      "prospects.expectedClosureDate",
      "prospects.stage.name",
      "prospects.product.name",
      "prospects.contact.name",
      "prospects.company.name",
    ], [{ fieldId: "prospects.expectedClosureDate", direction: "asc" }]),
  },
  {
    id: "prospect-pipeline-by-stage",
    name: "Pipeline by stage",
    category: "Prospects",
    description: "Compare weighted pipeline, prospect counts, and win rate by stage without combining currencies.",
    baseEntityId: "prospects",
    definition: summaryDefinition(
      "prospects",
      [{ fieldId: "prospects.stage.name" }],
      [
        { id: "weighted_value", label: "Weighted pipeline value", operation: "sum", fieldId: "prospects.weightedPipelineValue" },
        { id: "prospect_count", label: "Prospects", operation: "count" },
        { id: "win_rate", label: "Win rate", operation: "win_rate", fieldId: "prospects.stage.outcome" },
      ],
      {
        subtotals: true,
        grandTotal: true,
        visualization: {
          type: "bar",
          categoryFieldId: "group:prospects.stage.name",
          valueFieldId: "aggregate:weighted_value",
        },
      },
    ),
  },
  {
    id: "prospect-monthly-pipeline",
    name: "Monthly pipeline trend",
    category: "Prospects",
    description: "Track monthly weighted pipeline and prospect volume, with a separate series per currency.",
    baseEntityId: "prospects",
    definition: summaryDefinition(
      "prospects",
      [{ fieldId: "prospects.createdAt", interval: "month" }],
      [
        { id: "weighted_value", label: "Weighted pipeline value", operation: "sum", fieldId: "prospects.weightedPipelineValue" },
        { id: "prospect_count", label: "Prospects", operation: "count" },
      ],
      {
        grandTotal: true,
        visualization: {
          type: "line",
          categoryFieldId: "group:prospects.createdAt",
          valueFieldId: "aggregate:weighted_value",
        },
      },
    ),
  },
  {
    id: "prospect-stage-duration",
    name: "Average time in stage",
    category: "Prospects",
    description: "Compare average days in each stage period using immutable stage history.",
    baseEntityId: "prospectStageHistory",
    definition: summaryDefinition(
      "prospectStageHistory",
      [{ fieldId: "prospectStageHistory.newStage.name" }],
      [
        { id: "average_days", label: "Average days in stage", operation: "avg", fieldId: "prospectStageHistory.daysInStage" },
        { id: "stage_events", label: "Stage events", operation: "count" },
      ],
      {
        visualization: {
          type: "horizontal_bar",
          categoryFieldId: "group:prospectStageHistory.newStage.name",
          valueFieldId: "aggregate:average_days",
        },
      },
    ),
  },
  {
    id: "campaign-recipient-outcomes-by-status",
    name: "Recipient outcomes by status",
    category: "Campaigns",
    description: "Summarize recipient records by send status and distinguish replies from SMTP acceptance.",
    baseEntityId: "campaignRecipients",
    definition: summaryDefinition(
      "campaignRecipients",
      [{ fieldId: "campaignRecipients.status" }],
      [
        { id: "recipient_count", label: "Recipient records", operation: "count" },
        { id: "reply_count", label: "Recorded replies", operation: "sum", fieldId: "campaignRecipients.replyCount" },
      ],
      {
        visualization: {
          type: "donut",
          categoryFieldId: "group:campaignRecipients.status",
          valueFieldId: "aggregate:recipient_count",
        },
      },
    ),
  },
  {
    id: "company-prospect-analytics",
    name: "Prospects by business area",
    category: "Companies",
    description: "Compare workspace companies and their linked prospect counts by business area.",
    baseEntityId: "companies",
    definition: summaryDefinition(
      "companies",
      [{ fieldId: "companies.businessArea" }],
      [
        { id: "prospect_count", label: "Linked prospects", operation: "sum", fieldId: "companies.prospectCount" },
        { id: "company_count", label: "Companies", operation: "count" },
      ],
      {
        visualization: {
          type: "bar",
          categoryFieldId: "group:companies.businessArea",
          valueFieldId: "aggregate:prospect_count",
        },
      },
    ),
  },
  {
    id: "prospect-actions",
    name: "Prospect action history",
    category: "Prospects",
    description: "Review dated interactions and stage-specific action notes.",
    baseEntityId: "prospectActions",
    definition: definition("prospectActions", [
      "prospectActions.actionDate",
      "prospectActions.prospect.name",
      "prospectActions.contact.name",
      "prospectActions.company.name",
      "prospectActions.type",
      "prospectActions.stage",
      "prospectActions.notes",
    ], [{ fieldId: "prospectActions.actionDate", direction: "desc" }]),
  },
  {
    id: "prospect-follow-ups",
    name: "Prospect follow-ups",
    category: "Prospects",
    description: "Track scheduled follow-ups by date, prospect, company, status, and action type.",
    baseEntityId: "prospectFollowUps",
    definition: definition("prospectFollowUps", [
      "prospectFollowUps.date",
      "prospectFollowUps.status",
      "prospectFollowUps.prospect.name",
      "prospectFollowUps.contact.email",
      "prospectFollowUps.company.name",
      "prospectFollowUps.actionType.name",
      "prospectFollowUps.notes",
    ], [{ fieldId: "prospectFollowUps.date", direction: "asc" }]),
  },
  {
    id: "prospect-stage-history",
    name: "Prospect stage history",
    category: "Prospects",
    description: "Review stage movements with previous/new probability and change reasons.",
    baseEntityId: "prospectStageHistory",
    definition: definition("prospectStageHistory", [
      "prospectStageHistory.createdAt",
      "prospectStageHistory.prospect.name",
      "prospectStageHistory.contact.name",
      "prospectStageHistory.company.name",
      "prospectStageHistory.previousStage.name",
      "prospectStageHistory.newStage.name",
      "prospectStageHistory.previousProbability",
      "prospectStageHistory.newProbability",
      "prospectStageHistory.reason",
    ], [{ fieldId: "prospectStageHistory.createdAt", direction: "desc" }]),
  },
];

export function getReportWorkareaCatalog() {
  return {
    entities: reportEntities.map(({ fields, joins, id, label, description, grain }) => ({
      id,
      label,
      description,
      grain,
      fields: fields.map(({ expression: _expression, ...field }) => ({
        ...field,
        calculated: field.calculated === true,
      })),
      relations: joins.map(({ id, label, entityId, cardinality, description }) => ({
        id,
        label,
        entityId,
        cardinality,
        description,
      })),
    })),
    templates: reportTemplates,
    definitionVersion: 1,
  };
}

export function getReportEntity(entityId: string): ReportEntity | undefined {
  return reportEntityById.get(entityId);
}

export function getField(entity: ReportEntity, fieldId: string): ReportField | undefined {
  return entity.fields.find((field) => field.id === fieldId);
}

export function getRelationPlan(entity: ReportEntity, fieldIds: string[]): ReportJoin[] {
  const needed = new Set<string>();
  const visit = (id: string) => {
    if (needed.has(id)) return;
    const join = entity.joins.find((candidate) => candidate.id === id);
    if (!join) return;
    for (const dependency of join.requires ?? []) visit(dependency);
    needed.add(id);
  };
  for (const fieldId of fieldIds) {
    const field = getField(entity, fieldId);
    if (field?.relationId) visit(field.relationId);
  }
  return entity.joins.filter((join) => needed.has(join.id));
}
