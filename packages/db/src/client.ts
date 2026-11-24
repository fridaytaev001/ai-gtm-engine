import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv, requireEnv } from "@gtm/core";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let sqlClient: postgres.Sql | undefined;
let db: Db | undefined;

/** Lazily create one pooled Postgres connection per process. */
export function getDb(): Db {
  if (db) return db;
  const env = getEnv();
  requireEnv(["DATABASE_URL"], env);
  sqlClient = postgres(env.DATABASE_URL!, {
    max: 5,
    prepare: false, // works behind poolers (Neon/Supabase transaction mode)
  });
  db = drizzle(sqlClient, { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  await sqlClient?.end({ timeout: 5 });
  sqlClient = undefined;
  db = undefined;
}
