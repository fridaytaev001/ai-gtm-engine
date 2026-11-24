"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { enrichPerson } from "@/app/enrichment-actions";
import { Button } from "./ui";

export function EnrichContact({ personId }: { personId: string }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [short, setShort] = useState(false);

  return (
    <div className="mt-1 space-y-1">
      <Button className="px-2 py-1 text-xs" disabled={pending} onClick={() => start(async () => {
        setNotice(null);
        setShort(false);
        try {
          const result = await enrichPerson(personId);
          if (result.ok) {
            setNotice(result.data.cached ? "Using recent lookup." : result.data.status === "valid" ? "Contact verified." : "No verified email found.");
          } else {
            setNotice(result.error);
            setShort(result.error.startsWith("Not enough credits"));
          }
        } catch {
          setNotice("Contact enrichment is unavailable. Try again.");
        }
      })}>{pending ? "Checking…" : "Verify contact"}</Button>
      {notice && <div role="status" className="text-zinc-500">{notice}{" "}
        {short && <Link className="underline" href="/billing">Top up</Link>}
      </div>}
    </div>
  );
}
