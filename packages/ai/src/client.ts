import Anthropic from "@anthropic-ai/sdk";
import { getEnv, requireEnv } from "@gtm/core";

/** One model for the whole engine; effort is tuned per task. */
export const MODEL = "claude-opus-5-5";

/**
 * Server-side refusal fallback: if Claude Opus 5.5 declines a request on policy grounds,
 * the API re-runs it on a fallback model inside the same call.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  if (client) return client;
  requireEnv(["ANTHROPIC_API_KEY"], getEnv());
  client = new Anthropic({ maxRetries: 3 });
  return client;
}

export class ModelRefusalError extends Error {
  constructor(public readonly category: string | null | undefined) {
    super(`The model declined this request${category ? ` (${category})` : ""}.`);
    this.name = "ModelRefusalError";
  }
}

export type Usage = { inputTokens: number; outputTokens: number };

export function toUsage(u: { input_tokens: number; output_tokens: number }): Usage {
  return { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
}
