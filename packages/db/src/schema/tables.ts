import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  actorType,
  agentName,
  approvalDecision,
  approvalKind,
  approvalSource,
  channel,
  companyStatus,
  competitorCategory,
  emailStatus,
  entityType,
  icpStatus,
  leadStage,
  messageStatus,
  ownerType,
  runStatus,
  signalType,
  suggestionDecision,
  tier,
  usageMetric,
  userRole,
} from "./enums";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const orgRef = () =>
  uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" });

// ---------- JSON shapes ----------
export type IndustryCode = { naics: string; label: string; confidence?: number };
export type SizeBands = {
  headcountMin?: number;
  headcountMax?: number;
  revenueMinUsd?: number;
  revenueMaxUsd?: number;
};
export type Persona = { title: string; seniority: string; function?: string };
export type Trigger = { type: string; description: string };
export type Pricing = { model?: string; annualContractValueUsd?: number; notes?: string };
export type ReferenceCustomer = { name: string; domain?: string; notes?: string };

// ---------- Tenancy ----------
export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  flexpriceCustomerId: text("flexprice_customer_id"),
  flexpriceWalletId: text("flexprice_wallet_id"),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: orgRef(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: userRole("role").notNull().default("rep"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_org_email_uq").on(t.orgId, t.email)],
);

// ---------- Module 1: intake + ICP ----------
export const products = pgTable("products", {
  id: id(),
  orgId: orgRef(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  features: jsonb("features").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  pricing: jsonb("pricing").$type<Pricing>().notNull().default(sql`'{}'::jsonb`),
  referenceCustomers: jsonb("reference_customers").$type<ReferenceCustomer[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const icps = pgTable(
  "icps",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    status: icpStatus("status").notNull().default("draft"),
    industries: jsonb("industries").$type<IndustryCode[]>().notNull().default(sql`'[]'::jsonb`),
    sizeBands: jsonb("size_bands").$type<SizeBands>().notNull().default(sql`'{}'::jsonb`),
    personas: jsonb("personas").$type<Persona[]>().notNull().default(sql`'[]'::jsonb`),
    triggers: jsonb("triggers").$type<Trigger[]>().notNull().default(sql`'[]'::jsonb`),
    regions: jsonb("regions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Confidence 0.00–1.00 per ICP field, e.g. { industries: 0.92, sizeBands: 0.7 } */
    fieldConfidence: jsonb("field_confidence").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("icps_product_version_uq").on(t.productId, t.version)],
);

export const icpSuggestions = pgTable("icp_suggestions", {
  id: id(),
  icpId: uuid("icp_id")
    .notNull()
    .references(() => icps.id, { onDelete: "cascade" }),
  segment: text("segment").notNull(),
  reasoning: text("reasoning").notNull(),
  evidenceUrls: jsonb("evidence_urls").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  decision: suggestionDecision("decision").notNull().default("pending"),
  createdAt: createdAt(),
});

// ---------- Module 2: discovery ----------
export const companies = pgTable(
  "companies",
  {
    id: id(),
    orgId: orgRef(),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    hq: text("hq"),
    industryCode: text("industry_code"),
    industryLabel: text("industry_label"),
    headcount: integer("headcount"),
    revenueBand: text("revenue_band"),
    fitScore: integer("fit_score"),
    intentScore: integer("intent_score"),
    tier: tier("tier"),
    status: companyStatus("status").notNull().default("candidate"),
    negativeFlags: jsonb("negative_flags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    filterReason: text("filter_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("companies_org_domain_uq").on(t.orgId, t.domain), index("companies_org_tier_idx").on(t.orgId, t.tier)],
);

export const people = pgTable(
  "people",
  {
    id: id(),
    orgId: orgRef(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    seniority: text("seniority"),
    linkedinUrl: text("linkedin_url"),
    email: text("email"),
    emailStatus: emailStatus("email_status").notNull().default("unknown"),
    mxValid: boolean("mx_valid"),
    enrichSource: text("enrich_source"),
    enrichConfidence: real("enrich_confidence"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("people_company_idx").on(t.companyId)],
);

export const competitors = pgTable("competitors", {
  id: id(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  domain: text("domain"),
  category: competitorCategory("category").notNull(),
  positioning: text("positioning"),
  pricing: jsonb("pricing").$type<{ tier: string; price: string }[]>().notNull().default(sql`'[]'::jsonb`),
  differentiators: jsonb("differentiators").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
});

export const signals = pgTable(
  "signals",
  {
    id: id(),
    orgId: orgRef(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: signalType("type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    sourceUrl: text("source_url").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("signals_company_idx").on(t.companyId)],
);

/** Every factual claim the system shows must have a row here. */
export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    orgId: orgRef(),
    entityType: entityType("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    claim: text("claim").notNull(),
    sourceUrl: text("source_url").notNull(),
    quote: text("quote").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [index("evidence_entity_idx").on(t.entityType, t.entityId)],
);

// ---------- Modules 4–5: outreach, HITL, pipeline ----------
export const leads = pgTable(
  "leads",
  {
    id: id(),
    orgId: orgRef(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    icpId: uuid("icp_id")
      .notNull()
      .references(() => icps.id, { onDelete: "cascade" }),
    stage: leadStage("stage").notNull().default("matched"),
    ownerType: ownerType("owner_type").notNull().default("ai"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("leads_person_icp_uq").on(t.personId, t.icpId), index("leads_org_stage_idx").on(t.orgId, t.stage)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    channel: channel("channel").notNull(),
    step: integer("step").notNull().default(1),
    variant: text("variant").notNull().default("A"),
    subject: text("subject"),
    body: text("body").notNull(),
    status: messageStatus("status").notNull().default("draft"),
    reviewerNotes: text("reviewer_notes"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    externalId: text("external_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("messages_lead_idx").on(t.leadId), index("messages_status_idx").on(t.status)],
);

/** The HITL gate: a send or schema change runs only when a matching `approved`/`edited` row exists. */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    orgId: orgRef(),
    kind: approvalKind("kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    decision: approvalDecision("decision").notNull(),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id),
    source: approvalSource("source").notNull().default("app"),
    note: text("note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approvals_subject_idx").on(t.kind, t.subjectId)],
);

/** Append-only audit log for every outbound action, reply, stage change and approval. */
export const events = pgTable(
  "events",
  {
    id: id(),
    orgId: orgRef(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("events_org_created_idx").on(t.orgId, t.createdAt), index("events_lead_idx").on(t.leadId)],
);

// ---------- Billing + telemetry ----------
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: id(),
    orgId: orgRef(),
    metric: usageMetric("metric").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    credits: numeric("credits", { precision: 12, scale: 2 }).notNull(),
    flexpriceEventId: text("flexprice_event_id").notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("usage_ledger_event_uq").on(t.flexpriceEventId), index("usage_ledger_org_idx").on(t.orgId, t.createdAt)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    orgId: orgRef(),
    agent: agentName("agent").notNull(),
    bandRoomId: text("band_room_id"),
    task: text("task").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    status: runStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("agent_runs_org_idx").on(t.orgId, t.startedAt)],
);
