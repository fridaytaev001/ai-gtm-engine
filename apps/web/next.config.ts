import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rootEnv = resolve(process.cwd(), "../../.env");
if (!process.env.VERCEL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@gtm/core", "@gtm/db", "@gtm/ai", "@gtm/billing"],
  // Server-only drivers stay as Node modules instead of being bundled.
  serverExternalPackages: ["postgres", "neo4j-driver", "@moss-js/moss", "@moss-js/moss-core"],
  devIndicators: false,
};

export default nextConfig;
