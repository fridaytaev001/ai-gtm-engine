import { Suspense } from "react";
import { connection } from "next/server";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { ensureWorkspace, getDb, schema } from "@gtm/db";
import { Card } from "@/components/ui";
import { OutreachControls } from "@/components/outreach-controls";

export const metadata = { title: "Outreach review · AI GTM Engine" };
export const maxDuration = 300;

export default function ReviewPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-5 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Outreach review</h1>
      <p className="text-sm text-zinc-500">Approve each touch before dispatch. Test emails go to your configured test inbox.</p>
      <Suspense fallback={<p>Loading review queue…</p>}><Queue /></Suspense>
    </main>
  );
}

async function Queue() {
  await connection();
  const { orgId } = await ensureWorkspace();
  const { companies, evidence, leads, messages, people } = schema;
  const db = getDb();
  const rows = await db.select({ leadId: leads.id, name: people.name, company: companies.name }).from(leads)
    .innerJoin(people, eq(leads.personId, people.id)).innerJoin(companies, eq(people.companyId, companies.id))
    .where(and(eq(leads.orgId, orgId), eq(companies.orgId, orgId), ne(companies.status, "filtered")))
    .orderBy(desc(leads.updatedAt)).limit(50);
  if (!rows.length) return <p className="text-sm text-zinc-500">Verify a contact from the Accounts page to start drafting.</p>;
  const drafts = await db.select().from(messages).where(inArray(messages.leadId, rows.map((row) => row.leadId)))
    .orderBy(asc(messages.step), asc(messages.variant));
  const ids = drafts.flatMap((draft) => draft.reviewerNotes?.startsWith("Cited evidence: ") ? [draft.reviewerNotes.slice(16)] : []);
  const citations = ids.length ? await db.select({ id: evidence.id, sourceUrl: evidence.sourceUrl }).from(evidence)
    .where(and(eq(evidence.orgId, orgId), eq(evidence.verified, true), inArray(evidence.id, ids))) : [];
  const sources = new Map(citations.map((item) => [item.id, item.sourceUrl]));
  return rows.map((row) => {
    const sequence = drafts.filter((message) => message.leadId === row.leadId);
    return (
      <Card key={row.leadId} title={`${row.name} · ${row.company}`}>
        {sequence.length === 0 && <OutreachControls leadId={row.leadId} />}
        <div className="grid gap-3 sm:grid-cols-2">
          {sequence.map((message) => {
            const source = sources.get(message.reviewerNotes?.slice(16) ?? "");
            return (
              <section key={message.id} className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <p className="text-xs text-zinc-500">Touch {message.step}{message.step === 1 ? ` · Variant ${message.variant}` : ""} · {message.channel} · {message.status === "failed" ? "Dispatch needs review" : message.status}</p>
                {message.subject && <p className="mt-2 font-medium">{message.subject}</p>}
                <p className="mt-2 whitespace-pre-wrap break-words">{message.body}</p>
                {source?.startsWith("https://") && <a href={source} target="_blank" rel="noreferrer" className="text-xs text-sky-700 underline dark:text-sky-400">Open verified source ↗</a>}
                <OutreachControls leadId={row.leadId} message={message} />
              </section>
            );
          })}
        </div>
      </Card>
    );
  });
}
