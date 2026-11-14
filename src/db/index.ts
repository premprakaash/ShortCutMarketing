import path from "node:path";
import * as schema from "./schema";

/**
 * Database access.
 * - DATABASE_URL set   → real Postgres via node-postgres (production)
 * - DATABASE_URL empty → embedded Postgres (PGlite) stored in ./.data (development)
 * Migrations in ./drizzle are applied automatically on first use.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

let dbPromise: Promise<Db> | null = null;

async function createDb(): Promise<Db> {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  const url = process.env.DATABASE_URL;

  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const db = drizzle(new Pool({ connectionString: url }), { schema });
    await migrate(db, { migrationsFolder });
    return db;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  const client = dataDir === "memory" ? new PGlite() : new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = createDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export { schema };
