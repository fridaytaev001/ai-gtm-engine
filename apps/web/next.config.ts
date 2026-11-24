import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@gtm/core", "@gtm/db", "@gtm/ai"],
  // Server-only drivers stay as Node modules instead of being bundled.
  serverExternalPackages: ["postgres", "neo4j-driver"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
