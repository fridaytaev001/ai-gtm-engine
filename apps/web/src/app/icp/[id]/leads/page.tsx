import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getLeadsForIcp } from "@/lib/data";
import { cx } from "@/components/ui";
import { RunCompetitorsButton, RunDiscoveryButton } from "@/components/discovery-actions";
import { EnrichContact } from "@/components/enrich-contact";
import { GraphInsights } from "@/components/graph-insights";

export const metadata: Metadata = { title: "Leads · AI GTM Engine" };

// Discovery runs several web-research passes and verifies every quote; give it room.
export const maxDuration = 300;

type Tab = "accounts" | "filtered" | "competitors";

export default function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading leads…</p>}>
        <Leads params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const TIER_STYLE: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  B: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  C: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

async function Leads({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  await connection();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getLeadsForIcp(id);
  if (!data) notFound();
  const tab: Tab = rawTab === "filtered" || rawTab === "competitors" ? rawTab : "accounts";
  const accounts = data.leads.filter((l) => l.status !== "filtered");
  const filtered = data.leads.filter((l) => l.status === "filtered");
  const tierCount = (t: string) => accounts.filter((a) => a.tier === t).length;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            <Link href={`/icp/${data.icp.id}`} className="hover:underline">
              {data.product.name} · ICP v{data.icp.version}
            </Link>
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Accounts</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Every signal is backed by a quote that was found on its source page. Facts that could not be verified are dropped.
          </p>
        </div>
        <RunDiscoveryButton icpId={data.icp.id} hasLeads={data.leads.length > 0} />
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-6 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {(
          [
            ["accounts", `Accounts (${accounts.length})`],
            ["filtered", `Filtered (${filtered.length})`],
            ["competitors", `Competitors (${data.competitors.length})`],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/icp/${data.icp.id}/leads${key === "accounts" ? "" : `?tab=${key}`}`}
            className={cx(
              "-mb-px border-b-2 pb-2",
              tab === key ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
            )}
          >
            {label}
          </Link>
        ))}
        {tab === "accounts" && accounts.length > 0 && (
          <span className="ml-auto pb-2 text-xs text-zinc-500">
            Tier A {tierCount("A")} · B {tierCount("B")} · C {tierCount("C")}
          </span>
        )}
      </div>

      {tab === "competitors" ? (
        <Competitors icpId={data.icp.id} rows={data.competitors} />
      ) : (
        <AccountsTable rows={tab === "filtered" ? filtered : accounts} filteredView={tab === "filtered"} />
      )}
      {tab === "accounts" && <div className="mt-6"><GraphInsights icpId={data.icp.id} /></div>}
    </>
  );
}

type LeadsData = NonNullable<Awaited<ReturnType<typeof getLeadsForIcp>>>;

function AccountsTable({ rows, filteredView }: { rows: LeadsData["leads"]; filteredView: boolean }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-500">
        {filteredView ? "No accounts were filtered out." : "No accounts yet. Run discovery to find real companies with cited signals."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <th className="px-3 py-2 font-medium">Tier</th>
            <th className="px-3 py-2 font-medium">Company</th>
            <th className="px-3 py-2 text-right font-medium" title="Composite = 60% fit + 40% intent">Score</th>
            <th className="px-3 py-2 font-medium">{filteredView ? "Why filtered" : "Signals (verified)"}</th>
            <th className="px-3 py-2 font-medium">People</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900">
              <td className="px-3 py-2.5">
                <span className={cx("inline-flex h-6 w-6 items-center justify-center rounded font-mono text-xs font-semibold", TIER_STYLE[c.tier ?? "C"])}>
                  {c.tier ?? "–"}
                </span>
              </td>
              <td className="max-w-[16rem] px-3 py-2.5">
                <div className="font-medium">{c.name}</div>
                <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-700 hover:underline dark:text-sky-400">
                  {c.domain}
                </a>
                <div className="mt-0.5 text-xs text-zinc-500">{[c.industryLabel, c.hq, c.headcount ? `~${c.headcount} staff` : null].filter(Boolean).join(" · ")}</div>
                {c.fitReason && <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{c.fitReason}</p>}
              </td>
              <td className="px-3 py-2.5 text-right font-mono">
                <div className="text-base font-semibold">{c.composite}</div>
                {c.scoreChanged && <div className="text-[11px] text-amber-700 dark:text-amber-300">Score changed</div>}
                <div className="text-[11px] text-zinc-500">
                  fit {c.fitScore} · intent {c.intentScore}
                </div>
              </td>
              <td className="px-3 py-2.5">
                {filteredView ? (
                  <ul className="space-y-1.5">
                    {c.negativeEvidence.map((e) => (
                      <li key={e.id}>
                        <span className="font-medium text-rose-700 dark:text-rose-300">{e.claim.replace(/^Negative signal: /, "")}</span>
                        <Quote quote={e.quote} url={e.sourceUrl} />
                      </li>
                    ))}
                    {c.negativeEvidence.length === 0 && <li className="text-zinc-500">{c.filterReason}</li>}
                  </ul>
                ) : (
                  <ul className="space-y-2">
                    {c.signals.map((s) => (
                      <li key={s.id}>
                        <span className="mr-1.5 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{s.type}</span>
                        <span>{s.title}</span>
                        <span className="ml-1 text-xs text-zinc-500">{s.observedAt.toISOString().slice(0, 10)}</span>
                        {s.quote && <Quote quote={s.quote} url={s.sourceUrl} />}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-3 py-2.5 text-xs">
                {c.people.length === 0 ? (
                  <span className="text-zinc-400">—</span>
                ) : (
                  <ul className="space-y-1">
                    {c.people.map((p) => (
                      <li key={p.id}>
                        <span className="font-medium">{p.name}</span>
                        <div className="text-zinc-500">{p.title}</div>
                        {p.email && <div className="break-all">{p.email}</div>}
                        {p.enrichSource && p.enrichSource !== "discovery" && (
                          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                            <span className={p.emailStatus === "valid" ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}>
                              {p.emailStatus === "valid" ? "Verified email" : p.emailStatus === "unknown" ? "Unverified" : p.emailStatus}
                            </span>
                            <span className="text-zinc-500">· MX {p.mxValid === true ? "valid" : p.mxValid === false ? "invalid" : "unchecked"}</span>
                            {p.enrichConfidence !== null && <span>· {Math.round(p.enrichConfidence * 100)}% confidence</span>}
                          </div>
                        )}
                        {p.linkedinUrl?.startsWith("https://www.linkedin.com/in/") && (
                          <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="mr-2 text-sky-700 hover:underline dark:text-sky-400">LinkedIn ↗</a>
                        )}
                        {p.enrichSource === "hunter" && <a className="mr-2 underline" href="https://hunter.io/">Hunter</a>}
                        {p.enrichSource === "prospeo" && <a className="mr-2 underline" href="https://prospeo.io/">Prospeo</a>}
                        {p.evidence && (
                          <a href={p.evidence.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline dark:text-sky-400">
                            source
                          </a>
                        )}
                        {!filteredView && <EnrichContact personId={p.id} />}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Quote({ quote, url }: { quote: string; url: string }) {
  return (
    <blockquote className="mt-1 border-l-2 border-zinc-200 pl-2 text-xs leading-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
      “{quote.length > 220 ? `${quote.slice(0, 220)}…` : quote}”{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-sky-700 hover:underline dark:text-sky-400">
        {host(url)} ↗
      </a>
    </blockquote>
  );
}

function Competitors({ icpId, rows }: { icpId: string; rows: LeadsData["competitors"] }) {
  const order = { direct: 0, indirect: 1, alternative: 2 } as const;
  const sorted = [...rows].sort((a, b) => order[a.category] - order[b.category]);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RunCompetitorsButton icpId={icpId} hasAny={rows.length > 0} />
      </div>
      {sorted.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">No competitor map yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Competitor</th>
                <th className="px-3 py-2 font-medium">Positioning</th>
                <th className="px-3 py-2 font-medium">Public pricing</th>
                <th className="px-3 py-2 font-medium">How we win</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2.5 font-mono text-xs">{c.category}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{c.name}</div>
                    {c.domain && <div className="text-xs text-zinc-500">{c.domain}</div>}
                    <div className="mt-1 flex flex-wrap gap-x-2 text-xs">
                      {c.sourceUrls.slice(0, 3).map((u) => (
                        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline dark:text-sky-400">
                          {host(u)} ↗
                        </a>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-xs px-3 py-2.5 text-xs leading-5">{c.positioning}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {c.pricing.length === 0 ? (
                      <span className="text-zinc-400">Not public</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {c.pricing.map((p) => (
                          <li key={p.tier}>
                            <span className="font-medium">{p.tier}</span>: {p.price}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="max-w-xs px-3 py-2.5 text-xs">
                    <ul className="list-disc space-y-0.5 pl-4">
                      {c.differentiators.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
