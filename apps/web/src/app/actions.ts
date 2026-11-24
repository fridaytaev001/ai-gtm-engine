"use server";

import { and, eq, max } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { integrationStatus } from "@gtm/core";
import { z } from "zod";
import {
  discoverAccounts,
  inferIcp,
  mapCompetitors,
  intakeTurn,
  ModelRefusalError,
  ProductDraftSchema,
  suggestExpansions,
  type ChatTurn,
  type IcpInference,
  type IntakeTurn,
  type ProductDraft,
} from "@gtm/ai";
import { ensureWorkspace, getDb, schema } from "@gtm/db";
import { toDraft, toInference } from "@/lib/convert";
import { persistDiscovery, type DiscoveryRunSummary } from "@/lib/discovery";
import { getLeadsForIcp } from "@/lib/data";
import { syncProductGraph } from "@/lib/graph";
import { mossConfigured, searchMoss, syncMoss } from "@/lib/moss";

const { competitors, events, icpSuggestions, icps, products } = schema;

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof ModelRefusalError) return { ok: false, error: err.message };
  if (err instanceof z.ZodError) return { ok: false, error: "Some fields are invalid." };
  console.error(err);
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
}

// ---------------------------------------------------------------- intake

const ChatSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(60);

export async function sendIntakeMessage(history: ChatTurn[], draft: ProductDraft): Promise<ActionResult<IntakeTurn>> {
  try {
    const { turn } = await intakeTurn(ChatSchema.parse(history), ProductDraftSchema.parse(draft));
    return { ok: true, data: turn };
  } catch (err) {
    return fail(err);
  }
}

/** Save the product, infer ICP v1 and open it. */
export async function createProductAndIcp(draft: ProductDraft): Promise<ActionResult<never>> {
  let icpId: string;
  try {
    const product = ProductDraftSchema.parse(draft);
    if (!product.name.trim() || !product.description.trim()) {
      return { ok: false, error: "Add at least a product name and description." };
    }
    const { orgId, userId } = await ensureWorkspace();
    const db = getDb();
    const [saved] = await db
      .insert(products)
      .values({
        orgId,
        name: product.name.trim(),
        description: product.description.trim(),
        features: product.features.filter(Boolean),
        pricing: {
          model: product.pricing.model || undefined,
          annualContractValueUsd: product.pricing.annualContractValueUsd ?? undefined,
          notes: product.pricing.notes || undefined,
        },
        referenceCustomers: product.referenceCustomers
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name.trim(), domain: c.domain.trim() || undefined })),
      })
      .returning();

    const { icp } = await inferIcp(product);
    const [row] = await db.insert(icps).values({ productId: saved!.id, version: 1, ...toIcpColumns(icp) }).returning();
    icpId = row!.id;
    await db.insert(events).values([
      { orgId, type: "product.created", actorType: "rep", actorId: userId, payload: { productId: saved!.id } },
      { orgId, type: "icp.inferred", actorType: "agent", actorId: "planner", payload: { icpId, version: 1 } },
    ]);
  } catch (err) {
    return fail(err);
  }
  redirect(`/icp/${icpId}`);
}

function toIcpColumns(icp: IcpInference) {
  return {
    industries: icp.industries,
    sizeBands: {
      headcountMin: icp.sizeBands.headcountMin ?? undefined,
      headcountMax: icp.sizeBands.headcountMax ?? undefined,
      revenueMinUsd: icp.sizeBands.revenueMinUsd ?? undefined,
      revenueMaxUsd: icp.sizeBands.revenueMaxUsd ?? undefined,
    },
    personas: icp.personas,
    triggers: icp.triggers,
    regions: icp.regions,
    negativeSignals: icp.negativeSignals,
    fieldConfidence: icp.fieldConfidence,
    rationale: icp.rationale,
  };
}

// ---------------------------------------------------------------- ICP versions

/** Load an ICP that belongs to the workspace. */
async function loadIcp(icpId: string) {
  const { orgId } = await ensureWorkspace();
  const [row] = await getDb()
    .select({ icp: icps, product: products })
    .from(icps)
    .innerJoin(products, eq(icps.productId, products.id))
    .where(and(eq(icps.id, z.uuid().parse(icpId)), eq(products.orgId, orgId)));
  if (!row) throw new Error("ICP not found");
  return row;
}

type IcpPatch = Partial<
  Pick<typeof icps.$inferInsert, "industries" | "sizeBands" | "personas" | "triggers" | "regions" | "negativeSignals" | "segments">
>;

/** Every founder change creates a new version, so earlier versions stay auditable. */
async function createVersion(icpId: string, patch: IcpPatch, reason: string, confirmedFields: string[] = []) {
  const { icp } = await loadIcp(icpId);
  const db = getDb();
  const [{ latest }] = (await db.select({ latest: max(icps.version) }).from(icps).where(eq(icps.productId, icp.productId))) as [
    { latest: number | null },
  ];
  // A field the founder edited or confirmed is now known, not inferred.
  const fieldConfidence = { ...icp.fieldConfidence };
  for (const f of confirmedFields) fieldConfidence[f] = 1;
  const [next] = await db
    .insert(icps)
    .values({
      productId: icp.productId,
      version: (latest ?? icp.version) + 1,
      status: "draft",
      industries: icp.industries,
      sizeBands: icp.sizeBands,
      personas: icp.personas,
      triggers: icp.triggers,
      regions: icp.regions,
      negativeSignals: icp.negativeSignals,
      segments: icp.segments,
      rationale: icp.rationale,
      fieldConfidence,
      ...patch,
    })
    .returning();
  const { orgId, userId } = await ensureWorkspace();
  await db.insert(events).values({
    orgId,
    type: "icp.versioned",
    actorType: "rep",
    actorId: userId,
    payload: { from: icpId, to: next!.id, reason },
  });
  // Carry pending/decided suggestions over so the review history stays visible.
  const old = await db.select().from(icpSuggestions).where(eq(icpSuggestions.icpId, icpId));
  if (old.length) {
    await db.insert(icpSuggestions).values(
      old.map(({ segment, reasoning, evidenceUrls, decision }) => ({ icpId: next!.id, segment, reasoning, evidenceUrls, decision })),
    );
  }
  return next!.id;
}

const EditSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("industries"), value: z.array(z.object({ naics: z.string(), label: z.string(), confidence: z.number().optional() })) }),
  z.object({
    field: z.literal("sizeBands"),
    value: z.object({
      headcountMin: z.number().optional(),
      headcountMax: z.number().optional(),
      revenueMinUsd: z.number().optional(),
      revenueMaxUsd: z.number().optional(),
    }),
  }),
  z.object({
    field: z.literal("personas"),
    value: z.array(z.object({ title: z.string(), seniority: z.string(), function: z.string().optional(), role: z.string().optional() })),
  }),
  z.object({ field: z.literal("triggers"), value: z.array(z.object({ type: z.string(), description: z.string() })) }),
  z.object({ field: z.literal("regions"), value: z.array(z.string()) }),
  z.object({ field: z.literal("negativeSignals"), value: z.array(z.string()) }),
]);

export async function editIcpField(icpId: string, edit: z.input<typeof EditSchema>): Promise<ActionResult<never>> {
  let nextId: string;
  try {
    const e = EditSchema.parse(edit);
    nextId = await createVersion(icpId, { [e.field]: e.value } as IcpPatch, `edited ${e.field}`, [e.field]);
  } catch (err) {
    return fail(err);
  }
  redirect(`/icp/${nextId}`);
}

export async function approveIcp(icpId: string): Promise<ActionResult<null>> {
  try {
    const { icp } = await loadIcp(icpId);
    const db = getDb();
    // Only one approved version per product.
    await db.update(icps).set({ status: "archived" }).where(and(eq(icps.productId, icp.productId), eq(icps.status, "approved")));
    await db.update(icps).set({ status: "approved" }).where(eq(icps.id, icp.id));
    const { orgId, userId } = await ensureWorkspace();
    await db.insert(events).values({ orgId, type: "icp.approved", actorType: "rep", actorId: userId, payload: { icpId } });
    revalidatePath(`/icp/${icpId}`);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------- expansion

export async function findExpansions(icpId: string): Promise<ActionResult<number>> {
  try {
    const { icp, product } = await loadIcp(icpId);
    const draft = toDraft(product);
    const inference = toInference(icp);
    const { suggestions } = await suggestExpansions(draft, inference);
    const db = getDb();
    if (suggestions.length) await db.insert(icpSuggestions).values(suggestions.map((s) => ({ icpId: icp.id, ...s })));
    const { orgId } = await ensureWorkspace();
    await db.insert(events).values({
      orgId,
      type: "icp.expansion_suggested",
      actorType: "agent",
      actorId: "builder",
      payload: { icpId, count: suggestions.length },
    });
    revalidatePath(`/icp/${icpId}`);
    return { ok: true, data: suggestions.length };
  } catch (err) {
    return fail(err);
  }
}

const DecisionSchema = z.object({
  suggestionId: z.uuid(),
  decision: z.enum(["accepted", "adjusted", "dismissed"]),
  segment: z.string().min(1).max(200).optional(),
});

export async function decideSuggestion(icpId: string, input: z.input<typeof DecisionSchema>): Promise<ActionResult<never> | ActionResult<null>> {
  let nextId: string | undefined;
  try {
    const { suggestionId, decision, segment } = DecisionSchema.parse(input);
    const { icp } = await loadIcp(icpId);
    const db = getDb();
    const [s] = await db
      .select()
      .from(icpSuggestions)
      .where(and(eq(icpSuggestions.id, suggestionId), eq(icpSuggestions.icpId, icp.id)));
    if (!s) throw new Error("Suggestion not found");
    await db.update(icpSuggestions).set({ decision, segment: segment ?? s.segment }).where(eq(icpSuggestions.id, s.id));

    if (decision === "dismissed") {
      const { orgId, userId } = await ensureWorkspace();
      await db.insert(events).values({
        orgId,
        type: "icp.suggestion_dismissed",
        actorType: "rep",
        actorId: userId,
        payload: { icpId, segment: s.segment },
      });
      revalidatePath(`/icp/${icpId}`);
      return { ok: true, data: null };
    }
    const added = { segment: segment ?? s.segment, reasoning: s.reasoning, evidenceUrls: s.evidenceUrls };
    nextId = await createVersion(icpId, { segments: [...icp.segments, added] }, `${decision} segment: ${added.segment}`);
  } catch (err) {
    return fail(err);
  }
  redirect(`/icp/${nextId}`);
}

// ---------------------------------------------------------------- discovery (Module 2)

/** Find real accounts for an ICP, keeping only facts whose quote is found on the cited page. */
export async function runDiscovery(icpId: string): Promise<ActionResult<DiscoveryRunSummary>> {
  try {
    const { icp, product } = await loadIcp(icpId);
    const { orgId } = await ensureWorkspace();
    const draft = toDraft(product);
    const query = [draft.name, ...icp.industries.map((industry) => industry.label), ...icp.triggers.map((trigger) => trigger.description)].join(" ").slice(0, 300);
    const existingEvidence = mossConfigured()
      ? await searchMoss(orgId, query, { kind: "signal" }).then((result) => result.hits.map((hit) => hit.sourceUrl)).catch(() => [])
      : [];
    const { companies: found, stats } = await discoverAccounts(draft, toInference(icp), {
      excludeDomains: draft.referenceCustomers.map((c) => c.domain).filter(Boolean),
      knownSourceUrls: existingEvidence,
    });
    const { created, filtered } = await persistDiscovery(orgId, icp.id, found);
    if (mossConfigured()) after(async () => {
      await syncMoss(orgId).catch(() => getDb().insert(events).values({ orgId, type: "moss.sync_failed", actorType: "system", payload: { icpId } }).catch(() => {}));
    });
    scheduleGraphSync(icpId, orgId);
    const summary = { ...stats, created, filtered };
    await getDb().insert(events).values({ orgId, type: "discovery.completed", actorType: "agent", actorId: "builder", payload: { icpId, ...summary } });
    revalidatePath(`/icp/${icpId}/leads`);
    return { ok: true, data: summary };
  } catch (err) {
    return fail(err);
  }
}

/** Map direct, indirect and alternative competitors for the ICP's product (replaces the previous map). */
export async function runCompetitorMap(icpId: string): Promise<ActionResult<number>> {
  try {
    const { product } = await loadIcp(icpId);
    const { orgId } = await ensureWorkspace();
    const { competitors: found } = await mapCompetitors(toDraft(product));
    const db = getDb();
    if (found.length) {
      await db.delete(competitors).where(eq(competitors.productId, product.id));
      await db.insert(competitors).values(
        found.map((c) => ({
          productId: product.id,
          name: c.name,
          domain: c.domain || null,
          category: c.category,
          positioning: c.positioning,
          pricing: c.pricing,
          differentiators: c.differentiators,
          sourceUrls: c.sourceUrls,
        })),
      );
    }
    await db.insert(events).values({ orgId, type: "competitors.mapped", actorType: "agent", actorId: "builder", payload: { productId: product.id, count: found.length } });
    scheduleGraphSync(icpId, orgId);
    revalidatePath(`/icp/${icpId}/leads`);
    return { ok: true, data: found.length };
  } catch (err) {
    return fail(err);
  }
}

function scheduleGraphSync(icpId: string, orgId: string) {
  if (!integrationStatus().neo4j) return;
  after(async () => {
    try {
      const data = await getLeadsForIcp(icpId);
      if (data) await syncProductGraph(data);
    } catch {
      await getDb().insert(events).values({ orgId, type: "graph.sync_failed", actorType: "system", payload: { icpId } }).catch(() => {});
    }
  });
}

// ---------------------------------------------------------------- billing (Flexprice)

/** Demo top-up: a free credit grant on the org's Flexprice wallet (no payment). */
export async function topUpCredits(credits = 100): Promise<ActionResult<number>> {
  try {
    const { getOrgWallet } = await import("@/lib/billing");
    const { grantCredits } = await import("@gtm/billing");
    const w = await getOrgWallet();
    if (!w) return { ok: false, error: "Billing is not configured (FLEXPRICE_API_KEY missing)." };
    const amount = z.number().int().min(1).max(1000).parse(credits);
    const balance = await grantCredits(w.walletId, amount, `${w.orgId}:${Date.now()}`);
    await getDb().insert(events).values({ orgId: w.orgId, type: "credits.topped_up", actorType: "rep", actorId: (await ensureWorkspace()).userId, payload: { credits: amount, balance } });
    revalidatePath("/billing");
    return { ok: true, data: balance };
  } catch (err) {
    return fail(err);
  }
}
