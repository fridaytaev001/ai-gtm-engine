import { z } from "zod";

/**
 * Every environment variable the system uses, in one place.
 * Most are optional during early chunks; each chunk tightens the ones it needs
 * by calling `requireEnv([...])` at startup.
 */
const optional = z.string().min(1).optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // App database + knowledge graph (chunk 2)
  DATABASE_URL: optional,
  NEO4J_URI: optional,
  NEO4J_USERNAME: optional,
  NEO4J_PASSWORD: optional,
  NEO4J_DATABASE: z.string().min(1).default("neo4j"),

  // LLM (chunk 3): Meta Muse via the Meta Model API, or Anthropic Claude
  MODEL_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,

  // Discovery (chunk 4)
  TAVILY_API_KEY: optional,

  // Billing (chunk 6)
  FLEXPRICE_API_KEY: optional,
  FLEXPRICE_API_HOST: z.string().url().default("https://us.api.flexprice.io/v1"),
  FLEXPRICE_WEBHOOK_SECRET: optional,

  // Enrichment (chunk 7)
  APOLLO_API_KEY: optional,
  HUNTER_API_KEY: optional,
  PROSPEO_API_KEY: optional,

  // Outreach (chunk 8)
  GMAIL_CLIENT_ID: optional,
  GMAIL_CLIENT_SECRET: optional,
  GMAIL_REFRESH_TOKEN: optional,
  GMAIL_SENDER: optional,

  // Multi-agent orchestration (chunk 10)
  BAND_API_URL: z.string().url().default("https://api.band.ai"),
  BAND_PLANNER_API_KEY: optional,
  BAND_BUILDER_API_KEY: optional,
  BAND_REVIEWER_API_KEY: optional,
  BAND_SECURITY_API_KEY: optional,

  // Semantic search (chunk 12)
  MOSS_PROJECT_ID: optional,
  MOSS_PROJECT_KEY: optional,

  // Worker
  WORKER_PORT: z.coerce.number().int().positive().default(8787),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parse and cache process.env. Throws a readable error if a value is malformed. */
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached && source === process.env) return cached;
  // Treat blank values (e.g. `KEY=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Fail fast when a feature needs keys that are not set. Never prints values. */
export function requireEnv<K extends keyof Env>(keys: readonly K[], env: Env = getEnv()): void {
  const missing = keys.filter((k) => env[k] === undefined || env[k] === "");
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

/** Which integrations have keys configured (booleans only, safe to show in UI). */
export function integrationStatus(env: Env = getEnv()) {
  return {
    postgres: Boolean(env.DATABASE_URL),
    neo4j: Boolean(env.NEO4J_URI && env.NEO4J_USERNAME && env.NEO4J_PASSWORD),
    llm: Boolean(env.MODEL_API_KEY || env.ANTHROPIC_API_KEY),
    tavily: Boolean(env.TAVILY_API_KEY),
    flexprice: Boolean(env.FLEXPRICE_API_KEY),
    enrichment: Boolean(env.APOLLO_API_KEY || env.HUNTER_API_KEY || env.PROSPEO_API_KEY),
    gmail: Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN),
    band: Boolean(
      env.BAND_PLANNER_API_KEY &&
        env.BAND_BUILDER_API_KEY &&
        env.BAND_REVIEWER_API_KEY &&
        env.BAND_SECURITY_API_KEY,
    ),
    moss: Boolean(env.MOSS_PROJECT_ID && env.MOSS_PROJECT_KEY),
  } as const;
}

export type IntegrationStatus = ReturnType<typeof integrationStatus>;
