import neo4j, { type Driver, type QueryResult, type RecordShape } from "neo4j-driver";
import { getEnv, requireEnv } from "@gtm/core";
import { NODE_LABELS, REL_ENDPOINTS, type NodeLabel, type Provenance, type RelType } from "./ontology";

let driver: Driver | undefined;

export function getGraph(): Driver {
  if (driver) return driver;
  const env = getEnv();
  requireEnv(["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"], env);
  driver = neo4j.driver(env.NEO4J_URI!, neo4j.auth.basic(env.NEO4J_USERNAME!, env.NEO4J_PASSWORD!), {
    disableLosslessIntegers: true,
  });
  return driver;
}

export async function closeGraph(): Promise<void> {
  await driver?.close();
  driver = undefined;
}

/** Run a Cypher query. Always pass values as parameters, never by string concatenation. */
export async function runCypher<T extends RecordShape = RecordShape>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<QueryResult<T>> {
  return getGraph().executeQuery<QueryResult<T>>(cypher, params, { database: "neo4j" });
}

/** Unique id + org index per label. Safe to run repeatedly. */
export async function ensureGraphSchema(): Promise<void> {
  for (const label of NODE_LABELS) {
    await runCypher(
      `CREATE CONSTRAINT ${label.toLowerCase()}_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
    );
    await runCypher(`CREATE INDEX ${label.toLowerCase()}_org IF NOT EXISTS FOR (n:${label}) ON (n.orgId)`);
  }
}

function assertLabel(label: string): asserts label is NodeLabel {
  if (!(NODE_LABELS as readonly string[]).includes(label)) throw new Error(`Unknown node label: ${label}`);
}

/** Create or update a node by id. `props` are merged onto the node. */
export async function upsertNode(
  label: NodeLabel,
  id: string,
  orgId: string,
  props: Record<string, unknown> & Provenance = {},
): Promise<void> {
  assertLabel(label);
  await runCypher(
    `MERGE (n:${label} {id: $id})
     SET n += $props, n.orgId = $orgId, n.updatedAt = datetime()`,
    { id, orgId, props: { ...props, observedAt: props.observedAt ?? new Date().toISOString() } },
  );
}

/** Create or update a relationship between two existing nodes. Label pairs are checked against the ontology. */
export async function upsertRel(
  type: RelType,
  from: { label: NodeLabel; id: string },
  to: { label: NodeLabel; id: string },
  props: Record<string, unknown> & Provenance = {},
): Promise<void> {
  const [fromLabels, toLabels] = REL_ENDPOINTS[type];
  if (!fromLabels.includes(from.label) || !toLabels.includes(to.label)) {
    throw new Error(`${type} cannot connect ${from.label} -> ${to.label}`);
  }
  const res = await runCypher(
    `MATCH (a:${from.label} {id: $fromId}), (b:${to.label} {id: $toId})
     MERGE (a)-[r:${type}]->(b)
     SET r += $props
     RETURN count(r) AS n`,
    { fromId: from.id, toId: to.id, props: { ...props, observedAt: props.observedAt ?? new Date().toISOString() } },
  );
  if ((res.records[0]?.get("n") ?? 0) === 0) {
    throw new Error(`upsertRel ${type}: missing node ${from.label}:${from.id} or ${to.label}:${to.id}`);
  }
}

/** Remove every node belonging to an org (used by the seed script to reset demo data). */
export async function deleteOrgGraph(orgId: string): Promise<void> {
  await runCypher(`MATCH (n {orgId: $orgId}) DETACH DELETE n`, { orgId });
}
