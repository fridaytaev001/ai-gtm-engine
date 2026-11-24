/** Live smoke test: intake turn -> ICP -> (optional) expansion with the LogLens example. Costs a few cents of API usage. */
import { activeModel, activeProvider, emptyDraft, inferIcp, intakeTurn, suggestExpansions } from "../src";

const t0 = Date.now();
const lap = (label: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
console.log(`Provider: ${activeProvider()} (${activeModel()})`);

const { turn } = await intakeTurn(
  [
    {
      role: "user",
      content:
        "LogLens is AI log analysis that finds the root cause of production incidents for SaaS engineering teams. Features: incident clustering, root-cause summaries, Slack and PagerDuty integration. Customers: Northwind Cloud. About $15k per year, annual subscription.",
    },
  ],
  emptyDraft(),
);
lap(`intake: ready=${turn.ready} missing=[${turn.missing.join(", ")}]`);
console.log(`  reply: ${turn.reply}`);
console.log(
  `  record: ${turn.draft.name} | ${turn.draft.features.length} features | ${turn.draft.referenceCustomers.length} customers | $${turn.draft.pricing.annualContractValueUsd}`,
);

const { icp } = await inferIcp(turn.draft);
lap("ICP inferred");
console.log(`  industries: ${icp.industries.map((i) => `${i.naics} ${i.label} (${i.confidence})`).join("; ")}`);
console.log(`  size: ${icp.sizeBands.headcountMin}-${icp.sizeBands.headcountMax} staff`);
console.log(`  personas: ${icp.personas.map((p) => p.title).join(", ")}`);
console.log(`  triggers: ${icp.triggers.map((t) => t.description).join("; ")}`);
console.log(`  confidence: ${JSON.stringify(icp.fieldConfidence)}`);

if (process.argv.includes("--expand")) {
  const { suggestions } = await suggestExpansions(turn.draft, icp);
  lap(`expansion: ${suggestions.length} segments`);
  for (const s of suggestions) console.log(`  - ${s.segment}: ${s.evidenceUrls.join(", ")}`);
}
