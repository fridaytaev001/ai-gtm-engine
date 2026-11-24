import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { ensureWorkspace, getDb, schema } from "@gtm/db";

const { icps, icpSuggestions, products } = schema;

export type IcpRow = typeof icps.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type SuggestionRow = typeof icpSuggestions.$inferSelect;

/** All ICP versions in the workspace, newest first, with their product name. */
export async function listIcps() {
  const { orgId } = await ensureWorkspace();
  return getDb()
    .select({
      id: icps.id,
      version: icps.version,
      status: icps.status,
      createdAt: icps.createdAt,
      productId: products.id,
      productName: products.name,
    })
    .from(icps)
    .innerJoin(products, eq(icps.productId, products.id))
    .where(eq(products.orgId, orgId))
    .orderBy(desc(icps.createdAt));
}

/** One ICP with its product, sibling versions and expansion suggestions (scoped to the workspace). */
export async function getIcpDetail(icpId: string) {
  const { orgId } = await ensureWorkspace();
  const db = getDb();
  const [row] = await db
    .select({ icp: icps, product: products })
    .from(icps)
    .innerJoin(products, eq(icps.productId, products.id))
    .where(and(eq(icps.id, icpId), eq(products.orgId, orgId)));
  if (!row) return null;
  const [versions, suggestions] = await Promise.all([
    db
      .select({ id: icps.id, version: icps.version, status: icps.status })
      .from(icps)
      .where(eq(icps.productId, row.product.id))
      .orderBy(desc(icps.version)),
    db.select().from(icpSuggestions).where(eq(icpSuggestions.icpId, icpId)).orderBy(icpSuggestions.createdAt),
  ]);
  return { ...row, versions, suggestions };
}
