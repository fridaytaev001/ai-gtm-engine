import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getEnv } from "@gtm/core";
import { verifyWalletWebhook } from "@gtm/billing";
import { getDb, schema } from "@gtm/db";

export async function POST(request: Request) {
  const secret = getEnv().FLEXPRICE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });

  const rawBody = await request.text();
  let notification;
  try {
    notification = verifyWalletWebhook(rawBody, Object.fromEntries(request.headers), secret);
  } catch {
    return Response.json({ error: "Invalid webhook" }, { status: 400 });
  }
  if (!notification) return Response.json({ received: true, ignored: true });

  try {
    const { orgs, events } = schema;
    const [org] = await getDb().select({ id: orgs.id }).from(orgs).where(and(
      eq(orgs.flexpriceWalletId, notification.walletId),
      notification.customerId ? eq(orgs.flexpriceCustomerId, notification.customerId) : undefined,
    )).limit(1);
    if (!org) return Response.json({ received: true, ignored: true });

    await getDb().insert(events).values({
      id: notification.auditId, orgId: org.id, type: "billing.wallet.updated",
      actorType: "system", actorId: "flexprice",
      payload: { messageId: notification.messageId, eventType: notification.eventType, walletId: notification.walletId },
    }).onConflictDoNothing({ target: events.id });
    // Re-read the authoritative balance; never apply a potentially out-of-order snapshot.
    revalidatePath("/", "layout");
    return Response.json({ received: true });
  } catch {
    // Retry transient database errors without logging payloads or credentials.
    return Response.json({ error: "Webhook processing unavailable" }, { status: 503 });
  }
}
