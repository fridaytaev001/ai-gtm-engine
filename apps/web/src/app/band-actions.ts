"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { integrationStatus } from "@gtm/core";
import { ensureWorkspace, getDb, schema } from "@gtm/db";
import type { ActionResult } from "./actions";

export async function queueBandReview(messageId: string): Promise<ActionResult<boolean>> {
  const id = z.uuid().safeParse(messageId);
  if (!id.success) return { ok: false, error: "Invalid draft." };
  if (!integrationStatus().band) return { ok: false, error: "Configure Band agents and the designated reviewer." };
  const { orgId, userId } = await ensureWorkspace();
  const { agentRuns, events, leads, messages } = schema;
  const queued = await getDb().transaction(async (tx) => {
    const [draft] = await tx.select({ leadId: messages.leadId }).from(messages).innerJoin(leads, eq(leads.id, messages.leadId))
      .where(and(eq(messages.id, id.data), eq(messages.status, "draft"), eq(leads.orgId, orgId))).for("update", { of: messages });
    if (!draft) return false;
    const task = `review:${id.data}`;
    const [pending] = await tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.orgId, orgId),
      eq(agentRuns.agent, "planner"), eq(agentRuns.status, "running"), eq(agentRuns.task, task)));
    if (pending) return true;
    const [run] = await tx.insert(agentRuns).values({ orgId, agent: "planner", task }).returning({ id: agentRuns.id });
    await tx.insert(events).values({ orgId, leadId: draft.leadId, type: "band.queued", actorType: "rep", actorId: userId,
      payload: { messageId: id.data, runId: run.id } });
    return true;
  });
  revalidatePath("/agents");
  return queued ? { ok: true, data: true } : { ok: false, error: "Only drafts can be queued." };
}
