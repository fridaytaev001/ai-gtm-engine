import type { Metadata } from "next";
import { IntakeWorkspace } from "@/components/intake-workspace";

export const metadata: Metadata = { title: "Product intake · AI GTM Engine" };

// Server actions on this page call Claude; give them room to finish.
export const maxDuration = 300;

export default function IntakePage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <header className="mb-8 max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">Step 1</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Describe your product</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Chat or fill the form. When the record is complete, the AI infers who to sell to, with a confidence score on every field.
        </p>
      </header>
      <IntakeWorkspace />
    </main>
  );
}
