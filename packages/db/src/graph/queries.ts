import neo4j from "neo4j-driver";
import { runCypher } from "./client";

/**
 * The three named multi-hop queries from the design doc (Module 3).
 * Chunk 5 builds the UI on top of these; they live here so the seed script can prove the graph works.
 */

export type WarmIntroPath = {
  targetName: string;
  targetCompany: string;
  via: string; // shared past employer or school
  viaType: "Company" | "School";
  connectorName: string;
  connectorCompany: string;
  sourceUrls: string[];
};

/** Target person shares a past employer or school with someone at one of our user's customers. */
export async function findWarmIntros(orgId: string, productId: string, limit = 10): Promise<WarmIntroPath[]> {
  const res = await runCypher(
    `MATCH (cust:Company {orgId: $orgId})-[:CUSTOMER_OF]->(:Product {id: $productId})
     MATCH (connector:Person)-[:WORKS_AT]->(cust)
     MATCH (target:Person {orgId: $orgId})-[:WORKS_AT]->(targetCo:Company)-[:MATCHED_TO]->(:Product {id: $productId})
     MATCH (target)-[r1:PREVIOUSLY_EMPLOYED_AT|STUDIED_AT]->(shared)<-[r2:PREVIOUSLY_EMPLOYED_AT|STUDIED_AT|WORKS_AT]-(connector)
     WHERE target <> connector AND NOT (targetCo)-[:CUSTOMER_OF]->(:Product {id: $productId})
     RETURN target.name AS targetName, targetCo.name AS targetCompany,
            shared.name AS via, labels(shared)[0] AS viaType,
            connector.name AS connectorName, cust.name AS connectorCompany,
            [u IN [r1.sourceUrl, r2.sourceUrl] WHERE u IS NOT NULL] AS sourceUrls
     LIMIT $limit`,
    { orgId, productId, limit: neo4j.int(limit) },
  );
  return res.records.map((r) => r.toObject() as WarmIntroPath);
}

export type BuyingCycleHit = { company: string; signal: string; observedAt: string; sourceUrl: string };

/** Companies with a job-post signal in the last N days (active evaluation cycle). */
export async function findBuyingCycles(orgId: string, days = 30): Promise<BuyingCycleHit[]> {
  const res = await runCypher(
    `MATCH (c:Company {orgId: $orgId})-[:HAS_SIGNAL]->(s:Signal {type: 'job_post'})
     WHERE datetime(s.observedAt) >= datetime() - duration({days: $days})
     RETURN c.name AS company, s.title AS signal, s.observedAt AS observedAt, s.sourceUrl AS sourceUrl
     ORDER BY s.observedAt DESC`,
    { orgId, days: neo4j.int(days) },
  );
  return res.records.map((r) => r.toObject() as BuyingCycleHit);
}

export type DisplacementHit = { company: string; competitor: string; signal: string; sourceUrl: string };

/** Companies using a competitor that also show a churn/renewal-type signal. */
export async function findDisplacements(orgId: string): Promise<DisplacementHit[]> {
  const res = await runCypher(
    `MATCH (c:Company {orgId: $orgId})-[:USES]->(comp:Competitor)
     MATCH (c)-[:HAS_SIGNAL]->(s:Signal)
     WHERE s.type IN ['tech_change', 'news'] AND (toLower(s.title) CONTAINS 'renew' OR toLower(s.title) CONTAINS 'migrat' OR toLower(s.title) CONTAINS 'replac')
     RETURN c.name AS company, comp.name AS competitor, s.title AS signal, s.sourceUrl AS sourceUrl`,
    { orgId },
  );
  return res.records.map((r) => r.toObject() as DisplacementHit);
}
