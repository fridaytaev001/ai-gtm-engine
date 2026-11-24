import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getIcpDetail } from "@/lib/data";
import { Card, Confidence, cx } from "@/components/ui";
import { EditableField } from "@/components/icp-field-editor";
import { ApproveButton, FindExpansionsButton, SuggestionActions } from "@/components/icp-actions";

export const metadata: Metadata = { title: "ICP · AI GTM Engine" };

// Expansion runs web research through Claude; give the server action room.
export const maxDuration = 300;

export default function IcpPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading ICP…</p>}>
        <IcpDetail params={params} />
      </Suspense>
    </main>
  );
}

const usd = (n?: number) => (n === undefined ? "—" : `$${n.toLocaleString("en-US")}`);
const num = (n?: number) => (n === undefined ? "—" : n.toLocaleString("en-US"));

async function IcpDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // read the database at request time, never at build time
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getIcpDetail(id);
  if (!detail) notFound();
  const { icp, product, versions, suggestions } = detail;
  const conf = icp.fieldConfidence;
  const pending = suggestions.filter((s) => s.decision === "pending");
  const decided = suggestions.filter((s) => s.decision !== "pending");

  return (
    <>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">Ideal customer profile</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{product.name}</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">{product.description}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono">v{icp.version}</span>
            <span
              className={cx(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                icp.status === "approved"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
              )}
            >
              {icp.status}
            </span>
          </div>
          {icp.status !== "approved" && <ApproveButton icpId={icp.id} />}
          <Link
            href={`/icp/${icp.id}/leads`}
            className="text-sm font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            Accounts &amp; competitors →
          </Link>
          {versions.length > 1 && (
            <nav aria-label="Versions" className="flex flex-wrap justify-end gap-1 text-xs">
              {versions.map((v) => (
                <Link
                  key={v.id}
                  href={`/icp/${v.id}`}
                  className={cx(
                    "rounded px-1.5 py-0.5 font-mono",
                    v.id === icp.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  )}
                >
                  v{v.version}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>

      {icp.rationale && (
        <p className="mb-6 border-l-2 border-zinc-300 pl-4 text-sm leading-6 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">{icp.rationale}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Industries (NAICS)" aside={<Confidence value={conf.industries} />}>
          <EditableField icpId={icp.id} field="industries" value={icp.industries}>
            <table className="w-full text-sm">
              <tbody>
                {icp.industries.map((i) => (
                  <tr key={i.naics + i.label} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="py-1.5 pr-3 font-mono text-xs text-zinc-500">{i.naics}</td>
                    <td className="py-1.5 pr-3">{i.label}</td>
                    <td className="py-1.5 text-right">
                      <Confidence value={i.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </EditableField>
        </Card>

        <Card title="Company size" aside={<Confidence value={conf.sizeBands} />}>
          <EditableField icpId={icp.id} field="sizeBands" value={icp.sizeBands}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-500">Headcount</dt>
                <dd className="font-medium">
                  {num(icp.sizeBands.headcountMin)} – {num(icp.sizeBands.headcountMax)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Revenue</dt>
                <dd className="font-medium">
                  {usd(icp.sizeBands.revenueMinUsd)} – {usd(icp.sizeBands.revenueMaxUsd)}
                </dd>
              </div>
            </dl>
          </EditableField>
        </Card>

        <Card title="Buyer personas" aside={<Confidence value={conf.personas} />}>
          <EditableField icpId={icp.id} field="personas" value={icp.personas}>
            <ul className="space-y-1.5 text-sm">
              {icp.personas.map((p) => (
                <li key={p.title} className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{p.title}</span>
                  <span className="text-xs text-zinc-500">
                    {[p.seniority, p.function, p.role?.replace("_", " ")].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </EditableField>
        </Card>

        <Card title="Trigger events" aside={<Confidence value={conf.triggers} />}>
          <EditableField icpId={icp.id} field="triggers" value={icp.triggers}>
            <ul className="space-y-1.5 text-sm">
              {icp.triggers.map((t) => (
                <li key={t.description} className="flex gap-2">
                  <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    {t.type}
                  </span>
                  <span>{t.description}</span>
                </li>
              ))}
            </ul>
          </EditableField>
        </Card>

        <Card title="Regions" aside={<Confidence value={conf.regions} />}>
          <EditableField icpId={icp.id} field="regions" value={icp.regions}>
            <p className="text-sm">{icp.regions.join(", ") || "—"}</p>
          </EditableField>
        </Card>

        <Card title="Negative signals (filter out)">
          <EditableField icpId={icp.id} field="negativeSignals" value={icp.negativeSignals}>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {icp.negativeSignals.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </EditableField>
        </Card>
      </div>

      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Expansion segments</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Adjacent markets found through web research. Each one links to the sources behind it.
            </p>
          </div>
          <FindExpansionsButton icpId={icp.id} hasAny={suggestions.length > 0} />
        </div>

        {icp.segments.length > 0 && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-800 dark:text-emerald-200">In this ICP</p>
            <ul className="space-y-1 text-sm">
              {icp.segments.map((s) => (
                <li key={s.segment} className="font-medium">
                  {s.segment}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {pending.map((s) => (
            <article key={s.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="font-semibold">{s.segment}</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{s.reasoning}</p>
              <ul className="mt-2 space-y-0.5 text-xs">
                {s.evidenceUrls.map((u) => (
                  <li key={u} className="truncate">
                    <a href={u} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline underline-offset-2 dark:text-sky-400">
                      {u.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  </li>
                ))}
              </ul>
              <SuggestionActions icpId={icp.id} suggestionId={s.id} segment={s.segment} />
            </article>
          ))}
        </div>

        {decided.length > 0 && (
          <details className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            <summary className="cursor-pointer">Reviewed suggestions ({decided.length})</summary>
            <ul className="mt-2 space-y-1">
              {decided.map((s) => (
                <li key={s.id}>
                  <span className="font-mono text-xs">{s.decision}</span> · {s.segment}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
