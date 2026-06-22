#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// GATE SUITE — schema drift (no db.prepare query references a column the live
// table doesn't have). Catches the entire `no such column` runtime-crash class
// that two adversarial playtests found (Vael's Expedition #30 + #R9–#R35, ~26
// bugs) — see docs/CONTRACT_ENFORCEMENT_STRATEGY.md (Gate C).
//
// METHOD (the playtester's, mechanized):
//   1. Derive the schema model STATICALLY from server/migrations/*.js — the
//      union of CREATE TABLE columns + ALTER TABLE ADD COLUMN. The migrations
//      ARE the source of truth; no live DB / boot needed.
//   2. Scan db.prepare(`…`) / db.prepare("…") SQL across server/**/*.js.
//   3. Flag column refs absent from the target table, for the HIGH-PRECISION
//      query shapes only (near-zero false positive):
//        - INSERT INTO t (cols…)          — column list is unambiguous
//        - UPDATE t SET col = …           — assignment targets are unambiguous
//        - single-table SELECT … FROM t   — no JOIN / no second FROM table, so
//          every bare column identifier belongs to t (WHERE + SET + select-list)
//      Multi-table / JOIN / subquery-bearing queries are SKIPPED (alias
//      ambiguity is where false positives live — the report excluded them too).
//   4. RATCHET: FLOOR is the measured count; --ci exits 1 when violations exceed
//      it. Drive to 0 as the cluster is fixed.
//
// Run: node scripts/audit/gates/schema-drift.mjs [--ci] [--floor=N] [--list]
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const SERVER = path.join(ROOT, "server");
const MIGRATIONS = path.join(SERVER, "migrations");

// The measured pre-existing drift (Vael's Expedition I–III). The gate prepare()s
// every static query against the live in-memory schema, so this IS the exact
// count of ghost-table + wrong-column sites — not an estimate. RATCHET DOWN as
// each is fixed; the goal is 0. New drift beyond the floor fails --ci.
const DEFAULT_FLOOR = 0;
const floorArg = process.argv.find((a) => a.startsWith("--floor="));
let FLOOR = floorArg ? parseInt(floorArg.split("=")[1], 10) : DEFAULT_FLOOR;
const CI = process.argv.includes("--ci");
const LIST = process.argv.includes("--list");

// Documented false positives (hand-verified) — keep the gate trustworthy.
//  - secrets.js:219 — the flagged `user_id` belongs to a secret_discoveries
//    subquery, not `secrets` (reported honestly by the playtester).
const FP_EXCLUDE = new Set([
  // "file:col:table" tuples — verified non-drift (no valid target exists; the
  // call site is try/caught and degrades gracefully). Each is a feature-gap, not
  // a rename-drift, so it can't be "fixed" by pointing at the right column:
  //  - provenance: the audit's OWN catch returns "table_missing" by design —
  //    `lenses` is a frontend/registry concept, never a DB table.
  "server/lib/audit/provenance.js:null:lenses",
  //  - account-lifecycle: GDPR merge anonymises `citations.citing_user_id`, but
  //    no per-user citation table exists (dtu_citations is aggregate). No-op.
  "server/lib/account-lifecycle.js:null:citations",
  //  - kingdoms: procgen_regions has no faction column (regions aren't
  //    faction-owned); the realm-territory assignment is dormant until a
  //    faction→region link exists.
  "server/lib/kingdoms.js:faction_id:null",
  //  - collective-face: `political_offices` (elected-leader governance) was never
  //    built; the probe is safe()-wrapped and falls through to other face
  //    resolution. Feature-gap, not a rename.
  "server/lib/collective-face.js:null:political_offices",
  //  - npc-dossier: lineage is explicitly conditional ("if the bloodline table is
  //    present"); `npc_bloodline` is an optional dynasty feature that doesn't exist
  //    yet — the safe() probe returns null. Feature-gap, not a rename.
  "server/lib/npc-dossier.js:null:npc_bloodline",
]);

// SQLite keywords / functions we must never treat as column identifiers.
const SQL_KEYWORDS = new Set([
  "select", "from", "where", "and", "or", "not", "in", "is", "null", "like",
  "between", "order", "by", "group", "having", "limit", "offset", "as", "on",
  "join", "inner", "left", "right", "outer", "cross", "union", "all", "distinct",
  "insert", "into", "values", "update", "set", "delete", "case", "when", "then",
  "else", "end", "asc", "desc", "count", "sum", "avg", "min", "max", "coalesce",
  "json_extract", "json_patch", "json_set", "json_object", "json_group_array",
  "datetime", "unixepoch", "strftime", "abs", "length", "lower", "upper", "cast",
  "exists", "replace", "ifnull", "nullif", "true", "false", "default", "with",
  "returning", "conflict", "do", "nothing", "excluded", "glob", "instr", "trim",
]);

const CONSTRAINT_HEADS = new Set([
  "primary", "foreign", "unique", "check", "constraint", "key",
]);

// ── 1. derive the REAL schema by running migrations on an in-memory DB ────────
// Static SQL-parsing under-models tables whose columns are added via JS helpers
// (e.g. addNpcCol(...)) rather than literal ALTER TABLE — which caused mass false
// positives. Running the migrations' up(db) on a :memory: better-sqlite3 and
// PRAGMA-ing the result IS the playtester's method, and gives the exact live
// schema with zero parsing error.

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((f) => path.join(MIGRATIONS, f));
}

async function buildSchema() {
  let Database;
  try {
    const require = createRequire(path.join(SERVER, "package.json"));
    Database = require("better-sqlite3");
  } catch {
    return null; // deps unavailable — caller SKIPs gracefully (CI installs server deps)
  }
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  let applied = 0, failed = 0;
  for (const file of migrationFiles()) {
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.up === "function") { mod.up(db); applied++; }
    } catch {
      failed++; // a migration that can't run in isolation just leaves its tables
                // out of the model → those tables are skipped, never false-flagged
    }
  }
  return { db, applied, failed };
}

// PRAGMA the in-memory DB into a { table -> Set(columns) } model.
function readSchema(db) {
  const schema = new Map();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all();
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all();
    schema.set(name, new Set(cols.map((c) => c.name)));
  }
  return schema;
}

// ── 2. scan db.prepare SQL ───────────────────────────────────────────────────

// Files whose db.prepare SQL targets a DIFFERENT database than Concord's — the
// forge template generator emits SQL for the *generated* app's own schema, not
// Concord's tables (the playtester excluded these too).
const FILE_EXCLUDE = /forge-template-(engine|generator)\.js$/;

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "migrations" || e.name === "tests") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (e.name.endsWith(".js") && !FILE_EXCLUDE.test(e.name)) out.push(p);
  }
  return out;
}

// Extract the SQL string literal(s) passed to db.prepare( … ). Handles backtick,
// single, and double quotes. Returns { raw, sql, interpolated, index }:
//   raw          — the literal SQL (only valid when not interpolated)
//   sql          — ${…} collapsed to a neutral token (for the regex fallback)
//   interpolated — had a ${…} → can't be statically prepare()'d
function extractPreparedSql(src) {
  const out = [];
  const re = /\.prepare\(\s*([`'"])/g;
  let m;
  while ((m = re.exec(src))) {
    const quote = m[1];
    let i = re.lastIndex, raw = "";
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "\\") { raw += ch + (src[i + 1] || ""); i++; continue; }
      if (ch === quote) break;
      raw += ch;
    }
    const interpolated = /\$\{/.test(raw);
    const sql = raw.replace(/\$\{[^}]*\}/g, " _ ");
    // unescape the JS-string escapes so SQLite sees real newlines/quotes
    const unescaped = raw.replace(/\\([\\'"`nrt])/g, (_, c) =>
      c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c);
    out.push({ raw: unescaped, sql, interpolated, index: m.index });
  }
  return out;
}

function lineForIndex(src, index) {
  return src.slice(0, index).split("\n").length;
}

const RW_KEYWORD = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;
const COMPARATORS = "(?:=|==|<=|>=|<>|!=|<|>|\\bIN\\b|\\bIS\\b|\\bNOT\\b|\\bLIKE\\b|\\bGLOB\\b|\\bBETWEEN\\b)";

// Strip string literals so 'creature' / 'chronicle' don't read as columns, and
// collapse whitespace. Keeps the query shape intact for the targeted matchers.
function normalize(sql) {
  return sql
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")  // single-quoted literals
    .replace(/\s+/g, " ")
    .trim();
}

function analyzeQuery(sql, schema) {
  // Returns array of { table, column } violations for HIGH-PRECISION shapes only.
  const flat = normalize(sql);
  if (!RW_KEYWORD.test(flat)) return [];
  const violations = [];
  const has = (t, c) => schema.get(t)?.has(c);
  const known = (t) => schema.has(t);

  // INSERT INTO t (cols…) — unambiguous column list.
  let m = flat.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"']?([a-zA-Z_]\w*)[`"']?\s*\(([^)]*)\)/i);
  if (m) {
    const table = m[1];
    if (known(table)) {
      for (const raw of m[2].split(",")) {
        const c = raw.trim().replace(/[`"']/g, "");
        if (/^[a-zA-Z_]\w*$/.test(c) && c !== "_" && !has(table, c)) violations.push({ table, column: c });
      }
    }
    return violations;
  }

  // UPDATE t SET a = …, b = … — unambiguous assignment targets (stop at WHERE).
  m = flat.match(/UPDATE\s+[`"']?([a-zA-Z_]\w*)[`"']?\s+SET\s+(.*?)(?:\bWHERE\b|$)/i);
  if (m) {
    const table = m[1];
    if (known(table)) {
      const assignRe = /(?:^|,)\s*[`"']?([a-zA-Z_]\w*)[`"']?\s*=/g;
      let a;
      while ((a = assignRe.exec(m[2]))) {
        if (!has(table, a[1])) violations.push({ table, column: a[1] });
      }
    }
    return violations;
  }

  // single-table SELECT/DELETE: only the WHERE-clause LHS column refs, and only
  // when exactly one table is referenced with no JOIN / subquery — so every such
  // ident provably belongs to that table. (Select-list idents are skipped: their
  // aliases / functions / casts are where false positives live.)
  if (/^SELECT\b|^DELETE\b/i.test(flat)) {
    if (/\bJOIN\b/i.test(flat)) return [];
    if (/\(\s*SELECT\b/i.test(flat)) return [];
    const froms = [...flat.matchAll(/\bFROM\s+[`"']?([a-zA-Z_]\w*)[`"']?/gi)].map((x) => x[1]);
    if (froms.length !== 1) return [];
    const table = froms[0];
    if (!known(table)) return [];
    const whereIdx = flat.search(/\bWHERE\b/i);
    if (whereIdx < 0) return [];
    const where = flat.slice(whereIdx);
    // column refs that are the LHS of a comparison: `<col> <op>`
    const colRe = new RegExp(`(?:\\bWHERE\\b|\\bAND\\b|\\bOR\\b|\\bON\\b|\\(|,)\\s*[\`"']?([a-zA-Z_]\\w*)[\`"']?\\s*${COMPARATORS}`, "gi");
    const seen = new Set();
    let c;
    while ((c = colRe.exec(where))) {
      const col = c[1];
      if (seen.has(col) || col === "_" || col === table) continue;
      seen.add(col);
      if (SQL_KEYWORDS.has(col.toLowerCase())) continue;
      if (!has(table, col)) violations.push({ table, column: col });
    }
    return violations;
  }

  return violations;
}

// ── run ──────────────────────────────────────────────────────────────────────

// Table-valued functions / pseudo-tables that aren't real tables.
const TABLE_FN = new Set(["json_each", "json_tree", "generate_series"]);
// Real tables created by the migration RUNNER (not a migration's up()), so they
// aren't in the migrated schema model but exist at runtime.
const RUNTIME_TABLES = new Set(["schema_migrations"]);

// Extract every real table referenced (FROM/JOIN/INTO/UPDATE/DELETE-FROM) plus
// the CTE names declared by a leading WITH (so they aren't mistaken for tables).
function extractTableRefs(sql) {
  const flat = normalize(sql);
  const ctes = new Set();
  if (/^\s*WITH\b/i.test(flat)) {
    // name AS ( … )  or  name (col, col) AS ( … )  — recursive & multi-CTE
    const cteRe = /(?:\bWITH\b(?:\s+RECURSIVE)?|,)\s+([a-zA-Z_]\w*)\s*(?:\([^)]*\))?\s+AS\s*\(/gi;
    let c;
    while ((c = cteRe.exec(flat))) ctes.add(c[1].toLowerCase());
  }
  const tables = [];
  const tableRe = /\b(?:FROM|JOIN|INTO|UPDATE)\s+[`"']?([a-zA-Z_]\w*)[`"']?(\s*\()?/gi;
  let m;
  while ((m = tableRe.exec(flat))) {
    const t = m[1];
    if (m[2]) continue;                       // table-valued function: name(
    if (t === "_" || /^sqlite_/i.test(t)) continue;
    if (SQL_KEYWORDS.has(t.toLowerCase())) continue; // e.g. "DO UPDATE SET" → SET
    if (TABLE_FN.has(t.toLowerCase()) || RUNTIME_TABLES.has(t.toLowerCase())) continue;
    tables.push(t);
  }
  return { tables, ctes };
}

// Exec every non-interpolated CREATE TABLE found in PRODUCTION source onto the
// migrated DB, so lazily/runtime-created tables exist when we prepare() queries
// against them (otherwise they'd false-flag as ghosts). FK off → cross-refs fine.
function execSourceCreates(db, files) {
  let created = 0;
  const names = new Set();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const re = /CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([a-zA-Z_]\w*)[`"']?\s*\(/gi;
    let m;
    while ((m = re.exec(src))) {
      names.add(m[1].toLowerCase());
      const start = m.index;
      let i = re.lastIndex - 1, depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") { depth--; if (depth === 0) { i++; break; } }
      }
      let stmt = src.slice(start, i);
      if (/\$\{/.test(stmt)) continue; // interpolated — can't exec; name still known
      stmt = stmt
        .replace(/\\([\\'"`nrt])/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c))
        .replace(/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, "CREATE TABLE IF NOT EXISTS ");
      try { db.exec(stmt + ";"); created++; }
      catch { /* a create that can't run in isolation just stays absent */ }
    }
  }
  return { created, names };
}

// prepare() a static query against the live schema — SQLite's own parser surfaces
// EVERY ghost-table / wrong-column site (incl. JOINs/multi-table the regex skips).
function preparedViolations(db, rawSql, knownTables) {
  try { db.prepare(rawSql); return []; }
  catch (e) {
    const msg = String(e?.message || "");
    let m;
    if ((m = msg.match(/no such table:\s*([a-zA-Z_]\w*)/i))) {
      const t = m[1];
      if (knownTables.has(t.toLowerCase()) || /^sqlite_/i.test(t)) return [];
      return [{ kind: "ghost_table", table: t, column: null }];
    }
    if ((m = msg.match(/no such column:\s*([a-zA-Z_][\w.]*)/i))) {
      const ref = m[1];
      const column = ref.includes(".") ? ref.split(".").pop() : ref;
      const table = ref.includes(".") ? ref.split(".")[0] : null;
      return [{ kind: "column", table, column }];
    }
    return []; // syntax / no-such-function from partial extraction — not our class
  }
}

const built = await buildSchema();
if (built === null) {
  console.log("[schema-drift] SKIP — better-sqlite3 unavailable; gate runs locally + in server-installed jobs.");
  process.exit(0);
}
const { db, applied, failed } = built;
const files = sourceFiles(SERVER);

// Pull lazy/runtime CREATE TABLEs into the DB; collect their names too (for the
// ones whose CREATE is interpolated and couldn't be exec'd). Test-only creates
// are excluded (sourceFiles skips tests/), so user_wallets/city_presence/
// quest_state (created only in tests) stay ghosts.
const { names: sourceCreateNames } = execSourceCreates(db, files);
const schema = readSchema(db);
schema._meta = { applied, failed };
const knownTables = new Set([...schema.keys()].map((t) => t.toLowerCase()));
for (const n of sourceCreateNames) knownTables.add(n);
// Real-but-not-in-a-migration tables, suppressed honestly:
//  - schema_migrations: created by the migration RUNNER, not a migration up().
//  - creative_artifact_listings: an optional "v2" table the marketplace probes
//    and falls back to v1 when absent — the playtester verified + excluded it.
//  - literary_vec: a sqlite-vec `vec0` VIRTUAL TABLE created at runtime by
//    server/lib/literary-vec.js#ensureVec() (needs the loadable sqlite-vec
//    extension this in-memory gate DB lacks, so its CREATE can't be exec'd here).
//    LRL degrades gracefully when it's absent — ADR 009.
for (const n of ["schema_migrations", "creative_artifact_listings", "literary_vec"]) knownTables.add(n);

const violations = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(".prepare(")) continue;
  const rel = path.relative(ROOT, file);
  for (const { raw, sql, interpolated, index } of extractPreparedSql(src)) {
    if (!RW_KEYWORD.test(sql)) continue;
    const line = lineForIndex(src, index);

    if (!interpolated) {
      // PRIMARY PATH — let SQLite validate the whole statement.
      for (const v of preparedViolations(db, raw, knownTables)) {
        const key = `${rel}:${v.column}:${v.table}`;
        if (FP_EXCLUDE.has(key)) continue;
        violations.push({ file: rel, line, ...v });
      }
      continue;
    }

    // FALLBACK for interpolated SQL (can't prepare) — the conservative regex
    // ghost-table + high-precision column checks.
    try {
      const { tables, ctes } = extractTableRefs(sql);
      for (const t of tables) {
        const lt = t.toLowerCase();
        if (ctes.has(lt) || knownTables.has(lt)) continue;
        if (FP_EXCLUDE.has(`${rel}:${t}`)) continue;
        violations.push({ file: rel, line, kind: "ghost_table", table: t, column: null });
      }
    } catch { /* skip */ }
    let found;
    try { found = analyzeQuery(sql, schema); } catch { found = []; }
    for (const v of found) {
      if (v.column === "_") continue;
      if (FP_EXCLUDE.has(`${rel}:${v.column}:${v.table}`)) continue;
      violations.push({ file: rel, line, kind: "column", ...v });
    }
  }
}

// de-dupe identical (file,line,kind,table,column)
const seen = new Set();
const unique = violations.filter((v) => {
  const k = `${v.file}:${v.line}:${v.kind}:${v.table}:${v.column}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const ghosts = unique.filter((v) => v.kind === "ghost_table");
const columns = unique.filter((v) => v.kind === "column");
const meta = schema._meta || {};
console.log(`[schema-drift] ${schema.size} tables (migrations: ${meta.applied} applied, ${meta.failed} skipped), ${files.length} source files scanned`);
console.log(`[schema-drift] violations: ${unique.length} (floor ${FLOOR}) — ${columns.length} column-drift, ${ghosts.length} ghost-table`);
if (LIST || unique.length) {
  for (const v of unique.slice(0, 120)) {
    console.log(v.kind === "ghost_table"
      ? `   ✗ ${v.file}:${v.line} — ghost table: ${v.table}`
      : `   ✗ ${v.file}:${v.line} — ${v.table} ✗ ${v.column}`);
  }
}

// Write the report alongside the other gates for CI + committed tracking.
const report = {
  generatedAt: new Date().toISOString(),
  tablesModelled: schema.size,
  migrationsApplied: meta.applied,
  sourceFiles: files.length,
  floor: FLOOR,
  violationCount: unique.length,
  violations: unique,
};
try {
  fs.writeFileSync(path.join(ROOT, "audit/gate-schema-drift.json"), JSON.stringify(report, null, 2));
} catch { /* best-effort */ }

if (CI && unique.length > FLOOR) {
  console.error(`[schema-drift] ✗ ${unique.length} > floor ${FLOOR} — fix the column drift or ratchet`);
  process.exit(1);
}
if (!unique.length) console.log("[schema-drift] ✓ no column drift in the high-precision query shapes");
else console.log(`[schema-drift] ✓ at/under floor ${FLOOR} (ratchet down toward 0)`);
