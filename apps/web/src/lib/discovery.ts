import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DiscoveredCompany, DiscoveryStats } from "@gtm/ai";
import { getDb, schema } from "@gtm/db";

const { companies, evidence, people, signals } = schema;

/**
 * Intent 0-100 from verified signals: more signals and fresher ones score higher.
 * Composite = 60% fit + 40% intent; tiers A >= 75, B 50-74, C < 50 (design doc, Module 5).
 */
export function scoreCompany(c: DiscoveredCompany) {
  const now = Date.now();
  let intent = 30;
  for (const s of c.signals) {
    const weight = s.type === "job_post" || s.type === "funding" || s.type === "exec_hire" ? 20 : 12;
    const t = Date.parse(s.observedAt);
    const ageDays = Number.isFinite(t) ? (now - t) / 864e5 : 120;
    intent += ageDays <= 30 ? weight : ageDays <= 120 ? weight * 0.6 : weight * 0.3;
  }
  intent = Math.round(Math.min(100, intent));
  const composite = Math.round(c.fitScore * 0.6 + intent * 0.4);
  const tier: "A" | "B" | "C" = composite >= 75 ? "A" : composite >= 50 ? "B" : "C";
  return { fit: c.fitScore, intent, composite, tier };
}

/** Save one discovery run: upsert companies, append new signals/people, and write an evidence row per verified fact. */
export async function persistDiscovery(orgId: string, icpId: string, found: DiscoveredCompany[]) {
  const db = getDb();
  let created = 0;
  let filtered = 0;
  const known = found.length
    ? new Set(
        (
          await db
            .select({ domain: companies.domain })
            .from(companies)
            .where(and(eq(companies.orgId, orgId), inArray(companies.domain, found.map((c) => c.domain))))
        ).map((r) => r.domain),
      )
    : new Set<string>();

  // Companies are saved in parallel (each company's own writes stay in order) to fit the serverless time limit.
  await Promise.all(found.map(async (c) => {
    const score = scoreCompany(c);
    const negative = c.negativeFlags.map((n) => n.flag);
    const status = negative.length ? ("filtered" as const) : ("candidate" as const);
    if (status === "filtered") filtered++;

    const values = {
      orgId,
      icpId,
      name: c.name,
      domain: c.domain,
      hq: c.hq || null,
      industryLabel: c.industry || null,
      headcount: c.headcountEstimate ? Math.round(c.headcountEstimate) : null,
      fitScore: score.fit,
      intentScore: score.intent,
      tier: score.tier,
      fitReason: c.fitReason,
      status,
      negativeFlags: negative,
      filterReason: negative.length ? negative.join("; ") : null,
    };
    const [row] = await db
      .insert(companies)
      .values(values)
      .onConflictDoUpdate({ target: [companies.orgId, companies.domain], set: values })
      .returning({ id: companies.id });
    if (!known.has(c.domain)) created++;
    const companyId = row!.id;

    // Signals: skip ones already stored from the same source.
    const existing = await db
      .select({ sourceUrl: signals.sourceUrl, title: signals.title })
      .from(signals)
      .where(eq(signals.companyId, companyId));
    const seen = new Set(existing.map((s) => `${s.sourceUrl}|${s.title}`));
    for (const s of c.signals) {
      if (seen.has(`${s.sourceUrl}|${s.title}`)) continue;
      const t = Date.parse(s.observedAt);
      const [sig] = await db
        .insert(signals)
        .values({
          orgId,
          companyId,
          type: s.type,
          title: s.title,
          sourceUrl: s.sourceUrl,
          observedAt: Number.isFinite(t) ? new Date(t) : new Date(),
        })
        .returning({ id: signals.id });
      await db.insert(evidence).values({
        orgId,
        entityType: "signal",
        entityId: sig!.id,
        claim: s.title,
        sourceUrl: s.sourceUrl,
        quote: s.quote,
        verified: true,
        verifiedAt: new Date(),
      });
    }

    // People named in a source, in buyer roles.
    if (c.people.length) {
      const names = c.people.map((p) => p.name);
      const have = await db
        .select({ name: people.name })
        .from(people)
        .where(and(eq(people.companyId, companyId), inArray(people.name, names)));
      const haveSet = new Set(have.map((h) => h.name));
      for (const p of c.people) {
        if (haveSet.has(p.name)) continue;
        const [person] = await db
          .insert(people)
          .values({ orgId, companyId, name: p.name, title: p.title, enrichSource: "discovery" })
          .returning({ id: people.id });
        await db.insert(evidence).values({
          orgId,
          entityType: "person",
          entityId: person!.id,
          claim: `${p.name}, ${p.title}`,
          sourceUrl: p.sourceUrl,
          quote: p.quote,
          verified: true,
          verifiedAt: new Date(),
        });
      }
    }

    // Negative flags are evidence on the company.
    for (const n of c.negativeFlags) {
      await db.insert(evidence).values({
        orgId,
        entityType: "company",
        entityId: companyId,
        claim: `Negative signal: ${n.flag}`,
        sourceUrl: n.sourceUrl,
        quote: n.quote,
        verified: true,
        verifiedAt: new Date(),
      });
    }
  }));

  return { created, filtered };
}

export type DiscoveryRunSummary = DiscoveryStats & { created: number; filtered: number };
