import { APP_NAME } from "@gtm/core";

const steps = [
  { name: "Describe", detail: "Plain-language product intake" },
  { name: "Target", detail: "ICP with confidence scores" },
  { name: "Discover", detail: "Real accounts, every claim cited" },
  { name: "Connect", detail: "Knowledge graph and warm paths" },
  { name: "Reach out", detail: "Personalized drafts, human approved" },
  { name: "Track", detail: "Pipeline, attribution, analytics" },
];

const integrations = [
  { name: "Band", role: "Multi-agent orchestration" },
  { name: "Flexprice", role: "Usage metering and credits" },
  { name: "Moss", role: "Real-time semantic search" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-16 px-6 py-20">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-widest text-zinc-500">Go-to-market, end to end</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{APP_NAME}</h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          From a product description to approved, tracked outreach with real buyers, where every
          claim links back to its source.
        </p>
        <div>
          <a href="/intake" className="inline-flex rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
            Start with your product
          </a>
        </div>
      </header>

      <section aria-labelledby="loop" className="flex flex-col gap-6">
        <h2 id="loop" className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
          The loop
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-800">
          {steps.map((step, i) => (
            <li key={step.name} className="flex flex-col gap-1 bg-white p-5 dark:bg-zinc-950">
              <span className="font-mono text-xs text-zinc-400">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-medium">{step.name}</span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{step.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="stack" className="flex flex-col gap-6">
        <h2 id="stack" className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Built with
        </h2>
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {integrations.map((item) => (
            <li key={item.name} className="flex items-baseline justify-between py-3">
              <span className="font-medium">{item.name}</span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{item.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-sm text-zinc-500">
        Service status: <a className="underline underline-offset-4" href="/api/health">/api/health</a>
      </footer>
    </main>
  );
}
