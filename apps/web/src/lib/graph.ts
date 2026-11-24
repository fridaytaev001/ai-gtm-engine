import "server-only";
import { findBuyingCycles, findDisplacements, findWarmIntros, runCypher } from "@gtm/db/graph";
import { getLeadsForIcp } from "./data";

type Data = NonNullable<Awaited<ReturnType<typeof getLeadsForIcp>>>;

export async function syncProductGraph(data: Data) {
  const orgId = data.product.orgId;
  const productId = data.product.id;
  const companies = data.leads.filter((company) => company.status !== "filtered").map((company) => ({
    id: company.id, name: company.name, domain: company.domain, tier: company.tier, icpId: company.icpId,
    signals: company.signals.filter((signal) => signal.quote).map((signal) => ({
      id: signal.id, title: signal.title, type: signal.type, sourceUrl: signal.sourceUrl, observedAt: signal.observedAt.toISOString(),
    })),
    people: company.people.flatMap((person) => person.evidence ? [{
      id: person.id, name: person.name, title: person.title, sourceUrl: person.evidence.sourceUrl,
    }] : []),
  }));
  const rivals = data.competitors.flatMap((rival) => rival.sourceUrls[0] ? [{
    id: rival.id, name: rival.name, sourceUrl: rival.sourceUrls[0],
  }] : []);
  await runCypher(
    `MERGE (p:Product {id: $productId})
     SET p.orgId = $orgId, p.name = $name
     WITH p
     OPTIONAL MATCH (stale:Company {orgId: $orgId})-[edge:MATCHED_TO]->(p)
     WHERE NOT stale.id IN [item IN $companies | item.id]
     DELETE edge
     WITH DISTINCT p
     FOREACH (item IN $companies |
       MERGE (c:Company {id: item.id})
       SET c.orgId = $orgId, c.name = item.name, c.domain = item.domain, c.tier = item.tier
       MERGE (c)-[matched:MATCHED_TO]->(p)
       SET matched.icpId = item.icpId, matched.sourceUrl = head(item.signals).sourceUrl
       FOREACH (fact IN item.signals |
         MERGE (s:Signal {id: fact.id})
         SET s += fact, s.orgId = $orgId
         MERGE (c)-[rel:HAS_SIGNAL]->(s)
         SET rel.sourceUrl = fact.sourceUrl, rel.observedAt = fact.observedAt
       )
       FOREACH (person IN item.people |
         MERGE (b:Person {id: person.id})
         SET b += person, b.orgId = $orgId
         MERGE (b)-[rel:WORKS_AT]->(c)
         SET rel.sourceUrl = person.sourceUrl
       )
     )
     WITH p
     OPTIONAL MATCH (stale:Competitor {orgId: $orgId})-[edge:COMPETES_WITH]->(p)
     WHERE NOT stale.id IN [item IN $rivals | item.id]
     DELETE edge
     WITH DISTINCT p
     FOREACH (item IN $rivals |
       MERGE (c:Competitor {id: item.id})
       SET c += item, c.orgId = $orgId
       MERGE (c)-[rel:COMPETES_WITH]->(p)
       SET rel.sourceUrl = item.sourceUrl
     )`, { orgId, productId, name: data.product.name, companies, rivals },
  );
}

export async function readGraphInsights(orgId: string, productId: string) {
  const [intros, buying, displacement] = await Promise.all([
    findWarmIntros(orgId, productId), findBuyingCycles(orgId, 30, productId), findDisplacements(orgId, productId),
  ]);
  return { intros, buying, displacement };
}
