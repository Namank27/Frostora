// Database access for the standalone Frostora server.
//
// Drizzle over libsql (@libsql/client), the same SQLite dialect the
// Muse app used, so the drizzle/0001-0008 migrations apply unchanged.
//
// DATABASE_URL decides the backend:
//   file:./frostora.db   -> local SQLite file (dev / single machine)
//   libsql://...          -> Turso (needs DATABASE_AUTH_TOKEN)

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate as migrateLibsql } from "drizzle-orm/libsql/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type Db = LibSQLDatabase<typeof schema>;

let dbInstance: Db | null = null;
let clientInstance: Client | null = null;

/** True when DATABASE_URL points at a local file (or is unset, which defaults to one). */
export function isLocalDb(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url === "" || url.startsWith("file:");
}

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./frostora.db";
}

/** Lazily creates (and then reuses) the Drizzle client. */
export function getDb(): Db {
  if (dbInstance) return dbInstance;
  const url = databaseUrl();
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  if (!url.startsWith("file:") && !authToken) {
    throw new Error(
      "DATABASE_URL is not a file: URL but DATABASE_AUTH_TOKEN is not set. " +
        "Turso (libsql://) requires an auth token; see SERVER-NOTES.md.",
    );
  }
  clientInstance = createClient({ url, authToken });
  dbInstance = drizzle(clientInstance, { schema });
  return dbInstance;
}

/** Close the underlying client (tests / graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (clientInstance) {
    clientInstance.close();
    clientInstance = null;
    dbInstance = null;
  }
}

/** Locate the drizzle migrations folder. The integrator may run the
 *  server from the repo root (drizzle/ at ./drizzle) or from inside
 *  server/ (drizzle/ at ../drizzle); MIGRATIONS_DIR overrides both. */
export function resolveMigrationsDir(): string | null {
  const candidates: string[] = [];
  if (process.env.MIGRATIONS_DIR) candidates.push(process.env.MIGRATIONS_DIR);
  candidates.push(path.join(process.cwd(), "drizzle"));
  try {
    candidates.push(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle"),
    );
  } catch {
    /* import.meta.url unavailable (CJS build) — cwd candidates still apply */
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "meta", "_journal.json"))) return dir;
  }
  return null;
}

/** Run drizzle/0001-0008 against a LOCAL file database.
 *
 *  For Turso this is a no-op by design: auto-migrating a shared remote
 *  database blindly on every server start is how a bad deploy wipes or
 *  locks production data. Run the migrations against Turso explicitly
 *  instead — see SERVER-NOTES.md ("Migrations on Turso"). */
export async function migrate(): Promise<void> {
  if (!isLocalDb()) {
    console.log("[db] Remote database detected; skipping auto-migration (see SERVER-NOTES.md).");
    return;
  }
  const dir = resolveMigrationsDir();
  if (!dir) {
    console.warn("[db] Migrations folder not found; skipping auto-migration.");
    return;
  }
  // Ensure the client exists before migrating (creates the file DB).
  const db = getDb();
  migrateLibsql(db, { migrationsFolder: dir });
  console.log(`[db] Migrations applied from ${dir}.`);
}
