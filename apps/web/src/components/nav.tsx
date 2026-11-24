import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { APP_NAME } from "@gtm/core";
import { getBillingRevision, getOrgBalance } from "@/lib/billing";
import { BalanceSync } from "./balance-sync";

const links = [
  { href: "/intake", label: "Intake" },
  { href: "/icp", label: "ICPs" },
  { href: "/billing", label: "Credits" },
];

/** Live Flexprice credit balance; turns red when nearly empty. */
async function CreditBadge() {
  await connection();
  // Read the revision first so a notification during the balance fetch cannot be missed.
  const revision = await getBillingRevision().catch(() => null);
  const balance = await getOrgBalance().catch(() => null);
  if (balance === null) return null;
  return (
    <>
      <BalanceSync revision={revision} />
      <Link
        href="/billing"
        className={`ml-auto rounded-full px-2.5 py-0.5 font-mono text-xs ring-1 ${
          balance < 5 ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900" : "ring-zinc-200 dark:ring-zinc-800"
        }`}
        title="Flexprice credit balance"
      >
        {balance.toLocaleString("en-US")} credits
      </Link>
    </>
  );
}

export function Nav() {
  return (
    <nav className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-zinc-950 dark:hover:text-zinc-50">
              {l.label}
            </Link>
          ))}
        </div>
        <Suspense fallback={null}>
          <CreditBadge />
        </Suspense>
      </div>
    </nav>
  );
}
