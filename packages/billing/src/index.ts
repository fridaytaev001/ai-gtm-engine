import { Flexprice } from "@flexprice/sdk";
import { getEnv } from "@gtm/core";

/**
 * Usage-based billing on Flexprice (design doc → Flexprice metering and credit gating).
 *
 * - Every billable action is ingested as a Flexprice usage event (metered features below).
 * - Each org has a prepaid credit wallet. An action is allowed only if the wallet can cover it;
 *   then the credits are debited from the wallet and the event is recorded.
 * - event_id = a stable key per action, so retries never double-bill.
 */
export const METRICS = {
  leads_enriched: { credits: 5, label: "Lead enriched", unit: "lead" },
  outreach_sent: { credits: 1, label: "Outreach sent", unit: "message" },
  graph_queries_evaluated: { credits: 0.5, label: "Graph query", unit: "query" },
} as const;
export type Metric = keyof typeof METRICS;

/** 1 credit = $0.01. */
export const CREDIT_CONVERSION_RATE = "0.01";
export const STARTER_CREDITS = 100;

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly needed: number,
    public readonly available: number,
  ) {
    super(`Not enough credits: this needs ${needed}, the wallet has ${available}. Top up to continue.`);
    this.name = "InsufficientCreditsError";
  }
}

let client: Flexprice | undefined;

export function billingEnabled(): boolean {
  return Boolean(getEnv().FLEXPRICE_API_KEY);
}

export function getFlexprice(): Flexprice {
  const env = getEnv();
  if (!env.FLEXPRICE_API_KEY) throw new Error("FLEXPRICE_API_KEY is not set");
  client ??= new Flexprice({ apiKeyAuth: env.FLEXPRICE_API_KEY, serverURL: env.FLEXPRICE_API_HOST });
  return client;
}

const num = (s: string | undefined | null) => {
  const n = Number(s ?? "0");
  return Number.isFinite(n) ? n : 0;
};

/** Find or create the Flexprice customer and prepaid wallet for an org. */
export async function ensureBillingAccount(orgId: string, orgName: string): Promise<{ customerId: string; walletId: string }> {
  const fp = getFlexprice();
  let customerId: string | undefined;
  try {
    const existing = await fp.customers.getCustomerByExternalId(orgId);
    customerId = existing.id;
  } catch (error) {
    if (!(error && typeof error === "object" && "statusCode" in error && error.statusCode === 404)) throw error;
    const created = await fp.customers.createCustomer({ externalId: orgId, name: orgName });
    customerId = created.id;
  }
  if (!customerId) throw new Error("Flexprice did not return a customer id");

  const wallets = await fp.wallets.getWalletsByCustomerId(customerId);
  const list = (Array.isArray(wallets) ? wallets : []) as { id?: string; walletStatus?: string; currency?: string }[];
  const active = list.find((w) => w.walletStatus === "active" || !w.walletStatus);
  if (active?.id) return { customerId, walletId: active.id };

  const wallet = await fp.wallets.createWallet({
    customerId,
    currency: "usd",
    conversionRate: CREDIT_CONVERSION_RATE,
    walletType: "PRE_PAID",
    initialCreditsToLoad: String(STARTER_CREDITS),
    description: "GTM Engine credits",
  });
  if (!wallet.id) throw new Error("Flexprice did not return a wallet id");
  return { customerId, walletId: wallet.id };
}

/** Current credit balance, read live from Flexprice. */
export async function getCreditBalance(walletId: string): Promise<number> {
  const b = await getFlexprice().wallets.getWalletBalance(walletId);
  return num(b.realTimeCreditBalance ?? b.creditBalance);
}

export function costOf(metric: Metric, quantity = 1): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Usage quantity must be a positive integer");
  return Math.round(METRICS[metric].credits * quantity * 100) / 100;
}

/** Throw InsufficientCreditsError before starting work the wallet cannot cover. */
export async function requireCredits(walletId: string, metric: Metric, quantity = 1): Promise<number> {
  const needed = costOf(metric, quantity);
  const available = await getCreditBalance(walletId);
  if (available < needed) throw new InsufficientCreditsError(needed, available);
  return available;
}

/**
 * Record a completed billable action: ingest the usage event and debit the wallet.
 * `eventId` must be stable for the action (e.g. `${leadId}:leads_enriched`) so retries are free.
 */
export async function chargeUsage(opts: {
  walletId: string;
  orgId: string;
  metric: Metric;
  quantity?: number;
  eventId: string;
  properties?: Record<string, string>;
}): Promise<{ credits: number; balance: number }> {
  const fp = getFlexprice();
  const quantity = opts.quantity ?? 1;
  const credits = costOf(opts.metric, quantity);
  await fp.events.ingestEvent({
    eventName: opts.metric,
    externalCustomerId: opts.orgId,
    eventId: opts.eventId,
    timestamp: new Date().toISOString(),
    source: "gtm-engine",
    properties: { quantity: String(quantity), credits: String(credits), ...opts.properties },
  });
  await debitWallet(opts.walletId, credits, `debit:${opts.eventId}`, {
    metric: opts.metric, eventId: opts.eventId,
  });
  return { credits, balance: await getCreditBalance(opts.walletId) };
}

/** SDK 2.1.51 lacks this documented endpoint; top-up only accepts credit grants. */
async function debitWallet(walletId: string, credits: number, idempotencyKey: string, metadata: Record<string, string>) {
  const env = getEnv();
  if (!env.FLEXPRICE_API_KEY) throw new Error("FLEXPRICE_API_KEY is not set");
  const response = await fetch(`${env.FLEXPRICE_API_HOST.replace(/\/$/, "")}/wallets/${encodeURIComponent(walletId)}/debit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.FLEXPRICE_API_KEY },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      transaction_reason: "MANUAL_BALANCE_DEBIT",
      credits: String(credits),
      idempotency_key: idempotencyKey,
      description: `${METRICS[metadata.metric as Metric].label}`,
      metadata,
    }),
  });
  if (response.ok) return;
  const error = await response.json().catch(() => null) as { code?: string } | null;
  if (response.status === 409 && error?.code === "already_exists") {
    // A conflict is only a successful retry if the original debit matches.
    // Flexprice's conflict details echo the request, not the original transaction.
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await getFlexprice().wallets.getWalletTransactions({
        idPathParameter: walletId, type: "debit", limit: 100, offset, order: "desc",
      });
      const items = page.items ?? [];
      const original = items.find((t) => t.idempotencyKey === idempotencyKey);
      if (original) {
        if (Number(original.creditAmount) === credits && original.metadata?.metric === metadata.metric && original.metadata?.eventId === metadata.eventId) return;
        throw new Error("Billing event ID was already used for a different debit");
      }
      if (items.length < 100) break;
    }
    throw new Error("Could not verify the original wallet debit; retry with the same event ID");
  }
  // Never expose raw responses or request headers containing the API key.
  throw new Error(`Flexprice wallet debit failed (HTTP ${response.status})`);
}

/** Free credit grant (demo top-up; no payment). */
export async function grantCredits(walletId: string, credits: number, reference: string): Promise<number> {
  await getFlexprice().wallets.topUpWallet(walletId, {
    transactionReason: "FREE_CREDIT_GRANT",
    creditsToAdd: String(credits),
    idempotencyKey: `grant:${reference}`,
    description: "Credit top-up",
  });
  return getCreditBalance(walletId);
}

/** Create the three metered features once (safe to re-run: existing names are skipped). */
export async function ensureMeteredFeatures(): Promise<string[]> {
  const fp = getFlexprice();
  const existing = await fp.features.queryFeature({ lookupKeys: Object.keys(METRICS), limit: 100 });
  const have = new Set((existing.items ?? []).map((f) => f.lookupKey));
  const created: string[] = [];
  for (const [eventName, m] of Object.entries(METRICS)) {
    if (have.has(eventName)) continue;
    await fp.features.createFeature({
      name: m.label + "s",
      lookupKey: eventName,
      type: "metered",
      unitSingular: m.unit,
      unitPlural: `${m.unit}s`,
      meter: { name: `${m.label} meter`, eventName, aggregation: { type: "COUNT" }, resetUsage: "BILLING_PERIOD" },
    });
    created.push(eventName);
  }
  return created;
}
