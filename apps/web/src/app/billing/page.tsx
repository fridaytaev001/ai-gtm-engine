import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { METRICS } from "@gtm/billing";
import { ensureWorkspace, getDb, schema } from "@gtm/db";
import { getOrgBalance } from "@/lib/billing";
import { Card } from "@/components/ui";
import { TopUpButton } from "@/components/billing-actions";

export const metadata: Metadata = { title: "Credits · AI GTM Engine" };

export default function BillingPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">Usage-based billing · Flexprice</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Credits</h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Every enrichment, sent message and graph query is metered in Flexprice and paid from a prepaid credit wallet. When credits run out, costly work stops until you top up.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading wallet…</p>}>
        <Wallet />
      </Suspense>
    </main>
  );
}

async function Wallet() {
  await connection();
  const balance = await getOrgBalance().catch(() => null);
  const { orgId } = await ensureWorkspace();
  const ledger = await getDb()
    .select()
    .from(schema.usageLedger)
    .where(eq(schema.usageLedger.orgId, orgId))
    .orderBy(desc(schema.usageLedger.createdAt))
    .limit(50);
  const spent = ledger.reduce((s, r) => s + Number(r.credits), 0);

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
      <div className="space-y-4">
        <Card title="Wallet">
          {balance === null ? (
            <p className="text-sm text-zinc-500">Billing is not configured. Set FLEXPRICE_API_KEY.</p>
          ) : (
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className={`font-mono text-4xl font-semibold ${balance < 5 ? "text-rose-600" : ""}`}>{balance.toLocaleString("en-US")}</div>
                <div className="text-sm text-zinc-500">credits · 1 credit = $0.01</div>
              </div>
              <TopUpButton />
            </div>
          )}
        </Card>
        <Card title="Price list">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(METRICS).map(([key, m]) => (
                <tr key={key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="py-1.5">{m.label}</td>
                  <td className="py-1.5 font-mono text-xs text-zinc-500">{key}</td>
                  <td className="py-1.5 text-right font-mono">{m.credits} cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="Recent usage" aside={<span className="font-mono text-xs text-zinc-500">{spent} cr in last {ledger.length}</span>}>
        {ledger.length === 0 ? (
          <p className="text-sm text-zinc-500">No metered usage yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Event</th>
                <th className="pb-2 text-right font-medium">Credits</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1.5 text-xs text-zinc-500">{r.createdAt.toISOString().slice(5, 16).replace("T", " ")}</td>
                  <td className="py-1.5 font-mono text-xs">{r.metric}</td>
                  <td className="py-1.5 text-right font-mono">−{Number(r.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
