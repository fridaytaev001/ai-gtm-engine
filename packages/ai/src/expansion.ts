import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { FALLBACK_BETA, getAnthropic, MODEL, ModelRefusalError, toUsage, type Usage } from "./client";
import { ExpansionSchema, type ExpansionSuggestions, type IcpInference, type ProductDraft } from "./schemas";

const RESEARCH_SYSTEM = `You are a market researcher for a B2B startup. Find adjacent customer segments that the current ICP misses: neighbouring industries, emerging verticals, or non-obvious uses where the same pain exists.
Use web search to find public evidence (industry reports, job posts, news, case studies) for each segment. Only propose a segment if you found a source that supports it. Name the sources you used.`;

const EXTRACT_SYSTEM = `Turn the research notes into 2-4 structured suggestions. Only use evidence URLs that appear in the provided source list. Drop any segment that has no supporting source.`;

/**
 * Evidence-backed ICP expansion (Module 1).
 * Step 1 researches with the web search tool; step 2 structures the result.
 * Only URLs that web search actually returned are kept, so links cannot be invented.
 */
export async function suggestExpansions(
  product: ProductDraft,
  icp: IcpInference,
): Promise<{ suggestions: ExpansionSuggestions["suggestions"]; usage: Usage }> {
  const anthropic = getAnthropic();

  // Step 1: research with web search (server-side tool, runs on Anthropic's infrastructure).
  let messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `<product>\n${JSON.stringify(product, null, 2)}\n</product>\n<current_icp>\n${JSON.stringify(
        { industries: icp.industries, personas: icp.personas, sizeBands: icp.sizeBands },
        null,
        2,
      )}\n</current_icp>\nFind 2-4 adjacent segments with public evidence.`,
    },
  ];
  let research: Anthropic.Beta.BetaMessage | undefined;
  for (let i = 0; i < 3; i++) {
    research = await anthropic.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: RESEARCH_SYSTEM,
        output_config: { effort: "medium" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        messages,
      })
      .finalMessage();
    if (research.stop_reason !== "pause_turn") break;
    // Long server-tool turns can pause; send the content back to let it continue.
    messages = [...messages, { role: "assistant", content: research.content }];
  }
  if (!research) throw new Error("Research step returned nothing");
  if (research.stop_reason === "refusal") throw new ModelRefusalError(research.stop_details?.category);

  const sources = new Map<string, string>();
  const notes: string[] = [];
  for (const block of research.content) {
    if (block.type === "text") notes.push(block.text);
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result") sources.set(r.url, r.title);
    }
  }
  if (sources.size === 0) return { suggestions: [], usage: toUsage(research.usage) };

  // Step 2: structure the notes, restricted to the URLs search actually returned.
  const extracted = await anthropic.beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: EXTRACT_SYSTEM,
    output_config: { effort: "low", format: betaZodOutputFormat(ExpansionSchema) },
    messages: [
      {
        role: "user",
        content: `<research_notes>\n${notes.join("\n")}\n</research_notes>\n<sources>\n${[...sources]
          .map(([url, title]) => `- ${title}: ${url}`)
          .join("\n")}\n</sources>`,
      },
    ],
  });
  if (extracted.stop_reason === "refusal") throw new ModelRefusalError(extracted.stop_details?.category);
  const parsed = extracted.parsed_output?.suggestions ?? [];

  const suggestions = parsed
    .map((s) => ({ ...s, evidenceUrls: s.evidenceUrls.filter((u) => sources.has(u)) }))
    .filter((s) => s.evidenceUrls.length > 0);

  return {
    suggestions,
    usage: {
      inputTokens: research.usage.input_tokens + extracted.usage.input_tokens,
      outputTokens: research.usage.output_tokens + extracted.usage.output_tokens,
    },
  };
}
