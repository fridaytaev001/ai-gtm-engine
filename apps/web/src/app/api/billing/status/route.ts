import { connection } from "next/server";
import { billingEnabled } from "@gtm/billing";
import { getBillingRevision } from "@/lib/billing";

export async function GET() {
  await connection();
  const headers = { "Cache-Control": "private, no-store" };
  if (!billingEnabled()) return Response.json({ revision: null }, { headers });
  try {
    return Response.json({ revision: await getBillingRevision() }, { headers });
  } catch {
    return Response.json({ error: "Billing status unavailable" }, { status: 503, headers });
  }
}
