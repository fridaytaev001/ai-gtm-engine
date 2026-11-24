import { defineConfig } from "drizzle-kit";

// Load the repo-root .env when present (Node 21+); CI and Vercel provide env vars directly.
try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env file — fine
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
