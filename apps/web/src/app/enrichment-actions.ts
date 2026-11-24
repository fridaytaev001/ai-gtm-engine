"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { billingEnabled, InsufficientCreditsError } from "@gtm/billing";
import { ensureWorkspace, getDb, schema } from "@gtm/db";
import { bill, gate } from "@/lib/billing";
import { resolveContact } from "@/lib/contact-providers";
import type { ActionResult } from "./actions";

const { companies, events, leads, people } = schema;
const metric = "leads_enriched" as const;
const cacheMs = 7 * 24 * 60 * 60 * 1000;

export async function enrichPerson(personId: string): Promise<ActionResult<{ cached: boolean; status: string }>> {
  const id = z.uuid().safeParse(personId);
  if (!id.success) return { ok: false, error: "Invalid contact." };
  const { orgId, userId } = await ensureWorkspace();
  const db = getDb();
  let path: string | undefined;
  try {
    const [initial] = await db.select({ company: companies }).from(people)
      .innerJoin(companies, eq(people.companyId, companies.id))
      .where(and(eq(people.id, id.data), eq(people.orgId, orgId), eq(companies.orgId, orgId)));
    if (!initial?.company.icpId || initial.company.status === "filtered") return { ok: false, error: "Contact is not on an eligible account." };
    const icpId = initial.company.icpId;
    path = `/icp/${icpId}/leads`;
    const result = await db.transaction(async (tx): Promise<ActionResult<{ cached: boolean; status: string }>> => {
      const [lock] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${`enrich:${orgId}`}, 0)) as acquired`);
      if (!lock?.acquired) return { ok: false, error: "Another contact is being enriched. Try again shortly." };
      const [person] = await tx.select().from(people).where(and(eq(people.id, id.data), eq(people.orgId, orgId)));
      if (!person || person.companyId !== initial.company.id) return { ok: false, error: "Contact changed. Reload and try again." };

      if (["hunter", "prospeo", "no_match"].includes(person.enrichSource ?? "") && Date.now() - person.updatedAt.getTime() < cacheMs) {
        await tx.insert(events).values({ orgId, actorType: "rep", actorId: userId, type: "enrichment.cache_used", payload: { personId } });
        return { ok: true, data: { cached: true, status: person.emailStatus } };
      }
      if (!billingEnabled()) return { ok: false, error: "Configure Flexprice before using paid enrichment." };
      const lookup = await resolveContact({ ...person, domain: initial.company.domain }, () => gate(metric));
      let leadId: string | undefined;
      if (lookup.emailStatus === "valid") {
        // The lead must be committed before the separate billing transaction references it.
        const [lead] = await db.insert(leads).values({ orgId, personId, icpId })
          .onConflictDoUpdate({ target: [leads.personId, leads.icpId], set: { personId } })
          .returning({ id: leads.id });
        leadId = lead.id;
        await bill(metric, `${leadId}:${metric}`, { leadId, properties: { provider: lookup.enrichSource } });
      }
      await tx.update(people).set({ ...lookup, updatedAt: new Date() }).where(and(eq(people.id, personId), eq(people.orgId, orgId)));
      await tx.insert(events).values({
        orgId, leadId, type: "enrichment.completed", actorType: "agent", actorId: "builder",
        payload: { personId, requestedBy: userId, source: lookup.enrichSource, status: lookup.emailStatus, mxValid: lookup.mxValid },
      });
      return { ok: true, data: { cached: false, status: lookup.emailStatus } };
    });
    revalidatePath(path);
    return result;
  } catch (error) {
    await db.insert(events).values({
      orgId, actorType: "rep", actorId: userId, type: "enrichment.blocked",
      payload: { personId, reason: error instanceof InsufficientCreditsError ? "insufficient_credits" : "lookup_failed" },
    }).catch(() => {});
    if (error instanceof InsufficientCreditsError) return { ok: false, error: error.message };
    return { ok: false, error: "Contact enrichment failed. Check provider and billing configuration, then retry." };
  }
}
