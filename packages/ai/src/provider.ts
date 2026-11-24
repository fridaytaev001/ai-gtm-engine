import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { z } from "zod";
import { getEnv } from "@gtm/core";

/**
 * Model provider layer. Every feature (intake, ICP, expansion) calls these two functions,
 * so the engine runs on either Meta's Muse models (Meta Model API) or Anthropic's Claude.
 *
 *   LLM_PROVIDER=muse       -> Meta Model API, Responses protocol (needs MODEL_API_KEY)
 *   LLM_PROVIDER=anthropic  -> Claude via the Anthropic SDK (needs ANTHROPIC_API_KEY)
 *   unset                   -> whichever key is configured, Muse first
 */
export type Provider = "muse" | "anthropic";
export type Effort = "low" | "medium" | "high";
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Usage = { inputTokens: number; outputTokens: number };

export const MODELS = {
  muse: process.env.MUSE_MODEL ?? "muse-spark-1.3",
  anthropic: "claude-opus-5-5",
} as const;

const MUSE_BASE_URL = "https://api.meta.ai/v1";
/** Claude: if a request is declined on policy grounds, re-run it on a fallback model in the same call. */
const ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ModelRefusalError extends Error {
  constructor(public readonly category?: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ""}.`);
    this.name = "ModelRefusalError";
  }
}

export function activeProvider(): Provider {
  const env = getEnv();
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === "muse" || explicit === "anthropic") return explicit;
  if (env.MODEL_API_KEY) return "muse";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  throw new Error("No model provider configured: set MODEL_API_KEY (Muse) or ANTHROPIC_API_KEY (Claude).");
}

export function activeModel(): string {
  return MODELS[activeProvider()];
}

let muse: OpenAI | undefined;
let anthropic: Anthropic | undefined;

function museClient(): OpenAI {
  const key = getEnv().MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set");
  muse ??= new OpenAI({ apiKey: key, baseURL: MUSE_BASE_URL, maxRetries: 3 });
  return muse;
}

function anthropicClient(): Anthropic {
  if (!getEnv().ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  anthropic ??= new Anthropic({ maxRetries: 3 });
  return anthropic;
}

/** JSON Schema for a zod schema, in the plain form both APIs accept. */
function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  return rest;
}

// ---------------------------------------------------------------- structured generation

/** Ask the model for a reply that matches `schema`, validated with zod before it is returned. */
export async function generateStructured<S extends z.ZodType>(opts: {
  name: string;
  system: string;
  messages: ChatMessage[];
  schema: S;
  effort: Effort;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; usage: Usage }> {
  return activeProvider() === "muse" ? museStructured(opts) : anthropicStructured(opts);
}

async function museStructured<S extends z.ZodType>(opts: {
  name: string;
  system: string;
  messages: ChatMessage[];
  schema: S;
  effort: Effort;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; usage: Usage }> {
  const response = await museClient().responses.create({
    model: MODELS.muse,
    instructions: opts.system,
    input: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    reasoning: { effort: opts.effort },
    max_output_tokens: opts.maxTokens ?? 16000,
    text: { format: { type: "json_schema", name: opts.name, schema: jsonSchemaOf(opts.schema), strict: false } },
  });
  if (response.status === "incomplete") {
    throw new Error(`Model response was incomplete (${response.incomplete_details?.reason ?? "unknown reason"})`);
  }
  const text = response.output_text;
  if (!text) throw new ModelRefusalError();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  return {
    data: opts.schema.parse(json),
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
  };
}

async function anthropicStructured<S extends z.ZodType>(opts: {
  system: string;
  messages: ChatMessage[];
  schema: S;
  effort: Effort;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; usage: Usage }> {
  const response = await anthropicClient().beta.messages.parse({
    model: MODELS.anthropic,
    max_tokens: opts.maxTokens ?? 16000,
    betas: [ANTHROPIC_FALLBACK_BETA],
    fallbacks: "default",
    system: opts.system,
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    messages: opts.messages,
  });
  if (response.stop_reason === "refusal") throw new ModelRefusalError(response.stop_details?.category);
  if (response.parsed_output == null) throw new Error("Model response could not be parsed");
  return {
    data: opts.schema.parse(response.parsed_output),
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

// ---------------------------------------------------------------- web research

export type ResearchResult = {
  /** The model's written findings. */
  text: string;
  /** Every URL the search tool actually returned (url -> title). Evidence must come from here. */
  sources: Map<string, string>;
  /** Search-result snippets per URL, when the provider returns them (used to verify quotes). */
  snippets: Map<string, string>;
  usage: Usage;
};

/** Let the model research a question with the provider's server-side web search tool. */
export async function researchWithWebSearch(opts: { system: string; prompt: string; effort: Effort; searchDepth?: "low" | "medium" | "high" }): Promise<ResearchResult> {
  return activeProvider() === "muse" ? museResearch(opts) : anthropicResearch(opts);
}

async function museResearch(opts: { system: string; prompt: string; effort: Effort; searchDepth?: "low" | "medium" | "high" }): Promise<ResearchResult> {
  const response = await museClient().responses.create({
    model: MODELS.muse,
    instructions: opts.system,
    input: opts.prompt,
    reasoning: { effort: opts.effort },
    max_output_tokens: 32000,
    tools: [{ type: "web_search", search_context_size: opts.searchDepth ?? "medium" }],
    include: ["web_search_call.results"],
  });
  const sources = new Map<string, string>();
  const snippets = new Map<string, string>();
  for (const item of response.output as unknown as Record<string, unknown>[]) {
    // Raw search hits (requested via `include`).
    if (item.type === "web_search_call" && Array.isArray(item.results)) {
      for (const r of item.results as { url?: string; title?: string; snippet?: string }[]) {
        if (!r.url) continue;
        sources.set(r.url, r.title ?? r.url);
        if (r.snippet) snippets.set(r.url, `${snippets.get(r.url) ?? ""} ${r.snippet}`.trim());
      }
    }
    // Inline citations on the written answer.
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content as { annotations?: { type: string; url?: string; title?: string }[] }[]) {
        for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) sources.set(a.url, a.title ?? a.url);
      }
    }
  }
  return {
    text: response.output_text ?? "",
    sources,
    snippets,
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
  };
}

async function anthropicResearch(opts: { system: string; prompt: string; effort: Effort }): Promise<ResearchResult> {
  let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  let response: Anthropic.Beta.BetaMessage | undefined;
  for (let i = 0; i < 3; i++) {
    response = await anthropicClient()
      .beta.messages.stream({
        model: MODELS.anthropic,
        max_tokens: 32000,
        betas: [ANTHROPIC_FALLBACK_BETA],
        fallbacks: "default",
        system: opts.system,
        output_config: { effort: opts.effort },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        messages,
      })
      .finalMessage();
    if (response.stop_reason !== "pause_turn") break;
    // Long server-tool turns can pause; send the content back so it continues.
    messages = [...messages, { role: "assistant", content: response.content }];
  }
  if (!response) throw new Error("Research returned nothing");
  if (response.stop_reason === "refusal") throw new ModelRefusalError(response.stop_details?.category);
  const sources = new Map<string, string>();
  const text: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") text.push(block.text);
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result") sources.set(r.url, r.title);
    }
  }
  return {
    text: text.join("\n"),
    sources,
    snippets: new Map(),
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
