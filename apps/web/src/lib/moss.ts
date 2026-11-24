import "server-only";
import type { DocumentInfo, MossClient } from "@moss-js/moss";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getEnv } from "@gtm/core";
import { getDb, schema } from "@gtm/db";

const names = ["entities", "signals", "icp_segments"] as const;
type Index = typeof names[number];
type Filters = { kind?: "company" | "person" | "signal"; tier?: "A" | "B" | "C"; since?: string; domain?: string };
let clientPromise: Promise<MossClient> | undefined;
const loaded = new Map<Index, Promise<string>>();

export function mossConfigured() {
  const env = getEnv();
  return Boolean(env.MOSS_PROJECT_ID && env.MOSS_PROJECT_KEY);
}

async function client() {
  const env = getEnv();
  if (!env.MOSS_PROJECT_ID || !env.MOSS_PROJECT_KEY) throw new Error("Moss is not configured.");
  clientPromise ??= import("@moss-js/moss").then(({ MossClient }) => new MossClient(env.MOSS_PROJECT_ID!, env.MOSS_PROJECT_KEY!))
    .catch((error) => { clientPromise = undefined; throw error; });
  return clientPromise;
}

async function load(name: Index) {
  let pending = loaded.get(name);
  if (!pending) {
    pending = (await client()).loadIndex(name, { autoRefresh: true }).catch((error) => { loaded.delete(name); throw error; });
    loaded.set(name, pending);
  }
  return pending;
}

async function snapshot(orgId: string) {
  const { companies, evidence, icps, people, products, signals } = schema;
  const db = getDb();
  const [accountRows, icpRows] = await Promise.all([
    db.select().from(companies).where(and(eq(companies.orgId, orgId), ne(companies.status, "filtered"))),
    db.select({ icp: icps, product: products.name }).from(icps).innerJoin(products, eq(icps.productId, products.id))
      .where(and(eq(products.orgId, orgId), eq(icps.status, "approved"))),
  ]);
  const ids = accountRows.map((row) => row.id);
  const [personRows, signalRows] = ids.length ? await Promise.all([
    db.select().from(people).where(and(eq(people.orgId, orgId), inArray(people.companyId, ids))),
    db.select().from(signals).where(and(eq(signals.orgId, orgId), inArray(signals.companyId, ids))),
  ]) : [[], []];
  const targets = [...personRows, ...signalRows].map((row) => row.id);
  const quotes = targets.length ? await db.select().from(evidence).where(and(eq(evidence.orgId, orgId), eq(evidence.verified, true),
    inArray(evidence.entityId, targets))) : [];
  const byId = new Map(quotes.filter((row) => row.sourceUrl.startsWith("https://")).map((row) => [row.entityId, row]));
  const accounts = new Map(accountRows.map((row) => [row.id, row]));
  const docs: Record<Index, DocumentInfo[]> = { entities: [], signals: [], icp_segments: [] };
  const firstSignal = new Map<string, DocumentInfo>();
  for (const signal of [...signalRows].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())) {
    const cite = byId.get(signal.id);
    const account = accounts.get(signal.companyId);
    if (!cite || !account?.icpId) continue;
    const doc = {
      id: signal.id, text: `${account.name}: ${signal.title}. ${cite.quote}`,
      metadata: {
        org_id: orgId, kind: "signal", signal_type: signal.type, tier: account.tier ?? "", domain: account.domain,
        observed_at: String(Math.floor(signal.observedAt.getTime() / 1000)), source_url: cite.sourceUrl, icp_id: account.icpId,
      },
    };
    docs.signals.push(doc);
    if (!firstSignal.has(account.id)) firstSignal.set(account.id, doc);
  }
  for (const account of accountRows) {
    const cited = firstSignal.get(account.id);
    if (cited) docs.entities.push({ ...cited, id: account.id, metadata: { ...cited.metadata, kind: "company" } });
  }
  for (const person of personRows) {
    const cite = byId.get(person.id);
    const account = accounts.get(person.companyId);
    if (!cite || !account?.icpId) continue;
    docs.entities.push({
      id: person.id, text: `${person.name} · ${account.name}. ${cite.quote}`,
      metadata: {
        org_id: orgId, kind: "person", tier: account.tier ?? "", domain: account.domain,
        observed_at: String(Math.floor(cite.fetchedAt.getTime() / 1000)), source_url: cite.sourceUrl, icp_id: account.icpId,
      },
    });
  }
  for (const { icp, product } of icpRows) docs.icp_segments.push({
    id: icp.id,
    text: [product, ...icp.industries.map((industry) => industry.label), ...icp.segments.map((segment) => segment.segment),
      ...icp.triggers.map((trigger) => trigger.description)].join(". "),
    metadata: { org_id: orgId, kind: "icp", icp_id: icp.id, observed_at: String(Math.floor(icp.createdAt.getTime() / 1000)) },
  });
  return docs;
}

/** Reconcile only documents owned by this workspace. External jobs do not overlap for a workspace. */
export async function syncMoss(orgId: string) {
  const moss = await client();
  return getDb().transaction(async (tx) => {
    const [lock] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${`moss:${orgId}`}, 0)) as acquired`);
    if (!lock?.acquired) throw new Error("A search sync is already running.");
    const docs = await snapshot(orgId);
    const existing = new Set((await moss.listIndexes()).map((index) => index.name));
    for (const name of names) {
      if (!existing.has(name)) {
        if (docs[name].length) await moss.createIndex(name, docs[name], { modelId: "moss-minilm" });
        continue;
      }
      const previous = (await moss.getDocs(name)).filter((doc) => doc.metadata?.org_id === orgId);
      const previousById = new Map(previous.map((doc) => [doc.id, doc]));
      const nextIds = new Set(docs[name].map((doc) => doc.id));
      const deleted = previous.filter((doc) => !nextIds.has(doc.id)).map((doc) => doc.id);
      const changed = docs[name].filter((doc) => {
        const old = previousById.get(doc.id);
        return !old || old.text !== doc.text || Object.entries(doc.metadata ?? {}).some(([key, value]) => old.metadata?.[key] !== value);
      });
      if (changed.length) await moss.addDocs(name, changed, { upsert: true });
      if (deleted.length) await moss.deleteDocs(name, deleted);
      if (changed.length || deleted.length) {
        await moss.loadIndex(name, { autoRefresh: true });
      }
    }
    await tx.insert(schema.events).values({ orgId, type: "moss.synced", actorType: "agent", actorId: "builder",
      payload: { entities: docs.entities.length, signals: docs.signals.length, segments: docs.icp_segments.length } });
    return docs.entities.length + docs.signals.length + docs.icp_segments.length;
  });
}

export async function searchMoss(orgId: string, query: string, filters: Filters = {}) {
  const moss = await client();
  const started = performance.now();
  const metadata: Record<string, { $eq: string } | { $gte: string }> = { org_id: { $eq: orgId } };
  if (filters.kind) metadata.kind = { $eq: filters.kind };
  if (filters.tier) metadata.tier = { $eq: filters.tier };
  if (filters.domain) metadata.domain = { $eq: filters.domain };
  if (filters.since) metadata.observed_at = { $gte: String(Math.floor(Date.parse(filters.since) / 1000)) };
  const namesToSearch: Index[] = filters.kind === "signal" ? ["signals"] : filters.kind ? ["entities"] : ["entities", "signals"];
  const results = await Promise.allSettled(namesToSearch.map(async (name) => {
    await load(name);
    return (await moss.query(name, query, { filter: metadata, alpha: 0.6, topK: 12 })).docs;
  }));
  const good = results.filter((result) => result.status === "fulfilled");
  if (!good.length) throw new Error("Search indexes are unavailable. Sync them first.");
  const current = await snapshot(orgId);
  const currentById = new Map([...current.entities, ...current.signals].map((doc) => [doc.id, doc]));
  const hits = good.flatMap((result) => result.value).sort((a, b) => b.score - a.score).flatMap((result) => {
    const doc = currentById.get(result.id);
    const info = doc?.metadata;
    if (!doc || !info || info.org_id !== orgId || (filters.kind && info.kind !== filters.kind)
      || (filters.tier && info.tier !== filters.tier) || (filters.domain && info.domain !== filters.domain)
      || (filters.since && Number(info.observed_at) * 1000 < Date.parse(filters.since))) return [];
    return [{ id: doc.id, text: doc.text, score: result.score, sourceUrl: info.source_url, icpId: info.icp_id, kind: info.kind }];
  }).slice(0, 10);
  const ms = Math.round(performance.now() - started);
  await getDb().insert(schema.events).values({ orgId, type: "band.thought", actorType: "agent", actorId: "builder",
    payload: { text: "Searched verified pipeline evidence in Moss.", latencyMs: ms, hits: hits.length } });
  return { hits, ms };
}
