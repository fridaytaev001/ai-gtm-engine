"use client";

import { useState, useTransition } from "react";
import { runCompetitorMap, runDiscovery } from "@/app/actions";
import { Button, ErrorNote } from "./ui";

export function RunDiscoveryButton({ icpId, hasLeads }: { icpId: string; hasLeads: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  return (
    <div className="flex max-w-sm flex-col items-end gap-1 text-right">
      <Button
        variant="primary"
        disabled={pending}
        onClick={() => {
          setError(null);
          setSummary(null);
          start(async () => {
            const res = await runDiscovery(icpId);
            if (!res.ok) return setError(res.error);
            const s = res.data;
            setSummary(
              `${s.companiesKept} accounts kept (${s.created} new, ${s.filtered} filtered). ${s.factsVerified} of ${s.factsChecked} quotes verified; ${s.companiesDroppedNoEvidence} companies dropped for lack of proof.`,
            );
          });
        }}
      >
        {pending ? "Researching and verifying… (about 2 min)" : hasLeads ? "Find more accounts" : "Run discovery"}
      </Button>
      {summary && <p className="text-xs text-zinc-500">{summary}</p>}
      <ErrorNote message={error} />
    </div>
  );
}

export function RunCompetitorsButton({ icpId, hasAny }: { icpId: string; hasAny: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await runCompetitorMap(icpId);
            if (!res.ok) setError(res.error);
          });
        }}
      >
        {pending ? "Mapping competitors… (about a minute)" : hasAny ? "Refresh competitor map" : "Map competitors"}
      </Button>
      <ErrorNote message={error} />
    </div>
  );
}
