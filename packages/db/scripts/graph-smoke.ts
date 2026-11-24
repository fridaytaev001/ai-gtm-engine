import { and, eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { closeDb, getDb } from "../src/client";
import { findWarmIntros, findBuyingCycles, findDisplacements, closeGraph } from "../src/graph";
import { products } from "../src/schema";

const orgId = "00000000-0000-4000-8000-000000000001";
try {
  const [product] = await getDb().select({ id: products.id }).from(products)
    .where(and(eq(products.orgId, orgId), eq(products.name, "LogLens")));
  assert.ok(product, "LogLens demo fixture is absent. Run pnpm db:seed to create the separate demo org.");
  const [intros, buying, displacement] = await Promise.all([
    findWarmIntros(orgId, product.id), findBuyingCycles(orgId, 30, product.id), findDisplacements(orgId, product.id),
  ]);
  assert.ok(intros.some((path) => path.targetName === "Jordan Lee" && path.connectorName === "Sam Rivera" && path.sourceUrls.length >= 2));
  assert.ok(buying.some((hit) => hit.company === "Contoso Pay"));
  assert.ok(displacement.some((hit) => hit.competitor === "TraceHound"));
  console.log("LogLens graph smoke passed: warm intro, buying cycle, and competitor displacement.");
} finally {
  await Promise.allSettled([closeDb(), closeGraph()]);
}
