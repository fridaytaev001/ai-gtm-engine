"use client";

import { useState, useTransition } from "react";
import { dispatchOutreach, draftOutreach, reviewOutreach, syncReply } from "@/app/outreach-actions";
import { queueBandReview } from "@/app/band-actions";
import type { ActionResult } from "@/app/actions";
import { ctaOptions } from "@/lib/outreach-copy";
import { Button } from "./ui";

export function OutreachControls({ leadId, message }: {
  leadId: string;
  message?: { id: string; body: string; channel: "email" | "linkedin"; status: string };
}) {
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState("");
  const [cta, setCta] = useState<string>(ctaOptions[0]);
  function run<T>(action: () => Promise<ActionResult<T>>, success: string | ((data: T) => string)) {
    setNotice("");
    start(async () => {
      try {
        const result = await action();
        setNotice(result.ok ? typeof success === "string" ? success : success(result.data) : result.error);
      } catch {
        setNotice("The request could not complete. Reload and try again.");
      }
    });
  }
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!message && <Button disabled={busy} onClick={() => run(() => draftOutreach(leadId), "Sequence drafted.")}>Draft sequence</Button>}
        {message && ["draft", "approved"].includes(message.status) && (
          <>
            {message.status === "draft" && <Button disabled={busy} onClick={() => run(() => reviewOutreach(message.id, "approved"), "Approved.")}>Approve</Button>}
            {message.status === "draft" && <Button disabled={busy} onClick={() => run(() => queueBandReview(message.id), "Queued for Band review.")}>Review in Band</Button>}
            <select className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700" value={cta} onChange={(event) => setCta(event.target.value)} aria-label="Call to action">
              {ctaOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <Button disabled={busy} onClick={() => run(() => reviewOutreach(message.id, "edited", cta), "Edited and approved.")}>Edit and approve</Button>
            <Button disabled={busy} variant="danger" onClick={() => run(() => reviewOutreach(message.id, "rejected"), "Rejected.")}>Reject</Button>
          </>
        )}
        {message?.status === "approved" && message.channel === "linkedin" && <Button disabled={busy} onClick={() => {
          void navigator.clipboard.writeText(message.body).then(() => setNotice("Copied to clipboard."), () => setNotice("Copy the text manually."));
        }}>Copy note</Button>}
        {message?.status === "approved" && (
          <Button variant="primary" disabled={busy} onClick={() => run(() => dispatchOutreach(message.id, message.channel), message.channel === "email" ? "Sent to the test inbox." : "Marked as sent.")}>
            {message.channel === "email" ? "Send test email" : "Mark as sent"}
          </Button>
        )}
        {message?.status === "sent" && message.channel === "email" && (
          <Button disabled={busy} onClick={() => run(() => syncReply(message.id), (found) => found ? "Reply recorded." : "No reply yet.")}>Check for reply</Button>
        )}
      </div>
      {(notice || busy) && <p role="status" className="text-xs text-zinc-500">{busy ? "Working…" : notice}</p>}
    </div>
  );
}
