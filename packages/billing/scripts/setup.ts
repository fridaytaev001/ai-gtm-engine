/**
 * One-time Flexprice setup + self-test:
 *  1. create the three metered features
 *  2. create the workspace org's customer + prepaid wallet (100 starter credits)
 *  3. charge one graph query (0.5 credits) and confirm the wallet balance dropped
 */
import { chargeUsage, ensureBillingAccount, ensureMeteredFeatures, getCreditBalance } from "../src";

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
console.log(`Balance ${before} -> ${after} credits (${before - after === 0.5 ? "debit works" : "UNEXPECTED: check wallet debit semantics"})`);
