"use client";

import { useState, useTransition } from "react";
import { approveIcp, decideSuggestion, findExpansions } from "@/app/actions";
import { Button, ErrorNote } from "./ui";

export function ApproveButton({ icpId }: { icpId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await approveIcp(icpId);
            if (!res.ok) setError(res.error);
          })
        }
      >
        {pending ? "Approving…" : "Approve ICP"}
      </Button>
      <ErrorNote message={error} />
    </div>
  );
}

export function FindExpansionsButton({ icpId, hasAny }: { icpId: string; hasAny: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        onClick={() => {
          setError(null);
          setNote(null);
          start(async () => {
            const res = await findExpansions(icpId);
            if (!res.ok) setError(res.error);
            else if (res.data === 0) setNote("No segment had public evidence strong enough to suggest.");
          });
        }}
      >
        {pending ? "Researching the web… (about a minute)" : hasAny ? "Find more segments" : "Find adjacent segments"}
      </Button>
      {note && <p className="text-xs text-zinc-500">{note}</p>}
      <ErrorNote message={error} />
    </div>
  );
}

export function SuggestionActions({ icpId, suggestionId, segment }: { icpId: string; suggestionId: string; segment: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(segment);

  const decide = (decision: "accepted" | "adjusted" | "dismissed", value?: string) =>
    start(async () => {
      setError(null);
      const res = await decideSuggestion(icpId, { suggestionId, decision, segment: value });
      if (res && !res.ok) setError(res.error);
    });

  return (
    <div className="mt-3 space-y-2">
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) decide("adjusted", text.trim());
          }}
        >
          <label className="sr-only" htmlFor={`seg-${suggestionId}`}>
            Segment name
          </label>
          <input
            id={`seg-${suggestionId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button variant="primary" disabled={pending} onClick={() => decide("accepted")}>
            Accept
          </Button>
          <Button disabled={pending} onClick={() => setEditing(true)}>
            Adjust
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => decide("dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
      <ErrorNote message={error} />
    </div>
  );
}
