#!/usr/bin/env node
// server/scripts/apply-dila-identity-memo.mjs
//
// One-shot CLI to apply migration 400 + the Dila identity memo to a
// live SQLite file. Used by ~/.hermes/scripts/concord-env-bootstrap.sh
// after the env-var rotation block.
//
// Idempotent: re-runs are no-ops. The memo row is ON CONFLICT-stable.
// If migration 400 already ran (hermes_dtus exists), only the memo
// row is written; if it didn't run, we apply it directly.
//
// Usage:
//   node scripts/apply-dila-identity-memo.mjs --db=/path/to/concord.sqlite
//
// Exit codes:
//   0  success (memo applied OR already present)
//   1  db file not found / not readable
//   2  required user table missing
//   3  sqlite open failure

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArg(name, fallback) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return fallback;
}

const dbPath = parseArg("db", "");
if (!dbPath) {
  console.error("FATAL: --db=<path> required");
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error(`FATAL: db file not found: ${dbPath}`);
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
} catch (e) {
  console.error(`FATAL: cannot open db: ${e.message}`);
  process.exit(3);
}

// 1. Ensure users table exists (else the migration 400 INSERT will
//    fail). Most operational DBs already have it from migration 001.
const usersExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
  .get();
if (!usersExists) {
  console.error("FATAL: users table missing — has migration 001 been applied?");
  process.exit(2);
}

// 2. Apply migration 400 directly if hermes_dtus doesn't exist.
const hasHermesDilusTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hermes_dtus'")
  .get();

if (!hasHermesDilusTable) {
  const mig = await import(resolve(__dirname, "../migrations/400_hermes_dila.js"));
  mig.up(db);
  console.log("migration 400 applied");
} else {
  console.log("migration 400 already applied — skipping");
}

// 3. Apply the identity memo.
const memo = await import(resolve(__dirname, "../lib/dila-identity-memo.js"));
memo.applyIdentityMemo(db);
console.log("identity memo applied (id='hermes_identity_memo_v1')");

// 4. Audit-print the row so the operator sees the on-disk state.
const row = db
  .prepare(
    "SELECT id, title, memory_kind, visibility, length(body_json) AS body_bytes FROM hermes_dtus WHERE id = ?",
  )
  .get("hermes_identity_memo_v1");
if (row) {
  console.log(
    `row exists: title="${row.title}", kind=${row.memory_kind}, visibility=${row.visibility}, body=${row.body_bytes}b`,
  );
} else {
  console.error("FATAL: row did not round-trip after apply");
  process.exit(2);
}

db.close();
process.exit(0);