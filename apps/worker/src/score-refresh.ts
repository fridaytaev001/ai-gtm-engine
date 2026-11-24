import { and, eq, inArray, ne } from "drizzle-orm";
import { getEnv, scoreSignals } from "@gtm/core";
import { getDb, schema, WORKSPACE_ORG_ID } from "@gtm/db";

export function startScoreRefresh() {
  if (!getEnv().DATABASE_URL) return () => {};
  const orgId = WORKSPACE_ORG_ID;
  const { companies, signals, evidence, events } = schema;
  async function refresh() {
    const db = getDb();
    const tierA = await db.select().from(companies)
      .where(and(eq(companies.orgId, orgId), eq(companies.tier, "A"), ne(companies.status, "filtered")));
    if (!tierA.length) return;
    const verified = await db.selectDistinct({ id: signals.id, companyId: signals.companyId, type: signals.type, observedAt: signals.observedAt })
      .from(signals).innerJoin(evidence, and(eq(evidence.entityId, signals.id), eq(evidence.entityType, "signal"), eq(evidence.orgId, orgId), eq(evidence.verified, true)))
      .where(and(eq(signals.orgId, orgId), inArray(signals.companyId, tierA.map((company) => company.id))));
    for (const company of tierA) {
      if (company.intentScore === null) continue;
      const next = scoreSignals(company.fitScore ?? 0, verified.filter((signal) => signal.companyId === company.id));
      if (company.intentScore === next.intent && company.tier === next.tier) continue;
      await db.transaction(async (tx) => {
        const [changed] = await tx.update(companies).set({ intentScore: next.intent, tier: next.tier, updatedAt: new Date() })
          .where(and(eq(companies.id, company.id), eq(companies.orgId, orgId), eq(companies.updatedAt, company.updatedAt)))
          .returning({ id: companies.id });
        if (changed) await tx.insert(events).values({ orgId, type: "graph.score_changed", actorType: "system",
          payload: { companyId: company.id, from: company.intentScore, to: next.intent, tier: next.tier } });
      });
    }
  }
  const run = () => { void refresh().catch(() => console.error("[graph] Tier A score refresh failed.")); };
  run();
  const timer = setInterval(run, 86_400_000);
  return () => clearInterval(timer);
}
