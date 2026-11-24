import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listIcps } from "@/lib/data";

export const metadata: Metadata = { title: "ICPs · AI GTM Engine" };

export default function IcpListPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Ideal customer profiles</h1>
        <Link href="/intake" className="text-sm font-medium underline underline-offset-4">
          New product
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <IcpTable />
      </Suspense>
    </main>
  );
}

async function IcpTable() {
  await connection(); // read the database at request time, never at build time
  const rows = await listIcps();
  if (rows.length === 0) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        No ICPs yet. <Link href="/intake" className="underline underline-offset-4">Describe a product</Link> to infer one.
      </p>
    );
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
          <th className="py-2 pr-4 font-medium">Product</th>
          <th className="py-2 pr-4 font-medium">Version</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 font-medium">Created</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900">
            <td className="py-2 pr-4">
              <Link href={`/icp/${r.id}`} className="font-medium hover:underline">
                {r.productName}
              </Link>
            </td>
            <td className="py-2 pr-4 font-mono">v{r.version}</td>
            <td className="py-2 pr-4">{r.status}</td>
            <td className="py-2 text-zinc-500">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
