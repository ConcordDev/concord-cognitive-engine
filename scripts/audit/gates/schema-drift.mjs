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

// The measured pre-existing drift count (Vael's Expedition #30 + #R9–#R35 + a
// few extras). RATCHET DOWN as each column ref is corrected; the goal is 0. New
// drift beyond this floor fails --ci. Override with --floor=N.
const DEFAULT_FLOOR = 49;
const floorArg = process.argv.find((a) => a.startsWith("--floor="));
let FLOOR = floorArg ? parseInt(floorArg.split("=")[1], 10) : DEFAULT_FLOOR;
const CI = process.argv.includes("--ci");
const LIST = process.argv.includes("--list");

// Documented false positives (hand-verified) — keep the gate trustworthy.
//  - secrets.js:219 — the flagged `user_id` belongs to a secret_discoveries
//    subquery, not `secrets` (reported honestly by the playtester).
const FP_EXCLUDE = new Set([
  // "file:col:table" tuples that are verified non-bugs
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
  const schema = new Map(); // table -> Set(columns)
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all();
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all();
    schema.set(name, new Set(cols.map((c) => c.name)));
  }
  db.close();
  schema._meta = { applied, failed, tables: schema.size };
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
// single, and double quotes. Returns array of { sql, index }.
function extractPreparedSql(src) {
  const out = [];
  const re = /\.prepare\(\s*([`'"])/g;
  let m;
  while ((m = re.exec(src))) {
    const quote = m[1];
    let i = re.lastIndex, sql = "";
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "\\") { sql += ch + (src[i + 1] || ""); i++; continue; }
      if (ch === quote) break;
      sql += ch;
    }
    // collapse template ${…} interpolations to a neutral token
    sql = sql.replace(/\$\{[^}]*\}/g, " _ ");
    out.push({ sql, index: m.index });
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

const schema = await buildSchema();
if (schema === null) {
  console.log("[schema-drift] SKIP — better-sqlite3 unavailable; gate runs locally + in server-installed jobs.");
  process.exit(0);
}
const files = sourceFiles(SERVER);
const violations = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(".prepare(")) continue;
  for (const { sql, index } of extractPreparedSql(src)) {
    if (!RW_KEYWORD.test(sql)) continue;
    let found;
    try { found = analyzeQuery(sql, schema); } catch { found = []; }
    for (const v of found) {
      if (v.column === "_") continue; // interpolated column name (`SET ${col}=…`) — not a literal ref
      const rel = path.relative(ROOT, file);
      const key = `${rel}:${v.column}:${v.table}`;
      if (FP_EXCLUDE.has(key)) continue;
      violations.push({ file: rel, line: lineForIndex(src, index), ...v });
    }
  }
}

// de-dupe identical (file,line,table,column)
const seen = new Set();
const unique = violations.filter((v) => {
  const k = `${v.file}:${v.line}:${v.table}:${v.column}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const meta = schema._meta || {};
console.log(`[schema-drift] ${schema.size} tables (migrations: ${meta.applied} applied, ${meta.failed} skipped), ${files.length} source files scanned`);
console.log(`[schema-drift] violations: ${unique.length} (floor ${FLOOR})`);
if (LIST || unique.length) {
  for (const v of unique.slice(0, 80)) {
    console.log(`   ✗ ${v.file}:${v.line} — ${v.table} ✗ ${v.column}`);
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
