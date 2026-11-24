import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { ensureWorkspace, getDb, schema } from "@gtm/db";

const { companies, events, leads, messages, people, usageLedger } = schema;

export const stages = ["matched", "contacted", "replied", "meeting_booked", "closed_lost"] as const;
export const stageLabels = { matched: "Matched", contacted: "Contacted", replied: "Replied", meeting_booked: "Meeting booked", closed_lost: "Closed / lost" } as const;

export async function pipelineRevision() {
  const { orgId } = await ensureWorkspace();
  const [latest] = await getDb().select({ id: events.id }).from(events).where(eq(events.orgId, orgId))
    .orderBy(desc(events.createdAt), desc(events.id)).limit(1);
  return latest?.id ?? "";
}

export async function getPipeline() {
  const { orgId } = await ensureWorkspace();
  const db = getDb();
  const [cards, audit, sent, replies, spend] = await Promise.all([
    db.select({ id: leads.id, icpId: leads.icpId, person: people.name, company: companies.name, industry: companies.industryLabel,
      tier: companies.tier, fit: companies.fitScore, intent: companies.intentScore, stage: leads.stage, owner: leads.ownerType })
      .from(leads).innerJoin(people, eq(people.id, leads.personId)).innerJoin(companies, eq(companies.id, people.companyId))
      .where(and(eq(leads.orgId, orgId), eq(companies.orgId, orgId), ne(companies.status, "filtered"))).orderBy(desc(leads.updatedAt)),
    db.select({ id: events.id, date: events.createdAt, type: events.type, actor: events.actorType, actorId: events.actorId })
      .from(events).where(eq(events.orgId, orgId)).orderBy(desc(events.createdAt), desc(events.id)).limit(30),
    db.select({ id: messages.id, step: messages.step, variant: messages.variant, channel: messages.channel })
      .from(messages).innerJoin(leads, eq(leads.id, messages.leadId)).where(and(eq(leads.orgId, orgId), eq(messages.status, "sent"))),
    db.select({ payload: events.payload }).from(events).where(and(eq(events.orgId, orgId), eq(events.type, "outreach.reply_received"))),
    db.select({ metric: usageLedger.metric, credits: usageLedger.credits, leadId: usageLedger.leadId }).from(usageLedger)
      .where(and(eq(usageLedger.orgId, orgId), inArray(usageLedger.metric, ["leads_enriched", "outreach_sent"]))),
  ]);
  const replied = new Set(replies.map((event) => event.payload.messageId).filter((id): id is string => typeof id === "string"));
  const variants = new Map<string, { label: string; channel: string; sent: number; replies: number }>();
  for (const message of sent) {
    const label = message.step === 1 ? `First touch ${message.variant}` : message.step === 2 ? "Connection note" : "Follow-up";
    const key = `${message.channel}:${label}`;
    const row = variants.get(key) ?? { label, channel: message.channel, sent: 0, replies: 0 };
    row.sent++;
    if (replied.has(message.id)) row.replies++;
    variants.set(key, row);
  }
  const enriched = new Set(spend.filter((item) => item.metric === "leads_enriched" && item.leadId).map((item) => item.leadId));
  const enrichmentCredits = spend.filter((item) => item.metric === "leads_enriched").reduce((sum, item) => sum + Number(item.credits), 0);
  return { cards, audit, variants: [...variants.values()], enrichmentCredits, enrichedCount: enriched.size };
}
