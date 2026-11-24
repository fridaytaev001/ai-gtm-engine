"use server";

import { and, eq, max } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  emptyDraft,
  inferIcp,
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

const { events, icpSuggestions, icps, products } = schema;

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
    const draft: ProductDraft = {
      ...emptyDraft(),
      name: product.name,
      description: product.description,
      features: product.features,
      referenceCustomers: product.referenceCustomers.map((c) => ({ name: c.name, domain: c.domain ?? "" })),
      pricing: {
        model: product.pricing.model ?? "",
        annualContractValueUsd: product.pricing.annualContractValueUsd ?? null,
        notes: product.pricing.notes ?? "",
      },
    };
    const inference: IcpInference = {
      industries: icp.industries.map((i) => ({ ...i, confidence: i.confidence ?? 0.5 })),
      sizeBands: {
        headcountMin: icp.sizeBands.headcountMin ?? null,
        headcountMax: icp.sizeBands.headcountMax ?? null,
        revenueMinUsd: icp.sizeBands.revenueMinUsd ?? null,
        revenueMaxUsd: icp.sizeBands.revenueMaxUsd ?? null,
      },
      personas: icp.personas as IcpInference["personas"],
      triggers: icp.triggers as IcpInference["triggers"],
      regions: icp.regions,
      negativeSignals: icp.negativeSignals,
      fieldConfidence: icp.fieldConfidence as IcpInference["fieldConfidence"],
      rationale: icp.rationale ?? "",
    };
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
