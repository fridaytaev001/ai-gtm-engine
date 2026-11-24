"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { askPipeline, rebuildPipelineSearch } from "@/app/moss-actions";
import { Button, Card } from "./ui";

type SearchResult = Extract<Awaited<ReturnType<typeof askPipeline>>, { ok: true }>["data"];

export function PipelineSearch({ enabled }: { enabled: boolean }) {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const field = "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
  return <Card title="Ask your pipeline" aside={enabled && <Button disabled={pending} onClick={() => start(async () => {
    const sync = await rebuildPipelineSearch();
    setNotice(sync.ok ? `Synced ${sync.data} records.` : sync.error);
  })}>Sync search</Button>}>
    {enabled ? <>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        start(async () => {
          setNotice("");
          const response = await askPipeline({ query: values.get("query"), kind: values.get("kind") || undefined,
            tier: values.get("tier") || undefined, since: values.get("since") || undefined });
          if (response.ok) setResult(response.data);
          else { setResult(null); setNotice(response.error); }
        });
      }}>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs">Search verified accounts and signals
          <input name="query" required minLength={3} maxLength={300} className={field} placeholder="Series B companies hiring SREs" />
        </label>
        <label className="flex flex-col gap-1 text-xs">Type
          <select name="kind" className={field}><option value="">All</option><option value="company">Company</option><option value="person">Person</option><option value="signal">Signal</option></select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Tier
          <select name="tier" className={field}><option value="">All</option><option>A</option><option>B</option><option>C</option></select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Since<input name="since" type="date" className={field} /></label>
        <Button type="submit" variant="primary" disabled={pending}>Search</Button>
      </form>
      {(pending || notice) && <p role="status" className="mt-2 text-sm text-zinc-500">{pending ? "Working…" : notice}</p>}
      {result && <div className="mt-3 space-y-2">
        <p className="text-xs text-zinc-500">{result.hits.length} results · {result.ms} ms</p>
        {result.hits.map((hit) => <article key={hit.id} className="border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
          <p>{hit.text}</p>
          <div className="flex gap-3 pt-1 text-xs">
            <Link href={`/icp/${hit.icpId}/leads`} className="underline">Accounts</Link>
            <a href={hit.sourceUrl} target="_blank" rel="noreferrer" className="underline">Source ↗</a>
          </div>
        </article>)}
      </div>}
    </> : <p className="text-sm text-zinc-500">Configure Moss to search verified pipeline evidence.</p>}
  </Card>;
}
