import { getDb } from "./client";
import { orgs, users } from "./schema";

/**
 * Single-workspace mode for the hackathon: every request acts for one org and one founder.
 * (Auth and multi-tenancy can replace this later; all tables are already org-scoped.)
 */
export const WORKSPACE_ORG_ID = "00000000-0000-4000-8000-000000000010";
export const WORKSPACE_USER_ID = "00000000-0000-4000-8000-000000000011";

let ensured = false;

export async function ensureWorkspace(): Promise<{ orgId: string; userId: string }> {
  if (!ensured) {
    const db = getDb();
    await db.insert(orgs).values({ id: WORKSPACE_ORG_ID, name: "My workspace" }).onConflictDoNothing();
    await db
      .insert(users)
      .values({ id: WORKSPACE_USER_ID, orgId: WORKSPACE_ORG_ID, name: "Founder", email: "founder@workspace.local", role: "founder" })
      .onConflictDoNothing();
    ensured = true;
  }
  return { orgId: WORKSPACE_ORG_ID, userId: WORKSPACE_USER_ID };
}
