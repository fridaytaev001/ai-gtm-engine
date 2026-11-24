import { createHash } from "node:crypto";
import { webhookDtoWalletWebhookPayloadFromJSON } from "@flexprice/sdk/sdk/models";
import { Webhook } from "svix";

const walletEvents = new Set([
  "wallet.credit_balance.dropped", "wallet.credit_balance.recovered",
  "wallet.ongoing_balance.dropped", "wallet.ongoing_balance.recovered", "wallet.ongoing_balance.updated",
  "wallet.updated", "wallet.terminated", "wallet.transaction.created",
]);

/** Verify the original bytes before parsing or using any wallet/customer fields. */
export function verifyWalletWebhook(rawBody: string, headers: Record<string, string>, secret: string) {
  new Webhook(secret).verify(rawBody, headers);
  const verified: unknown = JSON.parse(rawBody);
  if (!verified || typeof verified !== "object" || !("event_type" in verified) || typeof verified.event_type !== "string") {
    throw new Error("Missing webhook event type");
  }
  if (!walletEvents.has(verified.event_type)) return null;
  const parsed = webhookDtoWalletWebhookPayloadFromJSON(rawBody);
  if (!parsed.ok || !parsed.value.wallet?.id) throw new Error("Invalid wallet notification");
  const messageId = headers["svix-id"] ?? headers["webhook-id"];
  // The same delivery always uses the same UUID primary key, even across processes.
  const hex = createHash("sha256").update(`flexprice:${messageId}`).digest("hex");
  const auditId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return {
    auditId,
    messageId,
    eventType: verified.event_type,
    walletId: parsed.value.wallet.id,
    customerId: parsed.value.wallet.customerId ?? parsed.value.customer?.id,
  };
}
