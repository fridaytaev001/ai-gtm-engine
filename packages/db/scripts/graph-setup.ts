import { closeGraph, ensureGraphSchema } from "../src/graph";

await ensureGraphSchema();
console.log("Neo4j constraints and indexes are in place.");
await closeGraph();
