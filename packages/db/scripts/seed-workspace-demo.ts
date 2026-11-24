/**
 * Copy the isolated fictional LogLens seed into the app workspace.
 * Stable IDs and conflict handling make the operation additive and repeatable.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { integrationStatus } from "@gtm/core";
import { closeDb, getDb } from "../src/client";
import { closeGraph, ensureGraphSchema, upsertNode, upsertRel } from "../src/graph";
import * as s from "../src/schema";
import { ensureWorkspace } from "../src/workspace";

const demoOrg = "00000000-0000-4000-8000-000000000001";
const { orgId, userId } = await ensureWorkspace();
const db = getDb();
function stable(key: string) {
  const hex = createHash("sha256").update(`hackbay-demo:${orgId}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const productId = stable("product");
const icpId = stable("icp");
const source = (path: string) => `https://news.example/${path}`;

try {
  const [product] = await db.select().from(s.products).where(and(eq(s.products.orgId, demoOrg), eq(s.products.name, "LogLens")));
  if (!product) throw new Error("Run pnpm db:seed to create the isolated fictional LogLens fixture first.");
  const [icp] = await db.select().from(s.icps).where(eq(s.icps.productId, product.id));
  if (!icp) throw new Error("The fictional LogLens ICP is missing.");
  const [accounts, people, signals, competitors, leads] = await Promise.all([
    db.select().from(s.companies).where(eq(s.companies.orgId, demoOrg)),
    db.select().from(s.people).where(eq(s.people.orgId, demoOrg)),
    db.select().from(s.signals).where(eq(s.signals.orgId, demoOrg)),
    db.select().from(s.competitors).where(eq(s.competitors.productId, product.id)),
    db.select().from(s.leads).where(and(eq(s.leads.orgId, demoOrg), eq(s.leads.icpId, icp.id))),
  ]);
  if (accounts.some((account) => !account.domain.endsWith(".example"))) throw new Error("Demo fixture contains non-example accounts.");
  const byCompany = new Map(accounts.map((row) => [row.id, stable(`account:${row.domain}`)]));
  const byPerson = new Map(people.map((row) => [row.id, stable(`person:${byCompany.get(row.companyId)}:${row.name}`)]));
  const bySignal = new Map(signals.map((row) => [row.id, stable(`signal:${row.sourceUrl}`)]));
  const proof = signals.length ? await db.select().from(s.evidence).where(and(eq(s.evidence.orgId, demoOrg), eq(s.evidence.verified, true),
    inArray(s.evidence.entityId, signals.map((row) => row.id)))) : [];
  const demoSignals = signals.map((row) => ({
    ...row, id: bySignal.get(row.id)!, companyId: byCompany.get(row.companyId)!, orgId,
    observedAt: new Date(Date.now() - (row.type === "funding" ? 40 : row.type === "job_post" ? 6 : 12) * 86_400_000),
  }));
  const demoPeople = people.map((row) => ({ ...row, id: byPerson.get(row.id)!, companyId: byCompany.get(row.companyId)!, orgId, updatedAt: new Date() }));
  const demoCompanies = accounts.map((row) => ({ ...row, id: byCompany.get(row.id)!, orgId, icpId }));
  const demoCompetitors = competitors.map((row) => ({ ...row, id: stable(`competitor:${row.name}`), productId, sourceUrls: [source("fabrikam-renewal")] }));
  const demoLeads = leads.map((row) => ({ ...row, id: stable(`lead:${byPerson.get(row.personId)}`), personId: byPerson.get(row.personId)!,
    icpId, orgId, ownerId: row.ownerId ? userId : null }));

  await db.transaction(async (tx) => {
    await tx.insert(s.products).values({ ...product, id: productId, orgId, name: "LogLens (fictional demo)" }).onConflictDoNothing();
    await tx.insert(s.icps).values({ ...icp, id: icpId, productId, status: "approved" }).onConflictDoNothing();
    if (demoCompanies.length) await tx.insert(s.companies).values(demoCompanies).onConflictDoNothing();
    if (demoPeople.length) await tx.insert(s.people).values(demoPeople).onConflictDoNothing();
    if (demoSignals.length) await tx.insert(s.signals).values(demoSignals).onConflictDoNothing();
    if (demoCompetitors.length) await tx.insert(s.competitors).values(demoCompetitors).onConflictDoNothing();
    if (demoLeads.length) await tx.insert(s.leads).values(demoLeads).onConflictDoNothing();
    const citedSignals = proof.map((row) => ({ ...row, id: stable(`evidence:${row.sourceUrl}`), orgId, entityId: bySignal.get(row.entityId)! }));
    if (citedSignals.length) await tx.insert(s.evidence).values(citedSignals).onConflictDoNothing();
    if (demoPeople.length) await tx.insert(s.evidence).values(demoPeople.map((person) => ({
      id: stable(`profile:${person.id}`), orgId, entityId: person.id, entityType: "person" as const,
      claim: `${person.name} · ${person.title}`, quote: `Fictional fixture: ${person.name} is ${person.title} at ${demoCompanies.find((company) => company.id === person.companyId)?.name}.`,
      sourceUrl: source(person.name.toLowerCase().replace(/\s+/g, "-")), verified: true, verifiedAt: new Date(),
    }))).onConflictDoNothing();
    const person = demoPeople.find((row) => row.name === "Avery Chen");
    const lead = demoLeads.find((row) => row.personId === person?.id);
    const cite = citedSignals.find((row) => row.sourceUrl.endsWith("fabrikam-renewal"));
    if (lead && cite) {
      const quote = `“${cite.quote}”\n${cite.sourceUrl}`;
      await tx.insert(s.messages).values([
        { id: stable("draft:a"), leadId: lead.id, channel: "email", step: 1, variant: "A", subject: "Quick introduction",
          body: `Hi Avery,\n\n${quote}\n\nWould you take a look at LogLens? Open to a 15-minute chat?`, reviewerNotes: `Cited evidence: ${cite.id}` },
        { id: stable("draft:b"), leadId: lead.id, channel: "email", step: 1, variant: "B", subject: "A question about incident response",
          body: `Hi Avery,\n\n${quote}\n\nWould it help if I sent a short overview?`, reviewerNotes: `Cited evidence: ${cite.id}` },
        { id: stable("draft:linkedin"), leadId: lead.id, channel: "linkedin", step: 2,
          body: "Hi Avery, would you be open to connecting?", reviewerNotes: "No factual claims" },
        { id: stable("draft:followup"), leadId: lead.id, channel: "email", step: 3, subject: "Following up",
          body: "Hi Avery, just checking in. Is this a priority for your team?", reviewerNotes: "No factual claims" },
      ]).onConflictDoNothing();
    }
    await tx.insert(s.events).values({ id: stable("event:seeded"), orgId, type: "demo.seeded", actorType: "system", payload: { icpId } }).onConflictDoNothing();
  });
  if (integrationStatus().neo4j) {
    await ensureGraphSchema();
    const productRef = { label: "Product" as const, id: productId };
    await upsertNode("Product", productId, orgId, { name: "LogLens (fictional demo)" });
    for (const company of demoCompanies) {
      const ref = { label: "Company" as const, id: company.id };
      await upsertNode("Company", company.id, orgId, { name: company.name, domain: company.domain, tier: company.tier });
      if (company.domain === "northwind.example") await upsertRel("CUSTOMER_OF", ref, productRef);
      else if (company.status !== "filtered") await upsertRel("MATCHED_TO", ref, productRef);
    }
    for (const person of demoPeople) {
      const ref = { label: "Person" as const, id: person.id };
      await upsertNode("Person", person.id, orgId, { name: person.name, title: person.title });
      await upsertRel("WORKS_AT", ref, { label: "Company", id: person.companyId });
      if (person.name === "Jordan Lee" || person.name === "Sam Rivera") {
        const shared = demoCompanies.find((company) => company.domain === "fabrikam.example");
        if (shared) await upsertRel("PREVIOUSLY_EMPLOYED_AT", ref, { label: "Company", id: shared.id },
          { sourceUrl: source(person.name === "Jordan Lee" ? "jordan-profile" : "sam-profile") });
      }
    }
    for (const signal of demoSignals) {
      const props = { title: signal.title, type: signal.type, sourceUrl: signal.sourceUrl, observedAt: signal.observedAt.toISOString() };
      await upsertNode("Signal", signal.id, orgId, props);
      await upsertRel("HAS_SIGNAL", { label: "Company", id: signal.companyId }, { label: "Signal", id: signal.id }, props);
    }
    for (const rival of demoCompetitors) {
      const ref = { label: "Competitor" as const, id: rival.id };
      await upsertNode("Competitor", rival.id, orgId, { name: rival.name, sourceUrl: rival.sourceUrls[0] });
      await upsertRel("COMPETES_WITH", ref, productRef, { sourceUrl: rival.sourceUrls[0] });
      const renewal = demoSignals.find((signal) => signal.sourceUrl.endsWith("fabrikam-renewal"));
      if (renewal) await upsertRel("USES", { label: "Company", id: renewal.companyId }, ref, { sourceUrl: renewal.sourceUrl });
    }
  }
  console.log(`Fictional demo ready at /icp/${icpId}/leads`);
} finally {
  await Promise.allSettled([closeDb(), closeGraph()]);
}
