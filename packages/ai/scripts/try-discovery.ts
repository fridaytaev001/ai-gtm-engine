/** Live test of discovery + competitor mapping with the LogLens example. Costs some API usage. */
import { activeModel, activeProvider, discoverAccounts, emptyDraft, inferIcp, mapCompetitors } from "../src";

const t0 = Date.now();
const lap = (label: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
console.log(`Provider: ${activeProvider()} (${activeModel()})`);

const product = {
  ...emptyDraft(),
  name: "LogLens",
  description: "AI log analysis that finds the root cause of production incidents for SaaS engineering teams.",
  features: ["Incident clustering", "Root-cause summaries", "Slack and PagerDuty integration"],
  referenceCustomers: [{ name: "Northwind Cloud", domain: "northwind.example" }],
  pricing: { model: "annual subscription", annualContractValueUsd: 15000, notes: "" },
};

const { icp } = await inferIcp(product);
lap(`ICP: ${icp.triggers.length} triggers`);

const [disc, comp] = await Promise.all([
  discoverAccounts(product, icp, { onProgress: (m) => lap(m) }),
  process.argv.includes("--competitors") ? mapCompetitors(product) : Promise.resolve(null),
]);
lap(`discovery stats: ${JSON.stringify(disc.stats)}`);
for (const c of disc.companies) {
  console.log(`  ${c.fitScore} ${c.name} (${c.domain}) · ${c.signals.length} signal(s) · ${c.people.length} people · ${c.negativeFlags.length} neg`);
  const s = c.signals[0]!;
  console.log(`      ${s.type}: "${s.quote.slice(0, 110)}" [${s.verifiedVia}] ${s.sourceUrl}`);
}
if (comp) {
  lap(`competitors: ${comp.competitors.length}`);
  for (const c of comp.competitors) console.log(`  ${c.category} ${c.name} (${c.domain}) pricing tiers: ${c.pricing.length}`);
}
