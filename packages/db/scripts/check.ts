/** Connectivity check for both databases. Prints row/node counts, never credentials. */
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/client";
import { closeGraph, runCypher } from "../src/graph";

const db = getDb();
const pg = await db.execute(sql`select current_database() as db, version() as version`);
console.log("Postgres OK:", (pg[0] as { db: string }).db);

const neo = await runCypher(`MATCH (n) RETURN count(n) AS nodes`);
console.log("Neo4j OK:", neo.records[0]?.get("nodes"), "nodes");

await closeDb();
await closeGraph();
