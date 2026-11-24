"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refresh open tabs after a webhook, top-up or billed action, without polling Flexprice. */
export function BalanceSync({ revision }: { revision: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function check() {
      if (document.visibilityState !== "visible" || pending) return;
      pending = true;
      try {
        const response = await fetch("/api/billing/status", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if ((data.revision === null || typeof data.revision === "string") && data.revision !== revision) {
          startTransition(() => router.refresh());
        }
      } catch {
        // Keep the last known balance when offline; the next tick retries.
      } finally {
        pending = false;
      }
    }
    const interval = window.setInterval(check, 10_000);
    document.addEventListener("visibilitychange", check);
    void check();
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, [revision, router]);
  return null;
}
