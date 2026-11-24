"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { integrationStatus } from "@gtm/core";
import { getDb, schema, ensureWorkspace } from "@gtm/db";
import { InsufficientCreditsError } from "@gtm/billing";
import { bill, gate } from "@/lib/billing";
import { getLeadsForIcp } from "@/lib/data";
import { readGraphInsights, syncProductGraph } from "@/lib/graph";
import type { ActionResult } from "./actions";

type Insights = Awaited<ReturnType<typeof readGraphInsights>>;

export async function evaluateGraph(icpId: string, requestId: string): Promise<ActionResult<Insights>> {
  if (!z.uuid().safeParse(icpId).success || !z.uuid().safeParse(requestId).success) return { ok: false, error: "Invalid graph request." };
  if (!integrationStatus().neo4j) return { ok: false, error: "Configure Neo4j to evaluate graph paths." };
  const metric = "graph_queries_evaluated" as const;
  try {
    const data = await getLeadsForIcp(icpId);
    if (!data) return { ok: false, error: "ICP unavailable." };
    const { orgId, userId } = await ensureWorkspace();
    await gate(metric);
    await syncProductGraph(data);
    const result = await readGraphInsights(orgId, data.product.id);
    await bill(metric, `graph:${orgId}:${requestId}`, { properties: { icpId } });
    await getDb().insert(schema.events).values({
      id: randomUUID(), orgId, type: "graph.evaluated", actorType: "rep", actorId: userId,
      payload: { icpId, requestId, warmIntros: result.intros.length, buyingCycles: result.buying.length, displacements: result.displacement.length },
    });
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: error instanceof InsufficientCreditsError ? error.message : "Graph evaluation could not complete. Check Neo4j and billing configuration." };
  }
}
