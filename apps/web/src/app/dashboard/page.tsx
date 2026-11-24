import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Card } from "@/components/ui";
import { PipelineBoard } from "@/components/pipeline-board";
import { getPipeline, pipelineRevision, stageLabels, stages } from "@/lib/pipeline";

export const metadata = { title: "Pipeline · AI GTM Engine" };
const columns = stages.map((id) => ({ id, label: stageLabels[id] }));

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Pipeline</h1>
      <Suspense fallback={<p>Loading pipeline…</p>}><Dashboard /></Suspense>
    </main>
  );
}

async function Dashboard() {
  await connection();
  const revision = await pipelineRevision();
  const data = await getPipeline();
  const segments = new Map<string, number[]>();
  for (const lead of data.cards) {
    const label = `${lead.industry ?? "Unclassified"} · Tier ${lead.tier ?? "—"}`;
    const counts = segments.get(label) ?? stages.map(() => 0);
    counts[stages.indexOf(lead.stage)]++;
    segments.set(label, counts);
  }
  return (
    <>
      {data.cards.length === 0 && <p className="text-sm text-zinc-500">Verify contacts from an <Link href="/icp" className="underline">ICP accounts page</Link> to populate the pipeline.</p>}
      <PipelineBoard cards={data.cards} columns={columns} revision={revision} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Stage distribution" aside={<span className="text-xs text-zinc-500">{data.cards.length} leads</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr><th className="py-2">Industry and tier</th>{columns.map((column) => <th className="px-1" key={column.id}>{column.label}</th>)}</tr></thead>
              <tbody>{[...segments].map(([label, counts]) => {
                const total = counts.reduce((sum, n) => sum + n, 0);
                return <tr key={label} className="border-t border-zinc-200 dark:border-zinc-800"><th className="py-2 font-normal">{label}</th>
                  {counts.map((count, index) => <td key={columns[index].id} className="px-1 font-mono">{count} ({Math.round(count * 100 / total)}%)</td>)}
                </tr>;
              })}</tbody>
            </table>
          </div>
        </Card>
        <Card title="Reply rates" aside={<Link href="/review" className="text-xs underline">Review queue</Link>}>
          {data.variants.length ? (
            <table className="w-full text-left text-xs">
              <thead><tr><th>Touch</th><th>Channel</th><th>Sent</th><th>Replies</th><th>Rate</th></tr></thead>
              <tbody>{data.variants.map((row) => (
                <tr key={`${row.channel}:${row.label}`} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-2">{row.label}</td><td>{row.channel}</td><td>{row.sent}</td><td>{row.replies}</td><td>{Math.round(row.replies * 100 / row.sent)}%</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="text-sm text-zinc-500">Send an approved test touch to start recording outreach.</p>}
        </Card>
        <Card title="Enrichment spend" aside={<Link className="text-xs underline" href="/billing">Billing</Link>}>
          <p className="font-mono text-lg">{data.enrichedCount ? (data.enrichmentCredits / data.enrichedCount).toFixed(2) : "—"} credits per billed lead</p>
          <p className="mt-1 text-xs text-zinc-500">{data.enrichmentCredits} credits across {data.enrichedCount} leads</p>
        </Card>
        <Card title="Audit log">
          {data.audit.length === 0 && <p className="text-sm text-zinc-500">No activity yet.</p>}
          <ul className="max-h-60 divide-y divide-zinc-200 overflow-auto text-xs dark:divide-zinc-800">
            {data.audit.map((event) => <li className="grid grid-cols-[110px_1fr_auto] items-center gap-2 py-2" key={event.id}>
              <time dateTime={event.date.toISOString()} className="font-mono text-zinc-500">{event.date.toISOString().slice(0, 16).replace("T", " ")}</time>
              <span>{event.type.replace(/[._]/g, " ")}</span><span className="text-zinc-500">{event.actor}</span>
            </li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
