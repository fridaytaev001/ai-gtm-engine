import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { ensureWorkspace, getDb, schema } from "@gtm/db";

const { icps, icpSuggestions, products } = schema;

export type IcpRow = typeof icps.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type SuggestionRow = typeof icpSuggestions.$inferSelect;

/** All ICP versions in the workspace, newest first, with their product name. */
export async function listIcps() {
  const { orgId } = await ensureWorkspace();
  return getDb()
    .select({
      id: icps.id,
      version: icps.version,
      status: icps.status,
      createdAt: icps.createdAt,
      productId: products.id,
      productName: products.name,
    })
    .from(icps)
    .innerJoin(products, eq(icps.productId, products.id))
    .where(eq(products.orgId, orgId))
    .orderBy(desc(icps.createdAt));
}

/** One ICP with its product, sibling versions and expansion suggestions (scoped to the workspace). */
export async function getIcpDetail(icpId: string) {
  const { orgId } = await ensureWorkspace();
  const db = getDb();
  const [row] = await db
    .select({ icp: icps, product: products })
    .from(icps)
    .innerJoin(products, eq(icps.productId, products.id))
    .where(and(eq(icps.id, icpId), eq(products.orgId, orgId)));
  if (!row) return null;
  const [versions, suggestions] = await Promise.all([
    db
      .select({ id: icps.id, version: icps.version, status: icps.status })
      .from(icps)
      .where(eq(icps.productId, row.product.id))
      .orderBy(desc(icps.version)),
    db.select().from(icpSuggestions).where(eq(icpSuggestions.icpId, icpId)).orderBy(icpSuggestions.createdAt),
  ]);
  return { ...row, versions, suggestions };
}

/** Companies found for any ICP version of this product, with verified signals, quotes, people and competitors. */
export async function getLeadsForIcp(icpId: string) {
  const detail = await getIcpDetail(icpId);
  if (!detail) return null;
  const db = getDb();
  const { companies, evidence, people, signals, competitors } = schema;
  const versionIds = detail.versions.map((v) => v.id);
  const rows = await db
    .select()
    .from(companies)
    .where(inArray(companies.icpId, versionIds))
    .orderBy(desc(companies.fitScore));
  const companyIds = rows.map((r) => r.id);
  const [sigs, ppl, comps, scoreEvents] = await Promise.all([
    companyIds.length ? db.select().from(signals).where(inArray(signals.companyId, companyIds)).orderBy(desc(signals.observedAt)) : [],
    companyIds.length ? db.select().from(people).where(inArray(people.companyId, companyIds)) : [],
    db.select().from(competitors).where(eq(competitors.productId, detail.product.id)),
    db.select({ payload: schema.events.payload }).from(schema.events).where(and(eq(schema.events.orgId, detail.product.orgId),
      eq(schema.events.type, "graph.score_changed"), gte(schema.events.createdAt, new Date(Date.now() - 86_400_000)))),
  ]);
  const changed = new Set(scoreEvents.map((event) => event.payload.companyId));
  const entityIds = [...sigs.map((s) => s.id), ...ppl.map((p) => p.id), ...companyIds];
  const ev = entityIds.length ? await db.select().from(evidence)
    .where(and(inArray(evidence.entityId, entityIds), eq(evidence.orgId, detail.product.orgId), eq(evidence.verified, true))) : [];
  const quoteFor = new Map(ev.map((e) => [e.entityId, e]));
  const negEvidence = new Map<string, typeof ev>();
  for (const e of ev) if (e.entityType === "company") negEvidence.set(e.entityId, [...(negEvidence.get(e.entityId) ?? []), e]);

  const leads = rows.map((c) => ({
    ...c,
    scoreChanged: changed.has(c.id),
    composite: Math.round((c.fitScore ?? 0) * 0.6 + (c.intentScore ?? 0) * 0.4),
    signals: sigs.filter((s) => s.companyId === c.id).map((s) => ({ ...s, quote: quoteFor.get(s.id)?.quote ?? null })),
    people: ppl.filter((p) => p.companyId === c.id).map((p) => ({ ...p, evidence: quoteFor.get(p.id) ?? null })),
    negativeEvidence: negEvidence.get(c.id) ?? [],
  }));
  return { ...detail, leads, competitors: comps };
}
