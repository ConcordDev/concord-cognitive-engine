/**
 * Migration runner for Concord Cognitive Engine.
 *
 * Manages schema_version table and applies numbered migrations in order.
 * Invoked at backend startup and via `npm run migrate`.
 *
 * Usage:
 *   node migrate.js                  # Apply pending migrations
 *   node migrate.js --status         # Show current schema version
 *   node migrate.js --rollback       # Rollback the last applied migration
 *   node migrate.js --rollback 5     # Rollback to version 5 (exclusive)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "concord.db");

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch {
  // Will be handled below
}

// List migration files with their NUMERIC version, correctly ordered.
//
// FIXED (audit 2026-07-27) — this used to be `^\d{3}_.*\.js$` + `.sort()` +
// `parseInt(file.slice(0, 3), 10)` at both call sites. That combination
// silently breaks once migration numbers pass 3 digits (this tree is at
// 396, 4 migrations of headroom at the time of this fix):
//   - The regex still MATCHES a 4-digit file (`\d{3}` consumes the first 3
//     digits, `.*` consumes the rest) — so it isn't excluded, it's just
//     mis-parsed.
//   - `file.slice(0, 3)` on "1000_foo.js" yields "100", not 1000.
//   - `parseInt("100") <= currentVersion` (396) is true, so migration 1000
//     is SILENTLY SKIPPED — no error, no warning, it just never runs.
//   - `.sort()` is lexicographic on the filename STRING, so "1000_foo.js"
//     also sorts BEFORE "397_bar.js" — ordering breaks before the skip
//     even matters.
// Fixed with a variable-width capture + a stable numeric sort, so this is
// correct for any future migration count, not just the next 4.
function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .map((f) => {
      const m = f.match(/^(\d+)_.*\.js$/);
      return m ? { file: f, version: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

/**
 * Run all pending migrations against the given database instance.
 * If no db is provided, opens the default database.
 * Returns { appliedCount, currentVersion, error? }
 */
export async function runMigrations(existingDb = null) {
  if (!Database && !existingDb) {
    console.warn("[Migrate] better-sqlite3 not available — skipping migrations");
    return { appliedCount: 0, currentVersion: 0, error: "no-sqlite" };
  }

  let db = existingDb;
  let shouldClose = false;

  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    shouldClose = true;
  }

  try {
    // Ensure schema_version table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Get current version
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get();
    const currentVersion = row?.v || 0;

    // Read migration files (format: 001_name.js — see listMigrationFiles
    // for why this must NOT be a fixed-3-digit regex + lexicographic sort).
    const migrationFiles = listMigrationFiles();

    let appliedCount = 0;

    for (const { file, version } of migrationFiles) {
      if (version <= currentVersion) continue;

      const migrationPath = path.join(MIGRATIONS_DIR, file);
      const migration = await import(`file://${migrationPath}`);

      if (typeof migration.up !== "function") {
        throw new Error(`Migration ${file} missing 'up' export`);
      }

      console.log(`[Migrate] Applying ${file}...`);

      // Run migration inside a transaction
      const tx = db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT INTO schema_version (version, name) VALUES (?, ?)"
        ).run(version, file.replace(/^\d+_/, "").replace(/\.js$/, ""));
      });
      tx();

      appliedCount++;
      console.log(`[Migrate] Applied ${file}`);
    }

    const finalRow = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get();
    const finalVersion = finalRow?.v || 0;

    if (appliedCount > 0) {
      console.log(
        `[Migrate] ${appliedCount} migration(s) applied. Schema version: ${finalVersion}`
      );
    } else {
      console.log(`[Migrate] Schema up to date at version ${finalVersion}`);
    }

    return { appliedCount, currentVersion: finalVersion };
  } catch (e) {
    console.error("[Migrate] Migration failed:", e.message);
    return { appliedCount: 0, currentVersion: 0, error: e.message };
  } finally {
    if (shouldClose && db) {
      db.close();
    }
  }
}

/**
 * Rollback migrations down to (but not including) the target version.
 * If no target is given, rolls back the single most recent migration.
 * Returns { rolledBack, currentVersion, error? }
 */
export async function rollbackMigrations(targetVersion = null, existingDb = null) {
  if (!Database && !existingDb) {
    console.warn("[Migrate] better-sqlite3 not available — skipping rollback");
    return { rolledBack: 0, currentVersion: 0, error: "no-sqlite" };
  }

  let db = existingDb;
  let shouldClose = false;

  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    shouldClose = true;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get();
    const currentVersion = row?.v || 0;

    if (currentVersion === 0) {
      console.log("[Migrate] No migrations to rollback.");
      return { rolledBack: 0, currentVersion: 0 };
    }

    // Default: rollback one step
    const target = targetVersion !== null ? Number(targetVersion) : currentVersion - 1;

    if (target >= currentVersion) {
      console.log(`[Migrate] Target version ${target} >= current version ${currentVersion}. Nothing to rollback.`);
      return { rolledBack: 0, currentVersion };
    }

    if (target < 0) {
      console.error("[Migrate] Target version cannot be negative.");
      return { rolledBack: 0, currentVersion, error: "invalid-target" };
    }

    // Get migrations to rollback (in reverse order)
    const applied = db
      .prepare("SELECT version, name FROM schema_version WHERE version > ? ORDER BY version DESC")
      .all(target);

    // Read migration files for down() functions (see listMigrationFiles for
    // why this must NOT be a fixed-3-digit regex + slice(0,3)/parseInt).
    const migrationFiles = listMigrationFiles();

    let rolledBack = 0;

    // @sql-loop-ok: migration runner — boot-time only, iterates fixed migration-files list
    for (const migration of applied) {
      const found = migrationFiles.find((mf) => mf.version === migration.version);
      const file = found?.file;

      if (!file) {
        console.warn(`[Migrate] Migration file for version ${migration.version} not found. Skipping.`);
        continue;
      }

      const migrationPath = path.join(MIGRATIONS_DIR, file);
      const mod = await import(`file://${migrationPath}`);

      if (typeof mod.down !== "function") {
        console.warn(`[Migrate] Migration ${file} has no 'down' export. Cannot rollback.`);
        return { rolledBack, currentVersion: migration.version, error: `no-down-in-${file}` };
      }

      console.log(`[Migrate] Rolling back ${file}...`);

      const tx = db.transaction(() => {
        mod.down(db);
        db.prepare("DELETE FROM schema_version WHERE version = ?").run(migration.version);
      });
      tx();

      rolledBack++;
      console.log(`[Migrate] Rolled back ${file}`);
    }

    const finalRow = db.prepare("SELECT MAX(version) as v FROM schema_version").get();
    const finalVersion = finalRow?.v || 0;

    console.log(`[Migrate] ${rolledBack} migration(s) rolled back. Schema version: ${finalVersion}`);
    return { rolledBack, currentVersion: finalVersion };
  } catch (e) {
    console.error("[Migrate] Rollback failed:", e.message);
    return { rolledBack: 0, currentVersion: 0, error: e.message };
  } finally {
    if (shouldClose && db) {
      db.close();
    }
  }
}

/**
 * Show current schema status.
 */
export function migrationStatus(existingDb = null) {
  if (!Database && !existingDb) {
    return { currentVersion: 0, migrations: [], error: "no-sqlite" };
  }

  let db = existingDb;
  let shouldClose = false;

  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    shouldClose = true;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const rows = db
      .prepare("SELECT version, name, applied_at FROM schema_version ORDER BY version")
      .all();
    const currentVersion = rows.length > 0 ? rows[rows.length - 1].version : 0;

    return { currentVersion, migrations: rows };
  } finally {
    if (shouldClose && db) {
      db.close();
    }
  }
}

// CLI mode
if (process.argv[1] && process.argv[1].endsWith("migrate.js")) {
  const rollbackIdx = process.argv.indexOf("--rollback");
  if (process.argv.includes("--status")) {
    const status = migrationStatus();
    console.log("Schema version:", status.currentVersion);
    if (status.migrations.length > 0) {
      console.table(status.migrations);
    } else {
      console.log("No migrations applied yet.");
    }
  } else if (rollbackIdx !== -1) {
    const targetArg = process.argv[rollbackIdx + 1];
    const target = targetArg && !targetArg.startsWith("--") ? Number(targetArg) : null;
    const result = await rollbackMigrations(target);
    if (result.error) {
      console.error("Rollback error:", result.error);
      process.exit(1);
    }
  } else {
    await runMigrations();
  }
}
