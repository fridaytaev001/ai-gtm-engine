"use server";

import { z } from "zod";
import { ensureWorkspace } from "@gtm/db";
import { mossConfigured, searchMoss, syncMoss } from "@/lib/moss";
import type { ActionResult } from "./actions";

const Search = z.object({
  query: z.string().trim().min(3).max(300),
  kind: z.enum(["company", "person", "signal"]).optional(),
  tier: z.enum(["A", "B", "C"]).optional(),
  since: z.iso.date().optional(),
});

export async function askPipeline(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof searchMoss>>>> {
  const parsed = Search.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a search query and valid filters." };
  if (!mossConfigured()) return { ok: false, error: "Configure the Moss project credentials to search." };
  try {
    const { orgId } = await ensureWorkspace();
    return { ok: true, data: await searchMoss(orgId, parsed.data.query, parsed.data) };
  } catch {
    return { ok: false, error: "Search is unavailable. Sync the indexes or check the Moss project." };
  }
}

export async function rebuildPipelineSearch(): Promise<ActionResult<number>> {
  if (!mossConfigured()) return { ok: false, error: "Configure the Moss project credentials to sync search." };
  try {
    const { orgId } = await ensureWorkspace();
    return { ok: true, data: await syncMoss(orgId) };
  } catch {
    return { ok: false, error: "Could not sync the indexes. Check Moss credentials and project credits or retry shortly." };
  }
}
