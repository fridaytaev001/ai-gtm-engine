import Link from "next/link";
import { notFound } from "next/navigation";
import { demoSources } from "@/lib/demo-sources";

export function generateStaticParams() {
  return Object.keys(demoSources).map((slug) => ({ slug }));
}

export default async function DemoSourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!Object.hasOwn(demoSources, slug)) notFound();
  const source = demoSources[slug];
  return <main className="mx-auto max-w-2xl space-y-4 px-6 py-10">
    <Link href="/demo" className="text-sm underline">LogLens demo</Link>
    <h1 className="text-3xl font-semibold">{source.title}</h1>
    <p className="text-sm text-zinc-500">Fictional source for the LogLens demo.</p>
    <p>{source.text}</p>
  </main>;
}
