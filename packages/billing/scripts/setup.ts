/**
 * One-time Flexprice setup + self-test:
 *  1. create the three metered features
 *  2. create the workspace org's customer + prepaid wallet (100 starter credits)
 *  3. charge one graph query (0.5 credits) and confirm the wallet balance dropped
 */
import assert from "node:assert/strict";
import { chargeUsage, costOf, ensureBillingAccount, ensureMeteredFeatures, getCreditBalance } from "../src";

const WORKSPACE_ORG_ID = "00000000-0000-4000-8000-000000000010";

const created = await ensureMeteredFeatures();
console.log(`Features: ${created.length ? `created ${created.join(", ")}` : "already present"}`);

const { customerId, walletId } = await ensureBillingAccount(WORKSPACE_ORG_ID, "My workspace");
console.log(`Customer ${customerId} · wallet ${walletId}`);

const before = await getCreditBalance(walletId);
const { balance: after } = await chargeUsage({
  walletId,
  orgId: WORKSPACE_ORG_ID,
  metric: "graph_queries_evaluated",
  eventId: `setup-selftest-${Date.now()}`,
  properties: { note: "setup self-test" },
});
assert.ok(
  Math.abs(before - after - costOf("graph_queries_evaluated")) < 1e-9,
  "Flexprice wallet debit failed: the balance must drop by 0.5 credits. Check wallet debit semantics before enabling billing.",
);
console.log(`Balance ${before} -> ${after} credits (debit works)`);
