import { connection } from "next/server";
import { APP_NAME, integrationStatus } from "@gtm/core";

/** Liveness check. Reports which integrations have keys configured (booleans only, never values). */
export async function GET() {
  await connection(); // evaluate at request time, not at build time
  return Response.json({
    service: `${APP_NAME} web`,
    status: "ok",
    time: new Date().toISOString(),
    integrations: integrationStatus(),
  });
}
