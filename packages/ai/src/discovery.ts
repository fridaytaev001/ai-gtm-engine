import { z } from "zod";
import { generateStructured, researchWithWebSearch, type ResearchResult, type Usage } from "./provider";
import type { IcpInference, ProductDraft } from "./schemas";
import { normalizeDomain, verifyQuote } from "./verify";

// ---------------------------------------------------------------- schemas

const SignalTypes = ["job_post", "funding", "exec_hire", "tech_change", "news", "other"] as const;

const CitedFact = {
  sourceUrl: z.string().describe("URL from the source list where this was found"),
  quote: z.string().describe("A sentence copied word for word from that source that proves the claim"),
};

export const DiscoveredCompaniesSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      domain: z.string().describe("Company website domain, e.g. acme.com"),
      hq: z.string().describe("City, country; empty if unknown"),
      industry: z.string().describe("Short industry label"),
      headcountEstimate: z.number().nullable().describe("Approximate employees if stated in a source, else null"),
      fitScore: z.number().describe("0-100: how well the company matches the ICP"),
      fitReason: z.string().describe("One sentence: why it matches the ICP"),
      signals: z
        .array(z.object({ type: z.enum(SignalTypes), title: z.string().describe("Short headline of the event"), observedAt: z.string().describe("ISO date if known, else empty"), ...CitedFact }))
        .describe("Buying signals with their proof"),
      people: z
        .array(z.object({ name: z.string(), title: z.string(), ...CitedFact }))
        .describe("Named people in ICP buyer roles, only if a source names them"),
      negativeFlags: z
        .array(z.object({ flag: z.string().describe("e.g. hiring freeze, layoffs, non-target region"), ...CitedFact }))
        .describe("Reasons this company is a bad fit right now, with proof"),
    }),
  ),
});
type RawCompany = z.infer<typeof DiscoveredCompaniesSchema>["companies"][number];

export const CompetitorsSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      domain: z.string(),
      category: z.enum(["direct", "indirect", "alternative"]),
      positioning: z.string().describe("Their value proposition in one or two sentences"),
      pricing: z.array(z.object({ tier: z.string(), price: z.string() })).describe("Public pricing tiers; empty if not public"),
      differentiators: z.array(z.string()).describe("How our product differs or wins against them"),
      sourceUrls: z.array(z.string()).describe("Source URLs that support this entry"),
    }),
  ),
});
export type Competitor = z.infer<typeof CompetitorsSchema>["competitors"][number];

// ---------------------------------------------------------------- verified output types

export type VerifiedFact = { sourceUrl: string; quote: string; verifiedVia: "page" | "snippet" };
export type DiscoveredCompany = Omit<RawCompany, "signals" | "people" | "negativeFlags" | "domain"> & {
  domain: string;
  signals: (Omit<RawCompany["signals"][number], "sourceUrl" | "quote"> & VerifiedFact)[];
  people: (Omit<RawCompany["people"][number], "sourceUrl" | "quote"> & VerifiedFact)[];
  negativeFlags: (Omit<RawCompany["negativeFlags"][number], "sourceUrl" | "quote"> & VerifiedFact)[];
};
export type DiscoveryStats = {
  angles: number;
  sourcesFound: number;
  companiesProposed: number;
  factsChecked: number;
  factsVerified: number;
  companiesKept: number;
  companiesDroppedNoEvidence: number;
};

// ---------------------------------------------------------------- discovery

const RESEARCH_SYSTEM = `You are a B2B prospect researcher. Use web search to find REAL companies that match an Ideal Customer Profile and show a buying signal right now.
Good sources: job postings on careers pages and job boards, funding announcements, press releases, engineering blogs, regulatory filings, news.
For every company, note the exact sentence from the source that proves the signal, and the URL. Prefer specific, recent evidence. Name people only when a source names them in a buyer role.
Also note any negative signals you see (layoffs, hiring freeze, wrong region). Cover as many distinct companies as you can (aim for 10+).`;

const EXTRACT_SYSTEM = `Extract prospect companies from research notes into structured data.
Hard rules:
- Use ONLY URLs from the provided source list. Never invent or alter a URL.
- Every quote must be copied word for word from the research notes or source snippets; do not paraphrase.
- Skip a company if you cannot attach at least one signal with a URL and quote.
- Do not include the seller's own existing customers or the seller itself.
- fitScore: judge against the ICP (industry, size, personas, triggers). 80+ only for a strong match on several dimensions.`;

function anglesFor(icp: IcpInference): string[] {
  const industries = icp.industries.map((i) => i.label).join(", ");
  const size =
    icp.sizeBands.headcountMin || icp.sizeBands.headcountMax
      ? `${icp.sizeBands.headcountMin ?? "?"}-${icp.sizeBands.headcountMax ?? "?"} employees`
      : "";
  const regions = icp.regions.join(", ");
  const triggers = icp.triggers.slice(0, 3);
  const angles = triggers.map(
    (t) => `Find companies in ${industries}${size ? `, ${size}` : ""}${regions ? `, in ${regions}` : ""} where this is happening now: ${t.description}.`,
  );
  if (angles.length < 2) angles.push(`Find fast-growing companies in ${industries}${regions ? ` in ${regions}` : ""} hiring for: ${icp.personas.map((p) => p.title).join(", ")}.`);
  return angles.slice(0, 3);
}

/**
 * Module 2 buyer discovery: research several ICP angles in parallel with web search,
 * extract companies with cited facts, then keep only facts whose quote is found on the cited page
 * (or in its search snippet). A company with no verified signal is dropped.
 */
export async function discoverAccounts(
  product: ProductDraft,
  icp: IcpInference,
  opts: { excludeDomains?: string[]; onProgress?: (msg: string) => void } = {},
): Promise<{ companies: DiscoveredCompany[]; stats: DiscoveryStats; usage: Usage }> {
  const exclude = new Set((opts.excludeDomains ?? []).map(normalizeDomain));
  const angles = anglesFor(icp);
  const context = `<seller_product>\n${product.name}: ${product.description}\nExisting customers (exclude): ${product.referenceCustomers
    .map((c) => c.name)
    .join(", ") || "none"}\n</seller_product>\n<icp>\n${JSON.stringify(
    { industries: icp.industries, sizeBands: icp.sizeBands, personas: icp.personas, regions: icp.regions, negativeSignals: icp.negativeSignals },
    null,
    2,
  )}\n</icp>`;

  opts.onProgress?.(`Researching ${angles.length} angles`);
  const research = await Promise.all(
    angles.map((angle) =>
      researchWithWebSearch({ system: RESEARCH_SYSTEM, effort: "medium", searchDepth: "high", prompt: `${context}\n\n${angle}` }).catch(
        (err: unknown) => {
          console.error("research angle failed", err);
          return null;
        },
      ),
    ),
  );
  const ok = research.filter((r): r is ResearchResult => r !== null);
  const sources = new Map<string, string>();
  const snippets = new Map<string, string>();
  for (const r of ok) {
    r.sources.forEach((v, k) => sources.set(k, v));
    r.snippets.forEach((v, k) => snippets.set(k, `${snippets.get(k) ?? ""} ${v}`.trim()));
  }

  opts.onProgress?.(`Extracting companies from ${sources.size} sources`);
  const extracted = await Promise.all(
    ok.map((r) =>
      generateStructured({
        name: "discovered_companies",
        system: EXTRACT_SYSTEM,
        schema: DiscoveredCompaniesSchema,
        effort: "low",
        maxTokens: 16000,
        messages: [
          {
            role: "user",
            content: `${context}\n<research_notes>\n${r.text}\n</research_notes>\n<sources>\n${[...r.sources]
              .map(([url, title]) => `- ${title}: ${url}${r.snippets.get(url) ? `\n  snippet: ${r.snippets.get(url)}` : ""}`)
              .join("\n")}\n</sources>`,
          },
        ],
      }).catch((err: unknown) => {
        console.error("extraction failed", err);
        return null;
      }),
    ),
  );

  // Merge by domain across angles.
  const byDomain = new Map<string, RawCompany>();
  let proposed = 0;
  for (const e of extracted) {
    for (const c of e?.data.companies ?? []) {
      proposed++;
      const domain = normalizeDomain(c.domain);
      if (!domain || !domain.includes(".") || exclude.has(domain)) continue;
      const prev = byDomain.get(domain);
      if (!prev) byDomain.set(domain, { ...c, domain });
      else
        byDomain.set(domain, {
          ...prev,
          fitScore: Math.max(prev.fitScore, c.fitScore),
          signals: [...prev.signals, ...c.signals],
          people: [...prev.people, ...c.people],
          negativeFlags: [...prev.negativeFlags, ...c.negativeFlags],
        });
    }
  }

  opts.onProgress?.(`Verifying citations for ${byDomain.size} companies`);
  let checked = 0;
  let verifiedCount = 0;
  const check = async <T extends { sourceUrl: string; quote: string }>(fact: T): Promise<(Omit<T, never> & { verifiedVia: "page" | "snippet" }) | null> => {
    if (!sources.has(fact.sourceUrl)) return null; // URL not returned by search: treat as invented
    checked++;
    const res = await verifyQuote(fact.sourceUrl, fact.quote, snippets.get(fact.sourceUrl));
    if (!res.verified || !res.via) return null;
    verifiedCount++;
    return { ...fact, verifiedVia: res.via };
  };
  const dedupe = <T extends { sourceUrl: string; quote: string }>(xs: T[]) => [
    ...new Map(xs.map((x) => [`${x.sourceUrl}|${x.quote}`, x])).values(),
  ];

  const companies: DiscoveredCompany[] = [];
  let dropped = 0;
  await Promise.all(
    [...byDomain.values()].map(async (c) => {
      const [signals, people, negativeFlags] = await Promise.all([
        Promise.all(dedupe(c.signals).map(check)),
        Promise.all(dedupe(c.people).map(check)),
        Promise.all(dedupe(c.negativeFlags).map(check)),
      ]);
      const vSignals = signals.filter((x) => x !== null);
      if (vSignals.length === 0) {
        dropped++;
        return;
      }
      companies.push({
        ...c,
        fitScore: Math.round(Math.min(100, Math.max(0, c.fitScore))),
        signals: vSignals,
        people: people.filter((x) => x !== null),
        negativeFlags: negativeFlags.filter((x) => x !== null),
      });
    }),
  );
  companies.sort((a, b) => b.fitScore - a.fitScore);

  const usage = [...ok.map((r) => r.usage), ...extracted.filter((e) => e !== null).map((e) => e!.usage)].reduce(
    (acc, u) => ({ inputTokens: acc.inputTokens + u.inputTokens, outputTokens: acc.outputTokens + u.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  );
  return {
    companies,
    usage,
    stats: {
      angles: angles.length,
      sourcesFound: sources.size,
      companiesProposed: proposed,
      factsChecked: checked,
      factsVerified: verifiedCount,
      companiesKept: companies.length,
      companiesDroppedNoEvidence: dropped,
    },
  };
}

// ---------------------------------------------------------------- competitors

const COMPETITOR_SYSTEM = `You are a competitive-intelligence analyst. Use web search to map the competitive landscape for a B2B product:
direct competitors (same category), indirect competitors (different product, same budget or job), and alternatives (in-house tools, open source, doing nothing).
For each, find their positioning from their own website and their public pricing tiers if published. Cite the pages you used.`;

const COMPETITOR_EXTRACT = `Structure the competitor research. Use only URLs from the provided source list. Leave pricing empty when it is not public; never guess prices. Differentiators must be specific to the seller's product.`;

export async function mapCompetitors(product: ProductDraft): Promise<{ competitors: Competitor[]; usage: Usage }> {
  const research = await researchWithWebSearch({
    system: COMPETITOR_SYSTEM,
    effort: "medium",
    searchDepth: "high",
    prompt: `<product>\n${JSON.stringify(product, null, 2)}\n</product>\nMap 4-8 competitors across direct, indirect and alternative.`,
  });
  if (research.sources.size === 0) return { competitors: [], usage: research.usage };
  const { data, usage } = await generateStructured({
    name: "competitors",
    system: COMPETITOR_EXTRACT,
    schema: CompetitorsSchema,
    effort: "low",
    maxTokens: 12000,
    messages: [
      {
        role: "user",
        content: `<product>${product.name}: ${product.description}</product>\n<research_notes>\n${research.text}\n</research_notes>\n<sources>\n${[
          ...research.sources,
        ]
          .map(([url, title]) => `- ${title}: ${url}`)
          .join("\n")}\n</sources>`,
      },
    ],
  });
  const competitors = data.competitors
    .map((c) => ({ ...c, domain: normalizeDomain(c.domain), sourceUrls: c.sourceUrls.filter((u) => research.sources.has(u)) }))
    .filter((c) => c.sourceUrls.length > 0);
  return {
    competitors,
    usage: { inputTokens: research.usage.inputTokens + usage.inputTokens, outputTokens: research.usage.outputTokens + usage.outputTokens },
  };
}
