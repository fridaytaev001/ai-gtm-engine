import "server-only";
import { z } from "zod";
import { getEnv } from "@gtm/core";

const api = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function gmailSession() {
  const env = getEnv();
  const sender = z.email().safeParse(env.GMAIL_SENDER);
  const recipient = z.email().safeParse(env.GMAIL_TEST_RECIPIENT);
  if (!sender.success || !recipient.success || !env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Configure Gmail OAuth, sender and test inbox before sending.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN }),
  });
  if (!response.ok) throw new Error("Gmail rejected the OAuth credentials.");
  const token = z.object({ access_token: z.string() }).parse(await response.json()).access_token;
  async function call(path: string, init: RequestInit = {}) {
    const res = await fetch(`${api}${path}`, {
      ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Gmail request failed (HTTP ${res.status}).`);
    return res.json() as Promise<unknown>;
  }
  return {
    async send(subject: string, body: string, id: string) {
      const message = [
        `From: ${sender.data}`, `To: ${recipient.data}`,
        `Subject: =?UTF-8?B?${Buffer.from(`[HackBay test] ${subject}`).toString("base64")}?=`,
        `Message-ID: <${id}@hackbay.example>`,
        "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64", "",
        Buffer.from(body).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "",
      ].join("\r\n");
      return z.object({ id: z.string(), threadId: z.string() }).parse(await call("/messages/send", {
        method: "POST", body: JSON.stringify({ raw: Buffer.from(message).toString("base64url") }),
      }));
    },
    async hasReply(threadId: string, originalId: string, sentAt: Date) {
      const thread = z.object({ messages: z.array(z.object({
        id: z.string(), labelIds: z.array(z.string()).optional(), internalDate: z.string().optional(),
        payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() }).optional(),
      })).optional() }).parse(await call(`/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From`));
      return thread.messages?.some((message) => {
        if (message.id === originalId || message.labelIds?.includes("SENT") || Number(message.internalDate) < sentAt.getTime() - 10_000) return false;
        const from = message.payload?.headers?.find((header) => header.name.toLowerCase() === "from")?.value.trim().toLowerCase();
        return from === recipient.data.toLowerCase() || from?.endsWith(`<${recipient.data.toLowerCase()}>`);
      }) ?? false;
    },
  };
}
