import { generateStructured, researchWithWebSearch, type Usage } from "./provider";
import { ExpansionSchema, type ExpansionSuggestions, type IcpInference, type ProductDraft } from "./schemas";

const RESEARCH_SYSTEM = `You are a market researcher for a B2B startup. Find adjacent customer segments that the current ICP misses: neighbouring industries, emerging verticals, or non-obvious uses where the same pain exists.
Use web search to find public evidence (industry reports, job posts, news, case studies) for each segment. Only propose a segment if you found a source that supports it. Cite the sources you used.`;

const EXTRACT_SYSTEM = `Turn the research notes into 2-4 structured suggestions. Only use evidence URLs that appear in the provided source list. Drop any segment that has no supporting source.`;

/**
 * Evidence-backed ICP expansion (Module 1).
 * Step 1 researches with the provider's web search tool; step 2 structures the findings.
 * Only URLs the search actually returned are kept, so links cannot be invented.
 */
export async function suggestExpansions(
  product: ProductDraft,
  icp: IcpInference,
): Promise<{ suggestions: ExpansionSuggestions["suggestions"]; usage: Usage }> {
  const research = await researchWithWebSearch({
    system: RESEARCH_SYSTEM,
    effort: "medium",
    prompt: `<product>\n${JSON.stringify(product, null, 2)}\n</product>\n<current_icp>\n${JSON.stringify(
      { industries: icp.industries, personas: icp.personas, sizeBands: icp.sizeBands },
      null,
      2,
    )}\n</current_icp>\nFind 2-4 adjacent segments with public evidence.`,
  });
  if (research.sources.size === 0) return { suggestions: [], usage: research.usage };

  const { data, usage } = await generateStructured({
    name: "expansion_suggestions",
    system: EXTRACT_SYSTEM,
    schema: ExpansionSchema,
    effort: "low",
    maxTokens: 8000,
    messages: [
      {
        role: "user",
        content: `<research_notes>\n${research.text}\n</research_notes>\n<sources>\n${[...research.sources]
          .map(([url, title]) => `- ${title}: ${url}`)
          .join("\n")}\n</sources>`,
      },
    ],
  });

  const suggestions = data.suggestions
    .map((s) => ({ ...s, evidenceUrls: s.evidenceUrls.filter((u) => research.sources.has(u)) }))
    .filter((s) => s.evidenceUrls.length > 0);

  return {
    suggestions,
    usage: {
      inputTokens: research.usage.inputTokens + usage.inputTokens,
      outputTokens: research.usage.outputTokens + usage.outputTokens,
    },
  };
}
