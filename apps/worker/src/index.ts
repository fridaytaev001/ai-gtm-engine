import { createServer } from "node:http";
import { APP_NAME, getEnv, integrationStatus } from "@gtm/core";
import { startBand } from "./band";
import { startScoreRefresh } from "./score-refresh";

/**
 * Agent worker. Later chunks add the pipelines (discovery, enrichment, outreach)
 * and the Band agents (Planner, Builder, Reviewer, Security) here.
 * For now it exposes a health endpoint so hosting platforms can check it is alive.
 */
const env = getEnv();
const startedAt = new Date();
const stopScoreRefresh = startScoreRefresh();
const band = startBand().catch(() => {
  console.error("[band] Could not connect configured agents.");
  return null;
});

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        service: `${APP_NAME} worker`,
        status: "ok",
        startedAt: startedAt.toISOString(),
        integrations: integrationStatus(env),
      }),
    );
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(env.WORKER_PORT, () => {
  console.log(`[worker] ${APP_NAME} worker listening on http://localhost:${env.WORKER_PORT}/health`);
});

function shutdown(signal: string) {
  stopScoreRefresh();
  console.log(`[worker] ${signal} received, shutting down`);
  server.close(() => { void band.then((stop) => stop?.()).finally(() => process.exit(0)); });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
