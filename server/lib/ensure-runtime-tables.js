// @sync-fs-ok: boot-time runtime-table provisioning scan. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// server/lib/ensure-runtime-tables.js
//
// #F1 — lazy-table fresh-install hazard.
//
// Dozens of tables in this codebase are created lazily at their first runtime
// call site via `db.exec("CREATE TABLE IF NOT EXISTS …")` rather than in a
// numbered migration (spell_cast_log, world_forecasts, knowledge_genomes,
// communes, world_vehicles, the agent/social_* scratch tables, forge_generations,
// …). On a long-lived box that's fine — the table exists the moment any code path
// touches it. But on a FRESH install the schema is non-deterministic until each of
// those paths has been exercised at least once: a JOIN against a not-yet-created
// table throws `no such table`, and the schema-drift gate (which runs every CREATE
// into its in-memory DB) sees a richer schema than a just-booted server actually has.
//
// This module closes that gap. It scans the server source for every NON-interpolated
// `CREATE TABLE IF NOT EXISTS` (and `CREATE INDEX IF NOT EXISTS`) statement and execs
// each idempotently at boot, right after `runSchemaMigrations(db)`. Because every
// statement is `IF NOT EXISTS`, a table a migration already created is a no-op (SQLite
// ignores the CREATE even if the column list differs), so this NEVER clobbers the
// authoritative migration schema — it only fills in the genuinely-absent runtime
// tables. Interpolated creates (`CREATE TABLE ${name}`) can't be exec'd statically and
// are skipped; they still create themselves at their call site as before.
//
// Mirrors the gate's `execSourceCreates` extractor (scripts/audit/gates/schema-drift.mjs)
// so the boot schema and the gate's modeled schema stay in lockstep.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");

// Directories whose runtime CREATEs we pre-materialise. Migrations are excluded —
// they are the authoritative schema and run separately via runSchemaMigrations.
// Tests are excluded so test-only fixtures (user_wallets, city_presence, quest_state,
// …) never leak into the production schema.
const SCAN_DIRS = ["domains", "lib", "routes", "emergent", "economy"];
const SCAN_ROOT_FILES = ["server.js", "guidance.js"];

function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "tests" || e.name === "migrations") continue;
      walk(full, acc);
    } else if (e.isFile() && e.name.endsWith(".js") && !e.name.endsWith(".test.js")) {
      acc.push(full);
    }
  }
  return acc;
}

function sourceFiles() {
  const files = [];
  for (const f of SCAN_ROOT_FILES) {
    const p = path.join(SERVER_ROOT, f);
    if (fs.existsSync(p)) files.push(p);
  }
  for (const d of SCAN_DIRS) walk(path.join(SERVER_ROOT, d), files);
  return files;
}

// Pull every non-interpolated CREATE TABLE / CREATE INDEX (IF NOT EXISTS or not)
// out of a source string, normalised to IF-NOT-EXISTS form.
function extractCreates(src) {
  const out = [];
  const re = /CREATE\s+(?:TEMP(?:ORARY)?\s+)?(TABLE|(?:UNIQUE\s+)?INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([a-zA-Z_]\w*)[`"']?/gi;
  let m;
  while ((m = re.exec(src))) {
    const kind = /TABLE/i.test(m[1]) ? "table" : "index";
    const name = m[2];
    const start = m.index;
    // Find the end of the statement. TABLE bodies are paren-balanced; INDEX
    // statements terminate at the first semicolon (their ON tbl(cols) has one
    // balanced paren group but no outer wrapper, so scan to `;`).
    let end;
    if (kind === "table") {
      // advance to the opening paren of the column list
      let i = re.lastIndex;
      while (i < src.length && src[i] !== "(") {
        // bail if we hit a statement terminator before the body (malformed slice)
        if (src[i] === ";") { i = -1; break; }
        i++;
      }
      if (i === -1 || i >= src.length) continue;
      let depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") { depth--; if (depth === 0) { i++; break; } }
      }
      end = i;
    } else {
      const semi = src.indexOf(";", re.lastIndex);
      const backtick = src.indexOf("`", re.lastIndex);
      // stop at the statement terminator; for template-literal exec calls the
      // closing backtick bounds it.
      end = semi === -1 ? (backtick === -1 ? src.length : backtick) : semi;
    }
    let stmt = src.slice(start, end);
    if (/\$\{/.test(stmt)) continue; // interpolated — handled at its own call site
    stmt = stmt
      .replace(/\\([\\'"`nrt])/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c))
      .replace(/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, "CREATE TABLE IF NOT EXISTS ")
      .replace(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, (full) =>
        /UNIQUE/i.test(full) ? "CREATE UNIQUE INDEX IF NOT EXISTS " : "CREATE INDEX IF NOT EXISTS ");
    out.push({ kind, name: name.toLowerCase(), stmt });
  }
  return out;
}

/**
 * Idempotently create every non-interpolated runtime table (and its indexes) at
 * boot. Safe to call on an already-migrated DB — every statement is IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ tablesCreated:number, indexesCreated:number, scanned:number, failed:number, names:string[] }}
 */
export function ensureRuntimeTables(db) {
  if (!db || typeof db.exec !== "function") {
    return { tablesCreated: 0, indexesCreated: 0, scanned: 0, failed: 0, names: [] };
  }
  const files = sourceFiles();
  const names = new Set();
  let tablesCreated = 0, indexesCreated = 0, scanned = 0, failed = 0;

  // Two passes: all tables first, then all indexes — so an index whose table is
  // defined in a different file still finds its table present.
  const tables = [];
  const indexes = [];
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (!/CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:TABLE|(?:UNIQUE\s+)?INDEX)/i.test(src)) continue;
    for (const c of extractCreates(src)) (c.kind === "table" ? tables : indexes).push(c);
  }

  for (const c of tables) {
    scanned++;
    names.add(c.name);
    try { db.exec(c.stmt + ";"); tablesCreated++; }
    catch { failed++; /* a create that can't run in isolation just stays absent */ }
  }
  for (const c of indexes) {
    scanned++;
    try { db.exec(c.stmt + ";"); indexesCreated++; }
    catch { failed++; /* index over a missing/interpolated table — harmless skip */ }
  }

  return { tablesCreated, indexesCreated, scanned, failed, names: [...names].sort() };
}

export default ensureRuntimeTables;
