import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { and, eq } from "drizzle-orm";
import { ensureWorkspace, getDb, schema } from "@gtm/db";
import { Card } from "@/components/ui";

export const metadata = { title: "LogLens demo · AI GTM Engine" };

export default function DemoPage() {
  return <main className="mx-auto w-full max-w-3xl space-y-5 px-6 py-10">
    <h1 className="text-3xl font-semibold">LogLens demo</h1>
    <p className="text-sm text-zinc-500">Explore a fictional incident-analysis product with sample accounts, cited signals, and outreach drafts.</p>
    <Suspense fallback={<p>Loading demo…</p>}><DemoLinks /></Suspense>
  </main>;
}

async function DemoLinks() {
  await connection();
  const { orgId } = await ensureWorkspace();
  const { products, icps } = schema;
  const [row] = await getDb().select({ icpId: icps.id }).from(products)
    .innerJoin(icps, eq(icps.productId, products.id))
    .where(and(eq(products.orgId, orgId), eq(products.name, "LogLens (fictional demo)"), eq(icps.version, 1))).limit(1);
  if (!row) return <Card title="Load the sample workspace">
    <p className="text-sm">Run <code>pnpm db:seed:workspace</code> after loading the isolated LogLens fixture, then reload this page.</p>
  </Card>;
  const steps = [
    { title: "Inspect the ICP", description: "See the roles, company size, and buying triggers LogLens targets.", href: `/icp/${row.icpId}` },
    { title: "Explore accounts and graph paths", description: "Check the hiring and renewal citations, then find the warm introduction to Contoso Pay.", href: `/icp/${row.icpId}/leads` },
    { title: "Review the outreach", description: "Compare Avery's first-touch drafts and record an approval.", href: `/review?icp=${row.icpId}` },
    { title: "Move a lead through the pipeline", description: "Move a sample card and inspect the stage counts and audit log.", href: `/dashboard?icp=${row.icpId}` },
  ];
  return <ol className="grid gap-3 sm:grid-cols-2">
    {steps.map((step) => <li key={step.href}><Card title={step.title}>
      <p className="mb-2 text-sm text-zinc-500">{step.description}</p>
      <Link className="text-sm font-medium underline" href={step.href}>Open ↗</Link>
    </Card></li>)}
  </ol>;
}
