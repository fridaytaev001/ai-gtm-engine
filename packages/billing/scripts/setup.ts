/**
 * One-time Flexprice setup + self-test:
 *  1. create the three metered features
 *  2. create the workspace org's customer + prepaid wallet (100 starter credits)
 *  3. charge one graph query (0.5 credits) and confirm the wallet balance dropped
 */
import assert from "node:assert/strict";
import { chargeUsage, costOf, ensureBillingAccount, ensureMeteredFeatures, getCreditBalance, InsufficientCreditsError, requireCredits } from "../src";

const WORKSPACE_ORG_ID = "00000000-0000-4000-8000-000000000010";

const created = await ensureMeteredFeatures();
console.log(`Features: ${created.length ? `created ${created.join(", ")}` : "already present"}`);

const { customerId, walletId } = await ensureBillingAccount(WORKSPACE_ORG_ID, "My workspace");
console.log(`Customer ${customerId} · wallet ${walletId}`);

const before = await getCreditBalance(walletId);
const charge = {
  walletId,
  orgId: WORKSPACE_ORG_ID,
  metric: "graph_queries_evaluated" as const,
  eventId: `setup-selftest-${Date.now()}`,
  properties: { note: "setup self-test" },
};
await requireCredits(walletId, charge.metric);
const { balance: after } = await chargeUsage(charge);
assert.ok(
  Math.abs(before - after - costOf("graph_queries_evaluated")) < 1e-9,
  "Flexprice wallet debit failed: the balance must drop by 0.5 credits. Check wallet debit semantics before enabling billing.",
);
console.log(`Balance ${before} -> ${after} credits (debit works)`);
const retried = await chargeUsage(charge);
assert.equal(retried.balance, after, "Retry must not debit twice");
console.log("Retry: same event ID did not debit twice");
await assert.rejects(
  requireCredits(walletId, "outreach_sent", Math.floor(after) + 1),
  InsufficientCreditsError,
);
console.log("Credit gate: unaffordable action blocked");
