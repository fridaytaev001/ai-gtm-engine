"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureWorkspace, getDb, schema } from "@gtm/db";
import { stages } from "@/lib/pipeline";

export async function moveLead(leadId: string, stage: string) {
  const id = z.uuid().safeParse(leadId);
  const to = z.enum(stages).safeParse(stage);
  if (!id.success || !to.success) return { ok: false };
  const { orgId, userId } = await ensureWorkspace();
  const { events, leads } = schema;
  const ok = await getDb().transaction(async (tx) => {
    const scope = and(eq(leads.id, id.data), eq(leads.orgId, orgId));
    const [lead] = await tx.select({ stage: leads.stage }).from(leads).where(scope).for("update");
    if (!lead) return false;
    if (lead.stage === to.data) return true;
    await tx.update(leads).set({ stage: to.data, ownerType: "rep", ownerId: userId, updatedAt: new Date() }).where(scope);
    await tx.insert(events).values({ orgId, leadId: id.data, type: "pipeline.stage_changed", actorType: "rep", actorId: userId,
      payload: { from: lead.stage, to: to.data } });
    return true;
  });
  revalidatePath("/dashboard");
  return { ok };
}
