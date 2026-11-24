import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { billingEnabled, chargeUsage, ensureBillingAccount, getCreditBalance, requireCredits, type Metric } from "@gtm/billing";
import { ensureWorkspace, getDb, schema } from "@gtm/db";

const { orgs, usageLedger } = schema;

/** The workspace org's Flexprice wallet id, created on first use and remembered on the org row. */
export async function getOrgWallet(): Promise<{ orgId: string; walletId: string } | null> {
  if (!billingEnabled()) return null;
  const { orgId } = await ensureWorkspace();
  const db = getDb();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (org?.flexpriceWalletId) return { orgId, walletId: org.flexpriceWalletId };
  const { customerId, walletId } = await ensureBillingAccount(orgId, org?.name ?? "My workspace");
  await db.transaction(async (tx) => {
    await tx.update(orgs).set({ flexpriceCustomerId: customerId, flexpriceWalletId: walletId }).where(eq(orgs.id, orgId));
    await tx.insert(schema.events).values({
      orgId, type: "billing.account_linked", actorType: "system", payload: { customerId, walletId },
    });
  });
  return { orgId, walletId };
}

export async function getOrgBalance(): Promise<number | null> {
  const w = await getOrgWallet();
  return w ? getCreditBalance(w.walletId) : null;
}

/** Cheap polling token: database-only, with no Flexprice API calls. */
export async function getBillingRevision(): Promise<string | null> {
  const { orgId } = await ensureWorkspace();
  const [event] = await getDb().select({ id: schema.events.id }).from(schema.events)
    .where(and(eq(schema.events.orgId, orgId), inArray(schema.events.type, [
      "billing.wallet.updated", "credits.topped_up", "billing.usage_recorded",
    ])))
    .orderBy(desc(schema.events.createdAt), desc(schema.events.id)).limit(1);
  return event?.id ?? null;
}

/** Gate: throws InsufficientCreditsError when the wallet cannot cover the action. No-op when billing is off. */
export async function gate(metric: Metric, quantity = 1) {
  const w = await getOrgWallet();
  if (w) await requireCredits(w.walletId, metric, quantity);
}

/** Bill a finished action in Flexprice and mirror it into usage_ledger (for cost per lead on the dashboard). */
export async function bill(metric: Metric, eventId: string, opts: { quantity?: number; leadId?: string; properties?: Record<string, string> } = {}) {
  const w = await getOrgWallet();
  if (!w) return null;
  const { credits, balance } = await chargeUsage({ walletId: w.walletId, orgId: w.orgId, metric, eventId, quantity: opts.quantity, properties: opts.properties });
  await getDb().transaction(async (tx) => {
    const inserted = await tx.insert(usageLedger)
      .values({ orgId: w.orgId, metric, quantity: String(opts.quantity ?? 1), credits: String(credits), flexpriceEventId: eventId, leadId: opts.leadId ?? null })
      .onConflictDoNothing().returning({ id: usageLedger.id });
    if (inserted.length) await tx.insert(schema.events).values({
      orgId: w.orgId, leadId: opts.leadId ?? null, type: "billing.usage_recorded", actorType: "system",
      payload: { metric, eventId, credits },
    });
  });
  return { credits, balance };
}
