import Link from "next/link";
import { APP_NAME } from "@gtm/core";

const links = [
  { href: "/intake", label: "Intake" },
  { href: "/icp", label: "ICPs" },
];

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
      </div>
    </nav>
  );
}
