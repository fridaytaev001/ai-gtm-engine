import { Suspense } from "react";
import { connection } from "next/server";
import { and, desc, eq, like } from "drizzle-orm";
import { ensureWorkspace, getDb, schema } from "@gtm/db";
import { integrationStatus } from "@gtm/core";
import { Card } from "@/components/ui";
import { PipelineLive } from "@/components/pipeline-board";
import { pipelineRevision } from "@/lib/pipeline";

export const metadata = { title: "Agent activity · AI GTM Engine" };

export default function AgentsPage() {
  return <main className="mx-auto w-full max-w-5xl space-y-5 px-6 py-10">
    <h1 className="text-3xl font-semibold">Agent activity</h1>
    <Suspense fallback={<p>Loading agent activity…</p>}><AgentActivity /></Suspense>
  </main>;
}

async function AgentActivity() {
  await connection();
  const { orgId } = await ensureWorkspace();
  const { agentRuns, events } = schema;
  const db = getDb();
  const revision = await pipelineRevision();
  const [runs, stream] = await Promise.all([
    db.select().from(agentRuns).where(eq(agentRuns.orgId, orgId)).orderBy(desc(agentRuns.startedAt)).limit(30),
    db.select().from(events).where(and(eq(events.orgId, orgId), like(events.type, "band.%"))).orderBy(desc(events.createdAt)).limit(30),
  ]);
  return <>
    <PipelineLive revision={revision} />
    {!integrationStatus().band && <p className="text-sm text-zinc-500">Band needs four agent credentials and a designated reviewer.</p>}
    <Card title="Recent sessions" aside={<span className="text-xs text-zinc-500">{runs.filter((run) => run.status === "running").length} active</span>}>
      <p className="mb-2 text-sm text-zinc-500">Recent session totals · {runs.reduce((sum, run) => sum + run.tokensIn + run.tokensOut, 0)} tokens · ${runs.reduce((sum, run) => sum + Number(run.costUsd), 0).toFixed(4)}</p>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {runs.map((run) => <li key={run.id} className="py-2 text-sm">
          <span className="capitalize">{run.agent}</span> · {run.status}
          {run.bandRoomId && <span className="ml-2 font-mono text-xs text-zinc-500">Room {run.bandRoomId}</span>}
        </li>)}
      </ul>
    </Card>
    <Card title="Room activity">
      {!stream.length && <p className="text-sm text-zinc-500">Queue a draft from Review to see room activity.</p>}
      <ul className="space-y-2 text-sm">
        {stream.map((event) => <li key={event.id}><span className="font-medium capitalize">{event.actorId ?? "Rep"}</span> · {event.type.slice(5).replace("_", " ")}
          {typeof event.payload.text === "string" && <p className="text-zinc-500">{event.payload.text}</p>}
        </li>)}
      </ul>
    </Card>
  </>;
}
