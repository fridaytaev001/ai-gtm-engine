/**
 * Seeds both databases with a small, clearly fictional demo dataset for the "LogLens" product.
 * All companies use reserved example domains (*.example) so nothing here is mistaken for real leads.
 * Real, cited leads come from discovery in chunk 4.
 *
 * Idempotent: it deletes the demo org (cascades in Postgres, DETACH DELETE in Neo4j) and recreates it.
 */
import { eq } from "drizzle-orm";
import { integrationStatus } from "@gtm/core";
import { closeDb, getDb } from "../src/client";
import * as s from "../src/schema";
import {
  closeGraph,
  deleteOrgGraph,
  ensureGraphSchema,
  findBuyingCycles,
  findDisplacements,
  findWarmIntros,
  upsertNode,
  upsertRel,
} from "../src/graph";

const DEMO_ORG_ID = "00000000-0000-4000-8000-000000000001";
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const src = (path: string) => `https://news.example/${path}`;

const db = getDb();
const graphOn = integrationStatus().neo4j;
if (!graphOn) console.warn("NEO4J_* not set: seeding Postgres only. Set them in .env and re-run to seed the graph.");

// ---------- reset ----------
await db.delete(s.orgs).where(eq(s.orgs.id, DEMO_ORG_ID));
if (graphOn) {
  await ensureGraphSchema();
  await deleteOrgGraph(DEMO_ORG_ID);
}

// ---------- org, user, product, ICP ----------
const [org] = await db.insert(s.orgs).values({ id: DEMO_ORG_ID, name: "LogLens (demo)" }).returning();
const [rep] = await db
  .insert(s.users)
  .values({ orgId: org!.id, name: "Demo Founder", email: "founder@loglens.example", role: "founder" })
  .returning();

const [product] = await db
  .insert(s.products)
  .values({
    orgId: org!.id,
    name: "LogLens",
    description: "AI log analysis that finds the root cause of production incidents for SaaS engineering teams.",
    features: ["Automatic incident clustering", "Root-cause summaries", "Slack and PagerDuty integration"],
    pricing: { model: "annual subscription", annualContractValueUsd: 15000 },
    referenceCustomers: [{ name: "Northwind Cloud", domain: "northwind.example" }],
  })
  .returning();

const [icp] = await db
  .insert(s.icps)
  .values({
    productId: product!.id,
    version: 1,
    status: "approved",
    industries: [{ naics: "518210", label: "Computing infrastructure, data processing and hosting", confidence: 0.86 }],
    sizeBands: { headcountMin: 50, headcountMax: 500 },
    personas: [
      { title: "VP Engineering", seniority: "vp", function: "engineering" },
      { title: "Head of Platform", seniority: "director", function: "engineering" },
    ],
    triggers: [
      { type: "job_post", description: "Hiring site reliability engineers" },
      { type: "funding", description: "Raised Series A or B in the last 6 months" },
    ],
    regions: ["US", "EU"],
    fieldConfidence: { industries: 0.86, sizeBands: 0.72, personas: 0.91, triggers: 0.8 },
  })
  .returning();

await db.insert(s.icpSuggestions).values({
  icpId: icp!.id,
  segment: "Fintech infrastructure teams",
  reasoning: "Payment platforms run high-volume services with strict uptime targets, the same pain LogLens solves.",
  evidenceUrls: [src("fintech-uptime")],
});

// ---------- companies ----------
const companyRows = await db
  .insert(s.companies)
  .values([
    { orgId: org!.id, name: "Northwind Cloud", domain: "northwind.example", hq: "Austin, US", industryCode: "518210", headcount: 220, status: "accepted" },
    { orgId: org!.id, name: "Contoso Pay", domain: "contosopay.example", hq: "Berlin, DE", industryCode: "522320", headcount: 180, fitScore: 84, intentScore: 78, tier: "A", status: "accepted" },
    { orgId: org!.id, name: "Fabrikam Data", domain: "fabrikam.example", hq: "Denver, US", industryCode: "518210", headcount: 340, fitScore: 71, intentScore: 55, tier: "B", status: "accepted" },
    { orgId: org!.id, name: "Tailspin Apps", domain: "tailspin.example", hq: "Toronto, CA", industryCode: "513210", headcount: 90, fitScore: 48, intentScore: 30, tier: "C", status: "accepted" },
    { orgId: org!.id, name: "Litware Systems", domain: "litware.example", hq: "Lisbon, PT", industryCode: "513210", headcount: 260, status: "filtered", negativeFlags: ["hiring_freeze"], filterReason: "Announced a hiring freeze" },
  ])
  .returning();
const co = Object.fromEntries(companyRows.map((c) => [c.domain, c])) as Record<string, (typeof companyRows)[number]>;
const northwind = co["northwind.example"]!;
const contoso = co["contosopay.example"]!;
const fabrikam = co["fabrikam.example"]!;
const tailspin = co["tailspin.example"]!;

// ---------- people ----------
const peopleRows = await db
  .insert(s.people)
  .values([
    { orgId: org!.id, companyId: northwind.id, name: "Sam Rivera", title: "Staff SRE", seniority: "senior" },
    { orgId: org!.id, companyId: contoso.id, name: "Jordan Lee", title: "VP Engineering", seniority: "vp", email: "jordan.lee@contosopay.example", emailStatus: "valid", mxValid: true, enrichSource: "seed", enrichConfidence: 0.92 },
    { orgId: org!.id, companyId: fabrikam.id, name: "Avery Chen", title: "Head of Platform", seniority: "director", email: "avery@fabrikam.example", emailStatus: "risky", mxValid: true, enrichSource: "seed", enrichConfidence: 0.64 },
    { orgId: org!.id, companyId: tailspin.id, name: "Riley Patel", title: "CTO", seniority: "c_level" },
  ])
  .returning();
const person = Object.fromEntries(peopleRows.map((p) => [p.name, p])) as Record<string, (typeof peopleRows)[number]>;
const jordan = person["Jordan Lee"]!;
const avery = person["Avery Chen"]!;
const sam = person["Sam Rivera"]!;
const riley = person["Riley Patel"]!;

// ---------- competitors ----------
const [rival] = await db
  .insert(s.competitors)
  .values({
    productId: product!.id,
    name: "TraceHound",
    domain: "tracehound.example",
    category: "direct",
    positioning: "Log search with manual dashboards",
    pricing: [{ tier: "Team", price: "$900/month" }],
    differentiators: ["LogLens explains root cause automatically; TraceHound needs manual queries"],
  })
  .returning();

// ---------- signals + evidence ----------
const signalRows = await db
  .insert(s.signals)
  .values([
    { orgId: org!.id, companyId: contoso.id, type: "job_post", title: "Hiring 3 Site Reliability Engineers", sourceUrl: src("contoso-sre-jobs"), observedAt: daysAgo(6) },
    { orgId: org!.id, companyId: contoso.id, type: "funding", title: "Raised a $40M Series B", sourceUrl: src("contoso-series-b"), observedAt: daysAgo(40) },
    { orgId: org!.id, companyId: fabrikam.id, type: "tech_change", title: "Plans to replace TraceHound at renewal", sourceUrl: src("fabrikam-renewal"), observedAt: daysAgo(12) },
  ])
  .returning();

await db.insert(s.evidence).values(
  signalRows.map((sig) => ({
    orgId: org!.id,
    entityType: "signal" as const,
    entityId: sig.id,
    claim: sig.title,
    sourceUrl: sig.sourceUrl,
    quote: `(sample data) ${sig.title}.`,
    verified: true,
    verifiedAt: new Date(),
  })),
);

// ---------- leads, messages, approvals, events ----------
const leadRows = await db
  .insert(s.leads)
  .values([
    { orgId: org!.id, personId: jordan.id, icpId: icp!.id, stage: "contacted", ownerType: "ai" },
    { orgId: org!.id, personId: avery.id, icpId: icp!.id, stage: "matched", ownerType: "ai" },
    { orgId: org!.id, personId: riley.id, icpId: icp!.id, stage: "replied", ownerType: "rep", ownerId: rep!.id },
  ])
  .returning();
const jordanLead = leadRows.find((l) => l.personId === jordan.id)!;
const averyLead = leadRows.find((l) => l.personId === avery.id)!;

const [sentMsg] = await db
  .insert(s.messages)
  .values({
    leadId: jordanLead.id,
    channel: "email",
    step: 1,
    variant: "A",
    subject: "Your 3 new SRE roles",
    body: "Hi Jordan, I saw Contoso Pay is hiring three SREs after the Series B. Teams like Northwind Cloud use LogLens to cut incident triage time. Worth a 15-minute look?",
    status: "sent",
    approvedBy: rep!.id,
    approvedAt: daysAgo(2),
    sentAt: daysAgo(2),
  })
  .returning();
await db.insert(s.messages).values({
  leadId: averyLead.id,
  channel: "email",
  step: 1,
  variant: "A",
  subject: "Before your TraceHound renewal",
  body: "Hi Avery, heard Fabrikam is reviewing TraceHound at renewal. LogLens explains root cause automatically instead of manual queries. Open to comparing?",
  status: "draft",
});

await db.insert(s.approvals).values({
  orgId: org!.id,
  kind: "message_send",
  subjectId: sentMsg!.id,
  decision: "approved",
  decidedBy: rep!.id,
  decidedAt: daysAgo(2),
});

await db.insert(s.events).values([
  { orgId: org!.id, leadId: jordanLead.id, type: "lead.matched", actorType: "agent", actorId: "builder", createdAt: daysAgo(3) },
  { orgId: org!.id, leadId: jordanLead.id, type: "message.approved", actorType: "rep", actorId: rep!.id, payload: { messageId: sentMsg!.id }, createdAt: daysAgo(2) },
  { orgId: org!.id, leadId: jordanLead.id, type: "message.sent", actorType: "agent", actorId: "builder", payload: { messageId: sentMsg!.id, channel: "email" }, createdAt: daysAgo(2) },
  { orgId: org!.id, leadId: jordanLead.id, type: "lead.stage_changed", actorType: "agent", actorId: "builder", payload: { from: "matched", to: "contacted" }, createdAt: daysAgo(2) },
]);

console.log("Seeded demo org:", org!.name);
console.log(`  Postgres: ${companyRows.length} companies, ${peopleRows.length} people, ${signalRows.length} signals, ${leadRows.length} leads`);

// ---------- knowledge graph ----------
if (graphOn) {
  await upsertNode("Product", product!.id, org!.id, { name: product!.name });
  await upsertNode("Competitor", rival!.id, org!.id, { name: rival!.name, category: rival!.category });
  for (const c of companyRows) {
    await upsertNode("Company", c.id, org!.id, { name: c.name, domain: c.domain, tier: c.tier, status: c.status });
  }
  for (const p of peopleRows) {
    await upsertNode("Person", p.id, org!.id, { name: p.name, title: p.title });
    await upsertRel("WORKS_AT", { label: "Person", id: p.id }, { label: "Company", id: p.companyId });
  }
  for (const sig of signalRows) {
    await upsertNode("Signal", sig.id, org!.id, {
      type: sig.type,
      title: sig.title,
      sourceUrl: sig.sourceUrl,
      observedAt: sig.observedAt.toISOString(),
    });
    await upsertRel("HAS_SIGNAL", { label: "Company", id: sig.companyId }, { label: "Signal", id: sig.id }, { sourceUrl: sig.sourceUrl });
  }

  const productRef = { label: "Product" as const, id: product!.id };
  await upsertRel("CUSTOMER_OF", { label: "Company", id: northwind.id }, productRef);
  for (const c of [contoso, fabrikam, tailspin]) {
    await upsertRel("MATCHED_TO", { label: "Company", id: c.id }, productRef, { icpId: icp!.id });
  }
  await upsertRel("COMPETES_WITH", { label: "Competitor", id: rival!.id }, productRef);
  await upsertRel("USES", { label: "Company", id: fabrikam.id }, { label: "Competitor", id: rival!.id }, { sourceUrl: src("fabrikam-renewal") });
  await upsertRel("CONTACTED_VIA", { label: "Person", id: jordan.id }, productRef, { channel: "email", messageId: sentMsg!.id });

  // Warm-intro path: Jordan (target at Contoso Pay) and Sam (at customer Northwind Cloud) both worked at Fabrikam Data.
  await upsertRel("PREVIOUSLY_EMPLOYED_AT", { label: "Person", id: jordan.id }, { label: "Company", id: fabrikam.id }, { sourceUrl: src("jordan-profile"), until: "2023" });
  await upsertRel("PREVIOUSLY_EMPLOYED_AT", { label: "Person", id: sam.id }, { label: "Company", id: fabrikam.id }, { sourceUrl: src("sam-profile"), until: "2022" });

  // ---------- prove it ----------
  const intros = await findWarmIntros(org!.id, product!.id);
  const cycles = await findBuyingCycles(org!.id);
  const displacements = await findDisplacements(org!.id);

  console.log(`  Warm intros: ${intros.map((i) => `${i.targetName} (${i.targetCompany}) via ${i.via} -> ${i.connectorName} (${i.connectorCompany})`).join("; ") || "none"}`);
  console.log(`  Buying cycles (30d): ${cycles.map((c) => `${c.company}: ${c.signal}`).join("; ") || "none"}`);
  console.log(`  Displacement: ${displacements.map((d) => `${d.company} uses ${d.competitor}: ${d.signal}`).join("; ") || "none"}`);
}

await closeDb();
if (graphOn) await closeGraph();
