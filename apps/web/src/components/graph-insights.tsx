"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { evaluateGraph } from "@/app/graph-actions";
import { displaySourceUrl } from "@/lib/demo-sources";
import { Button, Card } from "./ui";

type Result = Extract<Awaited<ReturnType<typeof evaluateGraph>>, { ok: true }>["data"];

export function GraphInsights({ icpId }: { icpId: string }) {
  const [loading, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const request = useRef<string | null>(null);
  return <Card title="Why these leads?" aside={<Button disabled={loading} onClick={() => start(async () => {
    setError("");
    try {
      request.current ??= crypto.randomUUID();
      const response = await evaluateGraph(icpId, request.current);
      if (response.ok) {
        setResult(response.data);
        request.current = null;
      } else setError(response.error);
    } catch { setError("Graph evaluation is unavailable. Try again."); }
  })}>{loading ? "Evaluating…" : "Evaluate paths · 0.5 credits"}</Button>}>
    {error && <p role="alert" className="text-sm text-rose-700">{error} {error.startsWith("Not enough credits") && <Link href="/billing" className="underline">Top up</Link>}</p>}
    {!result && <p className="text-sm text-zinc-500">See cited warm introductions, recent hiring signals, and competitor displacement paths.</p>}
    {result && <div className="grid gap-4 md:grid-cols-3">
      <Section title="Warm introductions" empty={!result.intros.length}>
        {result.intros.map((path, index) => <li key={index}>
          <p className="font-medium">{path.targetName} · {path.targetCompany}</p>
          <p>{path.targetName} → {path.via} ← {path.connectorName} · {path.connectorCompany}</p>
          <Sources urls={path.sourceUrls} />
        </li>)}
      </Section>
      <Section title="Buying cycles" empty={!result.buying.length}>
        {result.buying.map((path, index) => <li key={index}><p className="font-medium">{path.company}</p>
          <p>{path.signal} · {path.observedAt.slice(0, 10)}</p><Sources urls={[path.sourceUrl]} /></li>)}
      </Section>
      <Section title="Competitor displacement" empty={!result.displacement.length}>
        {result.displacement.map((path, index) => <li key={index}><p className="font-medium">{path.company} → {path.competitor}</p>
          <p>{path.signal}</p><Sources urls={[path.sourceUrl]} /></li>)}
      </Section>
    </div>}
  </Card>;
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return <section className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
    <h3 className="mb-2 font-medium">{title}</h3>
    {empty ? <p className="text-xs text-zinc-500">No verified paths found.</p> : <ul className="space-y-3 text-xs">{children}</ul>}
  </section>;
}

function Sources({ urls }: { urls: string[] }) {
  return <div className="mt-1 flex flex-wrap gap-2">
    {[...new Set(urls)].filter((url) => url.startsWith("https://")).map((url, index) => (
      <a className="text-sky-700 underline dark:text-sky-400" key={url} href={displaySourceUrl(url)} target="_blank" rel="noreferrer">Source {index + 1} ↗</a>
    ))}
  </div>;
}
