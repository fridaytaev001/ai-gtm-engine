"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { moveLead } from "@/app/pipeline-actions";
import type { getPipeline } from "@/lib/pipeline";

type Lead = Awaited<ReturnType<typeof getPipeline>>["cards"][number];
type Stage = Lead["stage"];
type Column = { id: Stage; label: string };

export function PipelineBoard({ cards, columns, revision }: { cards: Lead[]; columns: Column[]; revision: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const stream = new EventSource("/api/pipeline/events");
    stream.onmessage = (event) => {
      if (JSON.parse(event.data) !== revision) router.refresh();
    };
    return () => stream.close();
  }, [revision, router]);

  function move(id: string, stage: Stage) {
    setNotice("");
    start(async () => {
      try {
        const result = await moveLead(id, stage);
        if (!result.ok) setNotice("This lead could not be moved.");
      } catch {
        setNotice("The update could not complete. Try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      {notice && <p role="alert" className="text-sm text-rose-700">{notice}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {columns.map((column) => {
          const list = cards.filter((lead) => lead.stage === column.id);
          return (
            <section key={column.id} aria-label={column.label} className="min-h-40 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900"
              onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("application/x-hackbay-lead");
                if (id && cards.some((lead) => lead.id === id && lead.stage !== column.id) && !pending) move(id, column.id);
              }}>
              <h2 className="mb-3 flex items-center justify-between text-sm font-medium">{column.label}<span className="font-mono text-zinc-500">{list.length}</span></h2>
              <div className="space-y-2">
                {list.map((lead) => (
                  <article key={lead.id} draggable={!pending} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                    onDragStart={(event) => { event.dataTransfer.setData("application/x-hackbay-lead", lead.id); event.dataTransfer.effectAllowed = "move"; }}>
                    <Link href={`/icp/${lead.icpId}/leads`} className="text-sm font-medium hover:underline">{lead.person}</Link>
                    <p className="text-xs text-zinc-500">{lead.company}</p>
                    <p className="my-2 font-mono text-[11px]">Tier {lead.tier ?? "—"} · Fit {lead.fit ?? "—"} · Intent {lead.intent ?? "—"}</p>
                    <p className="mb-2 text-xs text-zinc-500">{lead.owner === "ai" ? "AI-managed" : "Rep-managed"}</p>
                    <select className="w-full rounded border border-zinc-300 bg-transparent p-1 text-xs dark:border-zinc-700"
                      aria-label={`Move ${lead.person}`} disabled={pending} value={lead.stage} onChange={(event) => move(lead.id, event.target.value as Stage)}>
                      {columns.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
