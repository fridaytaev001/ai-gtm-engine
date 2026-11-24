import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { Webhook } from "svix";
import { verifyWalletWebhook } from "./webhook";

const secret = `whsec_${randomBytes(32).toString("base64")}`;
const signer = new Webhook(secret);
const body = JSON.stringify({
  event_type: "wallet.credit_balance.dropped",
  wallet: { id: "wallet_test", customer_id: "cust_test", credit_balance: "0" },
});
function sign(payload = body, date = new Date(), id = "msg_test") {
  return {
    "svix-id": id,
    "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
    "svix-signature": signer.sign(id, date, payload),
  };
}

test("signed wallet event yields stable audit ID for duplicate deliveries", () => {
  const headers = sign();
  const first = verifyWalletWebhook(body, headers, secret)!;
  assert.equal(first.walletId, "wallet_test");
  assert.equal(first.customerId, "cust_test");
  assert.equal(first.eventType, "wallet.credit_balance.dropped");
  assert.match(first.auditId, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(verifyWalletWebhook(body, headers, secret)?.auditId, first.auditId);
  assert.notEqual(verifyWalletWebhook(body, sign(body, new Date(), "msg_other"), secret)?.auditId, first.auditId);
});

test("rejects tampered payloads, missing signatures, wrong secrets and old signed messages", () => {
  assert.throws(() => verifyWalletWebhook(body.replace("wallet_test", "wallet_foreign"), sign(), secret));
  assert.throws(() => verifyWalletWebhook(body, {}, secret));
  assert.throws(() => verifyWalletWebhook(body, sign(), `whsec_${randomBytes(32).toString("base64")}`));
  assert.throws(() => verifyWalletWebhook(body, sign(body, new Date(Date.now() - 600_000)), secret));
});

test("acknowledges unrelated signed events, but rejects malformed wallet notifications", () => {
  const unrelated = JSON.stringify({ event_type: "invoice.created" });
  assert.equal(verifyWalletWebhook(unrelated, sign(unrelated), secret), null);
  for (const payload of ["null", "{}", JSON.stringify({ event_type: "wallet.credit_balance.dropped" })]) {
    assert.throws(() => verifyWalletWebhook(payload, sign(payload), secret));
  }
});

test("accepts recovery events and Standard Webhooks header names", () => {
  const recovered = body.replace("wallet.credit_balance.dropped", "wallet.credit_balance.recovered");
  const headers = sign(recovered);
  assert.equal(verifyWalletWebhook(recovered, {
    "webhook-id": headers["svix-id"],
    "webhook-timestamp": headers["svix-timestamp"],
    "webhook-signature": headers["svix-signature"],
  }, secret)?.eventType, "wallet.credit_balance.recovered");
});
